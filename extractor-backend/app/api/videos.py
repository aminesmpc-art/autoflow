"""
Video analysis endpoints — the Extractor.

A video, uploaded or linked, becomes a job; the job watches it and writes the
prompts that recreate it (see app/extraction.py); the caller polls for the
result. The job pattern is the clipping endpoint's, for the same reasons:

  * every model call is awaited on the async client, so an extraction in
    progress no longer freezes every other request on this service
  * job state lives in Redis when it is configured, so a status poll reaches
    any worker and a finished result survives a deploy
  * a job belongs to the account that started it, and only that account can
    read it
"""

import asyncio
import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel

from app.api.clip import _open_source, clip_model
from app.auth import authenticated_user_id, security, verify_jwt
from app.config import get_settings
from app.cuts import detect_cuts_quietly
from app.extraction import (
    Extraction,
    ExtractionOptions,
    extract_video,
    resolve_section,
    snap_to_cuts,
)
from app.job_store import JobStore
from app.thumbnails import (
    JOB_ID,
    MAX_THUMBNAILS,
    THUMB_NAME,
    NotOwner,
    Probe,
    describe_frame,
    grab_frames,
    nearest_ratio,
    probe_video,
    thumb_store,
)

router = APIRouter()
settings = get_settings()

jobs = JobStore("extract-job")
job_gate = asyncio.Semaphore(settings.max_concurrent_extract_jobs)


# How long a finished reading waits for cut detection to catch up.
CUTS_GRACE_SEC = 20.0


def extract_model() -> str:
    return settings.extract_model or clip_model()


# ============================================================================
# Schemas
# ============================================================================

class VideoJob(BaseModel):
    job_id: str
    status: str
    message: str
    result: Optional[dict] = None


class AnalyzeUrlRequest(BaseModel):
    url: str
    options: Optional[ExtractionOptions] = None


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    step: str
    error: Optional[str] = None
    result: Optional[dict] = None


# ============================================================================
# Helpers
# ============================================================================

def public_base(request: Request) -> str:
    """This service's address as a browser reaches it, for thumbnail URLs.

    Behind Railway's proxy the request arrives as plain http on an internal
    host; the forwarded headers say what the browser actually used.
    """
    if settings.public_url:
        return settings.public_url.rstrip("/")
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme).split(",")[0].strip()
    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.url.netloc
    ).split(",")[0].strip()
    return f"{proto}://{host}"


def _safe_suffix(filename: Optional[str]) -> str:
    suffix = Path(filename or "").suffix.lower()
    return suffix if re.fullmatch(r"\.[a-z0-9]{1,5}", suffix) else ".mp4"


def _new_job(job_id: str, owner_id: str) -> None:
    jobs[job_id] = {
        "job_id": job_id,
        "status": "pending",
        "step": "Queued...",
        "result": None,
        "error": None,
        "owner_id": owner_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _fail(job_id: str, message: str) -> None:
    jobs.update_job(job_id, status="failed", step="", error=message)


def _check_length(probe: Optional[Probe]) -> Probe:
    if probe is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="That file claims to be a video but it could not be decoded.",
        )
    if probe.duration_sec > settings.max_video_duration_sec:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"That video is longer than the {settings.max_video_duration_sec // 60}-minute limit.",
        )
    return probe


def _parse_options(raw: Optional[str]) -> Optional[ExtractionOptions]:
    # Malformed options must not cost the user their upload — fall back to the
    # defaults, which is exactly the behaviour before options existed.
    if not raw:
        return None
    try:
        return ExtractionOptions(**json.loads(raw))
    except Exception:
        return None


