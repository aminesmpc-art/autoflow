"""
Reading a video, and refusing to believe it without checking.

The claim this file defends is one sentence: nothing the model says about time
is kept because it parsed. That is not caution for its own sake — the whole
clipping design exists because a model asked to timestamp a long recording
answered confidently and wrongly, and past about six minutes produced an
evenly spaced arithmetic sequence it had invented outright.

Native video through the API is a different modality and may be far better.
"May be" is why these tests exist rather than why they do not.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.clip_analysis import (
    MAX_SEGMENT_SEC,
    Scene,
    Segment,
    WINDOW_OVERLAP_SEC,
    WINDOW_SEC,
    ClipReading,
    TimedSegment,
    coverage_complaint,
    format_timecode,
    merge_scenes,
    merge_segments,
    parse_timecode,
    plan_windows,
    validate_scenes,
    validate_segments,
)


def seg(start, end, text="hello there friend", speaker=None) -> Segment:
    return Segment(start=start, end=end, text=text, speaker=speaker)


def kept(raw, *, window_start=0.0, window_end=600.0):
    return validate_segments(raw, window_start=window_start, window_end=window_end)


def reasons(raw, *, window_start=0.0, window_end=600.0):
    out: list[str] = []
    validate_segments(
        raw, window_start=window_start, window_end=window_end, on_drop=out.append
    )
    return out


# ──────────────────────────────────────────────────────────────────────────


class TestTimecodes:
    def test_reads_the_format_the_docs_say_the_model_uses(self):
        assert parse_timecode("01:23") == 83.0
        assert parse_timecode("00:05") == 5.0

    def test_reads_the_shapes_it_also_produces(self):
        """Every one of these is the model answering correctly in a format
        nobody asked about. Only an unreadable value is a real failure."""
        assert parse_timecode("1:23.5") == pytest.approx(83.5)
        assert parse_timecode("01:02:03") == 3723.0          # long video
        assert parse_timecode("1:23,5") == pytest.approx(83.5)   # comma locale
        assert parse_timecode("83.13") == pytest.approx(83.13)   # bare seconds
        assert parse_timecode(83.13) == pytest.approx(83.13)     # already a number

    def test_refuses_what_it_cannot_read(self):
        for bad in [None, "", "  ", "soon", "01:xx", "-4", -4]:
            assert parse_timecode(bad) is None

    def test_round_trips_through_the_format_it_asks_for(self):
        assert parse_timecode(format_timecode(83.1)) == pytest.approx(83.1)


class TestWindows:
    def test_a_short_video_is_read_whole(self):
        assert plan_windows(240.0) == [(0.0, 240.0)]

    def test_a_long_video_is_split_with_overlap(self):
        windows = plan_windows(1228.4)
        assert len(windows) == 3
        assert windows[0][0] == 0.0
        assert windows[-1][1] == pytest.approx(1228.4)
        # Consecutive windows overlap, so a sentence on a boundary is caught
        # whole by one of them.
        for earlier, later in zip(windows, windows[1:]):
            assert later[0] < earlier[1]
            assert earlier[1] - later[0] == pytest.approx(WINDOW_OVERLAP_SEC)

    def test_no_window_is_longer_than_the_limit(self):
        for duration in (500.0, 1228.4, 3600.0, 7200.0):
            for start, end in plan_windows(duration):
                assert end - start <= WINDOW_SEC + 0.001

    def test_windows_cover_the_whole_video(self):
        windows = plan_windows(3600.0)
        assert windows[0][0] == 0.0
        assert windows[-1][1] == pytest.approx(3600.0)
        for earlier, later in zip(windows, windows[1:]):
            assert later[0] <= earlier[1]      # no gap

    def test_a_video_with_no_length_is_not_read(self):
        assert plan_windows(0.0) == []
        assert plan_windows(-5.0) == []


class TestValidation:
    def test_keeps_a_segment_that_can_be_true(self):
        out = kept([seg("01:23", "01:26")])
        assert len(out) == 1
        assert out[0].start == pytest.approx(83.0)
        assert out[0].end == pytest.approx(86.0)

    def test_returns_absolute_seconds_for_a_later_window(self):
        """THE arithmetic that matters. Timings come back relative to the
        window the model was shown; a clip is cut from the whole video. Reading
        a window's answer as absolute puts every cut minutes out of place."""
        out = validate_segments(
            [seg("00:10", "00:13")], window_start=405.0, window_end=825.0
        )
        assert out[0].start == pytest.approx(415.0)
        assert out[0].end == pytest.approx(418.0)

    def test_refuses_a_segment_that_ends_before_it_starts(self):
        assert kept([seg("01:30", "01:20")]) == []
        assert "ends before it starts" in reasons([seg("01:30", "01:20")])[0]

    def test_refuses_a_paragraph_wearing_a_phrase_timestamp(self):
        long_span = seg("00:00", format_timecode(MAX_SEGMENT_SEC + 30), "word " * 200)
        assert kept([long_span]) == []
        assert "not a phrase" in reasons([long_span])[0]

    def test_refuses_a_span_too_short_to_hold_words(self):
        assert kept([seg("00:10", "00:10.1")]) == []

    def test_refuses_a_segment_outside_the_window_it_was_asked_about(self):
        """A timing far outside the window is the failure this whole design
        guards against: the model answering about video it was never shown."""
        out = validate_segments(
            [seg("10:00", "10:03")], window_start=0.0, window_end=60.0
        )
        assert out == []
        why = reasons([seg("10:00", "10:03")], window_start=0.0, window_end=60.0)
        assert "outside the" in why[0]

    def test_accepts_a_segment_inside_the_window(self):
        out = validate_segments(
            [seg("00:10", "00:13")], window_start=0.0, window_end=60.0
        )
        assert len(out) == 1

    def test_allows_a_sentence_running_just_past_the_window_edge(self):
        """Speech does not stop at a boundary we invented."""
        out = validate_segments(
            [seg("00:59.5", "01:01")], window_start=0.0, window_end=60.0
        )
        assert len(out) == 1

    def test_refuses_a_rate_nobody_speaks_at(self):
        # 40 words in one second.
        assert kept([seg("00:10", "00:11", "word " * 40)]) == []
        # Three words spread over fifty seconds.
        assert kept([seg("00:10", "01:00", "just three words")]) == []

    def test_refuses_a_segment_with_no_words(self):
        assert kept([seg("00:10", "00:13", "   ")]) == []

    def test_refuses_an_unreadable_timecode_rather_than_guessing(self):
        assert kept([seg("later", "00:13")]) == []
        assert "unreadable timecode" in reasons([seg("later", "00:13")])[0]

    def test_names_the_segment_and_quotes_it_when_dropping(self):
        """A drop nobody can act on is the same as a silent one."""
        why = reasons([seg("01:30", "01:20", "Look at these straw bales")])
        assert "Look at these straw bales" in why[0]

    def test_returns_them_in_time_order(self):
        out = kept([seg("02:00", "02:03"), seg("00:10", "00:13"), seg("01:00", "01:03")])
        assert [round(s.start) for s in out] == [10, 60, 120]


