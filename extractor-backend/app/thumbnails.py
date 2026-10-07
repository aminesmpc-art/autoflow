"""
Shot thumbnails: one frame from each shot, kept for as long as the extraction.

A shot list of twenty prompts is twenty paragraphs that read alike. A frame
beside each one is what tells a person which shot they are looking at, and it
costs nothing the model is charged for — the frames are cut here, from the
file already on disk, with the OpenCV this service already ships for face
tracking.

── Where they live ──────────────────────────────────────────────────────────

In Cloud Storage, under thumbs/<job id>/, and served back through this
service rather than from the bucket directly. That keeps the bucket private —
nothing about its access settings has to change — and the job id is a random
128-bit hex string, so a thumbnail's address is as hard to guess as the job's.

Each object records who it belongs to, so the owner, and only the owner, can
delete them when they delete the extraction.

Without Cloud Storage (local development, or AI Studio mode) they go to a
folder in the temp directory instead, which is enough to see them work and is
not meant to last.
"""

from __future__ import annotations

import logging
import re
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

THUMB_WIDTH = 320
JPEG_QUALITY = 78

# A two hour video can come back with hundreds of shots. Past this many the
# remainder go without — the list is still usable, and the upload is bounded.
MAX_THUMBNAILS = 200

# Names in the URL are checked before they touch a path or a bucket key.
JOB_ID = re.compile(r"^[0-9a-f]{32}$")
THUMB_NAME = re.compile(r"^[0-9]{1,4}$")


# ──────────────────────────────────────────────────────────────────────────
# Reading the file
# ──────────────────────────────────────────────────────────────────────────


@dataclass
class Probe:
    duration_sec: float
    width: int
    height: int


def probe_video(video_path: str) -> Optional[Probe]:
    """Duration and frame size from the container, or None if it won't decode."""
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
        if duration <= 0:
            return None
        return Probe(
            duration_sec=duration,
            width=int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0),
            height=int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0),
        )
    finally:
        capture.release()


# The ratios people name. A 1080x1920 phone video is "9:16", not "0.5625".
_RATIOS = [
    (16, 9), (9, 16), (1, 1), (4, 5), (5, 4), (4, 3), (3, 4), (21, 9), (2, 1), (3, 2), (2, 3),
]


def nearest_ratio(width: int, height: int) -> str:
    if width <= 0 or height <= 0:
        return ""
    actual = width / height
    w, h = min(_RATIOS, key=lambda r: abs(r[0] / r[1] - actual))
    return f"{w}:{h}"


def describe_frame(width: int, height: int) -> str:
    """'1080×1920, vertical 9:16' — for the prompt, so the model writes for it."""
    ratio = nearest_ratio(width, height)
    if not ratio:
        return ""
    shape = "square" if width == height else ("vertical" if height > width else "horizontal")
    return f"{width}×{height}, {shape} {ratio}"


def grab_frames(video_path: str, times: list[float]) -> list[Optional[bytes]]:
    """
    A small JPEG at each time, in the order given. None where a frame would
    not decode — one bad seek must not cost the rest of the thumbnails.
    """
    import cv2

    out: list[Optional[bytes]] = [None] * len(times)
    capture = cv2.VideoCapture(video_path)
    try:
        if not capture.isOpened():
            return out
        # Seek in time order; the results go back in the caller's order.
        for index in sorted(range(len(times)), key=lambda i: times[i]):
            try:
                capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, times[index]) * 1000.0)
                ok, frame = capture.read()
                if not ok or frame is None:
                    continue
                h, w = frame.shape[:2]
                if w > THUMB_WIDTH:
                    frame = cv2.resize(
                        frame,
                        (THUMB_WIDTH, max(1, round(h * THUMB_WIDTH / w))),
                        interpolation=cv2.INTER_AREA,
                    )
                ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
                if ok:
                    out[index] = encoded.tobytes()
            except Exception as exc:                           # noqa: BLE001
                log.warning("thumbnail at %.2fs failed: %s", times[index], exc)
    finally:
        capture.release()
    return out


# ──────────────────────────────────────────────────────────────────────────
# Keeping them
# ──────────────────────────────────────────────────────────────────────────


class NotOwner(Exception):
    """Somebody asked to delete thumbnails that are not theirs."""


class GcsThumbs:
    def __init__(self, bucket):
        self._bucket = bucket

    @staticmethod
    def _key(job_id: str, name: str) -> str:
        return f"thumbs/{job_id}/{name}.jpg"

    def put_many(self, job_id: str, owner_id: str, items: list[tuple[str, bytes]]) -> list[str]:
        """Store each image; return the names that were stored."""

        def put(item: tuple[str, bytes]) -> Optional[str]:
            name, data = item
            try:
                blob = self._bucket.blob(self._key(job_id, name))
                blob.metadata = {"owner": owner_id}
                blob.cache_control = "public, max-age=31536000, immutable"
                blob.upload_from_string(data, content_type="image/jpeg")
                return name
            except Exception as exc:                           # noqa: BLE001
                log.warning("thumbnail upload %s/%s failed: %s", job_id, name, exc)
                return None

        with ThreadPoolExecutor(max_workers=8) as pool:
            return [name for name in pool.map(put, items) if name is not None]

    def get(self, job_id: str, name: str) -> Optional[bytes]:
        from google.api_core.exceptions import NotFound

        try:
            return self._bucket.blob(self._key(job_id, name)).download_as_bytes()
        except NotFound:
            return None

    def delete(self, job_id: str, owner_id: str) -> int:
        blobs = list(self._bucket.list_blobs(prefix=f"thumbs/{job_id}/"))
        if any((b.metadata or {}).get("owner") != owner_id for b in blobs):
            raise NotOwner(job_id)
        for blob in blobs:
            try:
                blob.delete()
            except Exception:                                  # noqa: BLE001
                pass
        return len(blobs)


class LocalThumbs:
    """The temp-directory stand-in for development and tests."""

    def __init__(self, root: Path):
        self._root = root

    def put_many(self, job_id: str, owner_id: str, items: list[tuple[str, bytes]]) -> list[str]:
        folder = self._root / job_id
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "owner").write_text(owner_id, encoding="utf-8")
        for name, data in items:
            (folder / f"{name}.jpg").write_bytes(data)
        return [name for name, _data in items]

    def get(self, job_id: str, name: str) -> Optional[bytes]:
        path = self._root / job_id / f"{name}.jpg"
        return path.read_bytes() if path.is_file() else None

    def delete(self, job_id: str, owner_id: str) -> int:
        folder = self._root / job_id
        if not folder.is_dir():
            return 0
        owner = (folder / "owner").read_text(encoding="utf-8") if (folder / "owner").is_file() else ""
        if owner != owner_id:
            raise NotOwner(job_id)
        count = len(list(folder.glob("*.jpg")))
        shutil.rmtree(folder, ignore_errors=True)
        return count


@lru_cache
def thumb_store():
    """Cloud Storage when this service has a service account, else a temp folder."""
    from app.config import get_settings

    settings = get_settings()
    if settings.gcp_project_id and settings.gcp_credentials_json:
        import json

        from google.cloud import storage
        from google.oauth2 import service_account

        credentials = service_account.Credentials.from_service_account_info(
            json.loads(settings.gcp_credentials_json),
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        client = storage.Client(project=settings.gcp_project_id, credentials=credentials)
        return GcsThumbs(client.bucket(settings.thumbs_bucket_name or settings.gcs_bucket_name))

    return LocalThumbs(Path(tempfile.gettempdir()) / "autoflow-thumbs")
