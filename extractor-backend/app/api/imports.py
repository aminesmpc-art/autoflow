"""Authenticated download-only endpoint for Motion's explicit import action."""
import asyncio
import shutil
import tempfile
import threading
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from app.auth import authenticated_user_id, security, verify_jwt
from app.config import get_settings
from app.social_download import MAX_BYTES, canonical_video, run_download

router = APIRouter()
settings = get_settings()
_active: set[str] = set()
_counts: dict[tuple[str, int], int] = {}
_lock = threading.Lock()


class ImportVideo(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    reuse_permission: bool = False


class TemporaryVideo(FileResponse):
    def __init__(self, *args, cleanup, **kwargs):
        super().__init__(*args, **kwargs)
        self.cleanup = cleanup

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.cleanup()


def admit(owner: str) -> None:
    """Fail-closed Redis counter, or single-process development limiter."""
    bucket = int(time.time() // 3600)
    if settings.redis_url:
        try:
            import redis
            client = redis.Redis.from_url(settings.redis_url, socket_timeout=3, socket_connect_timeout=3)
            count = client.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],3600) end; return n", 1, f"motion-import:{owner}:{bucket}")
        except Exception as exc:
            raise HTTPException(503, "Download allowance could not be checked. Try later.") from exc
    else:
        with _lock:
            for key in list(_counts):
                if key[1] != bucket:
                    del _counts[key]
            key = owner, bucket
            _counts[key] = _counts.get(key, 0) + 1
            count = _counts[key]
    if count > settings.social_imports_per_hour:
        raise HTTPException(429, "Too many video imports. Try again later.", headers={"Retry-After": str(3600 - int(time.time() % 3600))})


async def active_account(token: str) -> None:
    """No generation reservation; just check that this account is still active."""
    try:
        async with httpx.AsyncClient(timeout=8, trust_env=False, follow_redirects=False) as client:
            response = await client.get(f"{settings.django_api_url.rstrip('/')}/motion/entitlements", headers={"Authorization": f"Bearer {token}"})
        if response.status_code == 401:
            raise HTTPException(401, "Sign in again to import a video.")
        if response.status_code != 200:
            raise HTTPException(503, "AutoFlow account check is unavailable.")
        account = response.json()
        if not isinstance(account, dict):
            raise HTTPException(503, "AutoFlow account check is unavailable.")
        if account.get("active") is not True:
            raise HTTPException(403, "Verify your AutoFlow account before importing.")
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(503, "AutoFlow account check is unavailable.") from exc


@router.post("/video")
async def import_video(body: ImportVideo, request: Request, user: dict = Depends(verify_jwt), credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not settings.social_imports_enabled:
        raise HTTPException(503, "Server video imports are not enabled yet. Choose Browser only or Upload file.")
    # A refresh token or unsigned development configuration cannot start work.
    if settings.jwt_secret_key == "insecure-dev-key-change-me":
        raise HTTPException(503, "Server authentication is not configured.")
    if user.get("token_type") != "access" or not isinstance(user.get("exp"), (int, float)):
        raise HTTPException(401, "An unexpired access token is required.")
    if not body.reuse_permission:
        raise HTTPException(400, "Confirm permission to download and reuse this video.")
    try:
        url = canonical_video(body.url)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    await active_account(credentials.credentials)
    owner = authenticated_user_id(user)
    await asyncio.to_thread(admit, owner)
    if owner in _active or len(_active) >= settings.max_concurrent_social_imports:
        raise HTTPException(429, "A video import is already running. Try again shortly.", headers={"Retry-After": "15"})
    _active.add(owner)
    try:
        directory = tempfile.mkdtemp(prefix="motion-import-")
    except OSError as exc:
        _active.discard(owner)
        raise HTTPException(503, "Temporary video storage is unavailable.") from exc

    def cleanup():
        shutil.rmtree(directory, ignore_errors=True)
        _active.discard(owner)

    try:
        path, kind = await run_download(url, directory, request.is_disconnected)
        if not 0 < path.stat().st_size <= MAX_BYTES:
            raise ValueError("Video exceeds 100 MB")
        # Cleanup also runs when response transmission raises on disconnect.
        return TemporaryVideo(path, media_type=f"video/{kind}", filename=f"motion-source.{kind}", headers={"Cache-Control": "no-store"}, cleanup=cleanup)
    except BaseException as exc:
        cleanup()
        if isinstance(exc, TimeoutError):
            raise HTTPException(504, "The download took too long. Try Upload file.") from exc
        if isinstance(exc, ValueError):
            raise HTTPException(422, str(exc)) from exc
        raise
