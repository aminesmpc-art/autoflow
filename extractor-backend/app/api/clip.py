"""
Reading a video for the Clipping node.

The extension used to build its transcript by cutting the audio into four
minute chunks and asking a chat to transcribe each one in turn — six round
trips and about 145 seconds on a twenty minute video, producing text with no
timings in it. Every clip cut from that text then needed a further two to four
asks to find where its own first and last lines were spoken.

This endpoint replaces all of that with one call. It exists here rather than
in the extension because the model can only take a video natively through the
API, and the API needs a key — which must never ship inside a Chrome
extension, where anyone can read it out of the bundle.

The job pattern matches the analysis endpoint next door for the same reason it
does: a long video takes longer to read than a proxy will hold a request open.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    UploadFile,
    status,
)
from pydantic import BaseModel

from app.config import get_settings
from app.clip_analysis import CLIP_MODEL, ClipReading, read_video

router = APIRouter()
settings = get_settings()

# Same in-memory store the analysis endpoint uses. Fine for one worker and a
# job that lives for a minute; a second instance would need Supabase, which is
# already a noted limitation over there.
jobs: dict[str, dict[str, Any]] = {}

MIME_BY_EXT = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
}


class ClipJob(BaseModel):
    job_id: str
    status: str
    message: str


class ClipJobStatus(BaseModel):
    job_id: str
    status: str
    step: str
    error: Optional[str] = None
    result: Optional[dict] = None


# ──────────────────────────────────────────────────────────────────────────
# Getting the video somewhere the model can see it
# ──────────────────────────────────────────────────────────────────────────


def _mime_for(path: str) -> str:
    return MIME_BY_EXT.get(Path(path).suffix.lower(), "video/mp4")


def _vertex_credentials():
    """Service account credentials, or None when not configured for Vertex."""
    if not (settings.gcp_project_id and settings.gcp_credentials_json):
        return None
    import json as _json
    from google.oauth2 import service_account

    info = _json.loads(settings.gcp_credentials_json)
    return service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )


def _open_source(video_path: str, say) -> tuple[Any, Any, Any]:
    """
    A client and a reference to the video the model can read.

    Two routes, the same two the analysis endpoint uses: Vertex with the file
    in Cloud Storage when a service account is configured, otherwise AI Studio
    with the Files API. Returns (client, source, cleanup).
    """
    from google import genai

    credentials = _vertex_credentials()
    mime = _mime_for(video_path)

    if credentials is not None:
        from google.cloud import storage

        say("uploading to cloud storage")
        client_gcs = storage.Client(
            project=settings.gcp_project_id, credentials=credentials
        )
        bucket = client_gcs.bucket(settings.gcs_bucket_name)
        blob_name = f"clips/{uuid.uuid4().hex}{Path(video_path).suffix.lower()}"
        blob = bucket.blob(blob_name)
        blob.upload_from_filename(video_path, content_type=mime)

        client = genai.Client(
            vertexai=True,
            project=settings.gcp_project_id,
            location=settings.gcp_location,
            credentials=credentials,
        )

        def cleanup() -> None:
            try:
                bucket.blob(blob_name).delete()
            except Exception:                                  # noqa: BLE001
                pass

        return client, f"gs://{settings.gcs_bucket_name}/{blob_name}", cleanup

    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="This server has no Gemini credentials configured.",
        )

    say("uploading to the model")
    client = genai.Client(api_key=settings.gemini_api_key)
    uploaded = client.files.upload(file=Path(video_path))

    # The Files API accepts the bytes immediately and processes them after; a
    # video referenced before it is ACTIVE comes back as a failure that reads
    # like a bad request.
    import time as _time

    deadline = _time.time() + 600
    while getattr(uploaded.state, "name", str(uploaded.state)) == "PROCESSING":
        if _time.time() > deadline:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="The video was still being processed after ten minutes.",
            )
        _time.sleep(2)
        uploaded = client.files.get(name=uploaded.name)

    if getattr(uploaded.state, "name", str(uploaded.state)) == "FAILED":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The model could not read that video file.",
        )

    def cleanup() -> None:
        try:
            client.files.delete(name=uploaded.name)
        except Exception:                                      # noqa: BLE001
            pass

    return client, uploaded, cleanup


# ──────────────────────────────────────────────────────────────────────────
# The job
# ──────────────────────────────────────────────────────────────────────────


async def _run_job(job_id: str, video_path: str, duration_sec: float) -> None:
    def say(line: str) -> None:
        jobs[job_id]["step"] = line

    cleanup = None
    try:
        jobs[job_id]["status"] = "processing"
        client, source, cleanup = await asyncio.to_thread(_open_source, video_path, say)

        reading = await read_video(
            client, source, duration_sec, model=CLIP_MODEL, on_progress=say
        )

        jobs[job_id].update(
            status="completed", step="done", result=reading.model_dump()
        )
    except HTTPException as exc:
        jobs[job_id].update(status="failed", step="failed", error=str(exc.detail))
    except Exception as exc:                                   # noqa: BLE001
        jobs[job_id].update(status="failed", step="failed", error=str(exc))
    finally:
        if cleanup:
            await asyncio.to_thread(cleanup)
        try:
            os.remove(video_path)
        except OSError:
            pass


@router.post("/read", response_model=ClipJob, status_code=status.HTTP_202_ACCEPTED)
async def read_clip_source(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    duration_sec: float = Form(...),
    authorization: Optional[str] = Header(default=None),
) -> ClipJob:
    """
    Start reading a video into timed speech and described scenes.

    `duration_sec` comes from the caller rather than being measured here: the
    extension has already decoded the file to probe it, and asking this service
    to measure it again would mean putting ffmpeg on the server to learn a
    number the client already has.
    """
    if duration_sec <= 0:
        raise HTTPException(status_code=400, detail="duration_sec must be positive.")

    if file.content_type and not file.content_type.startswith("video/"):
        raise HTTPException(
            status_code=415, detail=f"{file.content_type} is not a video."
        )

    # Quotas live in the Django API, which is the authority — this service is
    # where the expensive call happens, so it asks before spending anything.
    if settings.enforce_extraction_limits:
        from app.api.videos import enforce_extraction_limit

        await enforce_extraction_limit(authorization)

    suffix = Path(file.filename or "video.mp4").suffix.lower() or ".mp4"
    handle = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    size = 0
    limit = settings.max_video_size_mb * 1024 * 1024
    try:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                raise HTTPException(
                    status_code=413,
                    detail=f"That video is over the {settings.max_video_size_mb}MB limit.",
                )
            handle.write(chunk)
    except Exception:
        handle.close()
        os.remove(handle.name)
        raise
    handle.close()

    job_id = uuid.uuid4().hex
    jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "step": "queued",
        "error": None,
        "result": None,
    }
    background.add_task(_run_job, job_id, handle.name, duration_sec)

    return ClipJob(job_id=job_id, status="queued", message="Reading the video.")


@router.get("/status/{job_id}", response_model=ClipJobStatus)
async def clip_status(job_id: str) -> ClipJobStatus:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="No such job.")
    return ClipJobStatus(**job)


@router.get("/model")
async def clip_model() -> dict[str, Any]:
    """What this server would use, so a client can report it without guessing."""
    return {
        "model": CLIP_MODEL,
        "configured": bool(
            settings.gemini_api_key
            or (settings.gcp_project_id and settings.gcp_credentials_json)
        ),
    }
