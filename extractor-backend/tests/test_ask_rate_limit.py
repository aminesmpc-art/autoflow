"""
The ceiling on /api/clip/ask.

That endpoint had only `verify_jwt` in front of it. /api/clip/read reserves a
daily job against the Django-owned allowance and fails closed when it cannot;
/ask reserved nothing, so any account that could sign in could put prompts —
and eight stills at a time — in front of a model without limit.

Three properties are worth pinning down, and two of them are about what the
limiter must NOT do:

  · it must count per user, or one heavy caller silences everyone else
  · it must refuse before the work, not after
  · it must fail OPEN when its counter is unreachable, because failing closed
    would turn a Redis blip into an outage of every clipping run — while the
    expensive door next to it stays locked either way, since the reading quota
    is a separate authority that still fails closed
"""

from __future__ import annotations

import time

import pytest
from fastapi import HTTPException

from app.rate_limit import AskRateLimiter, Window, ask_limiter, reset_ask_limiter


def limiter(**windows: int) -> AskRateLimiter:
    """An in-process limiter — no Redis configured, so it counts in memory."""
    made = AskRateLimiter(
        "test-ask",
        [Window(name, seconds, limit) for name, (seconds, limit) in windows.items()],
    )
    assert made._redis is None, "these tests must not need a Redis"
    return made


def test_allows_up_to_the_ceiling():
    rl = limiter(minute=(60, 3))
    for _ in range(3):
        rl.check("user-1")  # no raise


def test_refuses_the_one_past_it():
    rl = limiter(minute=(60, 2))
    rl.check("user-1")
    rl.check("user-1")

    with pytest.raises(HTTPException) as caught:
        rl.check("user-1")

    assert caught.value.status_code == 429
    assert "2 per minute" in caught.value.detail
    # Something a client can act on rather than guess at.
    assert int(caught.value.headers["Retry-After"]) >= 1


def test_counts_each_user_separately():
    """Otherwise the first heavy run of the day locks out everybody else."""
    rl = limiter(minute=(60, 1))
    rl.check("user-1")

    rl.check("user-2")  # unaffected

    with pytest.raises(HTTPException):
        rl.check("user-1")


def test_every_window_applies():
    """A caller under the per-minute ceiling can still be over the daily one."""
    rl = limiter(minute=(60, 100), day=(86_400, 2))
    rl.check("u")
    rl.check("u")

    with pytest.raises(HTTPException) as caught:
        rl.check("u")

    assert "2 per day" in caught.value.detail


def test_a_new_window_starts_fresh():
    rl = limiter(short=(1, 1))
    rl.check("u")
    with pytest.raises(HTTPException):
        rl.check("u")

    time.sleep(1.05)

    rl.check("u")  # the bucket rolled over


def test_fails_open_when_the_counter_is_unreachable():
    """
    The load-bearing one. If this failed closed, a Redis outage would stop
    every clipping run in the product — while buying nothing, because the
    expensive call is metered by a different authority that still fails closed.
    An outage here degrades to the behaviour we had before this file existed.
    """
    rl = limiter(minute=(60, 1))

    class Broken:
        def pipeline(self):
            raise ConnectionError("redis is gone")

    rl._redis = Broken()

    for _ in range(50):
        rl.check("u")  # no raise, and nothing counted


def test_the_shared_limiter_is_built_from_settings():
    reset_ask_limiter()
    try:
        rl = ask_limiter()
        names = {w.name: w.limit for w in rl._windows}
        assert set(names) == {"minute", "day"}
        # Far above the heaviest legitimate run, which is 46 asks.
        assert names["minute"] >= 46
        assert names["day"] >= names["minute"]
        assert ask_limiter() is rl, "built once, not per call"
    finally:
        reset_ask_limiter()


def test_memory_counters_do_not_grow_for_ever():
    """A long-lived worker would otherwise keep a key per user per window."""
    rl = limiter(short=(1, 10_000))
    for i in range(5000):
        rl.check(f"user-{i}")

    time.sleep(1.05)
    rl.check("someone-else")

    assert len(rl._memory) < 4096
