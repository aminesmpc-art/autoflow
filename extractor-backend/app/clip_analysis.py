"""
Reading a video once, for clipping.

The Chrome extension used to build its transcript by cutting the audio into
four-minute chunks and asking a chat to transcribe each one, in sequence. On a
twenty-minute video that is six round trips and about 145 seconds, and it
produces a wall of text with no timings in it — so every clip cut from it then
needed a further two-to-four asks just to find where its own first and last
lines were spoken.

This does the whole thing in one pass, because the API can take the video
itself rather than an audio file pasted into a chat window:

  * timings come back WITH the words, which removes the locating entirely
  * the visual stream comes back too, so where the speaker is standing is
    known without sampling frames and asking about them separately
  * long videos are split by time offset and the windows run CONCURRENTLY,
    so wall-clock is roughly one window rather than the sum of them

── What is deliberately not trusted ──────────────────────────────────────────

Everything the model returns about time. The extension's whole design rests on
a measurement: asked to timestamp a long recording through a chat, the model
answered confidently and wrongly, and past about six minutes it emitted an
evenly spaced arithmetic sequence that was pure invention. Native video input
is a different modality and may well be better, but "may well be" is not a
reason to skip checking — so validate_segments throws away what cannot be true
and the caller is told exactly what was dropped.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Callable, Optional

from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

# The current Flash model. Video token cost fell in the 3.x line, which is what
# makes reading a whole video in one pass affordable.
CLIP_MODEL = "gemini-3.7-flash"

# How much video goes into one request.
#
# Not a context limit — a 20 minute video at low resolution is well inside 1M
# tokens. It is an OUTPUT limit and an accuracy one: a window has to come back
# as complete JSON, and a model asked to timestamp an hour in one go is exactly
# the situation that produced invented arithmetic. Seven minutes keeps each
# answer small enough to finish and short enough to stay honest.
WINDOW_SEC = 420.0

# Windows overlap so a sentence spanning a boundary is captured whole by one of
# them. Merging drops the duplicate.
WINDOW_OVERLAP_SEC = 15.0

# How many windows may be in flight at once. The point of windowing is wall
# clock, so they run together; the cap keeps a long video from opening thirty
# simultaneous requests.
MAX_CONCURRENT_WINDOWS = 4

# Frames per second the model samples.
#
# The default is 1. Speech timing comes from the audio stream, which is charged
# and processed independently of this, so dropping the frame rate cuts the bill
# roughly threefold and costs nothing on the transcript. Half a frame a second
# is still enough to describe a shot and to say where a person is standing.
CLIP_FPS = 0.5


# ──────────────────────────────────────────────────────────────────────────
# What comes back
# ──────────────────────────────────────────────────────────────────────────


class Segment(BaseModel):
    """One spoken phrase, with the seconds it occupies."""

    start: str = Field(description="Start timecode, MM:SS or MM:SS.s")
    end: str = Field(description="End timecode, MM:SS or MM:SS.s")
    text: str = Field(description="Exactly what is said, verbatim")
    speaker: Optional[str] = Field(
        default=None, description="Who is speaking, if it can be told apart"
    )


class Scene(BaseModel):
    """A stretch of video that looks like one shot."""

    start: str = Field(description="Start timecode, MM:SS")
    end: str = Field(description="End timecode, MM:SS")
    description: str = Field(description="What is on screen, in one sentence")
    shot: Optional[str] = Field(
        default=None, description="wide, medium, close, or aerial"
    )
    speaker_x: Optional[float] = Field(
        default=None,
        description=(
            "Where the person speaking is across the frame: 0 is the left edge, "
            "0.5 the middle, 1 the right edge. Null if nobody is speaking on camera."
        ),
    )
    on_screen_text: Optional[str] = Field(
        default=None, description="Any burned-in caption or graphic, verbatim"
    )


class VideoReading(BaseModel):
    """The whole reading of one window of video."""

    language: str = Field(description="Language of the speech, as a BCP-47 tag")
    summary: str = Field(description="What happens in this stretch, in two sentences")
    segments: list[Segment] = Field(default_factory=list)
    scenes: list[Scene] = Field(default_factory=list)


PROMPT = """Read this video and report what is said and what is shown.

TRANSCRIPT
Break the speech into short phrases — a sentence, or a clause where a sentence
runs long. Do NOT merge a paragraph into one segment: the timings are used to
cut clips, so a segment covering thirty seconds is useless.
Write the words EXACTLY as spoken, including false starts and repeated words.
Do not tidy, summarise, translate or correct anything.

