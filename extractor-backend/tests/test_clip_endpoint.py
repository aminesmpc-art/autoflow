"""
The /api/clip endpoints, without a Gemini key or a video.

What is worth testing here is the guarding, not the reading: that a caller
cannot spend an expensive model call by uploading a text file, that a video
over the size limit is refused before it is written to disk in full, and that
the temporary file is always removed — a service that leaks 350MB per request
falls over on its own long before the model does.
"""

from __future__ import annotations

import io
import os
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api import clip as clip_api
from app.clip_analysis import ClipReading, TimedScene, TimedSegment
from app.main import app


@pytest.fixture(autouse=True)
def no_quota_check(monkeypatch):
    """Quotas belong to the Django API and are tested there."""
    monkeypatch.setattr(clip_api.settings, "enforce_extraction_limits", False)


@pytest.fixture(autouse=True)
def clean_jobs():
    clip_api.jobs.clear()
    yield
    clip_api.jobs.clear()


@pytest.fixture
def client():
    return TestClient(app)


def a_video(size: int = 2048) -> tuple[str, io.BytesIO, str]:
    return ("clip.mp4", io.BytesIO(b"\x00" * size), "video/mp4")


def fake_reading() -> ClipReading:
    return ClipReading(
        duration_sec=240.0,
        language="en",
        summary="a chase",
        segments=[
            TimedSegment(start=83.1, end=86.4, text="Look at these straw bales right here.")
        ],
        scenes=[TimedScene(start=80.0, end=90.0, description="a field", speaker_x=0.38)],
    )


@pytest.fixture
def stub_read(monkeypatch):
    """Stand in for the upload and the model call."""
    opened: dict = {}

    def _open_source(path, say):
        opened["path"] = path
        opened["existed"] = os.path.exists(path)
        return SimpleNamespace(), "gs://bucket/v.mp4", lambda: opened.update(cleaned=True)

    async def _read_video(client, source, duration_sec, **kwargs):
        opened["duration"] = duration_sec
        return fake_reading()

    monkeypatch.setattr(clip_api, "_open_source", _open_source)
    monkeypatch.setattr(clip_api, "read_video", _read_video)
    return opened


# ──────────────────────────────────────────────────────────────────────────


class TestReadEndpoint:
    def test_reads_a_video_and_returns_the_timeline(self, client, stub_read):
        name, data, mime = a_video()
        response = client.post(
            "/api/clip/read",
            files={"file": (name, data, mime)},
            data={"duration_sec": "240.0"},
        )
        assert response.status_code == 202
        job_id = response.json()["job_id"]

        status = client.get(f"/api/clip/status/{job_id}").json()
        assert status["status"] == "completed"
        assert status["result"]["segments"][0]["start"] == pytest.approx(83.1)
        assert status["result"]["scenes"][0]["speaker_x"] == pytest.approx(0.38)

    def test_passes_the_duration_the_caller_measured(self, client, stub_read):
        """The extension has already decoded the file to probe it. Measuring it
        again here would mean putting ffmpeg on the server to learn a number
        the caller already has."""
        name, data, mime = a_video()
        client.post(
            "/api/clip/read",
            files={"file": (name, data, mime)},
            data={"duration_sec": "1228.4"},
        )
        assert stub_read["duration"] == pytest.approx(1228.4)

    def test_removes_the_temporary_file_afterwards(self, client, stub_read):
        """350MB per request, never cleaned up, fills a disk in a morning."""
        name, data, mime = a_video()
        client.post(
            "/api/clip/read",
            files={"file": (name, data, mime)},
            data={"duration_sec": "240.0"},
        )
        assert stub_read["existed"] is True          # it was there to be read
        assert not os.path.exists(stub_read["path"])  # and is gone now

    def test_releases_the_uploaded_copy_at_the_far_end_too(self, client, stub_read):
        name, data, mime = a_video()
        client.post(
            "/api/clip/read",
            files={"file": (name, data, mime)},
            data={"duration_sec": "240.0"},
        )
        assert stub_read.get("cleaned") is True

    def test_refuses_something_that_is_not_a_video(self, client, stub_read):
        response = client.post(
            "/api/clip/read",
            files={"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
            data={"duration_sec": "240.0"},
        )
        assert response.status_code == 415

    def test_refuses_a_duration_that_cannot_be_true(self, client, stub_read):
        for bad in ("0", "-12"):
            name, data, mime = a_video()
            response = client.post(
                "/api/clip/read",
                files={"file": (name, data, mime)},
                data={"duration_sec": bad},
            )
            assert response.status_code == 400

    def test_refuses_a_video_over_the_size_limit(self, client, stub_read, monkeypatch):
        monkeypatch.setattr(clip_api.settings, "max_video_size_mb", 1)
        name, data, mime = a_video(size=3 * 1024 * 1024)
        response = client.post(
            "/api/clip/read",
            files={"file": (name, data, mime)},
            data={"duration_sec": "240.0"},
        )
        assert response.status_code == 413

    def test_leaves_no_file_behind_when_it_refuses(self, client, monkeypatch, tmp_path):
        """A rejected upload must not leave its bytes on disk either."""
        monkeypatch.setattr(clip_api.settings, "max_video_size_mb", 1)
        before = set(os.listdir(tmp_path))
        monkeypatch.setattr("tempfile.tempdir", str(tmp_path))
        name, data, mime = a_video(size=3 * 1024 * 1024)
        client.post(
            "/api/clip/read",
            files={"file": (name, data, mime)},
            data={"duration_sec": "240.0"},
        )
        assert set(os.listdir(tmp_path)) == before

    def test_reports_a_failed_reading_rather_than_hanging(self, client, monkeypatch):
        def boom(path, say):
            raise RuntimeError("no credentials on this server")

        monkeypatch.setattr(clip_api, "_open_source", boom)
        name, data, mime = a_video()
        response = client.post(
            "/api/clip/read",
            files={"file": (name, data, mime)},
            data={"duration_sec": "240.0"},
        )
        job_id = response.json()["job_id"]
        status = client.get(f"/api/clip/status/{job_id}").json()
        assert status["status"] == "failed"
        assert "no credentials" in status["error"]


class TestStatusAndModel:
    def test_unknown_job_is_a_404_not_an_empty_success(self, client):
        assert client.get("/api/clip/status/nope").status_code == 404

    def test_reports_which_model_it_would_use(self, client):
        body = client.get("/api/clip/model").json()
        assert body["model"] == clip_api.CLIP_MODEL
        assert "configured" in body
