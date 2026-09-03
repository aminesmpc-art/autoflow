"""
Per-user ceilings on the endpoints that cost money but charge no quota.

/api/clip/read is metered: it reserves a daily job against the Django-owned
allowance before any model work starts, and fails closed if that authority
cannot be reached. /api/clip/ask had nothing. Only `verify_jwt` stood in front
of it, so any account that could sign in could call it without limit — and
every call puts a prompt, and sometimes eight stills, in front of a model.

That was survivable while the ranking was the only thing going through it. It
is not now: a clipping run puts the survey, up to four line locates per cut,
a speaker-position ask per cut and an edit-sheet ask per cut through the same
door, and none of it is counted anywhere.

── Why a rate limit and not a quota ──────────────────────────────────────

A quota would have to know the caller's plan — free is one reading a day, Pro
is ten — and the plan lives in Django. Asking for it on every ask would put a
second network hop on the hot path of a loop that already runs dozens of times
per video, to answer a question that changes about once a month.

A rate limit needs nothing external and stops the shape the abuse actually
takes. The numbers are set so far above legitimate use that a real run cannot
reach them: the heaviest honest run the website will produce is 46 asks
(6 + 2N, capped at twenty clips), spread over minutes of decoding and
encoding, and the extension's is bounded by how fast a person can lay out
cut nodes.

── Why it fails open ─────────────────────────────────────────────────────

Deliberately the opposite choice to consume_clipping_quota next door, and the
reasoning is not "this one matters less" — it is that the two protect
different things.

That one is the authority for an allowance somebody paid for, guarding a call
that costs about 160k tokens. Letting it through on an outage would turn a
Redis blip into free readings, so it fails closed.

This one bounds abuse of a 3.5k-token call. If Redis is unreachable and this
fails closed, every clipping run everywhere stops — and the expensive door is
still locked, because the reading quota is a separate authority that is still
failing closed. So an outage here degrades to exactly today's behaviour, which
is no limit at all, rather than to an outage of the product.

An error is logged rather than swallowed silently, because "the limiter has
been off for a week" should be discoverable.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from fastapi import HTTPException, status

from app.config import get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Window:
    """One counter: how many, over how long, and what to call it."""

    name: str
    seconds: int
    limit: int


class AskRateLimiter:
    """
    Fixed windows in Redis, with an in-process fallback for tests and local runs.

    Fixed rather than sliding on purpose. A sliding window needs a sorted set
    per user and a trim on every call; a fixed one is INCR plus EXPIRE, which
    is atomic in one round trip and cannot drift. The cost is that a caller can
    send up to 2x the per-minute limit across a window boundary, which at these
    numbers is not worth a data structure.
    """

    def __init__(self, namespace: str, windows: list[Window]):
        settings = get_settings()
        self._namespace = namespace
        self._windows = windows
        self._redis = None
        # {key: (count, expires_at)} — only used when there is no Redis.
        self._memory: dict[str, tuple[int, float]] = {}

        if settings.redis_url:
            try:
                import redis

                self._redis = redis.Redis.from_url(settings.redis_url, decode_responses=True)
                self._redis.ping()
            except Exception:
                # Constructed at import time; a Redis that is down then must not
                # stop the service booting. Counting falls back to per-process,
                # which is weaker across workers but better than nothing.
                logger.warning("rate limiter could not reach Redis; counting in-process", exc_info=True)
                self._redis = None

    def _key(self, user_id: str, window: Window, now: float) -> str:
        bucket = int(now // window.seconds)
        return f"{self._namespace}:{window.name}:{user_id}:{bucket}"

    def _bump_memory(self, key: str, ttl: int, now: float) -> int:
        count, expires_at = self._memory.get(key, (0, 0.0))
        if expires_at <= now:
            count = 0
        count += 1
        self._memory[key] = (count, now + ttl)
        # Cheap sweep; without it a long-lived process accumulates a key per
        # user per window for ever.
        if len(self._memory) > 4096:
            self._memory = {k: v for k, v in self._memory.items() if v[1] > now}
        return count

    def _bump(self, key: str, ttl: int, now: float) -> int | None:
        """The new count, or None when it could not be counted."""
        if self._redis is None:
            return self._bump_memory(key, ttl, now)
        try:
            pipe = self._redis.pipeline()
            pipe.incr(key)
            pipe.expire(key, ttl)
            return int(pipe.execute()[0])
        except Exception:
            logger.warning("rate limiter could not count against Redis; allowing", exc_info=True)
            return None

    def check(self, user_id: str) -> None:
        """Count one call and raise 429 if it puts the caller over any window."""
        now = time.time()
        for window in self._windows:
            count = self._bump(self._key(user_id, window, now), window.seconds, now)
            if count is None:
                # See the module docstring: an unreachable counter degrades to
                # today's behaviour rather than to an outage.
                continue
            if count > window.limit:
                retry_after = window.seconds - int(now % window.seconds)
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=(
                        f"Too many model asks — {window.limit} per {window.name} is the ceiling. "
                        "A clipping run makes a handful; this is far past one."
                    ),
                    headers={"Retry-After": str(max(1, retry_after))},
                )


_ask_limiter: AskRateLimiter | None = None


def ask_limiter() -> AskRateLimiter:
    """Built once, lazily, so importing this module needs no Redis."""
    global _ask_limiter
    if _ask_limiter is None:
        settings = get_settings()
        _ask_limiter = AskRateLimiter(
            "clip-ask",
            [
                Window("minute", 60, settings.clip_ask_per_minute),
                Window("day", 24 * 60 * 60, settings.clip_ask_per_day),
            ],
        )
    return _ask_limiter


def reset_ask_limiter() -> None:
    """Drop the built limiter. For tests that change the settings."""
    global _ask_limiter
    _ask_limiter = None
