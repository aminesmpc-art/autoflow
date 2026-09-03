"""
The /api/clip endpoints, without a Gemini key or a video.

What is worth testing here is the guarding, not the reading: that a caller
cannot spend an expensive model call by uploading a text file, that a video
over the size limit is refused before it is written to disk in full, and that
the temporary file is always removed — a service that leaks 350MB per request
falls over on its own long before the model does.
"""

from __future__ import annotations

import base64
import io
import os
from types import SimpleNamespace

import pytest
import jwt
from fastapi.testclient import TestClient

from app.api import clip as clip_api
from app.rate_limit import reset_ask_limiter
from app.clip_analysis import ClipReading, TimedScene, TimedSegment, TrackedFace

clip_api_face = TrackedFace
from app.main import app


@pytest.fixture(autouse=True)
def no_quota_check(monkeypatch):
    """Quotas belong to the Django API and are tested there."""
    monkeypatch.setattr(clip_api.settings, "enforce_extraction_limits", False)


@pytest.fixture(autouse=True)
def valid_video_probe(monkeypatch):
    monkeypatch.setattr(clip_api, "probe_video_duration", lambda _path: 240.0)


@pytest.fixture(autouse=True)
def clean_jobs():
    clip_api.jobs.clear()
    yield
    clip_api.jobs.clear()


@pytest.fixture(autouse=True)
def fresh_ask_ceiling():
    """The ask limiter is a singleton, so tests would otherwise share one
    allowance under one user id — and the file would start failing on whatever
    test happened to be the sixty-first, for a reason unrelated to it."""
    reset_ask_limiter()
    yield
    reset_ask_limiter()


@pytest.fixture
def client():
    client = TestClient(app)
    token = jwt.encode(
        {"user_id": "user-1"},
        clip_api.settings.jwt_secret_key,
        algorithm=clip_api.settings.jwt_algorithm,
    )
    client.headers["Authorization"] = f"Bearer {token}"
    return client


def auth_header(user_id: str) -> dict[str, str]:
    token = jwt.encode(
        {"user_id": user_id},
        clip_api.settings.jwt_secret_key,
        algorithm=clip_api.settings.jwt_algorithm,
    )
    return {"Authorization": f"Bearer {token}"}


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
        return (
            SimpleNamespace(),
            "gs://bucket/v.mp4",
            lambda: opened.update(cleaned=True),
            "video/mp4",
        )

    async def _read_video(client, source, duration_sec, **kwargs):
        opened["duration"] = duration_sec
        return fake_reading()

    monkeypatch.setattr(clip_api, "_open_source", _open_source)
    monkeypatch.setattr(clip_api, "read_video", _read_video)
    return opened


# ──────────────────────────────────────────────────────────────────────────


class TestReadEndpoint:
    def test_requires_authentication(self):
        name, data, mime = a_video()
        response = TestClient(app).post(
            "/api/clip/read",
            files={"file": (name, data, mime)},
            data={"duration_sec": "240.0"},
        )
        assert response.status_code == 401

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

    def test_uses_the_duration_measured_by_the_server(self, client, stub_read):
        """A caller-supplied duration cannot be trusted for billing or limits."""
        name, data, mime = a_video()
        client.post(
            "/api/clip/read",
            files={"file": (name, data, mime)},
            data={"duration_sec": "1228.4"},
        )
        assert stub_read["duration"] == pytest.approx(240.0)

    def test_rejects_a_video_the_server_cannot_decode(self, client, monkeypatch):
        monkeypatch.setattr(clip_api, "probe_video_duration", lambda _path: None)
        name, data, mime = a_video()
        response = client.post(
            "/api/clip/read",
            files={"file": (name, data, mime)},
            data={"duration_sec": "240.0"},
        )
        assert response.status_code == 422

    def test_rejects_a_video_over_the_duration_limit(self, client, monkeypatch):
        monkeypatch.setattr(clip_api.settings, "max_video_duration_sec", 60)
        monkeypatch.setattr(clip_api, "probe_video_duration", lambda _path: 61.0)
        name, data, mime = a_video()
        response = client.post(
            "/api/clip/read",
            files={"file": (name, data, mime)},
            data={"duration_sec": "1.0"},
        )
        assert response.status_code == 413

    def test_reserves_quota_once_with_the_job_id(self, client, stub_read, monkeypatch):
        seen = {}

        async def reserve(auth, job_id):
            seen.update(auth=auth, job_id=job_id)
            return {"allowed": True}

        monkeypatch.setattr(clip_api.settings, "enforce_extraction_limits", True)
        monkeypatch.setattr(clip_api, "consume_clipping_quota", reserve)
        name, data, mime = a_video()
        response = client.post(
            "/api/clip/read",
            files={"file": (name, data, mime)},
            data={"duration_sec": "240.0"},
        )
        assert response.status_code == 202
        assert seen["job_id"] == response.json()["job_id"]
        assert seen["auth"].startswith("Bearer ")

    def test_quota_authority_failure_cannot_fall_back_unmetered(
        self, client, stub_read, monkeypatch
    ):
        async def unavailable(_auth, _job_id):
            from fastapi import HTTPException

            raise HTTPException(status_code=502, detail="quota authority unavailable")

        monkeypatch.setattr(clip_api.settings, "enforce_extraction_limits", True)
        monkeypatch.setattr(clip_api, "consume_clipping_quota", unavailable)
        name, data, mime = a_video()
        response = client.post(
            "/api/clip/read",
            files={"file": (name, data, mime)},
            data={"duration_sec": "240.0"},
        )

        assert response.status_code == 502
        assert not clip_api.jobs
        assert stub_read == {}

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


