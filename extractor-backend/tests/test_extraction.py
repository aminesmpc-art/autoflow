"""
The Extractor's engine, against a fake model.

What matters here is everything the engine decides rather than what the model
writes: that an old reader still finds the four keys it reads, that timings
are checked rather than believed, that a long video is read in parts and put
back together under one cast, and that a reply cut short at the output limit
is repaired AND reported — the original failure was a truncated shot list that
nobody was told about.
"""

from __future__ import annotations

import asyncio
import json
import time
from types import SimpleNamespace

import pytest

from app.clip_analysis import format_timecode
from app.extraction import (
    CastMember,
    CharacterDraft,
    ExtractionOptions,
    MasterAudio,
    MasterPrompt,
    MergedReading,
    SheetDraft,
    Shot,
    ShotDraft,
    WindowReading,
    build_window_prompt,
    check_shots,
    extract_video,
    order_shots,
    parse_reply,
    plan_windows,
    resolve_section,
    sampling_fps,
    split_shot_count,
)


# ──────────────────────────────────────────────────────────────────────────
# Building blocks
# ──────────────────────────────────────────────────────────────────────────


def master(**overrides) -> MasterPrompt:
    fields = dict(
        shot="medium shot",
        subjects=[],
        scene="a kitchen at night",
        action="a chef plates a dish",
        camera="35mm, slow dolly in",
        lighting="warm practicals",
        style="photoreal, filmic grade",
        mood="calm",
        audio=MasterAudio(dialogue="", sound_effects="sizzle", ambience="hum", music=""),
        aspect_ratio="",
        duration="8s",
        avoid="captions, watermarks",
    )
    fields.update(overrides)
    return MasterPrompt(**fields)


def shot(start, end, *, who=(), image="A chef in whites plates a dish under warm light",
         video="The chef slides the plate forward; slow dolly in", dialogue="", sound="sizzle"):
    return ShotDraft(
        start=start if isinstance(start, str) else format_timecode(start),
        end=end if isinstance(end, str) else format_timecode(end),
        characters=list(who),
        shot_size="medium",
        lens="35mm, shallow depth of field",
        camera_movement="dolly in",
        dialogue=dialogue,
        sound=sound,
        image_prompt=image,
        video_prompt=video,
    )


def reading(shots, *, characters=("Marco",), sheets=("Marco",), concept="A quiet kitchen.",
            voiceover="MARCO: Service.", master_prompt="A chef plates a dish in a quiet kitchen."):
    return WindowReading(
        video_concept=concept,
        voiceover_text=voiceover,
        characters_description="Marco, a chef.",
        characters=[CharacterDraft(name=n, appearance="forties, short beard, chef whites") for n in characters],
        character_sheets=[
            SheetDraft(character_name=n, prompt=f"Character design sheet of {n}, chef whites, 8k")
            for n in sheets
        ],
        shots=list(shots),
        master_prompt=master_prompt,
        master_prompt_json=master(),
    )


class FakeModels:
    """Answers like the real client and records what it was asked.

    A request with a video part is a window; a request that is only text is
    the merge, which is how the engine itself tells them apart.
    """

    def __init__(self, window_reply, merge_reply=None):
        self.window_reply = window_reply
        self.merge_reply = merge_reply
        self.calls: list[dict] = []

    def generate_content(self, *, model, contents, config):
        first = contents[0]
        if isinstance(first, str):
            self.calls.append({"kind": "merge", "prompt": first, "model": model})
            reply = self.merge_reply() if callable(self.merge_reply) else self.merge_reply
            if isinstance(reply, BaseException):
                raise reply
            return SimpleNamespace(parsed=reply, text="", candidates=[])

        meta = getattr(first, "video_metadata", None)
        window = (
            float(str(meta.start_offset).rstrip("s")),
            float(str(meta.end_offset).rstrip("s")),
        )
        self.calls.append({
            "kind": "window",
            "window": window,
            "fps": getattr(meta, "fps", None),
            "prompt": contents[1],
            "model": model,
            "config": config,
        })
        reply = self.window_reply(window)
        if isinstance(reply, BaseException):
            raise reply
        if isinstance(reply, SimpleNamespace):
            return reply
        return SimpleNamespace(parsed=reply, text="", candidates=[])


def fake_client(window_reply, merge_reply=None):
    return SimpleNamespace(models=FakeModels(window_reply, merge_reply))


