"""Small job-state store with Redis durability and an in-process test fallback."""

from __future__ import annotations

import json
import time
from collections.abc import Iterator, MutableMapping
from typing import Any

from app.config import get_settings


class JobStore(MutableMapping[str, dict[str, Any]]):
    def __init__(self, namespace: str):
        settings = get_settings()
        self._namespace = namespace
        self._ttl = settings.job_state_ttl_sec
        self._memory: dict[str, dict[str, Any]] = {}
        self._redis = None
        if settings.redis_url:
            import redis

            self._redis = redis.Redis.from_url(settings.redis_url, decode_responses=True)
            self._redis.ping()

    def _key(self, job_id: str) -> str:
        return f"{self._namespace}:{job_id}"

    def __getitem__(self, job_id: str) -> dict[str, Any]:
        if self._redis is None:
            return self._memory[job_id]
        raw = self._redis.get(self._key(job_id))
        if raw is None:
            raise KeyError(job_id)
        return json.loads(raw)

    def __setitem__(self, job_id: str, value: dict[str, Any]) -> None:
        state = {**value, "updated_at": time.time()}
        if self._redis is None:
            self._memory[job_id] = state
            return
        self._redis.set(self._key(job_id), json.dumps(state), ex=self._ttl)

    def __delitem__(self, job_id: str) -> None:
        if self._redis is None:
            del self._memory[job_id]
            return
        if not self._redis.delete(self._key(job_id)):
            raise KeyError(job_id)

    def __iter__(self) -> Iterator[str]:
        if self._redis is None:
            return iter(self._memory)
        prefix = self._key("")
        return (key.removeprefix(prefix) for key in self._redis.scan_iter(f"{prefix}*"))

    def __len__(self) -> int:
        if self._redis is None:
            return len(self._memory)
        return sum(1 for _ in self.__iter__())

    def clear(self) -> None:
        if self._redis is None:
            self._memory.clear()
            return
        keys = list(self._redis.scan_iter(f"{self._key('')}*"))
        if keys:
            self._redis.delete(*keys)

    def update_job(self, job_id: str, **changes: Any) -> dict[str, Any]:
        state = self[job_id]
        state.update(changes)
        self[job_id] = state
        return state