async def attach_thumbnails(
    result: Extraction,
    video_path: str,
    *,
    job_id: str,
    owner_id: str,
    base_url: str,
) -> None:
    """A frame from the middle of each timed shot, stored and linked.

    Never raises. Thumbnails are the cheap, optional part of an extraction;
    failing a finished analysis because a frame would not decode or a bucket
    blinked would trade the expensive part for them.
    """
    try:
        wanted = [
            (shot, (shot.start_sec + shot.end_sec) / 2)
            for shot in result.shots
            if shot.start_sec is not None and shot.end_sec is not None
        ][:MAX_THUMBNAILS]
        if not wanted:
            return

        frames = await asyncio.to_thread(grab_frames, video_path, [t for _shot, t in wanted])
        items = [
            (str(shot.shot_id), frame)
            for (shot, _t), frame in zip(wanted, frames)
            if frame is not None
        ]
        stored = set(
            await asyncio.to_thread(thumb_store().put_many, job_id, owner_id, items)
            if items else []
        )

        for shot, _t in wanted:
            if str(shot.shot_id) in stored:
                shot.thumbnail_url = f"{base_url}/api/videos/thumbs/{job_id}/{shot.shot_id}.jpg"
        if stored:
            result.thumbnails_id = job_id

        missing = len(wanted) - len(stored)
        if missing:
            result.warnings.append(
                f"{missing} shot thumbnail{'' if missing == 1 else 's'} could not be made."
            )
    except Exception as exc:                                   # noqa: BLE001
        for shot in result.shots:
            shot.thumbnail_url = None
        result.thumbnails_id = None
        result.warnings.append(f"Shot thumbnails could not be saved ({exc}).")


# ============================================================================
# The job
# ============================================================================

async def process_video(
    job_id: str,
    video_path: str,
    options: Optional[ExtractionOptions] = None,
    *,
    probe: Optional[Probe] = None,
    owner_id: str = "",
    base_url: str = "",
) -> None:
    """Watch the video and write the prompts. Always removes the file."""

    def say(line: str) -> None:
        jobs.update_job(job_id, step=line)

    def say_upload(line: str) -> None:
        # _open_source speaks in clipping's lower-case log lines.
        say(line[:1].upper() + line[1:] + "...")

    cleanup: Optional[Callable[[], None]] = None
    cuts_task: Optional[asyncio.Task] = None
    stop_cuts = threading.Event()
    try:
        probe = probe or _check_length(await asyncio.to_thread(probe_video, video_path))
        try:
            section = resolve_section(options, probe.duration_sec)
        except ValueError as exc:
            _fail(job_id, str(exc))
            return

        async with job_gate:
            jobs.update_job(job_id, status="processing", step="Preparing video for AI...")
            # Started first and awaited last: decoding for cuts is CPU work on
            # the file already here, and everything until the reading comes
            # back is waiting on the network.
            cuts_task = asyncio.create_task(asyncio.to_thread(
                detect_cuts_quietly,
                video_path,
                start_sec=section[0],
                end_sec=section[1],
                should_stop=stop_cuts.is_set,
            ))
            client, source, cleanup, mime = await asyncio.to_thread(
                _open_source, video_path, say_upload, "videos"
            )
            result = await extract_video(
                client,
                source,
                duration_sec=probe.duration_sec,
                section=section,
                options=options,
                model=extract_model(),
                source_mime_type=mime,
                frame=describe_frame(probe.width, probe.height),
                source_ratio=nearest_ratio(probe.width, probe.height),
                on_progress=say,
            )

        say("Lining shots up with the cuts...")
        try:
            cuts = await asyncio.wait_for(asyncio.shield(cuts_task), timeout=CUTS_GRACE_SEC)
        except asyncio.TimeoutError:
            # A long video can take longer to decode than to read. Stop and
            # use the cuts found so far; shots past that point keep the
            # model's timing.
            stop_cuts.set()
            cuts = await cuts_task
        cuts_task = None
        result.shots, _moved = snap_to_cuts(result.shots, cuts)
        result.source_fps = round(probe.fps, 3) if probe.fps else None

        say("Cutting shot thumbnails...")
        await attach_thumbnails(
            result, video_path, job_id=job_id, owner_id=owner_id, base_url=base_url
        )
        jobs.update_job(job_id, status="completed", step="", result=result.model_dump())

    except HTTPException as exc:
        _fail(job_id, str(exc.detail))
    except Exception as exc:                                   # noqa: BLE001
        _fail(job_id, str(exc))
    finally:
        # Before the file goes, always: deleting a video under a decoder that
        # is still reading it turns a failed job into a crash in a thread.
        if cuts_task is not None:
            stop_cuts.set()
            try:
                await cuts_task
            except Exception:                                  # noqa: BLE001
                pass
        if cleanup:
            await asyncio.to_thread(cleanup)
        try:
            os.remove(video_path)
        except OSError:
            pass


