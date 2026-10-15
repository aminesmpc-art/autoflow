"""
Why a video works.

The extractor answers "how would I make this?". This answers "why does this
hold attention, and what should I copy?" — for marketers studying an ad and
creators studying a video that did well. Its own mode, with no prompts in it.

── What is judged and what is measured ─────────────────────────────────────

The model judges: the hook, the story beats, where attention is at risk, the
techniques, the call to action, and what is worth copying. Those are opinions
and the result presents them as such — scores out of ten, with reasons.

Pacing is not asked of the model. Cuts per minute and how they change over
the video come from app.cuts on the file itself, so the one number in a
breakdown that can be exact is exact. A reading straight from YouTube has no
file, and so no pacing; the result says so rather than estimating it.

The same window machinery as the extractor reads long videos: parts read
concurrently, their times checked, a short text-only call to say what the
whole adds up to.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
from typing import Any, Callable, Optional

from pydantic import BaseModel, Field

from app.clip_analysis import _generate_window, _offset_for, format_timecode, parse_timecode
from app.extraction import (
    MAX_CONCURRENT_WINDOWS,
    MERGE_TIMEOUT_SEC,
    TIMING_SLACK_SEC,
    WINDOW_TIMEOUT_SEC,
    LONG_VIDEO_SEC,
    Section,
    _clock,
    _config,
    _strip_fences,
    _text,
    _valid_items,
    _video_part,
    _hit_token_limit,
    plan_windows,
    sampling_fps,
)

log = logging.getLogger(__name__)

# The opening a hook is judged on. Three seconds is the window short-form
# platforms decide a scroll in.
HOOK_SEC = 3.0
PACING_BUCKET_SEC = 10.0


# ──────────────────────────────────────────────────────────────────────────
# What the model is asked for
# ──────────────────────────────────────────────────────────────────────────


class HookDraft(BaseModel):
    what_happens: str = Field(description="What is seen and heard in the first three seconds")
    technique: str = Field(description="bold claim, question, pattern interrupt, visual shock, in medias res, promise, curiosity gap, or other")
    strength: int = Field(description="1-10: how likely a scroller stops. 8+ is rare")
    why: str
    improve: str = Field(description="One concrete change that would make it stronger")


class BeatDraft(BaseModel):
    start: str = Field(description="MM:SS.s, read off the video")
    end: str = Field(description="MM:SS.s, read off the video")
    label: str = Field(description="setup, problem, tension, turn, proof, reveal, payoff, call to action, or other")
    what_happens: str
    purpose: str = Field(description="What this beat does for the viewer")


class RiskDraft(BaseModel):
    at: str = Field(description="MM:SS.s where attention is at risk")
    why: str
    fix: str


class TechniqueDraft(BaseModel):
    name: str = Field(description="e.g. jump cuts, burned-in captions, music drop, direct address, b-roll, sound effects")
    where: str = Field(description="Timecodes, or 'throughout'")
    why_it_works: str


class CtaDraft(BaseModel):
    present: bool
    at: str = Field(description="MM:SS.s, or empty when there is none")
    what: str
    strength: int = Field(description="1-10, 0 when there is none")
    suggestion: str


class BreakdownWindow(BaseModel):
    summary: str = Field(description="What the video is and who it is for, in two sentences")
    format: str = Field(description="e.g. UGC ad, talking-head explainer, challenge video, music video, tutorial")
    audience: str
    platform_fit: str = Field(description="Which platforms this suits and why")
    tone: str
    hook: HookDraft
    beats: list[BeatDraft]
    attention_risks: list[RiskDraft]
    techniques: list[TechniqueDraft]
    call_to_action: CtaDraft
    what_to_copy: list[str] = Field(description="Concrete things another creator could reuse")


class BreakdownMerge(BaseModel):
    summary: str
    format: str
    audience: str
    platform_fit: str
    tone: str
    what_to_copy: list[str]


SYSTEM = (
    "You are a creative strategist who studies why videos hold attention — ads, "
    "short-form clips and long-form videos alike. You are specific and honest: "
    "every claim points at a moment in the video, scores are earned, and a 9 out "
    "of 10 is rare. Describe people by how they look and name them only as the "
    "video names them. Read every timing off the video; never invent one."
)

PROMPT = """Break down why this video works — or where it does not.

