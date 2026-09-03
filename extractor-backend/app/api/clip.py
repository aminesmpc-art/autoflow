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
import base64
import binascii
import os
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from app.auth import authenticated_user_id, security, verify_jwt
from app.config import get_settings
from app.clip_analysis import CLIP_MODEL, _generate_window, read_video
from app.job_store import JobStore

router = APIRouter()
settings = get_settings()


def clip_model() -> str:
    """The model this server asks for, overridable without a deploy."""
    return settings.clip_model or CLIP_MODEL

# Redis is used when configured so any web worker can answer a status poll.
# Local tests use the store's in-process fallback.
jobs = JobStore("clip-job")
job_gate = asyncio.Semaphore(settings.max_concurrent_clip_jobs)
cancel_events: dict[str, threading.Event] = {}


class JobCancelled(Exception):
    pass

MIME_BY_EXT = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
}


async def consume_clipping_quota(authorization: str, job_id: str) -> dict[str, Any]:
    """Atomically reserve the Django-owned daily quota, failing closed."""
    import httpx

    response = None
    last_error = None
    async with httpx.AsyncClient(timeout=8.0) as client:
        for attempt in range(3):
            try:
                response = await client.post(
                    f"{settings.django_api_url.rstrip('/')}/usage/clipping-reserve",
                    headers={"Authorization": authorization},
                    json={"idempotency_key": job_id},
                )
                break
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt < 2:
                    await asyncio.sleep(0.25 * (2 ** attempt))

    if response is None:
        raise HTTPException(
            # The extension treats 503 as "this service cannot read video"
            # and falls back to a chat tab. A quota-authority outage must not
            # take that path or it would turn an outage into a quota bypass.
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Clipping quota service is temporarily unavailable. No model work was started.",
        ) from last_error

    try:
        body = response.json()
    except ValueError:
        body = {}

    if response.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
        raise HTTPException(status_code=429, detail=body.get("detail", "Daily clipping limit reached."))
    if response.status_code not in (status.HTTP_200_OK, status.HTTP_201_CREATED):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Clipping quota service rejected the request. No model work was started.",
        )
    if body.get("allowed") is not True:
        raise HTTPException(status_code=429, detail=body.get("detail", "Daily clipping limit reached."))
    return body


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