def run(coro):
    return asyncio.run(coro)


# ──────────────────────────────────────────────────────────────────────────
# Options
# ──────────────────────────────────────────────────────────────────────────


class TestOptions:
    def test_defaults_reproduce_the_original_request(self):
        o = ExtractionOptions()
        assert (o.style, o.aspect_ratio, o.language, o.creative_direction) == (
            "faithful", "source", "auto", ""
        )
        prompt = build_window_prompt(o, window=(0, 30), duration_sec=30)
        assert "DIRECTION" not in prompt

    def test_unknown_values_fall_back_instead_of_failing(self):
        o = ExtractionOptions(style="vaporwave", aspect_ratio="7:3")
        assert o.style == "faithful"
        assert o.aspect_ratio == "source"

    def test_creative_direction_is_cleaned_and_capped(self):
        o = ExtractionOptions(creative_direction="  set it\x00 in\n\nTokyo   at night " + "x" * 500)
        assert o.creative_direction.startswith("set it in Tokyo at night")
        assert len(o.creative_direction) == 300

    def test_section_accepts_timecodes_and_seconds(self):
        assert ExtractionOptions(start_sec="01:20", end_sec=95).start_sec == 80.0
        assert ExtractionOptions(start_sec="soon").start_sec is None

    def test_direction_reaches_the_prompt(self):
        o = ExtractionOptions(aspect_ratio="9:16", creative_direction="make it claymation",
                              character_sheets=False, shot_count=6, language="French")
        prompt = build_window_prompt(o, window=(0, 30), duration_sec=30, shots_hint=6)
        assert "9:16 vertical frame" in prompt
        assert "<<<make it claymation>>>" in prompt
        assert '"character_sheets": []' in prompt
        assert "about 6 shots" in prompt
        assert "in French" in prompt

    def test_every_listed_character_is_asked_for_a_sheet(self):
        """The first live run listed five characters and wrote two sheets."""
        prompt = build_window_prompt(None, window=(0, 60), duration_sec=60)
        assert "One sheet for EVERY character in your characters list" in prompt
        schema = WindowReading.model_json_schema()
        assert "every entry in characters" in schema["properties"]["character_sheets"]["description"]

    def test_names_come_only_from_the_video(self):
        """A spoken "Jimmy" came back as "Jimmy Donaldson" — recognised, not heard."""
        prompt = build_window_prompt(None, window=(0, 60), duration_sec=60)
        assert "Never add a surname" in prompt
        assert "never name anyone because of how they look" in prompt
        schema = CharacterDraft.model_json_schema()
        assert "as the video says or shows" in schema["properties"]["name"]["description"]

    def test_a_part_is_told_it_is_a_part(self):
        prompt = build_window_prompt(
            None, window=(300, 600), duration_sec=1200, part_of=(0, 1200), frame="1920×1080, horizontal 16:9"
        )
        assert "from 05:00.0 to 10:00.0 of a 20:00 video" in prompt
        assert "original video's clock" in prompt
        assert "1920×1080" in prompt
        assert "THE WHOLE PART" in prompt


class TestSection:
    def test_whole_video_by_default(self):
        assert resolve_section(None, 42.0) == (0.0, 42.0)

    def test_an_end_past_the_video_means_to_the_end(self):
        assert resolve_section(ExtractionOptions(start_sec=10, end_sec=999), 42.0) == (10, 42.0)

    def test_a_start_past_the_video_is_refused_in_words(self):
        with pytest.raises(ValueError, match="only 0:42 long"):
            resolve_section(ExtractionOptions(start_sec=60), 42.0)

    def test_a_backwards_section_is_refused(self):
        with pytest.raises(ValueError, match="not after"):
            resolve_section(ExtractionOptions(start_sec=20, end_sec=10), 42.0)