TIMING
Every timecode must be where that phrase is actually said, read off the audio.
Do not estimate, do not space them evenly, and do not infer them from how long
the text looks. If you are unsure of a phrase's timing, leave the phrase out
rather than guessing it — a missing segment costs nothing and a wrong one puts
a cut in the wrong place.

WHAT IS SHOWN
Also list the scenes. For each, say what is on screen, whether it is a wide,
medium, close or aerial shot, and any text burned into the picture.
When somebody is speaking on camera, give speaker_x: how far across the frame
they are, 0 at the left edge and 1 at the right. This is used to crop the video
to a vertical shape around them, so a wrong number crops onto a wall. Use null
whenever nobody is speaking on camera or you cannot tell which person it is.

Cover the entire video you were given. Report nothing outside it."""

SYSTEM = (
    "You transcribe and describe video for an editor who will cut clips from it. "
    "Accuracy of timing matters more than completeness of text: a phrase you leave "
    "out is a small loss, and a phrase timed wrongly puts a cut in the wrong place. "
    "Never invent a timestamp."
)


# ──────────────────────────────────────────────────────────────────────────
# Timecodes
# ──────────────────────────────────────────────────────────────────────────

_TIMECODE = re.compile(
    r"""^\s*
    (?:(?P<h>\d+):)?        # optional hours
    (?P<m>\d+):
    (?P<s>\d{1,2})
    (?:[.,](?P<frac>\d{1,3}))?
    \s*$""",
    re.VERBOSE,
)


def parse_timecode(value: Any) -> Optional[float]:
    """
    Seconds from whatever shape the timing came back in.

    MM:SS is what the documentation says the model uses and what it emits in
    practice, but it also produces H:MM:SS on long videos, a comma instead of a
    point in some locales, and occasionally a bare number of seconds. All of
    those are the model answering correctly in a format nobody asked about;
    only an unparseable value is a real failure.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        secs = float(value)
        return secs if secs >= 0 else None

    text = str(value).strip()
    if not text:
        return None

    m = _TIMECODE.match(text)
    if m:
        hours = int(m.group("h") or 0)
        minutes = int(m.group("m"))
        seconds = int(m.group("s"))
        frac = m.group("frac")
        total = hours * 3600 + minutes * 60 + seconds
        if frac:
            total += int(frac) / (10 ** len(frac))
        return float(total)

    # A bare "83" or "83.13".
    try:
        secs = float(text)
    except ValueError:
        return None
    return secs if secs >= 0 else None