async def download_video(url: str, temp_dir: str, say: Callable[[str], None]) -> str:
    """Fetch a linked video into temp_dir and return its path."""
    video_path = None

    # --- 1. RapidAPI bypass for blocked platforms ---
    # If RAPIDAPI_KEY is configured, Instagram/TikTok downloads are offloaded
    # to a proxy API to avoid datacenter IP blocks.
    rapidapi_key = os.getenv("RAPIDAPI_KEY", "").strip("\"'")
    rapidapi_host = os.getenv("RAPIDAPI_HOST", "instagram-reels-downloader-api.p.rapidapi.com").strip("\"'")

    is_blocked_platform = "instagram.com" in url.lower() or "tiktok.com" in url.lower()

    if rapidapi_key and is_blocked_platform:
        say("Bypassing block using RapidAPI Proxy...")
        import aiofiles
        import httpx

        headers = {
            "X-RapidAPI-Key": rapidapi_key,
            "X-RapidAPI-Host": rapidapi_host,
        }

        try:
            async with httpx.AsyncClient() as client:
                # The endpoint path varies by provider.
                if "reels-downloader" in rapidapi_host:
                    api_url = f"https://{rapidapi_host}/download"
                else:
                    api_url = f"https://{rapidapi_host}/v1/info"

                response = await client.get(api_url, params={"url": url}, headers=headers, timeout=30.0)

                if response.status_code == 200:
                    data = response.json()
                    video_url = None

                    # The response schemas of the common RapidAPI providers.
                    if isinstance(data, dict):
                        if "data" in data and isinstance(data["data"], dict):
                            if "medias" in data["data"] and isinstance(data["data"]["medias"], list):
                                for media in data["data"]["medias"]:
                                    if media.get("type") == "video" and "url" in media:
                                        video_url = media["url"]
                                        break
                            elif "video_url" in data["data"]:
                                video_url = data["data"]["video_url"]
                            elif "url" in data["data"] and "instagram.com" not in data["data"]["url"]:
                                video_url = data["data"]["url"]
                        elif "video_url" in data:
                            video_url = data["video_url"]
                        elif "download_url" in data:
                            video_url = data["download_url"]
                        elif "url" in data and data["url"].startswith("http") and "instagram.com" not in data["url"]:
                            video_url = data["url"]
                        elif "items" in data and len(data["items"]) > 0:
                            video_url = data["items"][0].get("video_versions", [{}])[0].get("url")

                    if video_url:
                        say("Downloading proxy payload...")
                        proxy_video_path = os.path.join(temp_dir, "video.mp4")
                        async with client.stream("GET", video_url) as r:
                            async with aiofiles.open(proxy_video_path, "wb") as f:
                                async for chunk in r.aiter_bytes():
                                    await f.write(chunk)
                        video_path = proxy_video_path
                else:
                    print(f"RapidAPI returned non-200 status: {response.status_code} - {response.text}")
        except Exception as e:
            print(f"RapidAPI bypass failed, falling back to yt-dlp: {e}")

    # --- 2. Fallback to standard yt-dlp ---
    if not video_path or not os.path.exists(video_path):
        say("Downloading video from URL...")

        import yt_dlp

        ydl_opts: dict[str, Any] = {
            "format": "best[ext=mp4]/best",
            "outtmpl": os.path.join(temp_dir, "video.%(ext)s"),
            "noplaylist": True,
            "quiet": True,
            "max_filesize": 100 * 1024 * 1024,  # 100MB limit
            "http_headers": {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "Accept-Language": "en-US,en;q=0.9",
                "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                "Sec-Ch-Ua-Mobile": "?0",
                "Sec-Ch-Ua-Platform": '"Windows"',
            },
        }

        # Route through a residential proxy if configured.
        proxy_url = os.getenv("PROXY_URL")
        if proxy_url:
            proxy_url = proxy_url.strip("\"'")
            # Accept a raw IP:PORT:USER:PASS as well as a URL.
            if proxy_url.count(":") == 3 and not proxy_url.startswith("http"):
                ip, port, user, password = proxy_url.split(":")
                ydl_opts["proxy"] = f"http://{user}:{password}@{ip}:{port}"
            else:
                ydl_opts["proxy"] = proxy_url

        # Cookies from the environment, past login walls and bot checks.
        cookies_content = os.getenv("YT_DLP_COOKIES")
        if cookies_content:
            cookie_path = os.path.join(temp_dir, "cookies.txt")
            with open(cookie_path, "w", encoding="utf-8") as f:
                f.write(cookies_content)
            ydl_opts["cookiefile"] = cookie_path

        def _download() -> str:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                return ydl.prepare_filename(info)

        video_path = await asyncio.to_thread(_download)

    if not video_path or not os.path.exists(video_path):
        raise RuntimeError("Failed to download video. Please verify the URL.")

    # HTML login walls and JSON errors come back as very small files.
    if os.path.getsize(video_path) < 150 * 1024:
        raise RuntimeError("empty media response")
    return video_path


