"""
YouTube links the server may not download.

The model can read a public YouTube video from its link, so a blocked
download need not fail the extraction. What these hold to: the link is
recognised in every shape people paste, the video's length comes from
YouTube and never from the model, and when nothing will say the length the
person hears the original download error rather than a guess.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import jwt
import pytest
from fastapi.testclient import TestClient

from app import youtube
from app.api import videos as videos_api
from app.extraction import Extraction, Shot
from app.main import app
from app.youtube import Details, NotReadable, parse_iso_duration, youtube_details, youtube_id


class TestLinks:
    @pytest.mark.parametrize("url", [
        "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        "https://youtube.com/watch?v=jNQXAC9IVRw&t=4s",
        "https://m.youtube.com/watch?feature=share&v=jNQXAC9IVRw",
        "https://youtu.be/jNQXAC9IVRw?si=abc",
        "https://www.youtube.com/shorts/jNQXAC9IVRw",
        "https://www.youtube.com/embed/jNQXAC9IVRw",
        "https://www.youtube.com/live/jNQXAC9IVRw",
    ])
    def test_every_shape_people_paste(self, url):
        assert youtube_id(url) == "jNQXAC9IVRw"

    @pytest.mark.parametrize("url", [
        "https://vimeo.com/123",
        "https://www.youtube.com/channel/UCxyz",
        "https://www.youtube.com/watch?v=short",
        "https://evil.example/watch?v=jNQXAC9IVRw",
        "not a url",
    ])
    def test_everything_else_is_not_youtube(self, url):
        assert youtube_id(url) is None

    def test_iso_durations(self):
        assert parse_iso_duration("PT19S") == 19
        assert parse_iso_duration("PT1H2M3S") == 3723
        assert parse_iso_duration("P1DT1S") == 86401
        assert parse_iso_duration("PT") is None
        assert parse_iso_duration("19") is None


def run(coro):
    return asyncio.run(coro)


class TestDetails:
    def test_the_data_api_is_asked_first_when_there_is_a_key(self, monkeypatch):
        monkeypatch.setenv("YOUTUBE_API_KEY", "k")
        asked = []

        async def data_api(vid, key):
            asked.append("data-api")
            return Details(19.0, "Me at the zoo", "data-api")

        async def never(*_a, **_k):
            asked.append("other")

        monkeypatch.setattr(youtube, "_from_data_api", data_api)
        monkeypatch.setattr(youtube, "_from_ytdlp", never)
        monkeypatch.setattr(youtube, "_from_watch_page", never)
        assert run(youtube_details("jNQXAC9IVRw")).duration_sec == 19.0
        assert asked == ["data-api"]

    def test_falls_through_to_whichever_source_answers(self, monkeypatch):
        monkeypatch.delenv("YOUTUBE_API_KEY", raising=False)

        async def blocked(*_a, **_k):
            raise RuntimeError("Sign in to confirm you're not a bot")

        async def page(vid):
            return Details(19.0, "", "watch-page")

        monkeypatch.setattr(youtube, "_from_ytdlp", blocked)
        monkeypatch.setattr(youtube, "_from_watch_page", page)
        assert run(youtube_details("jNQXAC9IVRw")).via == "watch-page"

    def test_nothing_answering_is_none_not_a_guess(self, monkeypatch):
        monkeypatch.delenv("YOUTUBE_API_KEY", raising=False)

        async def nothing(*_a, **_k):
            return None

        monkeypatch.setattr(youtube, "_from_ytdlp", nothing)
        monkeypatch.setattr(youtube, "_from_watch_page", nothing)
        assert run(youtube_details("jNQXAC9IVRw")) is None

    def test_a_private_video_is_an_answer_not_a_failure(self, monkeypatch):
        monkeypatch.setenv("YOUTUBE_API_KEY", "k")

        async def private(vid, key):
            raise NotReadable("That YouTube video is private.")

        monkeypatch.setattr(youtube, "_from_data_api", private)
        with pytest.raises(NotReadable):
            run(youtube_details("jNQXAC9IVRw"))


# ──────────────────────────────────────────────────────────────────────────
# The fallback inside a real job
# ──────────────────────────────────────────────────────────────────────────


def auth(user_id: str) -> dict[str, str]:
    token = jwt.encode({"user_id": user_id}, videos_api.settings.jwt_secret_key,
                       algorithm=videos_api.settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def quiet(monkeypatch):
    monkeypatch.setattr(videos_api.settings, "enforce_extraction_limits", False)
    videos_api.jobs.clear()
    yield
    videos_api.jobs.clear()


@pytest.fixture
def blocked_download(monkeypatch):
    async def _blocked(url, temp_dir, say):
        raise RuntimeError("ERROR: [youtube] jNQXAC9IVRw: Sign in to confirm you're not a bot")

    monkeypatch.setattr(videos_api, "download_video", _blocked)


@pytest.fixture
def model(monkeypatch):
    seen = {}

    async def _extract(client, source, **kwargs):
        seen.update(kwargs, source=source, client=client)
        return Extraction(
            shots=[Shot(shot_id=1, image_prompt="a man at the zoo", start_sec=0.0, end_sec=19.0)],
            duration_sec=kwargs["duration_sec"],
        )

    monkeypatch.setattr(videos_api, "model_client", lambda: SimpleNamespace(name="vertex"))
    monkeypatch.setattr(videos_api, "extract_video", _extract)
    return seen


def start(url: str, **options) -> dict:
    client = TestClient(app)
    body = {"url": url, **({"options": options} if options else {})}
    job_id = client.post("/api/videos/analyze-url", json=body, headers=auth("u1")).json()["job_id"]
    return client.get(f"/api/videos/status/{job_id}", headers=auth("u1")).json()


class TestFallback:
    def test_a_blocked_youtube_download_is_read_from_the_link(self, blocked_download, model, monkeypatch):
        async def details(vid, **_k):
            return Details(19.0, "Me at the zoo", "watch-page")

        monkeypatch.setattr(videos_api, "youtube_details", details)
        status = start("https://youtu.be/jNQXAC9IVRw", start_sec=5)

        assert status["status"] == "completed", status
        assert model["source"] == "https://www.youtube.com/watch?v=jNQXAC9IVRw"
        assert model["duration_sec"] == 19.0                 # YouTube's length, not the model's
        assert model["section"] == (5.0, 19.0)
        result = status["result"]
        assert result["read_from"] == "youtube"
        assert result["cover_url"] == "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg"
        assert result["warnings"][-1] == videos_api.YOUTUBE_NOTE
        assert result["shots"][0]["thumbnail_url"] is None

    def test_no_length_means_the_original_error(self, blocked_download, model, monkeypatch):
        async def none(vid, **_k):
            return None

        monkeypatch.setattr(videos_api, "youtube_details", none)
        status = start("https://www.youtube.com/watch?v=jNQXAC9IVRw")
        assert status["status"] == "failed"
        assert "YouTube requested bot verification" in status["error"]
        assert "source" not in model                           # no model call

    def test_a_private_video_says_so(self, blocked_download, model, monkeypatch):
        async def private(vid, **_k):
            raise NotReadable("That YouTube video is private.")

        monkeypatch.setattr(videos_api, "youtube_details", private)
        status = start("https://www.youtube.com/watch?v=jNQXAC9IVRw")
        assert status["error"] == "That YouTube video is private."

    def test_a_video_over_the_limit_is_refused_before_the_model(self, blocked_download, model, monkeypatch):
        async def long(vid, **_k):
            return Details(10 * 3600.0)

        monkeypatch.setattr(videos_api, "youtube_details", long)
        status = start("https://www.youtube.com/watch?v=jNQXAC9IVRw")
        assert status["status"] == "failed" and "limit" in status["error"]
        assert "source" not in model

    def test_other_sites_get_no_fallback(self, monkeypatch, model):
        async def _blocked(url, temp_dir, say):
            raise RuntimeError("ERROR: 403 Forbidden")

        async def never(vid, **_k):
            raise AssertionError("must not be asked")

        monkeypatch.setattr(videos_api, "download_video", _blocked)
        monkeypatch.setattr(videos_api, "youtube_details", never)
        status = start("https://www.instagram.com/reel/abc/")
        assert status["status"] == "failed"
        assert "Instagram blocked the download" in status["error"]