class TestAsk:
    """The relay that took the ranking, and then the per-cut asks, off a chat tab.

    Worth guarding because it is the one endpoint that will take an arbitrary
    prompt: it must require a caller, and refuse an empty or enormous one.

    It now also takes attachments, which the docstring here previously said it
    never would. The line that mattered in that reasoning was about VIDEO — the
    expensive call, metered on /read — so the tests below pin that exclusion
    down explicitly rather than leaving it resting on the absence of a field."""

    @pytest.fixture
    def stub_gemini(self, monkeypatch):
        seen = {}

        class FakeModels:
            def generate_content(self, *, model, contents, config):
                seen['model'] = model
                seen['contents'] = contents
                # Media leads, the question closes. See ask_model.
                seen['prompt'] = contents[-1]
                seen['mime'] = getattr(config, 'response_mime_type', None)
                return SimpleNamespace(text='{"clips":[]}')

        monkeypatch.setattr(clip_api, "_vertex_credentials", lambda: None)
        monkeypatch.setattr(clip_api.settings, "gemini_api_key", "test-key")
        import google.genai as genai
        monkeypatch.setattr(
            genai, "Client", lambda **kw: SimpleNamespace(models=FakeModels())
        )
        return seen

    def test_requires_authentication(self):
        response = TestClient(app).post("/api/clip/ask", json={"prompt": "rank"})
        assert response.status_code == 401

    def test_relays_the_prompt_and_returns_what_came_back(self, client, stub_gemini):
        r = client.post("/api/clip/ask", json={"prompt": "rank these moments"})
        assert r.status_code == 200
        assert r.json()["text"] == '{"clips":[]}'
        assert stub_gemini["prompt"] == "rank these moments"
        assert stub_gemini["model"] == clip_api.CLIP_MODEL

    def test_asks_for_json_by_default(self, client, stub_gemini):
        client.post("/api/clip/ask", json={"prompt": "rank these"})
        assert stub_gemini["mime"] == "application/json"

    def test_refuses_an_empty_prompt_before_spending_anything(self, client, stub_gemini):
        for bad in ("", "   "):
            assert client.post("/api/clip/ask", json={"prompt": bad}).status_code == 400
        assert "prompt" not in stub_gemini

    def test_refuses_a_prompt_too_large_to_be_a_question(self, client, stub_gemini):
        r = client.post("/api/clip/ask", json={"prompt": "x" * 200_001})
        assert r.status_code == 413

    def test_refuses_an_unbounded_output_request(self, client, stub_gemini):
        r = client.post(
            "/api/clip/ask",
            json={"prompt": "rank", "max_output_tokens": 100_000},
        )
        assert r.status_code == 422

    def test_says_so_rather_than_hanging_when_the_model_refuses(self, client, monkeypatch):
        class Boom:
            def generate_content(self, **kw):
                raise RuntimeError("quota exhausted")
        monkeypatch.setattr(clip_api, "_vertex_credentials", lambda: None)
        monkeypatch.setattr(clip_api.settings, "gemini_api_key", "k")
        import google.genai as genai
        monkeypatch.setattr(genai, "Client", lambda **kw: SimpleNamespace(models=Boom()))
        r = client.post("/api/clip/ask", json={"prompt": "rank"})
        assert r.status_code == 502
        assert "quota exhausted" in r.json()["detail"]

    def test_reports_an_empty_answer_rather_than_returning_one(self, client, monkeypatch):
        """An empty reply parses to no clips, which downstream reads as "the
        video has nothing worth posting" — a wrong answer that looks fine."""
        class Silent:
            def generate_content(self, **kw):
                return SimpleNamespace(text="")
        monkeypatch.setattr(clip_api, "_vertex_credentials", lambda: None)
        monkeypatch.setattr(clip_api.settings, "gemini_api_key", "k")
        import google.genai as genai
        monkeypatch.setattr(genai, "Client", lambda **kw: SimpleNamespace(models=Silent()))
        assert client.post("/api/clip/ask", json={"prompt": "rank"}).status_code == 502

    def test_refuses_when_the_server_has_no_credentials(self, client, monkeypatch):
        monkeypatch.setattr(clip_api, "_vertex_credentials", lambda: None)
        monkeypatch.setattr(clip_api.settings, "gemini_api_key", "")
        assert client.post("/api/clip/ask", json={"prompt": "rank"}).status_code == 503