{scope}

- summary, format, audience, platform_fit, tone: what the video is and who it is for.
- hook: the first {hook} seconds. {hook_note}
- beats: the structure, in order — each a stretch of the video with what happens and what it does for the viewer. Times as MM:SS.s read off the video.
- attention_risks: the moments a viewer is most likely to leave, why, and a concrete fix. Only real risks; none is a fine answer.
- techniques: the editing, visual, audio and copy techniques it uses, where, and why each works.
- call_to_action: whether it asks the viewer to do something, when, how well, and how to make it better.
- what_to_copy: concrete, reusable lessons — not "good editing" but what exactly to do.

Ground everything in what is on screen and in the audio."""

MERGE_PROMPT = """Below are breakdowns of consecutive parts of one video, in order. Say what the whole video adds up to: summary, format, audience, platform_fit, tone, and the most useful what_to_copy lessons across all parts (no more than eight, no repeats).

PARTS
{parts}"""


# ──────────────────────────────────────────────────────────────────────────
# What the caller gets
# ──────────────────────────────────────────────────────────────────────────


class Hook(BaseModel):
    start_sec: float
    end_sec: float
    what_happens: str = ""
    technique: str = ""
    strength: int = 0
    why: str = ""
    improve: str = ""


class Beat(BaseModel):
    start_sec: float
    end_sec: float
    label: str = ""
    what_happens: str = ""
    purpose: str = ""


class Risk(BaseModel):
    at_sec: float
    why: str = ""
    fix: str = ""


class Technique(BaseModel):
    name: str
    where: str = ""
    why_it_works: str = ""


class CallToAction(BaseModel):
    present: bool = False
    at_sec: Optional[float] = None
    what: str = ""
    strength: int = 0
    suggestion: str = ""


class PacingBucket(BaseModel):
    start_sec: float
    cuts: int


class Pacing(BaseModel):
    """Measured from the file, not judged."""

    cut_count: int
    cuts_per_minute: float
    average_shot_sec: float
    cuts: list[float] = Field(default_factory=list)
    buckets: list[PacingBucket] = Field(default_factory=list)
    bucket_sec: float = PACING_BUCKET_SEC


class Breakdown(BaseModel):
    kind: str = "breakdown"
    summary: str = ""
    format: str = ""
    audience: str = ""
    platform_fit: str = ""
    tone: str = ""
    hook: Optional[Hook] = None
    beats: list[Beat] = Field(default_factory=list)
    attention_risks: list[Risk] = Field(default_factory=list)
    techniques: list[Technique] = Field(default_factory=list)
    call_to_action: CallToAction = Field(default_factory=CallToAction)
    what_to_copy: list[str] = Field(default_factory=list)
    pacing: Optional[Pacing] = None
    duration_sec: float = 0.0
    section: Optional[Section] = None
    warnings: list[str] = Field(default_factory=list)
    model: str = ""
    read_from: str = "file"
    cover_url: Optional[str] = None


# ──────────────────────────────────────────────────────────────────────────
# Measuring
# ──────────────────────────────────────────────────────────────────────────


def pacing_from_cuts(cuts: list[float], start: float, end: float) -> Pacing:
    """Cuts per minute overall and per ten seconds, from detected cuts."""
    span = max(end - start, 0.001)
    inside = [c for c in cuts if start <= c <= end]
    n_buckets = max(1, math.ceil(span / PACING_BUCKET_SEC))
    # A last bucket of a few frames always reads as a dead stretch with no
    # cuts; under two seconds it joins the bucket before it.
    if n_buckets > 1 and span - (n_buckets - 1) * PACING_BUCKET_SEC < 2.0:
        n_buckets -= 1
    counts = [0] * n_buckets
    for c in inside:
        counts[min(n_buckets - 1, int((c - start) // PACING_BUCKET_SEC))] += 1
    return Pacing(
        cut_count=len(inside),
        cuts_per_minute=round(len(inside) / span * 60, 1),
        average_shot_sec=round(span / (len(inside) + 1), 2),
        cuts=inside,
        buckets=[
            PacingBucket(start_sec=round(start + i * PACING_BUCKET_SEC, 2), cuts=n)
            for i, n in enumerate(counts)
        ],
    )


# ──────────────────────────────────────────────────────────────────────────
# Reading the answer
# ──────────────────────────────────────────────────────────────────────────


def _int(v: Any, lo: int = 0, hi: int = 10) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return lo


def window_from(data: Any) -> BreakdownWindow:
    """A BreakdownWindow from whatever came back, keeping what holds up."""
    if isinstance(data, BreakdownWindow):
        return data
    d = data if isinstance(data, dict) else {}

    def one(model, value):
        try:
            return model.model_validate(value)
        except Exception:                                      # noqa: BLE001
            return None

    return BreakdownWindow.model_construct(
        summary=_text(d.get("summary")),
        format=_text(d.get("format")),
        audience=_text(d.get("audience")),
        platform_fit=_text(d.get("platform_fit")),
        tone=_text(d.get("tone")),
        hook=one(HookDraft, d.get("hook")),
        beats=_valid_items(BeatDraft, d.get("beats")),
        attention_risks=_valid_items(RiskDraft, d.get("attention_risks")),
        techniques=_valid_items(TechniqueDraft, d.get("techniques")),
        call_to_action=one(CtaDraft, d.get("call_to_action")),
        what_to_copy=[_text(x) for x in (d.get("what_to_copy") or []) if _text(x)],
    )


def parse_reply(response: Any) -> tuple[Optional[BreakdownWindow], Optional[str]]:
    truncated = _hit_token_limit(response)
    parsed = getattr(response, "parsed", None)
    if parsed is not None and not truncated:
        return window_from(parsed.model_dump() if isinstance(parsed, BaseModel) else parsed), None
    try:
        text = _strip_fences(getattr(response, "text", "") or "")
    except Exception:                                          # noqa: BLE001
        text = ""
    if not text:
        return None, "came back empty"
    try:
        return window_from(json.loads(text)), None
    except ValueError:
        pass
    try:
        import json_repair

        reading = window_from(json_repair.loads(text))
    except Exception as exc:                                   # noqa: BLE001
        return None, f"came back unusable ({exc})"
    why = "ran past the output limit" if truncated else "came back malformed"
    return reading, f"{why} and was repaired, so it may be incomplete"


class _At:
    """Lets a risk's single time ride through _offset_for, which reads .start."""

    def __init__(self, at: str):
        self.start = at


