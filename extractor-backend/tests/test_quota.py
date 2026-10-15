"""
The extractor's side of the weighted allowance.

Every job reserves its extractions (one per ten analysed minutes) before any
model work and gives them back if it fails. Tested here: the call fails
closed, the reservation sees the analysed length and not the file's, a
refusal stops the job before the model is asked, and only a failure is
refunded.
"""

from __future__ import annotations

import asyncio
import io
import os
from pathlib import Path
from types import SimpleNamespace

import httpx
import jwt
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api import videos as videos_api
from app.extraction import Extraction, Shot
from app.main import app
from app.thumbnails import LocalThumbs, Probe


def auth(user_id: str = "u1") -> dict[str, str]:
    token = jwt.encode({"user_id": user_id}, videos_api.settings.jwt_secret_key,
                       algorithm=videos_api.settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def enforced(monkeypatch):
    monkeypatch.setattr(videos_api.settings, "enforce_extraction_limits", True)
    videos_api.jobs.clear()
    yield
    videos_api.jobs.clear()


# ──────────────────────────────────────────────────────────────────────────
# The call itself
# ──────────────────────────────────────────────────────────────────────────


def fake_django(monkeypatch, respond):
    sent = []

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, json=None):
            sent.append({"url": url, "json": json, "auth": (headers or {}).get("Authorization")})
            return respond(url, json)

    monkeypatch.setattr(httpx, "AsyncClient", Client)
    return sent


def answer(status_code, body):
    return SimpleNamespace(status_code=status_code, json=lambda: body)


class TestReserveCall:
    def test_a_granted_reservation_lets_the_job_start(self, monkeypatch):
        sent = fake_django(monkeypatch, lambda url, body: answer(201, {"allowed": True, "charged": True}))
        asyncio.run(videos_api.reserve_extraction("Bearer t", "job1", 1500.0, "prompts"))
        assert sent[0]["url"].endswith("/extractions/reserve")
        assert sent[0]["json"] == {"idempotency_key": "job1", "seconds": 1500.0, "kind": "prompts"}
        assert sent[0]["auth"] == "Bearer t"

    def test_a_refusal_carries_djangos_words(self, monkeypatch):
        fake_django(monkeypatch, lambda url, body: answer(429, {"allowed": False, "detail": "counts as 3 extractions"}))
        with pytest.raises(HTTPException) as caught:
            asyncio.run(videos_api.reserve_extraction("Bearer t", "job1", 1500.0, "prompts"))
        assert caught.value.status_code == 429 and "3 extractions" in caught.value.detail

    def test_an_unreachable_allowance_fails_closed(self, monkeypatch):
        def down(url, body):
            raise httpx.ConnectError("no route")

        sent = fake_django(monkeypatch, down)
        real_sleep = asyncio.sleep
        monkeypatch.setattr(videos_api.asyncio, "sleep", lambda *_a: real_sleep(0))
        with pytest.raises(HTTPException) as caught:
            asyncio.run(videos_api.reserve_extraction("Bearer t", "job1", 30.0, "prompts"))
        assert caught.value.status_code == 502
        assert len(sent) == 3                                  # retried before giving up

    def test_an_expired_session_says_so(self, monkeypatch):
        fake_django(monkeypatch, lambda url, body: answer(401, {"detail": "token expired"}))
        with pytest.raises(HTTPException) as caught:
            asyncio.run(videos_api.reserve_extraction("Bearer t", "job1", 30.0, "prompts"))
        assert caught.value.status_code == 401 and "Sign in" in caught.value.detail

    def test_nothing_is_asked_when_limits_are_off(self, monkeypatch):
        monkeypatch.setattr(videos_api.settings, "enforce_extraction_limits", False)
        sent = fake_django(monkeypatch, lambda url, body: answer(500, {}))
        asyncio.run(videos_api.reserve_extraction("Bearer t", "job1", 30.0, "prompts"))
        assert sent == []


# ──────────────────────────────────────────────────────────────────────────
# Where in each flow it happens
# ──────────────────────────────────────────────────────────────────────────


@pytest.fixture
def ledger(monkeypatch):
    """Records reservations and releases; refuses anything over `allow` seconds."""
    book = {"reserved": [], "released": [], "allow": 10_000.0}

    async def reserve(authorization, job_id, seconds, kind):
        book["reserved"].append({"job": job_id, "seconds": round(seconds, 2), "kind": kind})
        if seconds > book["allow"]:
            raise HTTPException(status_code=429, detail="This video counts as 3 extractions.")

    async def release(authorization, job_id):
        book["released"].append(job_id)

    async def check(_authorization):
        return None

    monkeypatch.setattr(videos_api, "reserve_extraction", reserve)
    monkeypatch.setattr(videos_api, "release_extraction", release)
    monkeypatch.setattr(videos_api, "enforce_extraction_limit", check)
    return book