class TestScenes:
    def test_keeps_a_speaker_position_inside_the_frame(self):
        out = validate_scenes(
            [Scene(start="00:00", end="00:10", description="a man talks", speaker_x=0.38)],
            window_start=0.0,
            window_end=60.0,
        )
        assert out[0].speaker_x == pytest.approx(0.38)

    def test_drops_a_position_outside_the_frame(self):
        """0..1 is a fraction of frame width. Anything else was not measuring
        the frame, and cropping to it puts the shot on a wall."""
        for bad in (-0.2, 1.4, 42.0):
            out = validate_scenes(
                [Scene(start="00:00", end="00:10", description="x", speaker_x=bad)],
                window_start=0.0,
                window_end=60.0,
            )
            assert out[0].speaker_x is None

    def test_shifts_scenes_into_absolute_time_as_well(self):
        out = validate_scenes(
            [Scene(start="00:10", end="00:20", description="x")],
            window_start=810.0,
            window_end=1228.0,
        )
        assert out[0].start == pytest.approx(820.0)


class TestMerging:
    def test_drops_the_repeat_from_an_overlapping_window(self):
        """Windows overlap on purpose, so the same sentence is read twice."""
        a = [TimedSegment(start=400.0, end=403.0, text="Look at these straw bales")]
        b = [TimedSegment(start=400.2, end=403.1, text="look at these straw bales.")]
        assert len(merge_segments([a, b])) == 1

    def test_keeps_the_same_words_said_at_a_different_time(self):
        """"Go, go, go" is said all through a chase without being one line."""
        a = [TimedSegment(start=100.0, end=101.0, text="go go go")]
        b = [TimedSegment(start=400.0, end=401.0, text="go go go")]
        assert len(merge_segments([a, b])) == 2

    def test_keeps_different_words_said_at_the_same_time(self):
        a = [TimedSegment(start=400.0, end=403.0, text="show us your hands")]
        b = [TimedSegment(start=400.1, end=403.0, text="let me go let me go")]
        assert len(merge_segments([a, b])) == 2

    def test_treats_a_truncated_repeat_as_the_same_line(self):
        """A window can cut a sentence short at its edge."""
        a = [TimedSegment(start=400.0, end=403.0, text="look at these straw bales right here")]
        b = [TimedSegment(start=400.0, end=402.0, text="look at these straw bales")]
        assert len(merge_segments([a, b])) == 1

    def test_returns_one_timeline_in_order(self):
        a = [TimedSegment(start=10.0, end=12.0, text="first thing said")]
        b = [TimedSegment(start=5.0, end=7.0, text="earlier thing said")]
        out = merge_segments([a, b])
        assert [round(s.start) for s in out] == [5, 10]

    def test_merges_scenes_without_duplicating_the_overlap(self):
        from app.clip_analysis import TimedScene

        a = [TimedScene(start=400.0, end=410.0, description="a field")]
        b = [TimedScene(start=400.5, end=410.0, description="a field")]
        assert len(merge_scenes([a, b])) == 1


