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

from app.api.clip import _open_source, clip_model, model_client
from app.auth import authenticated_user_id, security, verify_jwt
from app.breakdown import break_down_video, pacing_from_cuts
from app.clip_analysis import _generate_window
from app.extraction import LONG_VIDEO_SEC, WINDOW_TIMEOUT_SEC, _video_part, sampling_fps
from app.extraction import _config as _extraction_config
from app.rate_limit import refine_limiter
from app.refine import MAX_INSTRUCTION_CHARS, REFINE_VIDEO_MAX_SEC, RefineReply, apply_edits
from app.refine import build_prompt as build_refine_prompt
from app.refine import parse_reply as parse_refine_reply
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
from app.youtube import NotReadable, cover_url, watch_url, youtube_details, youtube_id
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
# A breakdown's pacing needs every cut, so it waits longer.
BREAKDOWN_CUTS_GRACE_SEC = 120.0

MODES = {"prompts", "breakdown"}


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
    # "prompts" (the extractor) or "breakdown" (why it works).
    mode: str = "prompts"


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


def _check_mode(mode: Optional[str]) -> str:
    mode = (mode or "prompts").strip().lower()
    if mode not in MODES:
        # Unlike an unknown option, an unknown mode cannot fall back: a
        # breakdown and an extraction are different products.
        raise HTTPException(status_code=400, detail=f"Unknown mode. Use one of: {', '.join(sorted(MODES))}.")
    return mode


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
    mode: str = "prompts",
    authorization: str = "",
) -> None:
    """Watch the video and write the prompts — or, in "breakdown" mode, say
    why it works. Always removes the file.

    Its extractions were reserved before it was started; a failure gives
    them back."""

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
            if mode == "breakdown":
                result = await break_down_video(
                    client,
                    source,
                    duration_sec=probe.duration_sec,
                    section=section,
                    model=extract_model(),
                    source_mime_type=mime,
                    frame=describe_frame(probe.width, probe.height),
                    on_progress=say,
                )
            else:
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

        if mode == "breakdown":
            say("Measuring the pacing...")
            # Pacing is the one exact number in a breakdown, so it waits for
            # the whole decode — and is left out, with a note, rather than
            # computed from part of the video.
            try:
                cuts = await asyncio.wait_for(asyncio.shield(cuts_task), timeout=BREAKDOWN_CUTS_GRACE_SEC)
                result.pacing = pacing_from_cuts(cuts, *section)
            except asyncio.TimeoutError:
                stop_cuts.set()
                await cuts_task
                result.warnings.append("Pacing was not measured: the video took too long to decode.")
            cuts_task = None
            jobs.update_job(job_id, status="completed", step="", result=result.model_dump())
            return

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
        # Kept for an hour so an edit can look at the video again; the
        # sweeper deletes it after that. Only a Cloud Storage copy can be
        # kept — an AI Studio upload is cleaned up now, and edits to it
        # work from the text.
        if isinstance(source, str) and source.startswith("gs://"):
            kept = {"uri": source, "mime": mime, "expires_at": time.time() + settings.refine_video_ttl_sec}
            jobs.update_job(job_id, kept_video=kept)
            result.refine_until = kept["expires_at"]
            cleanup = None
        jobs.update_job(job_id, status="completed", step="", result=result.model_dump())

    except HTTPException as exc:
        _fail(job_id, str(exc.detail))
        await release_extraction(authorization, job_id)
    except Exception as exc:                                   # noqa: BLE001
        _fail(job_id, str(exc))
        await release_extraction(authorization, job_id)
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


def ydl_options(temp_dir: str) -> dict[str, Any]:
    """yt-dlp's settings: the browser headers, and the proxy and cookies from
    the environment when they are set. Shared by the download and by the
    details-only lookup a YouTube fallback makes, so both get past the same
    walls the same way."""
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
    return ydl_opts


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

        ydl_opts = ydl_options(temp_dir)

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


YOUTUBE_BREAKDOWN_NOTE = (
    "YouTube would not let the server download this video, so the AI watched it on "
    "YouTube directly. Pacing is measured from the file itself, so this breakdown has "
    "none; upload the video to get it."
)
YOUTUBE_NOTE = (
    "YouTube would not let the server download this video, so the AI watched it on "
    "YouTube directly. Shot thumbnails and cut-exact timings need the file itself, so "
    "this extraction has neither; upload the video to get both."
)