def check_window(
    reading: BreakdownWindow, window: tuple[float, float]
) -> tuple[list[Beat], list[Risk], Optional[float], int]:
    """Beats and risks on the video's clock, inside their window.

    Returns (beats, risks, call-to-action time, how many were dropped). A beat
    or risk with a time that cannot be true is dropped and counted — unlike a
    shot, its time IS its content."""
    lo, hi = window
    dropped = 0

    offset = _offset_for(reading.beats, lo, hi)
    beats: list[Beat] = []
    for b in reading.beats:
        s, e = parse_timecode(b.start), parse_timecode(b.end)
        if s is None or e is None:
            dropped += 1
            continue
        s, e = s + offset, e + offset
        if not (lo - TIMING_SLACK_SEC <= s <= hi + TIMING_SLACK_SEC) or e <= s:
            dropped += 1
            continue
        beats.append(Beat(
            start_sec=round(max(s, lo), 2), end_sec=round(min(e, hi), 2),
            label=_text(b.label), what_happens=_text(b.what_happens), purpose=_text(b.purpose),
        ))

    risk_offset = _offset_for([_At(r.at) for r in reading.attention_risks], lo, hi)
    risks: list[Risk] = []
    for r in reading.attention_risks:
        t = parse_timecode(r.at)
        if t is None or not (lo - TIMING_SLACK_SEC <= t + risk_offset <= hi + TIMING_SLACK_SEC):
            dropped += 1
            continue
        risks.append(Risk(at_sec=round(min(max(t + risk_offset, lo), hi), 2), why=_text(r.why), fix=_text(r.fix)))

    cta_at = None
    cta = reading.call_to_action
    if cta is not None and cta.present and cta.at:
        t = parse_timecode(cta.at)
        if t is not None:
            t += _offset_for([_At(cta.at)], lo, hi)
            if lo - TIMING_SLACK_SEC <= t <= hi + TIMING_SLACK_SEC:
                cta_at = round(min(max(t, lo), hi), 2)

    return beats, risks, cta_at, dropped


