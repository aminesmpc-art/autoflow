"""
"Why it works", against a fake model.

The judging is the model's; what is tested is everything around it: times
checked onto the video's clock, the hook pinned to the opening, parts merged
without repeating themselves, and pacing measured from the cuts rather than
asked for.
"""

from __future__ import annotations

import asyncio
import io
import os
from types import SimpleNamespace

import jwt
import pytest
from fastapi.testclient import TestClient

from app.api import videos as videos_api
from app.breakdown import (
    BeatDraft,
    BreakdownMerge,
    BreakdownWindow,
    CtaDraft,
    HookDraft,
    RiskDraft,
    TechniqueDraft,
    break_down_video,
    check_window,
    pacing_from_cuts,
)
from app.clip_analysis import format_timecode
from app.main import app
from app.thumbnails import Probe


def reading(beats=(), risks=(), techniques=("jump cuts",), cta=None, hook_strength=7, summary="An ad."):
    t = lambda x: x if isinstance(x, str) else format_timecode(x)
    return BreakdownWindow(
        summary=summary, format="UGC ad", audience="runners", platform_fit="TikTok", tone="upbeat",
        hook=HookDraft(what_happens="shoe slams down", technique="pattern interrupt",
                       strength=hook_strength, why="sudden sound", improve="say the claim sooner"),
        beats=[BeatDraft(start=t(a), end=t(b), label=l, what_happens="x", purpose="y") for a, b, l in beats],
        attention_risks=[RiskDraft(at=t(a), why="slow", fix="cut it") for a in risks],
        techniques=[TechniqueDraft(name=n, where="throughout", why_it_works="energy") for n in techniques],
        call_to_action=cta or CtaDraft(present=False, at="", what="", strength=0, suggestion="add a link prompt"),
        what_to_copy=["open on the product hitting the ground"],
    )


class FakeModels:
    def __init__(self, window_reply, merge_reply=None):
        self.window_reply, self.merge_reply, self.calls = window_reply, merge_reply, []

    def generate_content(self, *, model, contents, config):
        first = contents[0]
        if isinstance(first, str):
            self.calls.append("merge")
            if isinstance(self.merge_reply, BaseException):
                raise self.merge_reply
            return SimpleNamespace(parsed=self.merge_reply, text="", candidates=[])
        meta = first.video_metadata
        window = (float(meta.start_offset.rstrip("s")), float(meta.end_offset.rstrip("s")))
        self.calls.append(window)
        reply = self.window_reply(window)
        if isinstance(reply, BaseException):
            raise reply
        return SimpleNamespace(parsed=reply, text="", candidates=[])


def fake_client(window_reply, merge_reply=None):
    return SimpleNamespace(models=FakeModels(window_reply, merge_reply))


def run(coro):
    return asyncio.run(coro)


class TestPacing:
    def test_counts_cuts_overall_and_per_ten_seconds(self):
        pacing = pacing_from_cuts([1.0, 2.0, 3.0, 12.0, 25.0], 0.0, 30.0)
        assert pacing.cut_count == 5
        assert pacing.cuts_per_minute == 10.0
        assert pacing.average_shot_sec == 5.0
        assert [b.cuts for b in pacing.buckets] == [3, 1, 1]

    def test_a_sliver_at_the_end_joins_the_last_bucket(self):
        # 240.01s is 24 buckets and 0.01s; the 0.01s must not show as a gap.
        pacing = pacing_from_cuts([5.0, 239.5, 240.0], 0.0, 240.01)
        assert len(pacing.buckets) == 24
        assert pacing.buckets[-1].cuts == 2

    def test_only_counts_inside_the_section(self):
        pacing = pacing_from_cuts([1.0, 15.0, 70.0], 10.0, 40.0)
        assert pacing.cut_count == 1
        assert pacing.buckets[0].start_sec == 10.0


class TestCheckWindow:
    def test_relative_times_land_on_the_video_clock_and_bad_ones_go(self):
        r = reading(beats=[(2, 8, "setup"), (50, 40, "nonsense")], risks=[5, 999],
                    cta=CtaDraft(present=True, at="00:20.0", what="shop now", strength=6, suggestion=""))
        beats, risks, cta_at, dropped = check_window(r, (300.0, 600.0))
        assert [(b.start_sec, b.end_sec) for b in beats] == [(302.0, 308.0)]
        assert [x.at_sec for x in risks] == [305.0]
        assert cta_at == 320.0
        assert dropped == 2