async def process_youtube_link(
    job_id: str,
    video_id: str,
    options: Optional[ExtractionOptions],
    *,
    temp_dir: str,
    mode: str = "prompts",
    authorization: str = "",
) -> bool:
    """
    Extract from a YouTube link the model reads itself.

    Returns False — leaving the job alone — only when the video's length
    cannot be learned from YouTube, so the caller can report the download
    error the person would otherwise have seen. Once the length is known
    this owns the job's outcome, success or failure.
    """
    def say(line: str) -> None:
        jobs.update_job(job_id, step=line)

    say("YouTube blocked the download. Checking the video on YouTube instead...")
    try:
        details = await youtube_details(video_id, ydl_opts=ydl_options(temp_dir))
    except NotReadable as exc:
        _fail(job_id, str(exc))
        return True
    if details is None:
        return False

    if details.duration_sec > settings.max_video_duration_sec:
        _fail(job_id, f"That video is longer than the {settings.max_video_duration_sec // 60}-minute limit.")
        return True
    try:
        section = resolve_section(options, details.duration_sec)
    except ValueError as exc:
        _fail(job_id, str(exc))
        return True
    try:
        await reserve_extraction(authorization, job_id, section[1] - section[0], mode)
    except HTTPException as exc:
        _fail(job_id, str(exc.detail))
        return True

    try:
        async with job_gate:
            say("AI is watching the video on YouTube...")
            if mode == "breakdown":
                result = await break_down_video(
                    model_client(),
                    watch_url(video_id),
                    duration_sec=details.duration_sec,
                    section=section,
                    model=extract_model(),
                    source_mime_type="video/mp4",
                    on_progress=say,
                )
            else:
                result = await extract_video(
                    model_client(),
                    watch_url(video_id),
                    duration_sec=details.duration_sec,
                    section=section,
                    options=options,
                    model=extract_model(),
                    source_mime_type="video/mp4",
                    on_progress=say,
                )
        result.read_from = "youtube"
        result.cover_url = cover_url(video_id)
        result.warnings.append(YOUTUBE_BREAKDOWN_NOTE if mode == "breakdown" else YOUTUBE_NOTE)
        if mode != "breakdown":
            kept = {"uri": watch_url(video_id), "mime": "video/mp4", "youtube": True,
                    "expires_at": time.time() + settings.refine_video_ttl_sec}
            jobs.update_job(job_id, kept_video=kept)
            result.refine_until = kept["expires_at"]
        jobs.update_job(job_id, status="completed", step="", result=result.model_dump())
    except HTTPException as exc:
        _fail(job_id, str(exc.detail))
        await release_extraction(authorization, job_id)
    except Exception as exc:                                   # noqa: BLE001
        _fail(job_id, str(exc))
        await release_extraction(authorization, job_id)
    return True