class TestCoverage:
    def test_notices_a_summary_wearing_a_transcript_costume(self):
        """The same check the extension makes on a pasted transcript. Six words
        for twenty minutes parses perfectly and is not a transcript."""
        thin = [TimedSegment(start=0.0, end=3.0, text="we want a good video")]
        complaint = coverage_complaint(thin, 1228.0)
        assert complaint and "summary, not a transcript" in complaint

    def test_accepts_a_real_transcript(self):
        segments = [
            TimedSegment(start=float(i * 3), end=float(i * 3 + 3), text="word " * 10)
            for i in range(400)
        ]
        assert coverage_complaint(segments, 1228.0) is None

    def test_notices_silence(self):
        assert "no speech at all" in (coverage_complaint([], 600.0) or "")


# ──────────────────────────────────────────────────────────────────────────
# The whole read, against a fake model
# ──────────────────────────────────────────────────────────────────────────


class FakeModels:
    """Answers like the real client, and records what it was asked."""

    def __init__(self, reply_for):
        self.reply_for = reply_for
        self.calls: list[dict] = []

    def generate_content(self, *, model, contents, config):
        part = contents[0]
        meta = getattr(part, "video_metadata", None)
        window = (
            float(str(getattr(meta, "start_offset", "0s")).rstrip("s")),
            float(str(getattr(meta, "end_offset", "0s")).rstrip("s")),
        )
        self.calls.append({"model": model, "window": window, "fps": getattr(meta, "fps", None)})
        return SimpleNamespace(parsed=self.reply_for(window), text="")