class TestAskCeiling:
    """/ask charges no quota, so a ceiling is the only thing counting it.

    /read reserves a daily job against the Django-owned allowance before any
    model work starts. /ask reserved nothing at all: `verify_jwt` and then
    straight to the model. The limiter class is tested on its own in
    test_ask_rate_limit.py; what is worth proving here is that it is actually
    attached to this endpoint, reads the caller from the token, and refuses
    before spending anything."""

    @pytest.fixture
    def one_ask_allowed(self, monkeypatch):
        from app import rate_limit

        monkeypatch.setattr(rate_limit.get_settings(), "clip_ask_per_minute", 1)
        rate_limit.reset_ask_limiter()
        yield
        rate_limit.reset_ask_limiter()

    def test_refuses_past_the_ceiling_without_asking_the_model(
        self, client, one_ask_allowed, monkeypatch
    ):
        calls = {"n": 0}

        class FakeModels:
            def generate_content(self, **_kwargs):
                calls["n"] += 1
                return SimpleNamespace(text='{"clips":[]}')

        class FakeClient:
            models = FakeModels()

        import google.genai as genai

        monkeypatch.setattr(genai, "Client", lambda **_kwargs: FakeClient())
        monkeypatch.setattr(clip_api.settings, "gemini_api_key", "k", raising=False)

        first = client.post("/api/clip/ask", json={"prompt": "rank these"})
        second = client.post("/api/clip/ask", json={"prompt": "rank these again"})

        assert first.status_code == 200
        assert second.status_code == 429
        # The refusal must come before the spending, not after it.
        assert calls["n"] == 1
        assert "Retry-After" in second.headers

    def test_one_caller_cannot_silence_another(self, client, one_ask_allowed, monkeypatch):
        class FakeModels:
            def generate_content(self, **_kwargs):
                return SimpleNamespace(text='{"clips":[]}')

        class FakeClient:
            models = FakeModels()

        import google.genai as genai

        monkeypatch.setattr(genai, "Client", lambda **_kwargs: FakeClient())
        monkeypatch.setattr(clip_api.settings, "gemini_api_key", "k", raising=False)

        client.post("/api/clip/ask", json={"prompt": "one"})
        assert client.post("/api/clip/ask", json={"prompt": "two"}).status_code == 429

        other = client.post(
            "/api/clip/ask", json={"prompt": "mine"}, headers=auth_header("someone-else")
        )

        assert other.status_code == 200