async def process_video_url(
    job_id: str,
    url: str,
    options: Optional[ExtractionOptions] = None,
    *,
    owner_id: str = "",
    base_url: str = "",
    mode: str = "prompts",
    authorization: str = "",
) -> None:
    """Download a linked video, then analyse it like an upload. Its
    extractions are reserved once the download says how long it is."""
    temp_dir = tempfile.mkdtemp()

    def say(line: str) -> None:
        jobs.update_job(job_id, step=line)

    try:
        jobs.update_job(job_id, status="processing")
        try:
            video_path = await download_video(url, temp_dir, say)
        except Exception as exc:                               # noqa: BLE001
            # A YouTube video the server may not download can still be read
            # by the model from its link. Only if that cannot even start does
            # the person hear about the download.
            video_id = youtube_id(url)
            if video_id and await process_youtube_link(
                job_id, video_id, options, temp_dir=temp_dir, mode=mode, authorization=authorization,
            ):
                return
            _fail(job_id, friendly_download_error(url, str(exc)))
            return

        say("Video downloaded. Preparing for analysis...")
        try:
            probe = _check_length(await asyncio.to_thread(probe_video, video_path))
            section = resolve_section(options, probe.duration_sec)
            await reserve_extraction(authorization, job_id, section[1] - section[0], mode)
        except HTTPException as exc:
            _fail(job_id, str(exc.detail))
            return
        except ValueError as exc:
            _fail(job_id, str(exc))
            return

        await process_video(
            job_id, video_path, options,
            probe=probe, owner_id=owner_id, base_url=base_url, mode=mode, authorization=authorization,
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


QUOTA_UNREACHABLE = (
    "Your extraction allowance could not be checked right now, so nothing was started. "
    "Please try again in a moment."
)


async def reserve_extraction(authorization: str, job_id: str, seconds: float, kind: str) -> None:
    """
    Charge this job's extractions before any model work — every ten analysed
    minutes is one (see apps/extractions/services.py in the Django tree).

    Fails CLOSED, unlike the advisory check below: this is where the model
    bill is incurred, and a reservation that could not be made is a job that
    must not start. Idempotent on the job id, so a retry never charges twice.
    """
    if not settings.enforce_extraction_limits:
        return
    import httpx

    response = None
    async with httpx.AsyncClient(timeout=8.0) as client:
        for attempt in range(3):
            try:
                response = await client.post(
                    f"{settings.django_api_url.rstrip('/')}/extractions/reserve",
                    headers={"Authorization": authorization},
                    json={"idempotency_key": job_id, "seconds": round(float(seconds), 2), "kind": kind},
                )
                break
            except httpx.HTTPError:
                if attempt < 2:
                    await asyncio.sleep(0.25 * (2 ** attempt))
    if response is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=QUOTA_UNREACHABLE)
    try:
        body = response.json()
    except ValueError:
        body = {}
    if response.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
        raise HTTPException(status_code=429, detail=body.get("detail") or "You have used your extractions for now.")
    if response.status_code == status.HTTP_401_UNAUTHORIZED:
        raise HTTPException(status_code=401, detail="Your session expired before the video was ready. Sign in and run it again.")
    if response.status_code not in (200, 201) or body.get("allowed") is not True:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=QUOTA_UNREACHABLE)