# ──────────────────────────────────────────────────────────────────────────
# The whole breakdown
# ──────────────────────────────────────────────────────────────────────────


async def break_down_video(
    client: Any,
    source: Any,
    *,
    duration_sec: float,
    section: Optional[tuple[float, float]] = None,
    model: str,
    source_mime_type: str = "video/mp4",
    frame: str = "",
    on_progress: Optional[Callable[[str], None]] = None,
) -> Breakdown:
    from google.genai import types

    say = on_progress or (lambda _line: None)
    start, end = section or (0.0, duration_sec)
    whole = start <= 0.5 and end >= duration_sec - 0.5
    windows = plan_windows(start, end)
    if not windows:
        raise RuntimeError("The video has no length to analyse.")

    span = end - start
    fps = sampling_fps(span)
    config = _config(
        types, BreakdownWindow, max_tokens=32768, thinking="MEDIUM",
        low_media=span > LONG_VIDEO_SEC, system=SYSTEM,
    )
    gate = asyncio.Semaphore(MAX_CONCURRENT_WINDOWS)
    warnings: list[str] = []

    async def one(index: int, window: tuple[float, float]) -> Optional[BreakdownWindow]:
        label = f"{_clock(window[0])}–{_clock(window[1])}"
        opening = index == 0
        scope = (
            f"The video is {_clock(duration_sec)} long."
            if whole and len(windows) == 1
            else f"You are given the part from {format_timecode(window[0])} to {format_timecode(window[1])} "
                 f"of a {_clock(duration_sec)} video. Report only that part, with every time on the "
                 f"original video's clock."
        )
        if frame:
            scope += f" It is framed {frame}."
        prompt = PROMPT.format(
            scope=scope,
            hook=int(HOOK_SEC),
            hook_note=(
                "This part contains the opening, so judge it."
                if opening else
                "This part does not contain the opening: describe the hook as empty with strength 0."
            ),
        )
        async with gate:
            say("AI is studying your video..." if len(windows) == 1 else f"AI is studying {label}...")
            response = await _generate_window(
                client,
                model=model,
                contents=[_video_part(types, source, window, source_mime_type, fps), prompt],
                config=config,
                say=lambda _line: say(f"Retrying {label}..."),
                timeout=WINDOW_TIMEOUT_SEC,
            )
        reading, note = parse_reply(response)
        if note:
            warnings.append(f"The breakdown of {label} {note}.")
        return reading

    results = await asyncio.gather(*(one(i, w) for i, w in enumerate(windows)), return_exceptions=True)
    parts = [(w, r) for w, r in zip(windows, results) if isinstance(r, BreakdownWindow)]
    failed = [f"{_clock(w[0])}–{_clock(w[1])}" for w, r in zip(windows, results) if not isinstance(r, BreakdownWindow)]
    if not parts:
        reason = next((str(r) for r in results if isinstance(r, BaseException)), "every reading came back unusable")
        raise RuntimeError(f"The AI could not read this video: {reason}")
    if failed:
        warnings.append(f"These parts could not be read and are missing from the breakdown: {', '.join(failed)}.")

    beats: list[Beat] = []
    risks: list[Risk] = []
    techniques: dict[str, Technique] = {}
    cta = CallToAction()
    dropped = 0
    for window, reading in parts:
        b, r, cta_at, d = check_window(reading, window)
        beats += b
        risks += r
        dropped += d
        for t in reading.techniques:
            name = _text(t.name)
            if not name:
                continue
            key = name.casefold()
            if key in techniques:
                techniques[key].where = ", ".join(x for x in (techniques[key].where, _text(t.where)) if x)
            else:
                techniques[key] = Technique(name=name, where=_text(t.where), why_it_works=_text(t.why_it_works))
        c = reading.call_to_action
        # The last part that has one: a call to action is usually at the end,
        # and a later one supersedes an earlier tease.
        if c is not None and c.present:
            cta = CallToAction(
                present=True, at_sec=cta_at, what=_text(c.what),
                strength=_int(c.strength), suggestion=_text(c.suggestion),
            )
        elif c is not None and not cta.present and not cta.suggestion:
            cta.suggestion = _text(c.suggestion)
    if dropped:
        warnings.append(
            f"{dropped} beat{'s' if dropped != 1 else ''} or risk{'s' if dropped != 1 else ''} came back "
            f"with times that cannot be right and {'were' if dropped != 1 else 'was'} left out."
        )

    first = parts[0][1]
    hook = None
    if first.hook is not None and parts[0][0][0] == windows[0][0]:
        hook = Hook(
            start_sec=round(start, 2), end_sec=round(min(start + HOOK_SEC, end), 2),
            what_happens=_text(first.hook.what_happens), technique=_text(first.hook.technique),
            strength=_int(first.hook.strength), why=_text(first.hook.why), improve=_text(first.hook.improve),
        )

    whole_fields = {
        "summary": first.summary, "format": first.format, "audience": first.audience,
        "platform_fit": first.platform_fit, "tone": first.tone, "what_to_copy": first.what_to_copy,
    }
    if len(parts) > 1:
        say("Putting the parts together...")
        try:
            response = await _generate_window(
                client,
                model=model,
                contents=[MERGE_PROMPT.format(parts=json.dumps([
                    {"from": format_timecode(w[0]), "to": format_timecode(w[1]), "summary": r.summary,
                     "format": r.format, "tone": r.tone, "what_to_copy": r.what_to_copy}
                    for w, r in parts
                ], ensure_ascii=False))],
                config=_config(types, BreakdownMerge, max_tokens=8192, thinking="MEDIUM", system=SYSTEM),
                say=lambda _line: None,
                timeout=MERGE_TIMEOUT_SEC,
            )
            merged = getattr(response, "parsed", None)
            if not isinstance(merged, BreakdownMerge):
                merged = BreakdownMerge.model_validate(json.loads(_strip_fences(response.text or "")))
            whole_fields = merged.model_dump()
        except Exception as exc:                               # noqa: BLE001
            log.warning("breakdown merge failed: %s", exc)
            warnings.append("The parts could not be summed up, so the summary describes the opening part.")

    beats.sort(key=lambda b: b.start_sec)
    risks.sort(key=lambda r: r.at_sec)
    say("Breakdown written")
    return Breakdown(
        summary=_text(whole_fields["summary"]),
        format=_text(whole_fields["format"]),
        audience=_text(whole_fields["audience"]),
        platform_fit=_text(whole_fields["platform_fit"]),
        tone=_text(whole_fields["tone"]),
        hook=hook,
        beats=beats,
        attention_risks=risks,
        techniques=list(techniques.values()),
        call_to_action=cta,
        what_to_copy=[_text(x) for x in whole_fields["what_to_copy"] if _text(x)][:8],
        duration_sec=round(duration_sec, 2),
        section=None if whole else Section(start_sec=round(start, 2), end_sec=round(end, 2)),
        warnings=warnings,
        model=model,
    )