def probe_video_duration(video_path: str) -> float | None:
    """Read container metadata locally; client duration is advisory only."""
    import cv2

    capture = cv2.VideoCapture(video_path)
    try:
        if not capture.isOpened():
            return None
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
        frames = float(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if fps <= 0 or frames <= 0:
            return None
        duration = frames / fps
        return duration if duration > 0 else None
    finally:
        capture.release()


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


def _open_source(video_path: str, say) -> tuple[Any, Any, Any, str]:
    """
    A client and a reference to the video the model can read.

    Two routes, the same two the analysis endpoint uses: Vertex with the file
    in Cloud Storage when a service account is configured, otherwise AI Studio
    with the Files API. Returns (client, source, cleanup, MIME type).
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
        try:
            blob.upload_from_filename(video_path, content_type=mime)
            client = genai.Client(
                vertexai=True,
                project=settings.gcp_project_id,
                location=settings.clip_location or "global",
                credentials=credentials,
            )
        except Exception:
            try:
                blob.delete()
            except Exception:                                  # noqa: BLE001
                pass
            raise

        def cleanup() -> None:
            try:
                bucket.blob(blob_name).delete()
            except Exception:                                  # noqa: BLE001
                pass

        return client, f"gs://{settings.gcs_bucket_name}/{blob_name}", cleanup, mime

    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="This server has no Gemini credentials configured.",
        )

    say("uploading to the model")
    client = genai.Client(api_key=settings.gemini_api_key)
    uploaded = None
    try:
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
    except Exception:
        if uploaded is not None:
            try:
                client.files.delete(name=uploaded.name)
            except Exception:                                  # noqa: BLE001
                pass
        raise

    def cleanup() -> None:
        try:
            client.files.delete(name=uploaded.name)
        except Exception:                                      # noqa: BLE001
            pass

    return client, uploaded, cleanup, mime


# ──────────────────────────────────────────────────────────────────────────
# The job
# ──────────────────────────────────────────────────────────────────────────


def _track_faces_quietly(
    video_path: str,
    say,
    cancel_event: threading.Event | None = None,
) -> list:
    """
    Where the speaker is, or nothing at all.

    Never raises. A reading that comes back with words, timings and scenes but
    no face track is still a good reading — the caller falls back to asking a
    model per clip, which is what it did before this existed. Failing the whole
    job because a codec was unusual would trade the expensive, working part for
    the cheap, optional one.
    """
    from app.clip_analysis import TrackedFace
    from app.face_track import FaceTrackingUnavailable, track_faces

    try:
        points = track_faces(
            video_path,
            on_progress=say,
            should_cancel=cancel_event.is_set if cancel_event else None,
        )
    except FaceTrackingUnavailable as exc:
        say(f"not tracking faces: {exc}")
        return []
    except Exception as exc:                                   # noqa: BLE001
        say(f"face tracking failed: {exc}")
        return []

    return [
        TrackedFace(t=round(p.t, 3), x=round(p.x, 4), size=round(p.size, 4), weight=p.weight)
        for p in points
    ]


async def _run_job(job_id: str, video_path: str, duration_sec: float) -> None:
    cancel_event = cancel_events.setdefault(job_id, threading.Event())

    def say(line: str) -> None:
        job = jobs.get(job_id)
        if not job or job.get("cancel_requested"):
            raise JobCancelled("cancelled by user")
        jobs.update_job(job_id, step=line)

    cleanup = None
    faces_task = None
    try:
        async with job_gate:
            say("starting")
            jobs.update_job(job_id, status="processing")

            # Started first and awaited last. Tracking faces is CPU work on the
            # file already sitting on this disk, and everything after it here is
            # spent waiting on a network — uploading the video, then the model
            # reading it. Run alongside, it lands inside that waiting time.
            faces_task = asyncio.create_task(
                asyncio.to_thread(_track_faces_quietly, video_path, say, cancel_event)
            )

            client, source, cleanup, source_mime = await asyncio.to_thread(
                _open_source, video_path, say
            )
            say("reading video")

            reading = await read_video(
                client,
                source,
                duration_sec,
                model=clip_model(),
                source_mime_type=source_mime,
                on_progress=say,
            )

            reading.faces = await faces_task
            faces_task = None
            if reading.faces:
                say(f"tracked the speaker across {len(reading.faces)} frames")

            say("finishing")
            jobs.update_job(job_id, status="completed", step="done", result=reading.model_dump())
    except JobCancelled:
        jobs.update_job(job_id, status="cancelled", step="cancelled", error="Cancelled by user.")
    except HTTPException as exc:
        jobs.update_job(job_id, status="failed", step="failed", error=str(exc.detail))
    except Exception as exc:                                   # noqa: BLE001
        jobs.update_job(job_id, status="failed", step="failed", error=str(exc))
    finally:
        # Before the file is removed, always. A cancelled read leaves the
        # tracker mid-decode, and deleting the video underneath it turns a
        # failed reading into a crash in a thread nobody is watching.
        if faces_task is not None:
            faces_task.cancel()
            try:
                await faces_task
            except (asyncio.CancelledError, Exception):         # noqa: BLE001
                pass
        if cleanup:
            await asyncio.to_thread(cleanup)
        try:
            os.remove(video_path)
        except OSError:
            pass
        cancel_events.pop(job_id, None)


@router.post("/read", response_model=ClipJob, status_code=status.HTTP_202_ACCEPTED)
async def read_clip_source(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    duration_sec: float = Form(...),
    user: dict = Depends(verify_jwt),
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> ClipJob:
    """
    Start reading a video into timed speech and described scenes.

    `duration_sec` is retained for compatibility and basic request validation.
    The limit and model windowing use container metadata measured here; a
    caller cannot lower its declared duration to bypass either one.
    """
    if duration_sec <= 0:
        raise HTTPException(status_code=400, detail="duration_sec must be positive.")

    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if content_type not in settings.allowed_video_types:
        raise HTTPException(
            status_code=415,
            detail=f"{content_type or 'That file type'} is not a supported video.",
        )

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

    measured_duration = await asyncio.to_thread(probe_video_duration, handle.name)
    if measured_duration is None:
        os.remove(handle.name)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="That file claims to be a video but its container could not be decoded.",
        )
    if measured_duration > settings.max_video_duration_sec:
        os.remove(handle.name)
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                "That video is longer than the "
                f"{settings.max_video_duration_sec // 60}-minute limit."
            ),
        )

    job_id = uuid.uuid4().hex
    if settings.enforce_extraction_limits:
        try:
            await consume_clipping_quota(f"Bearer {credentials.credentials}", job_id)
        except Exception:
            try:
                os.remove(handle.name)
            except OSError:
                pass
            raise

    jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "step": "queued",
        "error": None,
        "result": None,
        "owner_id": authenticated_user_id(user),
        "cancel_requested": False,
    }
    background.add_task(_run_job, job_id, handle.name, measured_duration)

    return ClipJob(job_id=job_id, status="queued", message="Reading the video.")


@router.get("/status/{job_id}", response_model=ClipJobStatus)
async def clip_status(job_id: str, user: dict = Depends(verify_jwt)) -> ClipJobStatus:
    job = jobs.get(job_id)
    if not job or job.get("owner_id") != authenticated_user_id(user):
        raise HTTPException(status_code=404, detail="No such job.")
    if (
        job.get("status") in {"queued", "processing", "cancelling"}
        and time.time() - float(job.get("updated_at", 0)) > settings.clip_job_stale_sec
    ):
        job = jobs.update_job(
            job_id,
            status="failed",
            step="failed",
            error="The worker stopped before this job finished. Retry the clipping job.",
        )
    return ClipJobStatus(**job)


@router.delete("/status/{job_id}", response_model=ClipJobStatus)
async def cancel_clip_job(job_id: str, user: dict = Depends(verify_jwt)) -> ClipJobStatus:
    job = jobs.get(job_id)
    if not job or job.get("owner_id") != authenticated_user_id(user):
        raise HTTPException(status_code=404, detail="No such job.")
    if job.get("status") not in {"completed", "failed", "cancelled"}:
        event = cancel_events.get(job_id)
        if event:
            event.set()
        job = jobs.update_job(
            job_id,
            status="cancelling",
            step="cancelling",
            cancel_requested=True,
        )
    return ClipJobStatus(**job)


# ──────────────────────────────────────────────────────────────────────────
# The relay
# ──────────────────────────────────────────────────────────────────────────

# Enough for the eight stills a reframe samples, with room to spare.
MAX_ATTACHMENTS = 12

# One span of speech is the large case: 150 seconds of 16kHz mono WAV is about
# 4.8MB, and base64 makes it a third larger again on the wire. The cap sits well
# above that and well below a video.
MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024

ATTACHMENT_KINDS = ("audio/", "image/")


class AskRequest(BaseModel):
    prompt: str
    """Ask for a JSON object back. The caller still parses it."""
    json_only: bool = True
    max_output_tokens: int = Field(default=8192, ge=256, le=16384)
    """data: URLs — a span of audio, or stills cut from the video."""
    attachments: list[str] = Field(default_factory=list)


class AskResponse(BaseModel):
    text: str
    model: str
    """How many attachments this server actually put in front of the model.

    Here so a caller can tell an answer about its stills from an answer about
    nothing. A build of this service that predates attachments ignores the
    field entirely — Pydantic drops unknown keys — and answers the prompt as
    plain text, so "where is the speaker in each of these 8 stills" comes back
    with eight confident positions for images the model never saw.

    Observed in production, not imagined: during the rolling deploy that
    shipped attachments, one instance returned 415 for a video and the other
    answered it. The extension and this service deploy separately, so a client
    ahead of its server is the normal state, not the exception.
    """
    attachments_received: int = 0


def _decode_attachments(raw: list[str]) -> list[tuple[bytes, str]]:
    """
    Data URLs the caller already holds, as bytes the model can be shown.

    Audio and stills only, never a video. Not squeamishness about size: a video
    costs on the order of 160k tokens to read where a still costs a few hundred,
    and /read is the endpoint metered for that. Letting one through here would
    route the expensive call around its own accounting.

    Nothing is fetched. Accepting an `https://` attachment would make this
    endpoint issue arbitrary outbound requests on a caller's say-so, with a
    service account attached — server-side request forgery, not a feature.
    """
    if len(raw) > MAX_ATTACHMENTS:
        raise HTTPException(
            status_code=400,
            detail=f"At most {MAX_ATTACHMENTS} attachments per question.",
        )

    out: list[tuple[bytes, str]] = []
    total = 0
    for item in raw:
        text = (item or "").strip()
        if not text.startswith("data:"):
            raise HTTPException(
                status_code=400,
                detail="Attachments must be data: URLs, not links to fetch.",
            )

        header, _, payload = text.partition(",")
        mime = header[len("data:"):].split(";", 1)[0].strip().lower()
        if ";base64" not in header:
            raise HTTPException(
                status_code=400,
                detail="Attachments must be base64 data: URLs.",
            )

        # Checked before decoding. A caller that attaches a video should be told
        # so, not have 300MB of it base64-decoded into this process first.
        if not mime.startswith(ATTACHMENT_KINDS):
            raise HTTPException(
                status_code=415,
                detail=(
                    f"{mime or 'That'} cannot be attached to a question — audio "
                    "and stills only. A video goes to /read."
                ),
            )

        try:
            blob = base64.b64decode(payload, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise HTTPException(
                status_code=400, detail=f"An attachment could not be decoded: {exc}"
            ) from exc
        if not blob:
            raise HTTPException(status_code=400, detail="An attachment was empty.")

        total += len(blob)
        if total > MAX_ATTACHMENT_BYTES:
            raise HTTPException(
                status_code=413,
                detail=(
                    "Those attachments come to more than the "
                    f"{MAX_ATTACHMENT_BYTES // (1024 * 1024)}MB limit."
                ),
            )
        out.append((blob, mime))

    return out


@router.post("/ask", response_model=AskResponse)
async def ask_model(
    body: AskRequest,
    _user: dict = Depends(verify_jwt),
) -> AskResponse:
    """
    Put one question to the model and return what it said.

    A thin relay on purpose. The extension already builds these prompts and
    parses the replies, both covered by tests, and moving either here would put
    the same logic in TypeScript and Python where the two would drift. So the
    server adds exactly what the browser cannot have: the key.

    It exists because the ranking was the last step still going through a chat
    tab, and on a real twenty-minute run that step failed three times in a row
    — message channel closed, did not finish answering, lost connection — while
    the two API calls either side of it worked first time. The judgement is also
    the cheap part: the video costs about 160k tokens to read and the ranking
    about 3.5k, so refusing to spend two percent more to remove the most fragile
    step in the product was the wrong trade.

    ── Why it takes attachments ──────────────────────────────────────────────

    It did not, and the reasoning was that anything needing media belongs on
    /read. That held while the only media was a video. It stopped holding for
    the two asks a cut falls back on when the reading cannot answer it: finding
    a spoken line in a span of audio, and pointing at the speaker across eight
    stills. Those are small — the stills come to a few hundred kilobytes — and
    sending them to a chat tab meant opening a conversation, uploading through a
    composer, waiting on a reply, and leaving the thread behind to be cleaned
    up. The video exclusion is kept as an explicit check rather than as an
    absence, because it is the part that was load-bearing.
    """
    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="An empty prompt asks nothing.")
    if len(prompt) > 200_000:
        raise HTTPException(status_code=413, detail="That prompt is too long to send.")

    attachments = _decode_attachments(body.attachments or [])

    from google import genai
    from google.genai import types

    credentials = _vertex_credentials()
    if credentials is not None:
        client = genai.Client(
            vertexai=True,
            project=settings.gcp_project_id,
            location=settings.clip_location or "global",
            credentials=credentials,
        )
    elif settings.gemini_api_key:
        client = genai.Client(api_key=settings.gemini_api_key)
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="This server has no Gemini credentials configured.",
        )

    config: dict[str, Any] = {"max_output_tokens": body.max_output_tokens}
    if body.json_only:
        config["response_mime_type"] = "application/json"

    # Media first, question last. The prompts these carry describe what was
    # attached — "these are 8 stills, in order" — which reads as a question
    # about something already shown rather than a promise about what follows.
    contents: list[Any] = [
        types.Part.from_bytes(data=blob, mime_type=mime) for blob, mime in attachments
    ]
    contents.append(prompt)

    try:
        response = await _generate_window(
            client,
            model=clip_model(),
            contents=contents,
            config=types.GenerateContentConfig(**config),
            say=lambda _line: None,
        )
    except Exception as exc:                                   # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"The model refused: {exc}") from exc

    text = (getattr(response, "text", "") or "").strip()
    if not text:
        raise HTTPException(status_code=502, detail="The model returned nothing.")

    return AskResponse(
        text=text, model=clip_model(), attachments_received=len(attachments)
    )


@router.get("/model")
async def describe_model() -> dict[str, Any]:
    """What this server would use, so a client can report it without guessing."""
    vertex = bool(settings.gcp_project_id and settings.gcp_credentials_json)
    return {
        "api_version": 2,
        "model": clip_model(),
        "via": "vertex" if vertex else "ai-studio",
        "location": (settings.clip_location or "global") if vertex else None,
        "configured": bool(
            settings.gemini_api_key
            or (settings.gcp_project_id and settings.gcp_credentials_json)
        ),
        "features": {
            "authenticated_jobs": True,
            "owner_bound_status": True,
            "cancellation": True,
            "attachments": True,
            "server_media_probe": True,
            "window_retries": 3,
        },
        "limits": {
            "max_video_size_mb": settings.max_video_size_mb,
            "max_video_duration_sec": settings.max_video_duration_sec,
            "free_clips_per_day": 1,
            "pro_clips_per_day": 10,
        },
    }