class TestWindows:
    def test_a_short_video_is_one_window(self):
        assert plan_windows(0, 45) == [(0, 45)]

    def test_a_little_over_one_window_is_still_one(self):
        # Splitting 340s would leave a 40s tail with almost nothing in it.
        assert plan_windows(0, 340) == [(0, 340)]

    def test_a_long_video_is_split_evenly_without_overlap(self):
        windows = plan_windows(0, 720)
        assert windows == [(0, 240), (240, 480), (480, 720)]

    def test_a_section_is_split_inside_itself(self):
        windows = plan_windows(100, 800)
        assert windows[0][0] == 100 and windows[-1][1] == 800

    def test_shot_count_is_shared_by_length(self):
        assert split_shot_count(12, [(0, 240), (240, 480), (480, 720)]) == [4, 4, 4]
        assert split_shot_count(None, [(0, 10)]) == [None]

    def test_short_clips_are_sampled_densely(self):
        assert sampling_fps(8) == 3.0
        assert sampling_fps(120) == 2.0
        assert sampling_fps(600) == 1.0
        assert sampling_fps(3600) == 0.5


# ──────────────────────────────────────────────────────────────────────────
# Timing
# ──────────────────────────────────────────────────────────────────────────


class TestCheckShots:
    def test_relative_timings_in_a_later_window_are_moved_onto_the_video_clock(self):
        shots, _np, bad = check_shots(
            [shot(5, 9), shot(9, 14)], window_start=300, window_end=600
        )
        assert bad == 0
        assert (shots[0].start_sec, shots[0].end_sec) == (305.0, 309.0)

    def test_absolute_timings_are_left_alone(self):
        shots, _np, _bad = check_shots([shot(305, 309)], window_start=300, window_end=600)
        assert shots[0].start_sec == 305.0

    def test_an_impossible_timing_keeps_the_prompts_and_loses_the_time(self):
        shots, _np, bad = check_shots(
            [shot(5, 9), shot(50, 40), shot("soon", "later")], window_start=0, window_end=30
        )
        assert bad == 2
        assert len(shots) == 3
        assert shots[1].start_sec is None and shots[1].image_prompt
        assert shots[2].end_sec is None

    def test_a_shot_starting_outside_its_window_has_no_time(self):
        shots, _np, bad = check_shots([shot(3, 5), shot(95, 99)], window_start=0, window_end=30)
        assert bad == 1
        assert shots[1].start_sec is None

    def test_an_end_past_the_window_is_clamped(self):
        shots, _np, bad = check_shots([shot(25, 34)], window_start=0, window_end=30)
        assert bad == 0
        assert shots[0].end_sec == 30

    def test_a_shot_with_no_prompt_is_left_out_and_counted(self):
        shots, no_prompt, _bad = check_shots(
            [shot(0, 4), shot(4, 8, image="a man", video="")], window_start=0, window_end=30
        )
        assert no_prompt == 1
        assert len(shots) == 1


class TestOrderShots:
    def test_overlaps_are_trimmed_and_shots_numbered_in_time_order(self):
        a = Shot(shot_id=0, image_prompt="x" * 20, start_sec=10.0, end_sec=16.0)
        b = Shot(shot_id=0, image_prompt="y" * 20, start_sec=0.0, end_sec=12.0)
        ordered = order_shots([a, b])
        assert [s.start_sec for s in ordered] == [0.0, 10.0]
        assert ordered[0].end_sec == 10.0
        assert [s.shot_id for s in ordered] == [1, 2]
        assert ordered[0].time_range == "00:00.0 - 00:10.0"

    def test_an_untimed_shot_stays_after_the_shot_it_followed(self):
        a = Shot(shot_id=0, start_sec=0.0, end_sec=4.0)
        lost = Shot(shot_id=0, image_prompt="the lost one")
        c = Shot(shot_id=0, start_sec=8.0, end_sec=12.0)
        ordered = order_shots([a, lost, c])
        assert ordered[1].image_prompt == "the lost one"
        assert ordered[1].time_range == ""


# ──────────────────────────────────────────────────────────────────────────
# Replies that are less than they should be
# ──────────────────────────────────────────────────────────────────────────


class TestParseReply:
    def test_a_reply_cut_off_at_the_limit_is_repaired_and_reported(self):
        whole = reading([shot(0, 4), shot(4, 8), shot(8, 12)]).model_dump()
        text = json.dumps(whole)
        # Cut inside the third shot, before its prompts were written.
        cut = text[: text.index('"image_prompt"', text.index('"start": "00:08.0"'))]
        response = SimpleNamespace(
            parsed=None,
            text=cut,
            candidates=[SimpleNamespace(finish_reason="FinishReason.MAX_TOKENS")],
        )
        parsed, note = parse_reply(response)
        assert parsed is not None
        assert len(parsed.shots) == 2          # the cut one is dropped, the rest kept
        assert "output limit" in note

    def test_fenced_json_is_read(self):
        text = "```json\n" + json.dumps(reading([shot(0, 4)]).model_dump()) + "\n```"
        parsed, note = parse_reply(SimpleNamespace(parsed=None, text=text, candidates=[]))
        assert note is None and len(parsed.shots) == 1

    def test_an_empty_reply_is_nothing(self):
        parsed, note = parse_reply(SimpleNamespace(parsed=None, text="", candidates=[]))
        assert parsed is None and "empty" in note