def format_timecode(seconds: float) -> str:
    """Seconds as MM:SS.s, which is what the prompt asks the model to emit."""
    seconds = max(0.0, float(seconds))
    minutes = int(seconds // 60)
    rest = seconds - minutes * 60
    return f"{minutes:02d}:{rest:04.1f}"


# ──────────────────────────────────────────────────────────────────────────
# What the caller gets
# ──────────────────────────────────────────────────────────────────────────


class TimedSegment(BaseModel):
    start: float
    end: float
    text: str
    speaker: Optional[str] = None


class TimedScene(BaseModel):
    start: float
    end: float
    description: str
    shot: Optional[str] = None
    speaker_x: Optional[float] = None
    on_screen_text: Optional[str] = None


class TrackedFace(BaseModel):
    """One sample of where the person talking is, measured rather than asked.

    Produced by app.face_track, which runs while the model is reading the same
    file. See that module for why the scenes' own speaker_x could not do this
    job: measured on the same footage it answered for 0 of 8 scenes, while this
    agrees with a dedicated model ask to 0.009 of frame width.
    """
    t: float
    x: float
    size: float = 0.0
    weight: float = 0.0


class ClipReading(BaseModel):
    duration_sec: float
    language: str = "en"
    summary: str = ""
    segments: list[TimedSegment] = Field(default_factory=list)
    scenes: list[TimedScene] = Field(default_factory=list)
    """Where the speaker is over time, about twice a second. Empty when this
    server cannot track faces, which the caller must treat as "not measured"
    rather than as "nobody on camera"."""
    faces: list[TrackedFace] = Field(default_factory=list)
    """Why anything was thrown away. Empty is the normal case."""
    dropped: list[str] = Field(default_factory=list)
    model: str = CLIP_MODEL


# The shortest and longest a spoken phrase can plausibly be. A "segment" of a
# tenth of a second holds no words; one of two minutes is a paragraph the model
# declined to break up, and its timings cannot both be right.
MIN_SEGMENT_SEC = 0.2
MAX_SEGMENT_SEC = 60.0

# Words per second, at the extremes of human speech. Used the same way
# looksTranscribed is used in the extension: to notice text and timing that
# disagree about how long something takes to say.
MIN_WORDS_PER_SEC = 0.4
MAX_WORDS_PER_SEC = 8.0


def _offset_for(
    raw: list[Segment], window_start: float, window_end: float
) -> float:
    """
    Whether this window's answers are absolute or relative, decided by which
    reading puts more of them inside the window they were asked about.

    Given start_offset, the model timestamps against the ORIGINAL video, not
    against the clip it was shown. Assuming otherwise cost 351 of 515 segments
    on the first real run: everything after the first window was shifted past
    the end of its own window and thrown away, so a twenty-minute video came
    back transcribed for seven.

    Measured per window rather than assumed either way, because the convention
    is the model's to choose and it may not choose the same one twice. The
    tell is unambiguous when it matters: a relative timestamp cannot exceed
    the window's own length, and the value that exposed this was 422s inside a
    420s window.
    """
    if not raw or window_start <= 0:
        return 0.0

    def inside(offset: float) -> int:
        n = 0
        for seg in raw:
            t = parse_timecode(seg.start)
            if t is None:
                continue
            t += offset
            if window_start - 1.0 <= t <= window_end + 1.0:
                n += 1
        return n

    return 0.0 if inside(0.0) >= inside(window_start) else window_start


def validate_segments(
    raw: list[Segment],
    *,
    window_start: float,
    window_end: float,
    on_drop: Optional[Callable[[str], None]] = None,
) -> list[TimedSegment]:
    """
    Keep the segments that can be true, and say why the others went.

    A model answering about audio always answers. The question is never whether
    it replied but whether the reply agrees with something already known — here
    the window it was given, the order time runs in, and how long words take to
    say. Nothing is kept because it parsed.
    """
    drop = on_drop or (lambda _reason: None)
    offset = _offset_for(raw, window_start, window_end)
    out: list[TimedSegment] = []

    for index, seg in enumerate(raw):
        text = (seg.text or "").strip()
        if not text:
            drop(f"segment {index + 1} had no words")
            continue

        start = parse_timecode(seg.start)
        end = parse_timecode(seg.end)
        if start is None or end is None:
            drop(f'segment {index + 1} ("{text[:40]}") had an unreadable timecode')
            continue

        start += offset
        end += offset

        if end <= start:
            drop(f'segment {index + 1} ("{text[:40]}") ends before it starts')
            continue

        span = end - start
        if span < MIN_SEGMENT_SEC:
            drop(f'segment {index + 1} ("{text[:40]}") is {span:.2f}s, too short to hold words')
            continue
        if span > MAX_SEGMENT_SEC:
            drop(f'segment {index + 1} ("{text[:40]}") runs {span:.0f}s — a paragraph, not a phrase')
            continue

        # A window may legitimately end mid-sentence, so the tail gets a little
        # slack; a segment starting outside the window entirely does not.
        if start < window_start - 1.0 or start > window_end + 1.0:
            drop(
                f'segment {index + 1} ("{text[:40]}") is at {start:.0f}s, outside the '
                f"{window_start:.0f}–{window_end:.0f}s window it was asked about"
            )
            continue

        words = len(text.split())
        rate = words / span
        if rate < MIN_WORDS_PER_SEC or rate > MAX_WORDS_PER_SEC:
            drop(
                f'segment {index + 1} ("{text[:40]}") claims {words} words in '
                f"{span:.1f}s, which nobody says"
            )
            continue

        out.append(TimedSegment(start=start, end=end, text=text, speaker=seg.speaker))

    out.sort(key=lambda s: s.start)
    return out


def validate_scenes(
    raw: list[Scene], *, window_start: float, window_end: float
) -> list[TimedScene]:
    """Scenes, with the same time checks and a bounded speaker position."""
    out: list[TimedScene] = []
    offset = _offset_for(
        [Segment(start=s.start, end=s.end, text="x") for s in raw],
        window_start, window_end,
    )
    for scene in raw:
        start = parse_timecode(scene.start)
        end = parse_timecode(scene.end)
        if start is None or end is None:
            continue
        start += offset
        end += offset
        if end <= start or start > window_end + 1.0:
            continue

        x = scene.speaker_x
        # Out of range means it was not measuring the frame, so it is not a
        # position — better to crop centred than to crop where a bad number says.
        if x is not None and not (0.0 <= float(x) <= 1.0):
            x = None

        out.append(
            TimedScene(
                start=start,
                end=end,
                description=(scene.description or "").strip(),
                shot=scene.shot,
                speaker_x=None if x is None else float(x),
                on_screen_text=scene.on_screen_text,
            )
        )
    out.sort(key=lambda s: s.start)
    return out


def plan_windows(duration_sec: float) -> list[tuple[float, float]]:
    """
    The stretches of video to read, in order, overlapping slightly.

    A video shorter than one window is read whole — the overlap only exists so
    a sentence crossing a boundary survives, and there are no boundaries.
    """
    if duration_sec <= 0:
        return []
    if duration_sec <= WINDOW_SEC:
        return [(0.0, duration_sec)]

    windows: list[tuple[float, float]] = []
    start = 0.0
    while start < duration_sec:
        end = min(duration_sec, start + WINDOW_SEC)
        windows.append((start, end))
        if end >= duration_sec:
            break
        start = end - WINDOW_OVERLAP_SEC
    return windows


def merge_segments(groups: list[list[TimedSegment]]) -> list[TimedSegment]:
    """
    One timeline out of overlapping windows.

    Windows overlap on purpose, so the same sentence is read twice and arrives
    twice. Dropping a repeat needs the text as well as the time: two different
    people can speak within a second of each other, and "yeah" is said all the
    way through a video without being the same "yeah".
    """
    everything: list[TimedSegment] = [s for group in groups for s in group]
    everything.sort(key=lambda s: (s.start, s.end))

    merged: list[TimedSegment] = []
    for seg in everything:
        duplicate = False
        for kept in reversed(merged):
            if kept.start < seg.start - WINDOW_OVERLAP_SEC:
                break  # too far back for an overlap repeat
            if abs(kept.start - seg.start) <= 1.5 and _same_words(kept.text, seg.text):
                duplicate = True
                break
        if not duplicate:
            merged.append(seg)
    return merged


def _same_words(a: str, b: str) -> bool:
    """Same sentence, ignoring how it was punctuated or capitalised."""
    norm = lambda s: re.sub(r"[^a-z0-9 ]+", "", s.lower()).split()
    wa, wb = norm(a), norm(b)
    if not wa or not wb:
        return False
    if wa == wb:
        return True
    # One window may cut a sentence short; a clean prefix is still the same line.
    shorter, longer = (wa, wb) if len(wa) <= len(wb) else (wb, wa)
    return len(shorter) >= 3 and longer[: len(shorter)] == shorter


def merge_scenes(groups: list[list[TimedScene]]) -> list[TimedScene]:
    """Scenes from overlapping windows, keeping one per start time."""
    everything = [s for group in groups for s in group]
    everything.sort(key=lambda s: s.start)
    merged: list[TimedScene] = []
    for scene in everything:
        if merged and abs(merged[-1].start - scene.start) <= 2.0:
            continue
        merged.append(scene)
    return merged


def coverage_complaint(segments: list[TimedSegment], duration_sec: float) -> Optional[str]:
    """
    Whether the reading plausibly covers the video.

    The same check the extension makes on a pasted transcript, for the same
    reason: a reply that parses can still be a summary of a twenty-minute video
    rather than a transcript of it, and the difference only shows up as a
    ranking stage later choosing nonsense.
    """
    if duration_sec <= 0:
        return None
    words = sum(len(s.text.split()) for s in segments)
    if not words:
        return "came back with no speech at all"
    wpm = words / duration_sec * 60
    if wpm < 25:
        return (
            f"came back with only {words} words for {duration_sec:.0f}s of video — "
            "that is a summary, not a transcript"
        )
    return None


# ──────────────────────────────────────────────────────────────────────────
# Calling the model
# ──────────────────────────────────────────────────────────────────────────


def _build_config(types_mod: Any) -> Any:
    """
    The request settings, built defensively.

    thinking_level and media_resolution arrived with different SDK releases,
    and this service pins google-genai only by a floor. A parameter the
    installed SDK has never heard of is a TypeError at call time, which would
    take the endpoint down for a setting that is an optimisation.
    """
    kwargs: dict[str, Any] = {
        "system_instruction": SYSTEM,
        "response_mime_type": "application/json",
        "response_schema": VideoReading,
        # Gemini 3 warns that lowering temperature can cause looping or
        # degraded output, so the default is left alone deliberately.
        "max_output_tokens": 32768,
    }

    media = getattr(types_mod, "MediaResolution", None)
    if media is not None and hasattr(media, "MEDIA_RESOLUTION_LOW"):
        # Frames get a third of the tokens. Speech timing rides on the audio
        # stream, which this does not touch.
        kwargs["media_resolution"] = media.MEDIA_RESOLUTION_LOW

    thinking_cfg = getattr(types_mod, "ThinkingConfig", None)
    level = getattr(types_mod, "ThinkingLevel", None)
    if thinking_cfg is not None and level is not None and hasattr(level, "LOW"):
        # Transcription is perception, not reasoning. The default for 3.x Flash
        # is high, which spends time thinking about a job that needs listening.
        try:
            kwargs["thinking_config"] = thinking_cfg(thinking_level=level.LOW)
        except TypeError:                                    # older signature
            pass

    return types_mod.GenerateContentConfig(**kwargs)


def _video_part(types_mod: Any, source: Any, window: tuple[float, float]) -> Any:
    """The video, clipped to one window, sampled sparsely."""
    metadata = None
    video_meta = getattr(types_mod, "VideoMetadata", None)
    if video_meta is not None:
        fields: dict[str, Any] = {
            "start_offset": f"{window[0]:.3f}s",
            "end_offset": f"{window[1]:.3f}s",
        }
        if "fps" in getattr(video_meta, "model_fields", {}):
            fields["fps"] = CLIP_FPS
        metadata = video_meta(**fields)

    if isinstance(source, str):                       # a gs:// or https:// uri
        part = types_mod.Part.from_uri(file_uri=source, mime_type="video/mp4")
    else:                                             # an uploaded File object
        part = types_mod.Part.from_uri(
            file_uri=source.uri, mime_type=getattr(source, "mime_type", "video/mp4")
        )

    if metadata is not None:
        part.video_metadata = metadata
    return part


async def read_video(
    client: Any,
    source: Any,
    duration_sec: float,
    *,
    model: str = CLIP_MODEL,
    on_progress: Optional[Callable[[str], None]] = None,
) -> ClipReading:
    """
    Read a whole video into timed speech and described scenes.

    Windows run concurrently, which is the entire point: six sequential chat
    transcriptions took 145 seconds on a twenty-minute video, and three
    concurrent windows take about as long as the slowest one.
    """
    from google.genai import types

    say = on_progress or (lambda _line: None)
    windows = plan_windows(duration_sec)
    if not windows:
        return ClipReading(duration_sec=duration_sec, dropped=["the video has no length"])

    config = _build_config(types)
    gate = asyncio.Semaphore(MAX_CONCURRENT_WINDOWS)
    dropped: list[str] = []

    async def one(window: tuple[float, float]) -> tuple[list[TimedSegment], list[TimedScene], str, str]:
        async with gate:
            say(f"reading {window[0]:.0f}–{window[1]:.0f}s")
            part = _video_part(types, source, window)
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=model,
                contents=[part, PROMPT],
                config=config,
            )

        reading = getattr(response, "parsed", None)
        if reading is None:
            # response_schema is honoured by the model, not guaranteed by it.
            import json

            text = re.sub(r"^```(?:json)?\s*|\s*```$", "", (response.text or "").strip())
            try:
                reading = VideoReading.model_validate(json.loads(text))
            except Exception as exc:                       # noqa: BLE001
                dropped.append(
                    f"the reading of {window[0]:.0f}–{window[1]:.0f}s came back unusable: {exc}"
                )
                return [], [], "", ""

        segs = validate_segments(
            reading.segments,
            window_start=window[0],
            window_end=window[1],
            on_drop=dropped.append,
        )
        scenes = validate_scenes(
            reading.scenes, window_start=window[0], window_end=window[1]
        )
        return segs, scenes, reading.language, reading.summary

    results = await asyncio.gather(*(one(w) for w in windows), return_exceptions=True)

    seg_groups: list[list[TimedSegment]] = []
    scene_groups: list[list[TimedScene]] = []
    language = "en"
    summaries: list[str] = []

    for window, result in zip(windows, results):
        if isinstance(result, BaseException):
            dropped.append(
                f"reading {window[0]:.0f}–{window[1]:.0f}s failed: {result}"
            )
            continue
        segs, scenes, lang, summary = result
        seg_groups.append(segs)
        scene_groups.append(scenes)
        if lang:
            language = lang
        if summary:
            summaries.append(summary)

    segments = merge_segments(seg_groups)
    scenes = merge_scenes(scene_groups)

    complaint = coverage_complaint(segments, duration_sec)
    if complaint:
        dropped.append(f"the reading {complaint}")

    say(f"{len(segments)} phrases, {len(scenes)} scenes")
    return ClipReading(
        duration_sec=duration_sec,
        language=language,
        summary=" ".join(summaries).strip(),
        segments=segments,
        scenes=scenes,
        dropped=dropped,
        model=model,
    )
