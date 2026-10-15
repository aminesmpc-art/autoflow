"""
The /api/videos endpoints and the thumbnails, without a Gemini key.

The guarding is what is tested here: a job answers only the account that
started it, a file that is not a video or does not contain the chosen section
is refused before any model work, the upload is always removed, and the
thumbnails can be read by address but deleted only by their owner. The frame
cutting runs for real against a small generated video.
"""

from __future__ import annotations

import io
import os
import time
from pathlib import Path
from types import SimpleNamespace

import jwt
import pytest
from fastapi.testclient import TestClient

from app.api import videos as videos_api
from app.extraction import Extraction, Shot
from app.main import app
from app.thumbnails import (
    LocalThumbs,
    Probe,
    describe_frame,
    grab_frames,
    nearest_ratio,
    probe_video,
)


def auth(user_id: str) -> dict[str, str]:
    token = jwt.encode(
        {"user_id": user_id},
        videos_api.settings.jwt_secret_key,
        algorithm=videos_api.settings.jwt_algorithm,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def no_quota_check(monkeypatch):
    """Quotas belong to the Django API and are tested there."""
    monkeypatch.setattr(videos_api.settings, "enforce_extraction_limits", False)


@pytest.fixture(autouse=True)
def clean_jobs():
    videos_api.jobs.clear()
    yield
    videos_api.jobs.clear()


@pytest.fixture
def store(tmp_path, monkeypatch):
    local = LocalThumbs(tmp_path / "thumbs")
    monkeypatch.setattr(videos_api, "thumb_store", lambda: local)
    return local


@pytest.fixture
def client():
    return TestClient(app)


def a_video(name: str = "clip.mp4") -> tuple[str, io.BytesIO, str]:
    return (name, io.BytesIO(b"\x00" * 4096), "video/mp4")


def an_extraction() -> Extraction:
    return Extraction(
        video_concept="A kitchen.",
        shots=[
            Shot(shot_id=1, time_range="00:00.0 - 00:04.0", image_prompt="a chef plating",
                 video_prompt="slow dolly in", start_sec=0.0, end_sec=4.0),
            Shot(shot_id=2, image_prompt="the pass, untimed", video_prompt="static"),
        ],
        duration_sec=8.0,
    )


@pytest.fixture
def stub_pipeline(monkeypatch, store):
    """Stand in for the upload, the model and the frame cutting."""
    seen: dict = {}

    monkeypatch.setattr(videos_api, "probe_video", lambda _p: Probe(8.0, 1080, 1920))

    def _open_source(path, say, prefix):
        seen["prefix"] = prefix
        seen["path"] = path
        seen["existed"] = os.path.exists(path)
        return SimpleNamespace(), "gs://bucket/v.mp4", lambda: seen.update(cleaned=True), "video/mp4"

    async def _extract(client, source, **kwargs):
        seen.update(kwargs)
        return an_extraction()

    monkeypatch.setattr(videos_api, "_open_source", _open_source)
    monkeypatch.setattr(videos_api, "extract_video", _extract)
    monkeypatch.setattr(videos_api, "grab_frames", lambda _p, times: [b"\xff\xd8jpeg"] * len(times))
    return seen


# ──────────────────────────────────────────────────────────────────────────
# Starting a job
# ──────────────────────────────────────────────────────────────────────────


class TestAnalyze:
    def test_needs_a_login(self, client):
        assert client.post("/api/videos/analyze", files={"video": a_video()}).status_code == 401

    def test_refuses_a_file_that_is_not_a_video(self, client):
        r = client.post(
            "/api/videos/analyze",
            files={"video": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
            headers=auth("u1"),
        )
        assert r.status_code == 400

    def test_refuses_an_undecodable_video_and_removes_it(self, client, monkeypatch):
        written: list[str] = []
        monkeypatch.setattr(videos_api, "probe_video", lambda p: written.append(p) or None)
        r = client.post("/api/videos/analyze", files={"video": a_video()}, headers=auth("u1"))
        assert r.status_code == 422
        assert written and not os.path.exists(written[0])

    def test_refuses_a_video_over_the_length_limit(self, client, monkeypatch):
        monkeypatch.setattr(videos_api, "probe_video", lambda _p: Probe(99_999.0, 1920, 1080))
        r = client.post("/api/videos/analyze", files={"video": a_video()}, headers=auth("u1"))
        assert r.status_code == 413

    def test_refuses_a_section_the_video_does_not_contain(self, client, stub_pipeline):
        r = client.post(
            "/api/videos/analyze",
            files={"video": a_video()},
            data={"options": '{"start_sec": "00:30"}'},
            headers=auth("u1"),
        )
        assert r.status_code == 400
        assert "only 0:08 long" in r.json()["detail"]
        assert "path" not in stub_pipeline   # no model work started

    def test_a_hostile_filename_does_not_reach_the_path(self, client, stub_pipeline):
        r = client.post(
            "/api/videos/analyze",
            files={"video": a_video("../../evil.mp4")},
            headers=auth("u1"),
        )
        assert r.status_code == 200
        path = Path(stub_pipeline["path"])
        assert path.suffix == ".mp4" and "evil" not in path.name

    def test_runs_the_job_and_cleans_up(self, client, stub_pipeline):
        r = client.post(
            "/api/videos/analyze",
            files={"video": a_video()},
            data={"options": '{"aspect_ratio": "9:16", "creative_direction": "claymation"}'},
            headers={**auth("u1"), "x-forwarded-proto": "https", "host": "extractor.example"},
        )
        assert r.status_code == 200
        job_id = r.json()["job_id"]

        assert stub_pipeline["prefix"] == "videos"
        assert stub_pipeline["existed"] is True
        # The cloud copy is kept for an hour so an edit can look again (the
        # sweeper deletes it); the local file goes now, as always.
        assert "cleaned" not in stub_pipeline
        assert not os.path.exists(stub_pipeline["path"])
        kept = videos_api.jobs[job_id]["kept_video"]
        assert kept["uri"] == "gs://bucket/v.mp4"
        assert 3500 < kept["expires_at"] - time.time() <= 3600
        assert stub_pipeline["options"].creative_direction == "claymation"
        assert stub_pipeline["frame"] == "1080×1920, vertical 9:16"
        assert stub_pipeline["section"] == (0.0, 8.0)

        status = client.get(f"/api/videos/status/{job_id}", headers=auth("u1")).json()
        assert status["status"] == "completed"
        shots = status["result"]["shots"]
        assert shots[0]["thumbnail_url"] == (
            f"https://extractor.example/api/videos/thumbs/{job_id}/1.jpg"
        )
        assert shots[1]["thumbnail_url"] is None          # untimed, so no frame
        assert status["result"]["thumbnails_id"] == job_id

    def test_shots_are_snapped_to_the_cuts_found_in_the_file(self, client, stub_pipeline, monkeypatch):
        seen = {}

        def _cuts(path, **kwargs):
            seen.update(kwargs, existed=os.path.exists(path))
            return [3.6]

        monkeypatch.setattr(videos_api, "detect_cuts_quietly", _cuts)
        monkeypatch.setattr(videos_api, "probe_video", lambda _p: Probe(8.0, 1920, 1080, fps=25.0))
        job_id = client.post(
            "/api/videos/analyze", files={"video": a_video()}, headers=auth("u1")
        ).json()["job_id"]

        result = client.get(f"/api/videos/status/{job_id}", headers=auth("u1")).json()["result"]
        assert (result["shots"][0]["start_sec"], result["shots"][0]["end_sec"]) == (0.0, 3.6)
        assert result["shots"][0]["time_range"] == "00:00.0 - 00:03.6"
        assert result["source_fps"] == 25.0
        assert seen["existed"] and (seen["start_sec"], seen["end_sec"]) == (0.0, 8.0)

    def test_malformed_options_fall_back_to_the_defaults(self, client, stub_pipeline):
        r = client.post(
            "/api/videos/analyze",
            files={"video": a_video()},
            data={"options": "{not json"},
            headers=auth("u1"),
        )
        assert r.status_code == 200
        assert stub_pipeline["options"] is None

    def test_a_model_failure_fails_the_job_in_words(self, client, stub_pipeline, monkeypatch):
        async def _broken(*_a, **_k):
            raise RuntimeError("The AI could not read this video: provider 500")

        monkeypatch.setattr(videos_api, "extract_video", _broken)
        job_id = client.post(
            "/api/videos/analyze", files={"video": a_video()}, headers=auth("u1")
        ).json()["job_id"]
        status = client.get(f"/api/videos/status/{job_id}", headers=auth("u1")).json()
        assert status["status"] == "failed"
        assert "provider 500" in status["error"]
        assert stub_pipeline["cleaned"] is True


class TestAnalyzeUrl:
    def test_downloads_then_analyses(self, client, stub_pipeline, monkeypatch, tmp_path):
        async def _download(url, temp_dir, say):
            path = os.path.join(temp_dir, "video.mp4")
            Path(path).write_bytes(b"\x00" * 1024)
            return path

        monkeypatch.setattr(videos_api, "download_video", _download)
        r = client.post(
            "/api/videos/analyze-url",
            json={"url": "https://example.com/v.mp4", "options": {"start_sec": 2}},
            headers=auth("u1"),
        )
        job_id = r.json()["job_id"]
        status = client.get(f"/api/videos/status/{job_id}", headers=auth("u1")).json()
        assert status["status"] == "completed"
        assert stub_pipeline["section"] == (2.0, 8.0)

    def test_a_platform_block_is_explained(self, client, monkeypatch):
        async def _blocked(url, temp_dir, say):
            raise RuntimeError("ERROR: [Instagram] 403 Forbidden")

        monkeypatch.setattr(videos_api, "download_video", _blocked)
        job_id = client.post(
            "/api/videos/analyze-url",
            json={"url": "https://www.instagram.com/reel/abc/"},
            headers=auth("u1"),
        ).json()["job_id"]
        status = client.get(f"/api/videos/status/{job_id}", headers=auth("u1")).json()
        assert status["status"] == "failed"
        assert "Instagram blocked the download" in status["error"]


# ──────────────────────────────────────────────────────────────────────────
# Reading a job
# ──────────────────────────────────────────────────────────────────────────


class TestStatus:
    def test_answers_only_its_owner(self, client, stub_pipeline):
        job_id = client.post(
            "/api/videos/analyze", files={"video": a_video()}, headers=auth("u1")
        ).json()["job_id"]
        assert client.get(f"/api/videos/status/{job_id}", headers=auth("u2")).status_code == 404
        assert client.get(f"/api/videos/status/{job_id}").status_code == 401

    def test_a_job_abandoned_by_a_restart_fails_instead_of_spinning(self, client, monkeypatch):
        videos_api.jobs["a" * 32] = {
            "job_id": "a" * 32, "status": "processing", "step": "AI is watching...",
            "result": None, "error": None, "owner_id": "u1",
        }
        monkeypatch.setattr(videos_api.settings, "clip_job_stale_sec", -1)
        status = client.get(f"/api/videos/status/{'a' * 32}", headers=auth("u1")).json()
        assert status["status"] == "failed"
        assert "run it again" in status["error"]


# ──────────────────────────────────────────────────────────────────────────
# Thumbnails
# ──────────────────────────────────────────────────────────────────────────


class TestThumbnailEndpoints:
    JOB = "b" * 32

    def test_served_by_address_with_a_long_cache(self, client, store):
        store.put_many(self.JOB, "u1", [("1", b"\xff\xd8jpeg")])
        r = client.get(f"/api/videos/thumbs/{self.JOB}/1.jpg")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/jpeg"
        assert "immutable" in r.headers["cache-control"]
        assert r.content == b"\xff\xd8jpeg"

    def test_bad_names_never_reach_the_store(self, client, store):
        assert client.get("/api/videos/thumbs/not-a-job/1.jpg").status_code == 404
        assert client.get(f"/api/videos/thumbs/{self.JOB}/x.jpg").status_code == 404
        assert client.get(f"/api/videos/thumbs/{self.JOB}/9.jpg").status_code == 404

    def test_only_the_owner_can_delete_them(self, client, store):
        store.put_many(self.JOB, "u1", [("1", b"a"), ("2", b"b")])
        assert client.delete(f"/api/videos/thumbs/{self.JOB}", headers=auth("u2")).status_code == 404
        assert store.get(self.JOB, "1") == b"a"
        r = client.delete(f"/api/videos/thumbs/{self.JOB}", headers=auth("u1"))
        assert r.json() == {"deleted": 2}
        assert store.get(self.JOB, "1") is None


class TestFrames:
    @pytest.fixture
    def video(self, tmp_path) -> str:
        import cv2
        import numpy as np

        path = str(tmp_path / "v.mp4")
        writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (640, 360))
        for i in range(40):                            # 4 seconds
            frame = np.full((360, 640, 3), (i * 6) % 255, dtype=np.uint8)
            writer.write(frame)
        writer.release()
        return path

    def test_probe_reads_length_and_size(self, video):
        probe = probe_video(video)
        assert probe is not None
        assert abs(probe.duration_sec - 4.0) < 0.2
        assert (probe.width, probe.height) == (640, 360)

    def test_frames_come_back_small_and_in_the_order_asked(self, video):
        import cv2
        import numpy as np

        frames = grab_frames(video, [3.0, 0.5, 99.0])
        assert frames[2] is None                       # past the end
        for data in frames[:2]:
            assert data[:2] == b"\xff\xd8"
            image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            assert image.shape[1] == 320
        # Later frames are brighter in this video; order must be the caller's.
        later = cv2.imdecode(np.frombuffer(frames[0], np.uint8), cv2.IMREAD_GRAYSCALE).mean()
        earlier = cv2.imdecode(np.frombuffer(frames[1], np.uint8), cv2.IMREAD_GRAYSCALE).mean()
        assert later > earlier

    def test_ratios_are_named_the_way_people_name_them(self):
        assert nearest_ratio(1080, 1920) == "9:16"
        assert nearest_ratio(1920, 1080) == "16:9"
        assert nearest_ratio(1080, 1350) == "4:5"
        assert describe_frame(1080, 1080) == "1080×1080, square 1:1"
        assert describe_frame(0, 0) == ""