# ──────────────────────────────────────────────────────────────────────────
# The whole extraction
# ──────────────────────────────────────────────────────────────────────────


class TestExtractVideo:
    def test_a_short_video_keeps_the_original_contract_and_adds_to_it(self):
        client = fake_client(lambda _w: reading([
            shot(0, 3.5, who=["marco"], dialogue='MARCO: "Service."'),
            shot(3.5, 8, who=[]),
        ]))
        result = run(extract_video(
            client, "gs://b/v.mp4", duration_sec=8.0, model="m", source_ratio="9:16",
        ))
        data = result.model_dump()

        # What the website, Studio and Django read today, unchanged.
        for key in ("video_concept", "voiceover_text", "characters_description",
                    "character_sheets", "shots"):
            assert key in data
        first = data["shots"][0]
        assert {"shot_id", "time_range", "image_prompt", "video_prompt"} <= first.keys()
        assert data["character_sheets"][0] == {
            "character_name": "Marco",
            "prompt": "Character design sheet of Marco, chef whites, 8k",
        }

        # What is new.
        assert first["characters"] == ["Marco"]        # canonical casing
        assert data["shots"][1]["characters"] == []    # nobody in frame
        assert first["camera"] == {"shot_size": "medium", "lens": "35mm, shallow depth of field",
                                   "movement": "dolly in"}
        assert first["dialogue"] == 'MARCO: "Service."'
        assert data["master_prompt"].startswith("A chef plates")
        assert data["master_prompt_json"]["aspect_ratio"] == "9:16"
        assert data["section"] is None
        assert data["warnings"] == []

        call = client.models.calls[0]
        assert call["fps"] == 3.0
        assert call["window"] == (0.0, 8.0)
        assert len(client.models.calls) == 1           # no merge for one window

    def test_character_sheets_can_be_switched_off(self):
        client = fake_client(lambda _w: reading([shot(0, 4, who=["Marco"])]))
        result = run(extract_video(
            client, "gs://b/v.mp4", duration_sec=8.0, model="m",
            options=ExtractionOptions(character_sheets=False),
        ))
        assert result.character_sheets == []
        assert result.shots[0].characters == ["Marco"]   # still named per shot

    def test_a_section_is_read_alone_and_reported(self):
        client = fake_client(lambda _w: reading([shot(1, 6)]))   # relative answers
        result = run(extract_video(
            client, "gs://b/v.mp4", duration_sec=600.0, model="m", section=(80.0, 95.0),
        ))
        assert client.models.calls[0]["window"] == (80.0, 95.0)
        assert result.section.model_dump() == {"start_sec": 80.0, "end_sec": 95.0}
        assert result.shots[0].start_sec == 81.0
        assert "of a 10:00 video" in client.models.calls[0]["prompt"]

    def test_a_long_video_is_read_in_parts_and_merged_under_one_cast(self):
        def window_reply(window):
            if window[0] == 0:
                return reading([shot(10, 20, who=["The chef"])], characters=["The chef"],
                               sheets=["The chef"], voiceover="part one")
            return reading([shot(window[0] + 10, window[0] + 20, who=["Marco"])],
                           voiceover="part two")

        merged = MergedReading(
            video_concept="A night in a kitchen.",
            characters_description="Marco runs the pass.",
            cast=[CastMember(name="Marco", aliases=["The chef"])],
            character_sheets=[SheetDraft(character_name="Marco", prompt="Character design sheet of Marco, 8k")],
            master_prompt="A whole night in a kitchen, in one prompt.",
            master_prompt_json=master(),
        )
        client = fake_client(window_reply, merged)
        result = run(extract_video(client, "gs://b/v.mp4", duration_sec=600.0, model="m"))

        kinds = [c["kind"] for c in client.models.calls]
        assert kinds.count("window") == 2 and kinds[-1] == "merge"
        assert [s.characters for s in result.shots] == [["Marco"], ["Marco"]]
        assert result.video_concept == "A night in a kitchen."
        assert result.master_prompt.startswith("A whole night")
        assert [s.character_name for s in result.character_sheets] == ["Marco"]
        assert result.voiceover_text == "part one\n\npart two"
        assert [s.start_sec for s in result.shots] == [10.0, 310.0]

    def test_a_failed_merge_falls_back_and_says_so(self):
        client = fake_client(
            lambda w: reading([shot(w[0] + 1, w[0] + 5)]),
            RuntimeError("merge blew up"),
        )
        result = run(extract_video(client, "gs://b/v.mp4", duration_sec=600.0, model="m"))
        assert len(result.shots) == 2
        assert any("could not be combined" in w for w in result.warnings)
        assert result.master_prompt   # the opening part's, not nothing

    def test_one_unreadable_part_costs_its_own_shots_not_the_extraction(self):
        def window_reply(window):
            if window[0] > 0:
                return RuntimeError("provider 500")
            return reading([shot(1, 5)])

        client = fake_client(window_reply, RuntimeError("no merge either"))
        result = run(extract_video(client, "gs://b/v.mp4", duration_sec=600.0, model="m"))
        assert len(result.shots) == 1
        assert any("could not be read and have no shots: 5:00–10:00" in w for w in result.warnings)

    def test_every_part_failing_fails_the_extraction(self):
        client = fake_client(lambda _w: RuntimeError("provider 500"))
        with pytest.raises(RuntimeError, match="could not read this video"):
            run(extract_video(client, "gs://b/v.mp4", duration_sec=30.0, model="m"))

    def test_a_shot_list_with_a_hole_in_it_is_reported(self):
        client = fake_client(lambda _w: reading([shot(0, 4)]))
        result = run(extract_video(client, "gs://b/v.mp4", duration_sec=60.0, model="m"))
        assert any("cover 0:04 of the 1:00" in w for w in result.warnings)

    def test_the_model_call_does_not_block_the_event_loop(self):
        """The bug this rewrite started from: one extraction froze the service.

        Two extractions whose model calls each take 0.3s must finish in about
        0.3s together, not 0.6s — which only happens if the call is awaited.
        """

        class SlowAio:
            async def generate_content(self, *, model, contents, config):
                await asyncio.sleep(0.3)
                return SimpleNamespace(parsed=reading([shot(0, 4)]), text="", candidates=[])

        client = SimpleNamespace(aio=SimpleNamespace(models=SlowAio()))

        async def both():
            started = time.perf_counter()
            await asyncio.gather(
                extract_video(client, "gs://b/a.mp4", duration_sec=8.0, model="m"),
                extract_video(client, "gs://b/b.mp4", duration_sec=8.0, model="m"),
            )
            return time.perf_counter() - started

        assert run(both()) < 0.55


