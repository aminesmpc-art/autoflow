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


def clip_model() -> str:
    """The model this server asks for, overridable without a deploy."""
    return settings.clip_model or CLIP_MODEL

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
            location=settings.clip_location or "global",
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
            client, source, duration_sec, model=clip_model(), on_progress=say
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
    max_output_tokens: int = 8192
    """data: URLs — a span of audio, or stills cut from the video."""
    attachments: list[str] = []


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
    authorization: Optional[str] = Header(default=None),
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

    if settings.enforce_extraction_limits:
        from app.api.videos import enforce_extraction_limit

        await enforce_extraction_limit(authorization)

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
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=clip_model(),
            contents=contents,
            config=types.GenerateContentConfig(**config),
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
        "model": clip_model(),
        "via": "vertex" if vertex else "ai-studio",
        "location": (settings.clip_location or "global") if vertex else None,
        "configured": bool(
            settings.gemini_api_key
            or (settings.gcp_project_id and settings.gcp_credentials_json)
        ),
    }