def fake_client(reply_for):
    return SimpleNamespace(models=FakeModels(reply_for))


def a_reading(texts_at):
    from app.clip_analysis import VideoReading

    return VideoReading(
        language="en",
        summary="things happen",
        segments=[seg(t, t2, txt) for t, t2, txt in texts_at],
        scenes=[],
    )


class TestReadVideo:
    def test_reads_every_window_and_returns_one_timeline(self):
        from app.clip_analysis import read_video

        def reply(window):
            # One marker phrase ten seconds in — in ITS OWN time — plus enough
            # speech that the coverage check is satisfied this is a transcript.
            filler = [
                (format_timecode(20 + i * 3), format_timecode(23 + i * 3), "word " * 12)
                for i in range(120)
            ]
            return a_reading(
                [("00:10", "00:13", f"phrase from {int(window[0])}")] + filler
            )

        client = fake_client(reply)
        out = asyncio.run(read_video(client, "gs://bucket/v.mp4", 1228.4))

        assert len(client.models.calls) == 3
        markers = [s for s in out.segments if s.text.startswith("phrase from")]
        assert len(markers) == 3
        # Every one landed in absolute time, not relative to its window.
        assert [round(s.start) for s in markers] == [10, 415, 820]
        assert out.dropped == []

    def test_asks_for_the_current_flash_model_and_sparse_frames(self):
        from app.clip_analysis import CLIP_FPS, CLIP_MODEL, read_video

        client = fake_client(lambda w: a_reading([("00:01", "00:04", "a phrase here")]))
        asyncio.run(read_video(client, "gs://bucket/v.mp4", 100.0))

        call = client.models.calls[0]
        assert call["model"] == CLIP_MODEL
        assert call["fps"] == CLIP_FPS

    def test_one_bad_window_does_not_lose_the_others(self):
        """A read of twenty minutes must not be thrown away because one window
        of it came back unusable."""
        from app.clip_analysis import read_video

        def reply(window):
            if window[0] > 400:
                raise RuntimeError("the model refused")
            return a_reading([("00:10", "00:13", "a phrase that survived")])

        client = fake_client(reply)
        out = asyncio.run(read_video(client, "gs://bucket/v.mp4", 1228.4))

        assert len(out.segments) == 1
        assert any("failed" in d for d in out.dropped)

    def test_reports_a_reading_that_is_really_a_summary(self):
        from app.clip_analysis import read_video

        client = fake_client(lambda w: a_reading([("00:10", "00:13", "barely anything")]))
        out = asyncio.run(read_video(client, "gs://bucket/v.mp4", 1228.4))
        assert any("summary, not a transcript" in d for d in out.dropped)

    def test_survives_a_reply_that_ignored_the_schema(self):
        from app.clip_analysis import read_video

        client = SimpleNamespace(
            models=SimpleNamespace(
                generate_content=lambda **kw: SimpleNamespace(
                    parsed=None,
                    text='```json\n{"language":"en","summary":"s","segments":'
                    '[{"start":"00:10","end":"00:13","text":"a fenced phrase here"}],'
                    '"scenes":[]}\n```',
                )
            )
        )
        out = asyncio.run(read_video(client, "gs://bucket/v.mp4", 100.0))
        assert len(out.segments) == 1
        assert out.segments[0].text == "a fenced phrase here"

    def test_says_so_rather_than_throwing_when_a_reply_is_rubbish(self):
        from app.clip_analysis import read_video

        client = SimpleNamespace(
            models=SimpleNamespace(
                generate_content=lambda **kw: SimpleNamespace(parsed=None, text="sorry, no.")
            )
        )
        out = asyncio.run(read_video(client, "gs://bucket/v.mp4", 100.0))
        assert out.segments == []
        assert any("unusable" in d for d in out.dropped)