class TestSpeakers:
    def test_the_prompt_says_who_a_name_belongs_to(self):
        prompt = build_window_prompt(None, window=(0, 30), duration_sec=30)
        assert "SPEAKERS" in prompt and "nobody addresses themselves by their own name" in prompt

    @pytest.mark.parametrize("dialogue, flagged", [
        ('Benny: "Yo Benny, this stuff hitting."', True),           # the live run
        ('Jax: "Yo Benny, this stuff hitting."', False),
        ('Benny: "Benny, come here!"', True),
        ('Benny: "Thanks, Benny."', True),
        ('Benny: "I\'m Benny and this is my yard."', False),         # an introduction
        ('Jax: "For what?" Benny: "Get some girls over here?" Jax: "Say less."', False),
        ('Jax: "Hey Jax"', True),
        ('', False),
    ])
    def test_a_line_that_calls_its_own_speaker_by_name(self, dialogue, flagged):
        from app.extraction import self_addressed

        shots = [Shot(shot_id=2, dialogue=dialogue)]
        assert (self_addressed(shots) == [2]) is flagged

    def test_the_result_warns_when_speakers_look_swapped(self):
        client = fake_client(lambda _w: reading([shot(0, 3.5, who=["Marco"], dialogue='Marco: "Hey Marco, plates up."')]))
        result = run(extract_video(client, "gs://b/v.mp4", duration_sec=4.0, model="m"))
        assert any("calls them by their own name" in w for w in result.warnings)