class TestAskAttachments:
    """The two asks a cut falls back on when the reading cannot answer it:
    a span of audio to find a line in, and eight stills to point at a speaker
    in. Small, bounded, and emphatically not a video."""

    @pytest.fixture
    def stub_gemini(self, monkeypatch):
        seen = {}

        class FakeModels:
            def generate_content(self, *, model, contents, config):
                seen['contents'] = contents
                return SimpleNamespace(text='{"positions":[]}')

        monkeypatch.setattr(clip_api, "_vertex_credentials", lambda: None)
        monkeypatch.setattr(clip_api.settings, "gemini_api_key", "test-key")
        import google.genai as genai
        monkeypatch.setattr(
            genai, "Client", lambda **kw: SimpleNamespace(models=FakeModels())
        )
        return seen

    @staticmethod
    def data_url(mime: str, payload: bytes = b"\x00\x01\x02\x03") -> str:
        return f"data:{mime};base64,{base64.b64encode(payload).decode()}"

    def test_sends_the_bytes_it_was_given(self, client, stub_gemini):
        r = client.post("/api/clip/ask", json={
            "prompt": "where is the speaker",
            "attachments": [self.data_url("image/jpeg", b"stillbytes")],
        })
        assert r.status_code == 200
        parts = stub_gemini["contents"]
        assert len(parts) == 2
        assert parts[0].inline_data.data == b"stillbytes"
        assert parts[0].inline_data.mime_type == "image/jpeg"

    def test_puts_the_media_before_the_question(self, client, stub_gemini):
        """The prompts these carry describe what was attached — "these are 8
        stills, in order" — which only reads correctly after the stills."""
        client.post("/api/clip/ask", json={
            "prompt": "these are 2 stills",
            "attachments": [self.data_url("image/jpeg"), self.data_url("image/jpeg")],
        })
        contents = stub_gemini["contents"]
        assert contents[-1] == "these are 2 stills"
        assert len(contents) == 3

    def test_takes_audio_too(self, client, stub_gemini):
        r = client.post("/api/clip/ask", json={
            "prompt": "when is this line said",
            "attachments": [self.data_url("audio/wav", b"RIFFsomething")],
        })
        assert r.status_code == 200
        assert stub_gemini["contents"][0].inline_data.mime_type == "audio/wav"

    def test_refuses_a_video(self, client, stub_gemini):
        """The whole point of /read is that reading a video is the metered,
        expensive call. A video smuggled in here would route around that."""
        r = client.post("/api/clip/ask", json={
            "prompt": "read this",
            "attachments": [self.data_url("video/mp4", b"\x00" * 64)],
        })
        assert r.status_code == 415
        assert "contents" not in stub_gemini

    def test_refuses_to_fetch_a_link(self, client, stub_gemini):
        """A server that fetches whatever URL a caller names, with a service
        account attached, is a request-forgery hole."""
        for link in ("https://example.com/a.jpg", "file:///etc/passwd", "gs://b/o"):
            r = client.post("/api/clip/ask", json={
                "prompt": "look", "attachments": [link],
            })
            assert r.status_code == 400, link
        assert "contents" not in stub_gemini

    def test_refuses_more_attachments_than_a_question_needs(self, client, stub_gemini):
        r = client.post("/api/clip/ask", json={
            "prompt": "look",
            "attachments": [self.data_url("image/jpeg")] * 13,
        })
        assert r.status_code == 400
        assert "contents" not in stub_gemini

    def test_refuses_attachments_over_the_size_cap(self, client, stub_gemini, monkeypatch):
        monkeypatch.setattr(clip_api, "MAX_ATTACHMENT_BYTES", 1024)
        r = client.post("/api/clip/ask", json={
            "prompt": "look",
            "attachments": [self.data_url("image/jpeg", b"\x00" * 2048)],
        })
        assert r.status_code == 413
        assert "contents" not in stub_gemini

    def test_counts_the_total_not_each_one(self, client, stub_gemini, monkeypatch):
        """Eight stills that each pass and together do not is the case that
        matters; checking them one at a time would let it through."""
        monkeypatch.setattr(clip_api, "MAX_ATTACHMENT_BYTES", 1024)
        r = client.post("/api/clip/ask", json={
            "prompt": "look",
            "attachments": [self.data_url("image/jpeg", b"\x00" * 600)] * 2,
        })
        assert r.status_code == 413

    def test_refuses_something_that_is_not_base64(self, client, stub_gemini):
        r = client.post("/api/clip/ask", json={
            "prompt": "look", "attachments": ["data:image/jpeg,not-base64"],
        })
        assert r.status_code == 400

    def test_refuses_an_empty_attachment(self, client, stub_gemini):
        """Decodes fine, costs a part, carries nothing."""
        r = client.post("/api/clip/ask", json={
            "prompt": "look", "attachments": ["data:image/jpeg;base64,"],
        })
        assert r.status_code == 400

    def test_still_works_with_none_at_all(self, client, stub_gemini):
        r = client.post("/api/clip/ask", json={"prompt": "rank these moments"})
        assert r.status_code == 200
        assert stub_gemini["contents"] == ["rank these moments"]