async def release_extraction(authorization: str, job_id: str) -> None:
    """Give a failed job's extractions back. Best effort: a release that does
    not arrive costs the person one extraction, never the service a bill."""
    if not settings.enforce_extraction_limits or not authorization:
        return
    try:
        import httpx

        async with httpx.AsyncClient(timeout=8.0) as client:
            await client.post(
                f"{settings.django_api_url.rstrip('/')}/extractions/release",
                headers={"Authorization": authorization},
                json={"idempotency_key": job_id},
            )
    except Exception:                                          # noqa: BLE001
        pass


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

    mode = _check_mode(body.mode)
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
        owner_id=owner_id, base_url=public_base(request), mode=mode,
        authorization=f"Bearer {credentials.credentials}",
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
    mode: Optional[str] = Form(default=None),
    user: dict = Depends(verify_jwt),
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """Upload and analyze a video to extract AI prompts. Returns a job ID for polling."""

    # Before reading the upload — no point accepting 500MB from someone who is
    # over quota.
    await enforce_extraction_limit(f"Bearer {credentials.credentials}")
    mode = _check_mode(mode)
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
    job_id = uuid.uuid4().hex
    authorization = f"Bearer {credentials.credentials}"
    try:
        probe = _check_length(await asyncio.to_thread(probe_video, handle.name))
        section = resolve_section(parsed_options, probe.duration_sec)
        # The length is known now, so the charge is too — reserved before the
        # job exists, and a refusal reaches the person straight away.
        await reserve_extraction(authorization, job_id, section[1] - section[0], mode)
    except (HTTPException, ValueError) as exc:
        os.remove(handle.name)
        if isinstance(exc, ValueError):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        raise

    owner_id = authenticated_user_id(user)
    _new_job(job_id, owner_id)
    background_tasks.add_task(
        process_video, job_id, handle.name, parsed_options,
        probe=probe, owner_id=owner_id, base_url=public_base(request), mode=mode,
        authorization=authorization,
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


# ============================================================================
# Refining an extraction (see app/refine.py)
# ============================================================================

class RefineRequest(BaseModel):
    instruction: str
    # The version on screen. The page owns the versions — undo is going back
    # to one it already has — so the server edits whatever it is sent.
    extraction: dict
    # The job it came from, so an edit within the hour can re-watch the video.
    job_id: Optional[str] = None


class RefineResponse(BaseModel):
    extraction: dict
    summary: str
    used_video: bool


_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def _kept_video(job_id: Optional[str], owner_id: str) -> Optional[dict]:
    """The job's kept video, if it is this caller's and still within its hour."""
    if not job_id or not JOB_ID.match(job_id):
        return None
    job = jobs.get(job_id)
    if not job or job.get("owner_id") != owner_id:
        return None
    kept = job.get("kept_video")
    if not kept or float(kept.get("expires_at", 0)) <= time.time():
        return None
    return kept


def _download_kept(uri: str, folder: str) -> str:
    """A kept Cloud Storage video, back on local disk to cut frames from."""
    from google.cloud import storage

    from app.api.clip import _vertex_credentials

    bucket_name, _, name = uri.removeprefix("gs://").partition("/")
    client = storage.Client(project=settings.gcp_project_id, credentials=_vertex_credentials())
    path = os.path.join(folder, "kept" + Path(name).suffix)
    client.bucket(bucket_name).blob(name).download_to_filename(path)
    return path


async def _frames_for(
    shots: list, kept: dict, *, job_id: str, owner_id: str, thumbnails_id: str, base_url: str,
) -> int:
    """Frames for edited or added shots, cut from the kept video. Returns how
    many were made. Names count up from 1000 so they never overwrite the
    frames of the original shots, which earlier versions still show."""
    folder = tempfile.mkdtemp()
    try:
        path = await asyncio.to_thread(_download_kept, kept["uri"], folder)
        frames = await asyncio.to_thread(
            grab_frames, path, [(s.start_sec + s.end_sec) / 2 for s in shots]
        )
        seq = int((jobs.get(job_id) or {}).get("thumb_seq", 0))
        items = []
        for shot, frame in zip(shots, frames):
            if frame is not None:
                items.append((str(1000 + seq), frame, shot))
                seq += 1
        jobs.update_job(job_id, thumb_seq=seq)
        stored = set(await asyncio.to_thread(
            thumb_store().put_many, thumbnails_id, owner_id, [(n, f) for n, f, _ in items]
        ))
        for name, _frame, shot in items:
            if name in stored:
                shot.thumbnail_url = f"{base_url}/api/videos/thumbs/{thumbnails_id}/{name}.jpg"
        return len(stored)
    finally:
        shutil.rmtree(folder, ignore_errors=True)


@router.post("/refine", response_model=RefineResponse)
async def refine_extraction(
    body: RefineRequest,
    request: Request,
    user: dict = Depends(verify_jwt),
):
    """Apply one requested change to an extraction and return the new version.

    Charges no quota; rate-limited instead (see app/rate_limit.py)."""
    from google.genai import types

    owner_id = authenticated_user_id(user)
    refine_limiter().check(owner_id)

    instruction = re.sub(r"\s+", " ", _CONTROL_CHARS.sub(" ", body.instruction or "")).strip()
    if not instruction:
        raise HTTPException(status_code=400, detail="Say what to change.")
    if len(instruction) > MAX_INSTRUCTION_CHARS:
        raise HTTPException(status_code=400, detail=f"Keep the request under {MAX_INSTRUCTION_CHARS} characters.")
    if len(json.dumps(body.extraction)) > 2_000_000:
        raise HTTPException(status_code=413, detail="That extraction is too large to edit.")
    try:
        current = Extraction.model_validate(body.extraction)
    except Exception:
        raise HTTPException(status_code=400, detail="That is not an extraction.")
    if not current.shots:
        raise HTTPException(status_code=400, detail="Only an extraction with shots can be edited.")

    lo = current.section.start_sec if current.section else 0.0
    hi = current.section.end_sec if current.section else current.duration_sec
    if hi <= lo:
        # Saved before durations were recorded: the last shot's end is the
        # best bound there is, and an edit's timings are checked against it.
        hi = max([s.end_sec or 0.0 for s in current.shots] + [lo + 1.0])
        current.duration_sec = hi
    span = max(0.0, hi - lo)
    kept = _kept_video(body.job_id, owner_id)
    use_video = kept is not None and 0 < span <= REFINE_VIDEO_MAX_SEC

    client = model_client()
    config = _extraction_config(types, RefineReply, max_tokens=32768, thinking="LOW", low_media=span > LONG_VIDEO_SEC)

    async def ask(with_video: bool):
        contents = []
        if with_video:
            # The video goes first: repeated edits then share a prefix, which
            # the model's own cache can serve instead of re-reading it.
            contents.append(_video_part(types, kept["uri"], (lo, hi), kept.get("mime", "video/mp4"), sampling_fps(span)))
        contents.append(build_refine_prompt(
            current, instruction, with_video=with_video, video_available=can_look and not with_video,
        ))
        return parse_refine_reply(await _generate_window(
            client, model=extract_model(), contents=contents, config=config,
            say=lambda _line: None, timeout=WINDOW_TIMEOUT_SEC,
        ))

    # The text first; the video only when the model says it has to look.
    can_look = use_video
    use_video = False
    try:
        reply = await ask(False)
    except Exception as exc:                                   # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"The AI could not make that change: {exc}")
    if can_look and reply.needs_video:
        try:
            reply = await ask(True)
            use_video = True
        except Exception:                                      # noqa: BLE001
            # The kept copy may have just been swept. The text answer stands,
            # and the person is told the video could not be checked.
            reply.summary = (reply.summary + " " if reply.summary else "") + (
                "The video could not be checked for this change."
            )
    updated, notes, needs_frame = apply_edits(current, reply)

    framed = [s for s in needs_frame if s.start_sec is not None and s.end_sec is not None]
    if framed:
        can_cut = kept is not None and not kept.get("youtube") and str(kept.get("uri", "")).startswith("gs://")
        if can_cut:
            try:
                thumbs_id = current.thumbnails_id or body.job_id
                made = await _frames_for(
                    framed, kept, job_id=body.job_id, owner_id=owner_id,
                    thumbnails_id=thumbs_id, base_url=public_base(request),
                )
                if made:
                    updated.thumbnails_id = thumbs_id
                if made < len(framed):
                    missing = len(framed) - made
                    notes.append(f"{missing} changed shot{'s' if missing != 1 else ''} could not get a new frame.")
            except Exception as exc:                           # noqa: BLE001
                notes.append(f"Changed shots could not get new frames ({exc}).")
        elif not (kept is not None and kept.get("youtube")):
            # A YouTube reading never had frames, and already says so.
            notes.append("Changed and added shots have no frame: the video is only kept for an hour after extracting.")
    updated.warnings = notes
    if kept is None:
        updated.refine_until = None

    edited = bool(reply.shot_edits or reply.sheet_edits or reply.master_prompt or reply.video_concept)
    summary = reply.summary or ("Done." if edited else "Nothing was changed.")
    if not use_video and any(e.action.strip().lower() == "insert" for e in reply.shot_edits):
        summary += " The new timings are estimates: the video was not available to check them against."
    return RefineResponse(extraction=updated.model_dump(), summary=summary, used_video=use_video)


async def sweep_kept_videos() -> int:
    """Delete kept videos past their hour. Returns how many went.

    Lists the bucket rather than the jobs: a kept copy must go even if its job
    record expired or the process restarted, and everything under videos/ is
    either a job in progress (minutes old) or a kept copy."""
    if not (settings.gcp_project_id and settings.gcp_credentials_json):
        return 0
    from datetime import timedelta

    from google.cloud import storage

    from app.api.clip import _vertex_credentials

    def sweep() -> int:
        client = storage.Client(project=settings.gcp_project_id, credentials=_vertex_credentials())
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.refine_video_ttl_sec + 300)
        gone = 0
        for blob in client.bucket(settings.gcs_bucket_name).list_blobs(prefix="videos/"):
            if blob.time_created and blob.time_created < cutoff:
                try:
                    blob.delete()
                    gone += 1
                except Exception:                              # noqa: BLE001
                    pass
        return gone

    return await asyncio.to_thread(sweep)


async def sweep_forever(every_sec: float = 300.0) -> None:
    import logging

    log = logging.getLogger(__name__)
    while True:
        try:
            gone = await sweep_kept_videos()
            if gone:
                log.info("swept %d kept videos past their hour", gone)
        except Exception as exc:                               # noqa: BLE001
            log.warning("kept-video sweep failed: %s", exc)
        await asyncio.sleep(every_sec)