@pytest.fixture
def pipeline(monkeypatch, tmp_path):
    seen = {"model_calls": 0}
    monkeypatch.setattr(videos_api, "probe_video", lambda _p: Probe(1500.0, 1920, 1080, fps=25.0))
    monkeypatch.setattr(videos_api, "_open_source", lambda path, say, prefix: (SimpleNamespace(), "gs://b/v.mp4", lambda: None, "video/mp4"))
    monkeypatch.setattr(videos_api, "detect_cuts_quietly", lambda _p, **_k: [])
    monkeypatch.setattr(videos_api, "thumb_store", lambda: LocalThumbs(tmp_path / "thumbs"))
    monkeypatch.setattr(videos_api, "grab_frames", lambda _p, times: [None] * len(times))

    async def extract(client, source, **kwargs):
        seen["model_calls"] += 1
        if seen.get("fail"):
            raise RuntimeError("provider 500")
        return Extraction(shots=[Shot(shot_id=1, image_prompt="a shot", start_sec=0.0, end_sec=4.0)],
                          duration_sec=kwargs["duration_sec"])

    monkeypatch.setattr(videos_api, "extract_video", extract)
    return seen


def upload(**options):
    data = {"options": __import__("json").dumps(options)} if options else {}
    return TestClient(app).post(
        "/api/videos/analyze",
        files={"video": ("v.mp4", io.BytesIO(b"\x00" * 4096), "video/mp4")},
        data=data, headers=auth(),
    )


class TestFlows:
    def test_an_upload_reserves_its_analysed_length_before_the_job_exists(self, ledger, pipeline):
        r = upload(start_sec=60, end_sec=240)
        assert r.status_code == 200
        assert ledger["reserved"] == [{"job": r.json()["job_id"], "seconds": 180.0, "kind": "prompts"}]
        assert ledger["released"] == []

    def test_a_refused_upload_never_reaches_the_model_and_leaves_nothing(self, ledger, pipeline, monkeypatch):
        written = []
        real_probe = videos_api.probe_video
        monkeypatch.setattr(videos_api, "probe_video", lambda p: written.append(p) or real_probe(p))
        ledger["allow"] = 600
        r = upload()
        assert r.status_code == 429 and "3 extractions" in r.json()["detail"]
        assert pipeline["model_calls"] == 0
        assert videos_api.jobs.get(ledger["reserved"][0]["job"]) is None
        assert written and not os.path.exists(written[0])

    def test_a_failed_job_is_refunded(self, ledger, pipeline):
        pipeline["fail"] = True
        job = upload().json()["job_id"]
        assert ledger["released"] == [job]

    def test_a_link_reserves_after_the_download_says_how_long(self, ledger, pipeline, monkeypatch):
        async def download(url, temp_dir, say):
            path = os.path.join(temp_dir, "v.mp4")
            Path(path).write_bytes(b"\x00" * 1024)
            return path

        monkeypatch.setattr(videos_api, "download_video", download)
        c = TestClient(app)
        job = c.post("/api/videos/analyze-url", json={"url": "https://example.com/v.mp4", "mode": "breakdown"},
                     headers=auth()).json()["job_id"]
        assert ledger["reserved"] == [{"job": job, "seconds": 1500.0, "kind": "breakdown"}]

    def test_a_refused_link_fails_with_the_reason(self, ledger, pipeline, monkeypatch):
        async def download(url, temp_dir, say):
            path = os.path.join(temp_dir, "v.mp4")
            Path(path).write_bytes(b"\x00" * 1024)
            return path

        monkeypatch.setattr(videos_api, "download_video", download)
        ledger["allow"] = 600
        c = TestClient(app)
        job = c.post("/api/videos/analyze-url", json={"url": "https://example.com/v.mp4"}, headers=auth()).json()["job_id"]
        status = c.get(f"/api/videos/status/{job}", headers=auth()).json()
        assert status["status"] == "failed" and "3 extractions" in status["error"]
        assert pipeline["model_calls"] == 0 and ledger["released"] == []

    def test_a_youtube_link_read_directly_is_reserved_too(self, ledger, pipeline, monkeypatch):
        from app.youtube import Details

        async def blocked(url, temp_dir, say):
            raise RuntimeError("Sign in to confirm you're not a bot")

        async def details(vid, **_k):
            return Details(19.0)

        monkeypatch.setattr(videos_api, "download_video", blocked)
        monkeypatch.setattr(videos_api, "youtube_details", details)
        monkeypatch.setattr(videos_api, "model_client", lambda: SimpleNamespace())
        c = TestClient(app)
        job = c.post("/api/videos/analyze-url", json={"url": "https://youtu.be/jNQXAC9IVRw"}, headers=auth()).json()["job_id"]
        assert ledger["reserved"] == [{"job": job, "seconds": 19.0, "kind": "prompts"}]
        assert c.get(f"/api/videos/status/{job}", headers=auth()).json()["status"] == "completed"