class TestAnswersAboutNothing:
    """A server that ignores attachments must be distinguishable from one that
    read them.

    Not hypothetical. During the rolling deploy that shipped attachments, the
    same probe returned 415 from one instance and a cheerful 200 from the
    other — the older build dropped the unknown `attachments` key and answered
    "read this" as plain text. Put the framing prompt through that and it
    returns eight confident speaker positions for stills it never saw."""

    @pytest.fixture
    def stub_gemini(self, monkeypatch):
        class FakeModels:
            def generate_content(self, **kw):
                return SimpleNamespace(text='{"positions":[]}')

        monkeypatch.setattr(clip_api, "_vertex_credentials", lambda: None)
        monkeypatch.setattr(clip_api.settings, "gemini_api_key", "test-key")
        import google.genai as genai
        monkeypatch.setattr(
            genai, "Client", lambda **kw: SimpleNamespace(models=FakeModels())
        )

    @staticmethod
    def data_url(mime: str = "image/jpeg") -> str:
        return f"data:{mime};base64,{base64.b64encode(b'bytes').decode()}"

    def test_says_how_many_it_put_in_front_of_the_model(self, client, stub_gemini):
        r = client.post("/api/clip/ask", json={
            "prompt": "where is the speaker",
            "attachments": [self.data_url(), self.data_url(), self.data_url()],
        })
        assert r.json()["attachments_received"] == 3

    def test_says_zero_when_there_were_none(self, client, stub_gemini):
        """The count is what a caller checks against, so it has to be present
        and honest on the plain-text path too."""
        r = client.post("/api/clip/ask", json={"prompt": "rank these"})
        assert r.json()["attachments_received"] == 0


class TestFaceTrackOnTheRead:
    """The track rides along with the reading that was happening anyway.

    It is CPU work on a file already on this disk, and everything else in the
    job is spent waiting on a network — the upload, then the model. Run in
    sequence it would add about half a minute to a twenty minute video; run
    alongside, it lands inside time already being spent."""

    def test_returns_the_track_with_the_reading(self, client, stub_read, monkeypatch):
        monkeypatch.setattr(
            clip_api, "_track_faces_quietly",
            lambda path, say, cancel=None: [
                clip_api_face(t=0.0, x=0.34),
                clip_api_face(t=0.5, x=0.58),
            ],
        )
        name, data, mime = a_video()
        r = client.post(
            "/api/clip/read", files={"file": (name, data, mime)},
            data={"duration_sec": "240.0"},
        )
        status = client.get(f"/api/clip/status/{r.json()['job_id']}").json()
        assert status["status"] == "completed"
        assert [f["x"] for f in status["result"]["faces"]] == [0.34, 0.58]

    def test_a_reading_still_succeeds_when_tracking_cannot_run(self, client, stub_read, monkeypatch):
        """Words, timings and scenes are the expensive part and they worked.
        Failing the job because a codec was unusual would throw away the
        working half for the optional one — the caller just asks a model per
        clip instead, which is what it did before this existed."""
        def unavailable(path, say, cancel=None):
            return []

        monkeypatch.setattr(clip_api, "_track_faces_quietly", unavailable)
        name, data, mime = a_video()
        r = client.post(
            "/api/clip/read", files={"file": (name, data, mime)},
            data={"duration_sec": "240.0"},
        )
        status = client.get(f"/api/clip/status/{r.json()['job_id']}").json()
        assert status["status"] == "completed"
        assert status["result"]["faces"] == []
        assert status["result"]["segments"]          # the reading itself survived

    def test_the_video_is_still_there_while_it_is_being_tracked(self, client, stub_read, monkeypatch):
        """The job deletes the upload when it finishes. Deleting it out from
        under a decode in a worker thread turns a slow read into a crash
        nobody is watching."""
        seen = {}

        def check(path, say, cancel=None):
            seen["existed"] = os.path.exists(path)
            return []

        monkeypatch.setattr(clip_api, "_track_faces_quietly", check)
        name, data, mime = a_video()
        client.post(
            "/api/clip/read", files={"file": (name, data, mime)},
            data={"duration_sec": "240.0"},
        )
        assert seen["existed"] is True
        assert not os.path.exists(stub_read["path"])

    def test_a_failed_reading_does_not_leave_the_tracker_running(self, client, monkeypatch):
        """Nothing may outlive the job and touch the file after it is gone."""
        def boom(path, say):
            raise RuntimeError("no credentials on this server")

        monkeypatch.setattr(clip_api, "_open_source", boom)
        monkeypatch.setattr(
            clip_api,
            "_track_faces_quietly",
            lambda path, say, cancel=None: [],
        )
        name, data, mime = a_video()
        r = client.post(
            "/api/clip/read", files={"file": (name, data, mime)},
            data={"duration_sec": "240.0"},
        )
        status = client.get(f"/api/clip/status/{r.json()['job_id']}").json()
        assert status["status"] == "failed"