def friendly_download_error(url: str, err_msg: str) -> str:
    """The common platform blocks, in words a person can act on."""
    lower = url.lower()
    if not any(keyword in err_msg for keyword in [
        "empty media response", "403", "Sign in", "confirm you are not a bot", "Login required",
        "isn't available", "certain audiences", "private", "restricted", "not available",
    ]):
        return err_msg
    if "instagram.com" in lower:
        if "isn't available" in err_msg or "certain audiences" in err_msg or "private" in err_msg:
            return (
                "This Instagram post is restricted — it's either private, age-gated, or limited to certain audiences. "
                "Try a different public post, or download the video to your device first and use the 'Upload File' option instead."
            )
        return (
            "Instagram blocked the download. This usually happens because Instagram blocks server-side requests. "
            "Try downloading the video to your device first and use the 'Upload File' option, or configure "
            "'RAPIDAPI_KEY' / 'PROXY_URL' / 'YT_DLP_COOKIES' in your Railway environment."
        )
    if "youtube.com" in lower or "youtu.be" in lower:
        return (
            "YouTube requested bot verification. To extract from YouTube links, please add your "
            "browser cookies to the 'YT_DLP_COOKIES' environment variable in Railway."
        )
    if "tiktok.com" in lower:
        return (
            "TikTok blocked the server. Please either set a 'RAPIDAPI_KEY' (Pro Fix) or add your "
            "browser cookies to the 'YT_DLP_COOKIES' environment variable in Railway to extract from TikTok."
        )
    return err_msg


async def process_video_url(
    job_id: str,
    url: str,
    options: Optional[ExtractionOptions] = None,
    *,
    owner_id: str = "",
    base_url: str = "",
) -> None:
    """Download a linked video, then analyse it like an upload."""
    temp_dir = tempfile.mkdtemp()

    def say(line: str) -> None:
        jobs.update_job(job_id, step=line)

    try:
        jobs.update_job(job_id, status="processing")
        try:
            video_path = await download_video(url, temp_dir, say)
        except Exception as exc:                               # noqa: BLE001
            _fail(job_id, friendly_download_error(url, str(exc)))
            return

        say("Video downloaded. Preparing for analysis...")
        try:
            probe = _check_length(await asyncio.to_thread(probe_video, video_path))
        except HTTPException as exc:
            _fail(job_id, str(exc.detail))
            return

        await process_video(
            job_id, video_path, options, probe=probe, owner_id=owner_id, base_url=base_url
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


async def enforce_extraction_limit(authorization: Optional[str]) -> None:
    """Ask Django whether this caller may start another extraction.

    The browser checks the quota before uploading, but nothing stopped a direct
    call to this service — and this is where the Gemini bill is incurred, so the
    check belongs here too.

    Fails OPEN on any transport problem. A blip talking to Django must not block
    a paying customer from the thing they paid for; the worst case is one extra
    extraction, which Django's own create endpoint still refuses to save.
    """
    if not settings.enforce_extraction_limits or not authorization:
        return

    try:
        import httpx

        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"{settings.django_api_url.rstrip('/')}/extractions/check-limit/",
                headers={"Authorization": authorization},
            )
        if resp.status_code != 200:
            return  # can't tell — let it through
        state = resp.json()
    except Exception:
        return  # fail open

    if state.get("allowed") is False:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"You have reached your limit of {state.get('limit')} extractions "
                f"per {state.get('period')}."
            ),
        )


# ============================================================================
# Endpoints
# ============================================================================

@router.post("/analyze-url", response_model=VideoJob)
async def analyze_video_url(
    request: Request,
    background_tasks: BackgroundTasks,
    body: AnalyzeUrlRequest,
    user: dict = Depends(verify_jwt),
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """Analyze a video from URL (YouTube, TikTok, etc.). Returns a job ID for polling."""
    await enforce_extraction_limit(f"Bearer {credentials.credentials}")

    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid URL. Must start with http:// or https://",
        )

    job_id = uuid.uuid4().hex
    owner_id = authenticated_user_id(user)
    _new_job(job_id, owner_id)
    background_tasks.add_task(
        process_video_url, job_id, url, body.options,
        owner_id=owner_id, base_url=public_base(request),
    )

    return VideoJob(
        job_id=job_id,
        status="pending",
        message="Video URL analysis started. Poll /api/videos/status/{job_id} for updates.",
    )