class TestBreakDown:
    def test_a_short_video(self):
        client = fake_client(lambda _w: reading(
            beats=[(0, 3, "hook"), (3, 20, "proof"), (20, 30, "call to action")],
            risks=[12],
            techniques=("jump cuts", "Jump Cuts", "captions"),
            cta=CtaDraft(present=True, at="00:25.0", what="tap the link", strength=5, suggestion="say why now"),
        ))
        b = run(break_down_video(client, "gs://b/v.mp4", duration_sec=30.0, model="m"))
        assert (b.hook.start_sec, b.hook.end_sec, b.hook.strength) == (0.0, 3.0, 7)
        assert [x.label for x in b.beats] == ["hook", "proof", "call to action"]
        assert [x.at_sec for x in b.attention_risks] == [12.0]
        assert [t.name for t in b.techniques] == ["jump cuts", "captions"]      # one per name
        assert (b.call_to_action.present, b.call_to_action.at_sec) == (True, 25.0)
        assert b.pacing is None                     # measured by the job, never by the model
        assert client.models.calls == [(0.0, 30.0)]

    def test_a_long_video_in_parts_with_the_hook_from_the_opening(self):
        def reply(window):
            if window[0] == 0:
                return reading(beats=[(10, 60, "setup")], hook_strength=8)
            return reading(beats=[(window[0] + 5, window[0] + 30, "payoff")], hook_strength=0)

        merged = BreakdownMerge(summary="A whole film.", format="vlog", audience="a", platform_fit="YouTube",
                                tone="warm", what_to_copy=["one", "two"])
        client = fake_client(reply, merged)
        b = run(break_down_video(client, "gs://b/v.mp4", duration_sec=720.0, model="m"))
        assert b.hook.strength == 8
        assert [x.label for x in b.beats] == ["setup", "payoff", "payoff"]
        assert b.summary == "A whole film." and b.what_to_copy == ["one", "two"]
        assert client.models.calls[-1] == "merge"

    def test_a_failed_merge_keeps_the_opening_parts_summary(self):
        client = fake_client(lambda w: reading(summary=f"part at {w[0]:.0f}"), RuntimeError("down"))
        b = run(break_down_video(client, "gs://b/v.mp4", duration_sec=720.0, model="m"))
        assert b.summary == "part at 0"
        assert any("could not be summed up" in w for w in b.warnings)

    def test_every_part_failing_fails(self):
        client = fake_client(lambda _w: RuntimeError("provider 500"))
        with pytest.raises(RuntimeError, match="could not read this video"):
            run(break_down_video(client, "gs://b/v.mp4", duration_sec=30.0, model="m"))


# ──────────────────────────────────────────────────────────────────────────
# Through the endpoints
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
def pipeline(monkeypatch):
    seen = {}
    client = fake_client(lambda _w: reading(beats=[(0, 3, "hook")]))

    def _open_source(path, say, prefix):
        return client, "gs://bucket/v.mp4", lambda: seen.update(cleaned=True), "video/mp4"

    monkeypatch.setattr(videos_api, "probe_video", lambda _p: Probe(30.0, 1080, 1920, fps=30.0))
    monkeypatch.setattr(videos_api, "_open_source", _open_source)
    monkeypatch.setattr(videos_api, "detect_cuts_quietly", lambda _p, **_k: [1.0, 2.0, 15.0])
    return seen


class TestEndpoints:
    def test_an_upload_in_breakdown_mode(self, pipeline):
        c = TestClient(app)
        job_id = c.post(
            "/api/videos/analyze",
            files={"video": ("ad.mp4", io.BytesIO(b"\x00" * 4096), "video/mp4")},
            data={"mode": "breakdown"},
            headers=auth("u1"),
        ).json()["job_id"]
        result = c.get(f"/api/videos/status/{job_id}", headers=auth("u1")).json()["result"]
        assert result["kind"] == "breakdown"
        assert "shots" not in result                         # no prompts in this mode
        assert result["pacing"]["cut_count"] == 3
        assert result["pacing"]["cuts_per_minute"] == 6.0
        assert result["hook"]["strength"] == 7
        assert pipeline["cleaned"] is True

    def test_an_unknown_mode_is_refused(self, pipeline):
        r = TestClient(app).post(
            "/api/videos/analyze-url",
            json={"url": "https://example.com/v.mp4", "mode": "poetry"},
            headers=auth("u1"),
        )
        assert r.status_code == 400

    def test_a_blocked_youtube_link_in_breakdown_mode(self, monkeypatch):
        async def blocked(url, temp_dir, say):
            raise RuntimeError("Sign in to confirm you're not a bot")

        async def details(vid, **_k):
            from app.youtube import Details
            return Details(30.0)

        monkeypatch.setattr(videos_api, "download_video", blocked)
        monkeypatch.setattr(videos_api, "youtube_details", details)
        monkeypatch.setattr(videos_api, "model_client", lambda: fake_client(lambda _w: reading()))
        c = TestClient(app)
        job_id = c.post(
            "/api/videos/analyze-url",
            json={"url": "https://youtu.be/jNQXAC9IVRw", "mode": "breakdown"},
            headers=auth("u1"),
        ).json()["job_id"]
        result = c.get(f"/api/videos/status/{job_id}", headers=auth("u1")).json()["result"]
        assert result["kind"] == "breakdown" and result["read_from"] == "youtube"
        assert result["pacing"] is None
        assert result["warnings"][-1] == videos_api.YOUTUBE_BREAKDOWN_NOTE