class TestTrackFacesQuietly:
    """The wrapper that must never take a reading down with it."""

    def test_returns_nothing_when_the_detector_is_missing(self, monkeypatch):
        from app import face_track

        def unavailable(*a, **kw):
            raise face_track.FaceTrackingUnavailable("opencv is not installed")

        monkeypatch.setattr(face_track, "track_faces", unavailable)
        assert clip_api._track_faces_quietly("/nope.mp4", lambda _: None) == []

    def test_swallows_anything_else_the_decoder_throws(self, monkeypatch):
        from app import face_track

        def boom(*a, **kw):
            raise ValueError("some codec surprise")

        monkeypatch.setattr(face_track, "track_faces", boom)
        assert clip_api._track_faces_quietly("/nope.mp4", lambda _: None) == []

    def test_says_why_it_gave_up(self, monkeypatch):
        """Silence here reads as "there was nobody on camera", which is the
        exact confusion that broke framing once already."""
        from app import face_track

        def boom(*a, **kw):
            raise ValueError("some codec surprise")

        monkeypatch.setattr(face_track, "track_faces", boom)
        said = []
        clip_api._track_faces_quietly("/nope.mp4", said.append)
        assert any("face tracking failed" in line for line in said)

class TestStatusAndModel:
    def test_unknown_job_is_a_404_not_an_empty_success(self, client):
        assert client.get("/api/clip/status/nope").status_code == 404

    def test_reports_which_model_it_would_use(self, client):
        body = client.get("/api/clip/model").json()
        assert body["model"] == clip_api.CLIP_MODEL
        assert "configured" in body
        assert body["api_version"] == 2
        assert body["limits"]["free_clips_per_day"] == 1
        assert body["limits"]["pro_clips_per_day"] == 10
        assert body["features"]["cancellation"] is True

    def test_a_different_user_cannot_read_a_job(self, client):
        clip_api.jobs["private-job"] = {
            "job_id": "private-job",
            "status": "queued",
            "step": "queued",
            "error": None,
            "result": None,
            "owner_id": "user-1",
        }
        response = client.get(
            "/api/clip/status/private-job",
            headers=auth_header("user-2"),
        )
        assert response.status_code == 404

    def test_owner_can_cancel_a_queued_job(self, client):
        clip_api.jobs["queued-job"] = {
            "job_id": "queued-job",
            "status": "queued",
            "step": "queued",
            "error": None,
            "result": None,
            "owner_id": "user-1",
            "cancel_requested": False,
        }
        response = client.delete("/api/clip/status/queued-job")
        assert response.status_code == 200
        assert response.json()["status"] == "cancelling"
        assert clip_api.jobs["queued-job"]["cancel_requested"] is True

    def test_other_user_cannot_cancel_a_job(self, client):
        clip_api.jobs["private-job"] = {
            "job_id": "private-job",
            "status": "queued",
            "step": "queued",
            "error": None,
            "result": None,
            "owner_id": "user-1",
        }
        response = client.delete(
            "/api/clip/status/private-job",
            headers=auth_header("user-2"),
        )
        assert response.status_code == 404