@router.post("/analyze", response_model=VideoJob)
async def analyze_video(
    request: Request,
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    # Multipart can't carry a nested JSON body alongside the file, so options
    # arrive as a JSON string in a form field.
    options: Optional[str] = Form(default=None),
    user: dict = Depends(verify_jwt),
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """Upload and analyze a video to extract AI prompts. Returns a job ID for polling."""

    # Before reading the upload — no point accepting 500MB from someone who is
    # over quota.
    await enforce_extraction_limit(f"Bearer {credentials.credentials}")
    parsed_options = _parse_options(options)

    content_type = (video.content_type or "").split(";", 1)[0].strip().lower()
    if content_type not in settings.allowed_video_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed: {settings.allowed_video_types}",
        )

    # Streamed to disk a megabyte at a time. Reading the whole upload into
    # memory first held up to 500MB per request in this process.
    handle = tempfile.NamedTemporaryFile(delete=False, suffix=_safe_suffix(video.filename))
    size = 0
    limit = settings.max_video_size_mb * 1024 * 1024
    try:
        while chunk := await video.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Video too large. Max size: {settings.max_video_size_mb}MB",
                )
            handle.write(chunk)
    except Exception:
        handle.close()
        os.remove(handle.name)
        raise
    handle.close()

    # Measured here, before the job exists, so a file that is not really a
    # video, is too long, or does not contain the chosen section is refused
    # with a reason rather than accepted and failed a minute later.
    try:
        probe = _check_length(await asyncio.to_thread(probe_video, handle.name))
        resolve_section(parsed_options, probe.duration_sec)
    except (HTTPException, ValueError) as exc:
        os.remove(handle.name)
        if isinstance(exc, ValueError):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        raise

    job_id = uuid.uuid4().hex
    owner_id = authenticated_user_id(user)
    _new_job(job_id, owner_id)
    background_tasks.add_task(
        process_video, job_id, handle.name, parsed_options,
        probe=probe, owner_id=owner_id, base_url=public_base(request),
    )

    return VideoJob(
        job_id=job_id,
        status="pending",
        message="Video analysis started. Poll /api/videos/status/{job_id} for updates.",
    )


@router.get("/status/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str, user: dict = Depends(verify_jwt)):
    """The state of an analysis, to the account that started it."""
    job = jobs.get(job_id)
    # Someone else's job answers exactly like a missing one: a result holds a
    # transcript of whatever they uploaded.
    if not job or job.get("owner_id") != authenticated_user_id(user):
        raise HTTPException(status_code=404, detail="Job not found")

    if (
        job.get("status") in {"pending", "processing"}
        and time.time() - float(job.get("updated_at", 0)) > settings.clip_job_stale_sec
    ):
        job = jobs.update_job(
            job_id,
            status="failed",
            step="",
            error="The server stopped before this analysis finished. Please run it again.",
        )

    return JobStatusResponse(
        job_id=job_id,
        status=job["status"],
        step=job.get("step", ""),
        error=job.get("error"),
        result=job.get("result"),
    )


@router.get("/thumbs/{job_id}/{name}.jpg")
async def get_thumbnail(job_id: str, name: str):
    """One shot's thumbnail.

    Public, like an image on a CDN: an <img> cannot send a bearer token. The
    address is the access control — it carries a random 128-bit job id — and
    the page that shows it is one only the owner sees until they publish it.
    """
    if not JOB_ID.match(job_id) or not THUMB_NAME.match(name):
        raise HTTPException(status_code=404, detail="Not found")
    data = await asyncio.to_thread(thumb_store().get, job_id, name)
    if data is None:
        raise HTTPException(status_code=404, detail="Not found")
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.delete("/thumbs/{job_id}")
async def delete_thumbnails(job_id: str, user: dict = Depends(verify_jwt)):
    """Remove an extraction's thumbnails, when its owner deletes it."""
    if not JOB_ID.match(job_id):
        raise HTTPException(status_code=404, detail="Not found")
    try:
        deleted = await asyncio.to_thread(thumb_store().delete, job_id, authenticated_user_id(user))
    except NotOwner:
        raise HTTPException(status_code=404, detail="Not found")
    return {"deleted": deleted}
