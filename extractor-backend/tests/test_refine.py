"""
Refining an extraction by chat.

The model returns edits; this applies them. What is tested is that the
application is exact: untouched shots are untouched to the hundredth of a
second, a restructure lands in time order, impossible timings never erase
good ones, the video is only looked at within its hour and only by its
owner, and kept copies are swept once the hour is up.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
import pytest
from fastapi.testclient import TestClient

from app.api import videos as videos_api
from app.extraction import Camera, CharacterSheet, Extraction, MasterPrompt, MasterAudio, Shot, ShotDraft, order_shots
from app.main import app
from app.rate_limit import reset_ask_limiter
from app.refine import RefineReply, SheetEdit, ShotEdit, apply_edits, extraction_for_prompt
from app.thumbnails import LocalThumbs


def an_extraction(**over) -> Extraction:
    fields = dict(
        video_concept="A kitchen at night.",
        character_sheets=[CharacterSheet(character_name="Marco", prompt="Character design sheet of Marco, 8k")],
        shots=[
            Shot(shot_id=1, image_prompt="Marco plates a dish under warm light", video_prompt="slow dolly in",
                 start_sec=0.0, end_sec=5.68, characters=["Marco"], camera=Camera(shot_size="medium"),
                 thumbnail_url="https://x/thumbs/j/1.jpg"),
            Shot(shot_id=2, image_prompt="The empty pass, steel and steam", video_prompt="static wide",
                 start_sec=5.68, end_sec=12.0, thumbnail_url="https://x/thumbs/j/2.jpg"),
        ],
        master_prompt="A chef plates a dish.",
        duration_sec=12.0,
        thumbnails_id="a" * 32,
    )
    fields.update(over)
    # Through the same ordering the engine applies, so time ranges are filled.
    fields["shots"] = order_shots(fields["shots"])
    return Extraction(**fields)


def draft(start, end, image="A close-up of Marco's hands plating", video="push in slowly", who=("Marco",)):
    return ShotDraft(start=start, end=end, characters=list(who), shot_size="close-up", lens="85mm",
                     camera_movement="push in", dialogue="", sound="", image_prompt=image, video_prompt=video)


def master() -> MasterPrompt:
    return MasterPrompt(shot="", subjects=[], scene="", action="", camera="", lighting="", style="", mood="",
                        audio=MasterAudio(dialogue="", sound_effects="", ambience="", music=""),
                        aspect_ratio="", duration="", avoid="")


def reply(shot_edits=(), sheet_edits=(), **over) -> RefineReply:
    fields = dict(summary="Done.", shot_edits=list(shot_edits), sheet_edits=list(sheet_edits),
                  video_concept="", master_prompt="", master_prompt_changed=False, master_prompt_json=master(),
                  needs_video=False)
    fields.update(over)
    return RefineReply(**fields)


class TestPromptShape:
    def test_times_go_out_with_two_decimals_so_snapped_times_survive(self):
        payload = json.loads(extraction_for_prompt(an_extraction()))
        assert payload["shots"][0]["end"] == "00:05.68"
        assert payload["shots"][1]["start"] == "00:05.68"


class TestApplyEdits:
    def test_an_edit_to_words_keeps_the_time_and_the_frame(self):
        new, notes, needs = apply_edits(an_extraction(), reply([
            ShotEdit(action="update", shot_id=1, shot=draft("00:00.00", "00:05.68", image="Marco plates a dish, now a close-up")),
        ]))
        first = new.shots[0]
        assert first.image_prompt == "Marco plates a dish, now a close-up"
        assert (first.start_sec, first.end_sec) == (0.0, 5.68)
        assert first.thumbnail_url == "https://x/thumbs/j/1.jpg"
        assert needs == [] and notes == []
        assert new.shots[1] == an_extraction().shots[1]          # untouched, exactly

    def test_a_split_is_an_update_and_an_insert_in_time_order(self):
        new, _notes, needs = apply_edits(an_extraction(), reply([
            ShotEdit(action="update", shot_id=2, shot=draft("00:05.68", "00:09.00", image="Wide of the empty pass", who=())),
            ShotEdit(action="insert", shot_id=2, shot=draft("00:09.00", "00:12.00", image="Close on the steam rising", who=())),
        ]))
        assert [(s.shot_id, s.start_sec, s.end_sec) for s in new.shots] == [(1, 0.0, 5.68), (2, 5.68, 9.0), (3, 9.0, 12.0)]
        assert len(needs) == 2                                    # both changed timing: new frames
        assert new.shots[2].thumbnail_url is None

    def test_delete_and_an_unknown_id(self):
        new, notes, _needs = apply_edits(an_extraction(), reply([
            ShotEdit(action="delete", shot_id=1, shot=draft("00:00.00", "00:05.68")),
            ShotEdit(action="delete", shot_id=9, shot=draft("00:00.00", "00:01.00")),
        ]))
        assert [s.image_prompt for s in new.shots] == ["The empty pass, steel and steam"]
        assert new.shots[0].shot_id == 1
        assert any("no such shot" in n for n in notes)

    def test_impossible_times_never_erase_good_ones(self):
        new, _notes, needs = apply_edits(an_extraction(), reply([
            ShotEdit(action="update", shot_id=1, shot=draft("00:50.00", "00:40.00", image="Marco, warmer light, same moment")),
        ]))
        assert (new.shots[0].start_sec, new.shots[0].end_sec) == (0.0, 5.68)
        assert new.shots[0].thumbnail_url == "https://x/thumbs/j/1.jpg"
        assert needs == []

    def test_an_insert_with_no_believable_time_is_kept_untimed_and_said(self):
        new, notes, needs = apply_edits(an_extraction(), reply([
            ShotEdit(action="insert", shot_id=1, shot=draft("soon", "later")),
        ]))
        assert len(new.shots) == 3 and new.shots[1].start_sec is None
        assert needs == [] and any("without a timing" in n for n in notes)

    def test_an_edit_with_no_prompt_is_skipped(self):
        new, notes, _ = apply_edits(an_extraction(), reply([
            ShotEdit(action="update", shot_id=1, shot=draft("00:00.00", "00:05.68", image="x", video="")),
        ]))
        assert new.shots[0].image_prompt == "Marco plates a dish under warm light"
        assert any("no usable prompt" in n for n in notes)

    def test_sheets_and_the_master_prompt(self):
        m = master().model_copy(update={"scene": "rainy street"})
        new, _notes, _ = apply_edits(an_extraction(aspect_ratio="9:16"), reply(
            sheet_edits=[
                SheetEdit(action="update", character_name="marco", prompt="Character design sheet of Marco in a raincoat"),
                SheetEdit(action="insert", character_name="Waiter", prompt="Character design sheet of a young waiter"),
            ],
            master_prompt="A chef in the rain.", master_prompt_changed=True, master_prompt_json=m,
        ))
        assert [s.character_name for s in new.character_sheets] == ["marco", "Waiter"]
        assert "raincoat" in new.character_sheets[0].prompt
        assert new.master_prompt == "A chef in the rain."
        assert new.master_prompt_json["scene"] == "rainy street"
        assert new.master_prompt_json["aspect_ratio"] == "9:16"

    def test_a_new_shot_over_an_existing_moment_gets_no_time(self):
        """Live, "add the shot of the police car" added a second shot over
        the seconds shot 13 already covered."""
        new, notes, needs = apply_edits(an_extraction(), reply([
            ShotEdit(action="insert", shot_id=1, shot=draft("00:06.00", "00:11.50", image="The pass again, closer")),
        ]))
        assert [s.start_sec for s in new.shots] == [0.0, None, 5.68]   # kept where it was inserted
        assert needs == []
        assert any("same moment as shot 2" in n for n in notes)

    def test_nothing_asked_nothing_changed(self):
        before = an_extraction()
        new, notes, needs = apply_edits(before, reply())
        assert new.shots == before.shots and new.master_prompt == before.master_prompt
        assert notes == [] and needs == []


# ──────────────────────────────────────────────────────────────────────────
# The endpoint
# ──────────────────────────────────────────────────────────────────────────


def auth(user_id: str) -> dict[str, str]:
    token = jwt.encode({"user_id": user_id}, videos_api.settings.jwt_secret_key,
                       algorithm=videos_api.settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


JOB = "b" * 32


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    videos_api.jobs.clear()
    reset_ask_limiter()
    yield
    videos_api.jobs.clear()
    reset_ask_limiter()


@pytest.fixture
def model(monkeypatch):
    """A fake model that splits shot 2, and records whether it was shown the
    video. With wants_video set, it asks to look before it edits."""
    seen = {"calls": []}

    class Models:
        def generate_content(self, *, model, contents, config):
            has_video = not isinstance(contents[0], str)
            seen["calls"].append({"video": has_video, "prompt": contents[-1]})
            if seen.get("video_fails") and has_video:
                raise RuntimeError("the kept copy is gone")
            if seen.get("wants_video") and not has_video and "You have NOT been shown the video yet" in contents[-1]:
                return SimpleNamespace(parsed=reply(needs_video=True, summary=""), text="", candidates=[])
            return SimpleNamespace(parsed=reply([
                ShotEdit(action="update", shot_id=2, shot=draft("00:05.68", "00:09.00", image="Wide of the empty pass", who=())),
                ShotEdit(action="insert", shot_id=2, shot=draft("00:09.00", "00:12.00", image="Close on the steam rising", who=())),
            ], summary="Split shot 2 into a wide and a close-up."), text="", candidates=[])

    monkeypatch.setattr(videos_api, "model_client", lambda: SimpleNamespace(models=Models()))
    return seen


@pytest.fixture
def frames(monkeypatch, tmp_path):
    store = LocalThumbs(tmp_path / "thumbs")
    monkeypatch.setattr(videos_api, "thumb_store", lambda: store)
    monkeypatch.setattr(videos_api, "_download_kept", lambda uri, folder: str(tmp_path / "kept.mp4"))
    monkeypatch.setattr(videos_api, "grab_frames", lambda _p, times: [b"\xff\xd8jpeg"] * len(times))
    return store


def keep(owner="u1", minutes_left=30.0, **extra):
    videos_api.jobs[JOB] = {
        "job_id": JOB, "status": "completed", "owner_id": owner,
        "kept_video": {"uri": "gs://bucket/videos/x.mp4", "mime": "video/mp4",
                       "expires_at": time.time() + minutes_left * 60, **extra},
    }


def refine(job_id=JOB, user="u1", instruction="split shot 2 into a wide and a close-up", extraction=None):
    return TestClient(app).post(
        "/api/videos/refine",
        json={"instruction": instruction, "job_id": job_id,
              "extraction": (extraction or an_extraction()).model_dump()},
        headers={**auth(user), "x-forwarded-proto": "https", "host": "ex.example"},
    )


class TestEndpoint:
    def test_within_the_hour_it_looks_again_when_it_must_and_cuts_new_frames(self, model, frames):
        keep()
        model["wants_video"] = True
        r = refine()
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["used_video"] is True
        assert [c["video"] for c in model["calls"]] == [False, True]   # text first, then a look
        shots = body["extraction"]["shots"]
        assert [s["shot_id"] for s in shots] == [1, 2, 3]
        assert shots[0]["thumbnail_url"] == "https://x/thumbs/j/1.jpg"        # untouched shot keeps its frame
        assert shots[1]["thumbnail_url"] == f"https://ex.example/api/videos/thumbs/{'a' * 32}/1000.jpg"
        assert shots[2]["thumbnail_url"].endswith("/1001.jpg")               # never overwrites the originals
        assert frames.get("a" * 32, "1000") == b"\xff\xd8jpeg"
        assert body["summary"].startswith("Split shot 2")

    def test_an_edit_the_text_can_answer_does_not_look(self, model, frames):
        keep()
        body = refine().json()
        assert body["used_video"] is False
        assert [c["video"] for c in model["calls"]] == [False]
        assert "You have NOT been shown the video yet" in model["calls"][0]["prompt"]
        # The video is still kept, so the moved shots still get real frames.
        assert body["extraction"]["shots"][1]["thumbnail_url"].endswith("/1000.jpg")

    def test_after_the_hour_it_works_from_the_text(self, model, frames):
        keep(minutes_left=-1)
        body = refine().json()
        assert body["used_video"] is False and model["calls"][0]["video"] is False
        assert "You do NOT have the video" in model["calls"][0]["prompt"]
        assert body["extraction"]["shots"][1]["thumbnail_url"] is None
        assert any("only kept for an hour" in w for w in body["extraction"]["warnings"])
        assert "estimates" in body["summary"]

    def test_someone_elses_job_never_lends_its_video(self, model, frames):
        keep(owner="u2")
        model["wants_video"] = True
        assert refine().json()["used_video"] is False
        assert "You do NOT have the video" in model["calls"][0]["prompt"]

    def test_a_long_video_is_edited_from_the_text(self, model, frames):
        keep()
        model["wants_video"] = True
        body = refine(extraction=an_extraction(duration_sec=3 * 3600.0)).json()
        assert body["used_video"] is False

    def test_a_youtube_reading_is_re_watched_from_its_link_without_frames(self, model, frames):
        keep(youtube=True, uri="https://www.youtube.com/watch?v=jNQXAC9IVRw")
        model["wants_video"] = True
        body = refine().json()
        assert body["used_video"] is True
        assert body["extraction"]["warnings"] == []

    def test_a_swept_copy_keeps_the_text_answer_and_says_so(self, model, frames):
        keep()
        model["wants_video"] = True
        model["video_fails"] = True
        body = refine().json()
        assert body["used_video"] is False
        assert model["calls"][0]["video"] is False and model["calls"][-1]["video"] is True
        assert "could not be checked" in body["summary"]

    def test_an_old_saved_extraction_without_a_duration_can_still_be_edited(self, model):
        body = refine(job_id=None, extraction=an_extraction(duration_sec=0.0)).json()
        assert [s["start_sec"] for s in body["extraction"]["shots"]] == [0.0, 5.68, 9.0]

    def test_bad_requests(self, model):
        assert refine(instruction="   ").status_code == 400
        assert refine(instruction="x" * 601).status_code == 400
        r = TestClient(app).post("/api/videos/refine", json={"instruction": "x", "extraction": {"shots": []}}, headers=auth("u1"))
        assert r.status_code == 400
        assert TestClient(app).post("/api/videos/refine", json={"instruction": "x", "extraction": {}}).status_code == 401

    def test_edits_are_rate_limited_not_charged(self, model, monkeypatch):
        monkeypatch.setattr(videos_api.settings, "refine_per_minute", 2)
        reset_ask_limiter()
        assert [refine(job_id=None).status_code for _ in range(3)] == [200, 200, 429]


class TestSweep:
    def test_deletes_kept_copies_past_their_hour_and_nothing_else(self, monkeypatch):
        now = datetime.now(timezone.utc)
        deleted = []

        class Blob:
            def __init__(self, name, age_min):
                self.name, self.time_created = name, now - timedelta(minutes=age_min)

            def delete(self):
                deleted.append(self.name)

        class Bucket:
            def list_blobs(self, prefix):
                assert prefix == "videos/"
                return [Blob("videos/old.mp4", 70), Blob("videos/kept.mp4", 30), Blob("videos/running.mp4", 2)]

        class Client:
            def __init__(self, **_k):
                pass

            def bucket(self, _name):
                return Bucket()

        import google.cloud.storage as storage

        monkeypatch.setattr(storage, "Client", Client)
        monkeypatch.setattr(videos_api.settings, "gcp_project_id", "p")
        monkeypatch.setattr(videos_api.settings, "gcp_credentials_json", "{}")
        monkeypatch.setattr("app.api.clip._vertex_credentials", lambda: None)
        assert asyncio.run(videos_api.sweep_kept_videos()) == 1
        assert deleted == ["videos/old.mp4"]

    def test_does_nothing_without_cloud_storage(self, monkeypatch):
        monkeypatch.setattr(videos_api.settings, "gcp_credentials_json", "")
        assert asyncio.run(videos_api.sweep_kept_videos()) == 0
