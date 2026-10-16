"""
Reverse-engineering a video into prompts.

This is the Extractor's engine: it watches a video and writes back the prompts
that would recreate it — a concept, character sheets, a shot list where every
shot carries an image prompt and a video prompt, and a master prompt for the
whole thing. It replaces a single blocking call that had four problems, each
of which the clipping side had already solved:

  * it ran on the event loop, so one extraction froze every other request on
    the service for as long as the model took to answer
  * it had an 8192-token ceiling and no way of noticing it had hit it, so a
    long shot list was truncated and json_repair quietly closed the brackets
  * it asked for the whole video in one request however long it was
  * it trusted every timestamp it was given

So it now reads the way clipping does — in windows, concurrently, through the
async client, with retries and a timeout per window — and checks what comes
back before anyone sees it.

── The contract ─────────────────────────────────────────────────────────────

The website, the Studio extension and the saved extractions in Django all read
the original shape:

    { video_concept, voiceover_text, characters_description,
      character_sheets: [{ character_name, prompt }],
      shots: [{ shot_id, time_range, image_prompt, video_prompt }] }

Every one of those keys is still there and still means what it meant. All of
the new output is additive — fields an old reader ignores.

── What is not trusted ──────────────────────────────────────────────────────

Time, as on the clipping side. A shot whose timing cannot be true keeps its
prompts — those are the product — but loses its timing and its thumbnail,
and the result says so in `warnings`. Nothing is silently dropped.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re
from typing import Any, Callable, Optional

from pydantic import BaseModel, Field, field_validator

from app.clip_analysis import (
    _generate_window,
    _offset_for,
    format_timecode,
    parse_timecode,
)

log = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Tuning
# ──────────────────────────────────────────────────────────────────────────

# How much video goes into one request. Shorter than clipping's seven minutes
# because the answer is far denser: every shot costs a few hundred tokens of
# prompt, and a fast-cut five minutes can hold a hundred shots.
WINDOW_SEC = 300.0

# Windows run together — the point of splitting is wall clock — but a two hour
# video must not open twenty-four requests at once.
MAX_CONCURRENT_WINDOWS = 4

# A window is a long answer to write; the merge is a short one.
WINDOW_TIMEOUT_SEC = 300.0
MERGE_TIMEOUT_SEC = 120.0

# Gemini 3 Flash's own ceiling. It is a ceiling, not a target: the model stops
# when the shot list is done. What it must never be again is 8192.
WINDOW_MAX_TOKENS = 65536
MERGE_MAX_TOKENS = 16384

# Past this, frames are sampled more sparsely and at low resolution. A two hour
# video read at full detail costs dollars per extraction, and a shot list that
# long is about structure more than texture.
LONG_VIDEO_SEC = 15 * 60

# A prompt shorter than this is a label, not a prompt. Matches the Studio
# builder's own threshold, so a shot kept here is a shot Studio will build.
MIN_PROMPT_CHARS = 12

# A cut is a frame boundary, but the model reads at a few frames a second.
TIMING_SLACK_SEC = 1.0
MIN_SHOT_SEC = 0.2

# A shot list covering less of the video than this has a hole in it.
MIN_COVERAGE = 0.6


def sampling_fps(span_sec: float) -> float:
    """
    Frames per second the model is shown.

    The default of one a second misses most cuts in a fast eight second clip —
    and short clips are most of what people extract. Long videos go the other
    way for cost. Speech timing rides on the audio and is unaffected either way.
    """
    if span_sec <= 60:
        return 3.0
    if span_sec <= 180:
        return 2.0
    if span_sec <= LONG_VIDEO_SEC:
        return 1.0
    return 0.5


# ──────────────────────────────────────────────────────────────────────────
# What the caller can ask for
# ──────────────────────────────────────────────────────────────────────────

# Visual direction appended to the prompt. "faithful" is the default and adds
# nothing, so the extraction keeps matching the source video unless the user
# deliberately asks for a different look.
STYLE_DIRECTIVES = {
    "faithful": "",
    "cinematic": (
        "Render every prompt in a cinematic film style: anamorphic framing, "
        "motivated practical lighting, shallow depth of field, filmic colour grade."
    ),
    "photorealistic": (
        "Render every prompt as photorealistic capture: real camera and lens "
        "language, natural light, believable skin and material detail. No illustration."
    ),
    "illustrated": (
        "Render every prompt as stylised 2D illustration: clean linework, "
        "flat shapes, deliberate colour palette. Not photographic."
    ),
    "anime": (
        "Render every prompt in modern anime style: cel shading, expressive "
        "faces, detailed backgrounds, high-contrast key light."
    ),
    "3d": (
        "Render every prompt as a polished 3D render: subsurface scattering, "
        "soft global illumination, physically based materials, UE5/Octane look."
    ),
}

# The frames a person can ask the prompts to be written for. "source" keeps
# whatever the video was shot in.
ASPECT_RATIOS = {
    "source": "",
    "16:9": "a 16:9 horizontal frame",
    "9:16": "a 9:16 vertical frame",
    "1:1": "a 1:1 square frame",
    "4:5": "a 4:5 portrait frame",
}

# A creative brief, not an essay. It goes into every window's prompt.
MAX_DIRECTION_CHARS = 300

_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


class ExtractionOptions(BaseModel):
    """Caller-supplied direction for the analysis.

    Every field is optional and the defaults reproduce the original behaviour,
    so an old client that sends nothing gets what it always got — and an
    unknown value falls back rather than failing a paid extraction the user
    already waited on.
    """

    # Bounded: the value goes into a prompt, and an absurd number would either
    # blow the output budget or produce nonsense.
    shot_count: Optional[int] = Field(default=None, ge=1, le=40)
    language: str = "auto"
    style: str = "faithful"
    character_sheets: bool = True
    aspect_ratio: str = "source"
    creative_direction: str = ""
    # Analyse only part of the video. Seconds, or a timecode like "01:20".
    start_sec: Optional[float] = None
    end_sec: Optional[float] = None

    @field_validator("style")
    @classmethod
    def known_style(cls, v: str) -> str:
        return v if v in STYLE_DIRECTIVES else "faithful"

    @field_validator("aspect_ratio")
    @classmethod
    def known_ratio(cls, v: str) -> str:
        v = (v or "").strip()
        return v if v in ASPECT_RATIOS else "source"

    @field_validator("language")
    @classmethod
    def sane_language(cls, v: str) -> str:
        v = _CONTROL.sub("", v or "auto").strip()
        # Goes straight into a prompt; keep it short.
        return v[:32] if v else "auto"

    @field_validator("creative_direction")
    @classmethod
    def sane_direction(cls, v: str) -> str:
        v = _CONTROL.sub(" ", v or "")
        v = re.sub(r"\s+", " ", v).strip()
        return v[:MAX_DIRECTION_CHARS]

    @field_validator("start_sec", "end_sec", mode="before")
    @classmethod
    def seconds(cls, v: Any) -> Optional[float]:
        if v is None or v == "":
            return None
        secs = parse_timecode(v)
        if secs is None or not math.isfinite(secs):
            return None
        return secs


def resolve_section(
    options: Optional[ExtractionOptions], duration_sec: float
) -> tuple[float, float]:
    """
    The stretch of video to analyse, or a message saying why there is none.

    Raises ValueError with words a person can act on. An end past the end of
    the video is clamped rather than refused: "to the end" is what they meant.
    """
    start = (options.start_sec if options else None) or 0.0
    end = options.end_sec if options and options.end_sec is not None else duration_sec
    end = min(end, duration_sec)

    if start >= duration_sec:
        raise ValueError(
            f"The section starts at {_clock(start)}, but the video is only "
            f"{_clock(duration_sec)} long."
        )
    if end <= start:
        raise ValueError(
            f"The section ends at {_clock(end)}, which is not after where it "
            f"starts ({_clock(start)})."
        )
    if end - start < 1.0:
        raise ValueError("The section is under a second long — there is nothing to analyse.")
    return start, end


def _clock(seconds: float) -> str:
    """A time for a person to read: 1:05, or 1:02:05 past an hour."""
    seconds = int(round(max(0.0, seconds)))
    h, rest = divmod(seconds, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


# ──────────────────────────────────────────────────────────────────────────
# What the model is asked to return
# ──────────────────────────────────────────────────────────────────────────
#
# Every field is required, because the schema is what tells the model to fill
# it. Empty is said with "" rather than null — Optional becomes anyOf in the
# schema, which not every SDK release converts.


class ShotDraft(BaseModel):
    start: str = Field(description="Where the shot begins, MM:SS.s, read off the video")
    end: str = Field(description="Where the shot ends, MM:SS.s, read off the video")
    characters: list[str] = Field(description="Names from the characters list, of everyone visible")
    shot_size: str = Field(description="extreme wide, wide, full, medium, medium close-up, close-up, extreme close-up, or insert")
    lens: str = Field(description='Apparent focal length and depth of field, e.g. "35mm, shallow depth of field"')
    camera_movement: str = Field(description="static, pan, tilt, dolly, tracking, handheld, orbit, crane, zoom, or a short combination")
    dialogue: str = Field(description='Every word spoken during the shot, as NAME: "line". Empty if none')
    sound: str = Field(description="Ambience, sound effects and music during the shot. Empty if silent")
    image_prompt: str = Field(description="Self-contained prompt for the shot's key frame")
    video_prompt: str = Field(description="Prompt for the shot's motion, camera move, pacing and sound")


class CharacterDraft(BaseModel):
    # The first live run turned a spoken "Jimmy" into "Jimmy Donaldson" — a
    # surname the video never said, recalled from recognising the person. On a
    # user's own upload that is naming a stranger from their face.
    name: str = Field(description="Only as the video says or shows it; otherwise descriptive")
    appearance: str = Field(description="Face, age, hair, eyes, build, wardrobe, accessories")


class SheetDraft(BaseModel):
    character_name: str
    prompt: str


class MasterSubject(BaseModel):
    name: str
    appearance: str
    action: str


class MasterAudio(BaseModel):
    dialogue: str = Field(description='Spoken lines in order, as NAME: "line". Empty if none')
    sound_effects: str
    ambience: str
    music: str


class MasterPrompt(BaseModel):
    """The master prompt as fields — the JSON-prompting shape people share for
    Veo, so one part can be changed without rewriting the paragraph."""

    shot: str = Field(description="Framing and composition, and how they change")
    subjects: list[MasterSubject]
    scene: str = Field(description="Location, time of day, weather, set dressing")
    action: str = Field(description="What happens, in order")
    camera: str = Field(description="Lens, angle and movement")
    lighting: str
    style: str = Field(description="Medium, look, colour grade, texture")
    mood: str
    audio: MasterAudio
    aspect_ratio: str
    duration: str
    avoid: str = Field(description="What must not appear: captions, watermarks, logos, artefacts")


class WindowReading(BaseModel):
    """The model's whole answer about one window of video."""

    video_concept: str
    voiceover_text: str
    characters_description: str
    characters: list[CharacterDraft]
    # Described in the schema as well as the prompt. The first live run listed
    # five characters and wrote sheets for two; the three without one could
    # not be wired into their shots in Studio.
    character_sheets: list[SheetDraft] = Field(
        description="A turnaround sheet for every entry in characters, under the same name"
    )
    shots: list[ShotDraft]
    master_prompt: str
    master_prompt_json: MasterPrompt


class CastMember(BaseModel):
    name: str = Field(description="The one name to use for this character")
    aliases: list[str] = Field(description="Every other name they appeared under")


class MergedReading(BaseModel):
    """The model's account of the whole video, from the readings of its parts."""

    video_concept: str
    characters_description: str
    cast: list[CastMember]
    character_sheets: list[SheetDraft]
    master_prompt: str
    master_prompt_json: MasterPrompt


# ──────────────────────────────────────────────────────────────────────────
# What the caller gets
# ──────────────────────────────────────────────────────────────────────────


class CharacterSheet(BaseModel):
    character_name: str
    prompt: str


class Camera(BaseModel):
    shot_size: str = ""
    lens: str = ""
    movement: str = ""


class Shot(BaseModel):
    # The original four, unchanged in meaning.
    shot_id: int
    time_range: str = ""
    image_prompt: str = ""
    video_prompt: str = ""
    # Checked against the video. None means the model's timing could not be
    # true — the prompts are still good, the position is unknown.
    start_sec: Optional[float] = None
    end_sec: Optional[float] = None
    characters: list[str] = Field(default_factory=list)
    camera: Camera = Field(default_factory=Camera)
    dialogue: str = ""
    sound: str = ""
    thumbnail_url: Optional[str] = None


class Section(BaseModel):
    start_sec: float
    end_sec: float


class Extraction(BaseModel):
    video_concept: str = ""
    voiceover_text: str = ""
    characters_description: str = ""
    character_sheets: list[CharacterSheet] = Field(default_factory=list)
    shots: list[Shot] = Field(default_factory=list)
    master_prompt: str = ""
    master_prompt_json: Optional[dict[str, Any]] = None
    duration_sec: float = 0.0
    # Only when part of the video was analysed.
    section: Optional[Section] = None
    # The frame the prompts were written for.
    aspect_ratio: str = ""
    # Everything thrown away or cut short, in words a person can act on.
    # Empty is the normal case.
    warnings: list[str] = Field(default_factory=list)
    model: str = ""
    # Where this extraction's thumbnails live, so they can be deleted with it.
    thumbnails_id: Optional[str] = None
    # The source's frame rate, which a cut list (EDL) is counted in. None when
    # the server never had the file.
    source_fps: Optional[float] = None
    # "file" when the server had the video, "youtube" when YouTube refused the
    # download and the model read the link itself. A youtube reading has no
    # shot thumbnails and no cut-snapped timings: both need the file.
    read_from: str = "file"
    # A poster for a reading with no shot thumbnails — YouTube's own.
    cover_url: Optional[str] = None
    # Until when (epoch seconds) an edit can look at the video again. None
    # once it is gone, or when it was never kept.
    refine_until: Optional[float] = None


# ──────────────────────────────────────────────────────────────────────────
# The prompt
# ──────────────────────────────────────────────────────────────────────────

SYSTEM = (
    "You are a film director and prompt engineer. You watch footage and write the "
    "prompts an AI image or video generator needs to recreate it: what is in frame, "
    "how it is lit and lensed, how it moves, and what it sounds like. Describe only "
    "what the video shows and the audio contains. Read every timing off the video; "
    "never invent one."
)

WINDOW_PROMPT = """Watch this video and reverse-engineer it into the prompts that would recreate it with an AI image and video generator.

{scope}

SHOTS
Split the footage at every cut: each change of camera angle, framing or scene starts a new shot. For each shot:
- start, end: where the shot begins and ends, as MM:SS.s, read off the video itself. Do not estimate them from how much happens and do not space them evenly.
- characters: the name of everyone visible in the shot, written exactly as in your characters list. Empty when nobody is on screen.
- shot_size, lens, camera_movement: the framing, the apparent focal length and depth of field, and how the camera moves.
- dialogue: every word spoken during the shot, as NAME: "line", each line given to the person who says it (see SPEAKERS). Empty when nothing is said.
- sound: the ambience, sound effects and music heard during the shot. Empty when silent.
- image_prompt: a production-ready prompt for the shot's key frame — subject and wardrobe, pose and expression, setting, composition, lighting, lens, colour palette, texture and detail. Make it self-contained: describe each character's look in it, because a generator reads one prompt at a time and has never seen the others.
- video_prompt: a prompt for the motion — what moves and how, with its weight and physics, the camera move, the pacing, and for generators that make sound, the dialogue in quotes and the sounds.

CHARACTERS
Every person, creature or mascot who appears more than in passing. Give each a short name, and describe their appearance: face, age, hair, eyes, build, wardrobe, accessories. Use exactly the same name everywhere they appear.

SPEAKERS
Give each line to the person who says it: the one on screen whose mouth moves with the words, or the voice that answers the line before. A name inside a line is the person being spoken TO — "Yo Benny" is said to Benny by someone else — so nobody addresses themselves by their own name. Check every line against this before answering, and keep each name attached to the same look in every shot and sheet.

NAMES
Name a person only with what this video itself says or shows, and only that much: someone called "Jimmy" is "Jimmy". Never add a surname, a channel or stage name, a nickname or a job you know from anywhere else, and never name anyone because of how they look or who they resemble. Everyone the video does not name gets a plain descriptive name such as "Woman in red coat". This holds everywhere you write a name or describe a person — characters, sheets, shots, prompts, dialogue speakers and the master prompt: describe people by how they look, never by who they are.

CHARACTER SHEETS
One sheet for EVERY character in your characters list — the same people, in the same order, under exactly the same names. Do not keep sheets for the main characters only: a character who appears in a shot and has no sheet cannot be kept looking the same from shot to shot. Each sheet is a turnaround prompt: "Character design sheet, concept art turnaround, multiple views", then facial structure, age, hair, eye colour, body type and posture, then wardrobe materials and accessories, then "Studio rim lighting, neutral grey backdrop, 8k".

THE WHOLE {what}
- video_concept: the mood, narrative and visual style, in a few sentences.
- voiceover_text: every word spoken, in order.
- characters_description: who appears and what they do, in prose.
- master_prompt: one complete paragraph that would make a video like this in a single generation — subject and action, setting, camera and lens, lighting, colour and style, pacing, and the sound, with any dialogue in quotes.
- master_prompt_json: the same master prompt, broken into its fields."""

MERGE_PROMPT = """Below are readings of consecutive parts of one video, in order. Combine them into one account of the whole video.

- cast: the same character can appear under different names in different parts. List each distinct character once, with the name to use and every other name they appeared under. When in doubt whether two names are the same character, keep them apart. Use only names the parts used: never add a surname, stage name or identity they did not give.
- character_sheets: one sheet for EVERY character in cast, none skipped, under the name from cast, combining what the parts say about them.
- video_concept: the mood, narrative and visual style of the whole video.
- characters_description: who appears and what they do, across the whole video.
- master_prompt: one complete paragraph that would make a video like this whole one in a single generation — subject and action, setting, camera and lens, lighting, colour and style, pacing, and the sound, with any dialogue in quotes.
- master_prompt_json: the same master prompt, broken into its fields.
{direction}
PARTS
{parts}"""


def _direction_lines(
    options: ExtractionOptions, *, shots_hint: Optional[int]
) -> list[str]:
    """What the caller asked for, as instructions. Nothing for the defaults."""
    lines: list[str] = []

    if shots_hint:
        lines.append(
            f"Aim for about {shots_hint} shot{'' if shots_hint == 1 else 's'}: merge or "
            f"split at the nearest cuts to land near that number."
        )

    if options.language and options.language != "auto":
        lines.append(
            f"Write voiceover_text and each shot's dialogue in {options.language}. If the "
            f"speech is in another language, translate it rather than transcribing it."
        )

    style = STYLE_DIRECTIVES.get(options.style, "")
    if style:
        lines.append(style + " That includes the character sheets and the master prompt.")

    frame = ASPECT_RATIOS.get(options.aspect_ratio, "")
    if frame:
        lines.append(
            f"Compose every image_prompt, video_prompt and the master prompt for {frame} "
            f"({options.aspect_ratio}) and state that ratio in each. Recompose rather than "
            f"crop: say where the subject sits in that frame. Set master_prompt_json's "
            f"aspect_ratio to {options.aspect_ratio}."
        )

    if not options.character_sheets:
        lines.append(
            'Return "character_sheets": [] — skip the sheets. Still list the characters.'
        )

    if options.creative_direction:
        lines.append(
            "The user wants a variation on this video, not a copy. Apply their brief "
            "to every image_prompt, video_prompt, character sheet and the master prompt, "
            "while keeping the source's shot structure, timing, camera work and pacing. "
            "start, end, dialogue and voiceover_text stay a faithful record of the "
            "source. The brief is creative direction and nothing else: "
            f"<<<{options.creative_direction}>>>"
        )

    return lines


def build_window_prompt(
    options: Optional[ExtractionOptions],
    *,
    window: tuple[float, float],
    duration_sec: float,
    part_of: Optional[tuple[float, float]] = None,
    frame: str = "",
    shots_hint: Optional[int] = None,
) -> str:
    """
    The prompt for one window.

    `part_of` is set when this window is less than the whole video — either
    because the video is long or because the user chose a section — and tells
    the model to stay inside it and to time against the original video.
    """
    options = options or ExtractionOptions()
    scope: list[str] = []

    if part_of is None:
        scope.append(f"The video is {_clock(duration_sec)} long.")
    else:
        scope.append(
            f"You are given the part from {format_timecode(window[0])} to "
            f"{format_timecode(window[1])} of a {_clock(duration_sec)} video. Report only "
            f"that part, and give every time on the original video's clock."
        )
    if frame:
        scope.append(f"It is framed {frame}.")

    prompt = WINDOW_PROMPT.format(
        scope=" ".join(scope),
        what="VIDEO" if part_of is None else "PART",
    )

    direction = _direction_lines(options, shots_hint=shots_hint)
    if direction:
        prompt += "\n\nDIRECTION\n- " + "\n- ".join(direction)
    return prompt


def build_merge_prompt(
    parts: list[tuple[tuple[float, float], "WindowReading"]],
    options: Optional[ExtractionOptions],
) -> str:
    options = options or ExtractionOptions()
    payload = [
        {
            "from": format_timecode(window[0]),
            "to": format_timecode(window[1]),
            "concept": reading.video_concept,
            "characters": [c.model_dump() for c in reading.characters],
            "character_sheets": [s.model_dump() for s in reading.character_sheets],
            "master_prompt": reading.master_prompt,
            # Enough to know what is said, not the whole transcript.
            "speech": (reading.voiceover_text or "")[:800],
        }
        for window, reading in parts
    ]
    direction = _direction_lines(options, shots_hint=None)
    block = ("\nDIRECTION\n- " + "\n- ".join(direction) + "\n") if direction else ""
    return MERGE_PROMPT.format(direction=block, parts=json.dumps(payload, ensure_ascii=False))


# ──────────────────────────────────────────────────────────────────────────
# Windows and shot counts
# ──────────────────────────────────────────────────────────────────────────


def plan_windows(start: float, end: float) -> list[tuple[float, float]]:
    """
    The stretches to read, in equal parts and without overlap.

    Equal rather than WINDOW_SEC and a remainder, because a twelve second tail
    window asks the model to find shots in almost nothing. No overlap, because
    a shot is not a sentence: a cut through one at a boundary costs two shots
    with similar prompts, where an overlap would cost a de-duplication that
    can merge two genuinely different shots of the same subject.
    """
    span = end - start
    if span <= 0:
        return []
    if span <= WINDOW_SEC * 1.2:
        return [(start, end)]
    n = math.ceil(span / WINDOW_SEC)
    size = span / n
    return [(start + i * size, end if i == n - 1 else start + (i + 1) * size) for i in range(n)]


def split_shot_count(
    total: Optional[int], windows: list[tuple[float, float]]
) -> list[Optional[int]]:
    """A requested shot count, shared across windows by their length."""
    if not total or not windows:
        return [None] * len(windows)
    if len(windows) == 1:
        return [total]
    span = sum(b - a for a, b in windows)
    return [max(1, round(total * (b - a) / span)) for a, b in windows]


# ──────────────────────────────────────────────────────────────────────────
# Reading the answer
# ──────────────────────────────────────────────────────────────────────────


def _text(v: Any) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()


def _strip_fences(text: str) -> str:
    return re.sub(r"^```(?:json)?\s*|\s*```$", "", (text or "").strip())


def _hit_token_limit(response: Any) -> bool:
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return False
    return "MAX_TOKENS" in str(getattr(candidates[0], "finish_reason", ""))


def _valid_items(model: type[BaseModel], items: Any) -> list[Any]:
    """The items of a list that validate, one at a time.

    A repaired answer usually ends inside its last item; dropping that one
    item keeps everything before it, where validating the list whole would
    keep nothing.
    """
    out = []
    for item in items if isinstance(items, list) else []:
        try:
            out.append(model.model_validate(item))
        except Exception:                                      # noqa: BLE001
            continue
    return out


def _master_from(data: Any) -> Optional[MasterPrompt]:
    if isinstance(data, MasterPrompt):
        return data
    try:
        return MasterPrompt.model_validate(data)
    except Exception:                                          # noqa: BLE001
        return None


def window_from(data: Any) -> WindowReading:
    """A WindowReading from whatever came back, keeping every part that holds up."""
    if isinstance(data, WindowReading):
        return data
    d = data if isinstance(data, dict) else {}
    master = _master_from(d.get("master_prompt_json"))
    return WindowReading.model_construct(
        video_concept=_text(d.get("video_concept")),
        voiceover_text=str(d.get("voiceover_text") or "").strip(),
        characters_description=_text(d.get("characters_description")),
        characters=_valid_items(CharacterDraft, d.get("characters")),
        character_sheets=_valid_items(SheetDraft, d.get("character_sheets")),
        shots=_valid_items(ShotDraft, d.get("shots")),
        master_prompt=_text(d.get("master_prompt")),
        master_prompt_json=master,
    )


def parse_reply(response: Any) -> tuple[Optional[WindowReading], Optional[str]]:
    """
    The window's reading, and a note when it is less than the model meant.

    response_schema is honoured by the model, not guaranteed by it. An answer
    that ran into the output ceiling is repaired so the shots before the cut
    survive — and the note makes sure the person hears that there was a cut.
    """
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

    if not truncated:
        try:
            return window_from(json.loads(text)), None
        except ValueError:
            pass

    try:
        import json_repair

        repaired = json_repair.loads(text)
    except Exception as exc:                                   # noqa: BLE001
        return None, f"came back unusable ({exc})"

    reading = window_from(repaired)
    if not reading.shots:
        return None, "came back unusable"
    why = "ran past the output limit" if truncated else "came back malformed"
    return reading, f"{why} and was repaired, so its last shots may be missing"


def check_shots(
    raw: list[ShotDraft],
    *,
    window_start: float,
    window_end: float,
) -> tuple[list[Shot], int, int]:
    """
    The window's shots with their timing checked.

    Returns (shots, number left out for having no prompt, number whose timing
    could not be true). A shot with impossible timing is kept — its prompts are
    the product — but its timing is cleared rather than shown wrong.
    """
    offset = _offset_for(raw, window_start, window_end)
    out: list[Shot] = []
    no_prompt = bad_timing = 0

    for draft in raw:
        image = _text(draft.image_prompt)
        video = _text(draft.video_prompt)
        if len(image) < MIN_PROMPT_CHARS and len(video) < MIN_PROMPT_CHARS:
            no_prompt += 1
            continue

        start = parse_timecode(draft.start)
        end = parse_timecode(draft.end)
        timed = start is not None and end is not None
        if timed:
            start += offset
            end += offset
            if not (window_start - TIMING_SLACK_SEC <= start <= window_end + TIMING_SLACK_SEC):
                timed = False
            elif end <= start:
                timed = False
            else:
                start = max(start, window_start)
                end = min(end, window_end)
                timed = end - start >= MIN_SHOT_SEC
        if not timed:
            bad_timing += 1

        out.append(
            Shot(
                shot_id=0,
                image_prompt=image,
                video_prompt=video,
                start_sec=round(start, 2) if timed else None,
                end_sec=round(end, 2) if timed else None,
                characters=[_text(n) for n in draft.characters if _text(n)],
                camera=Camera(
                    shot_size=_text(draft.shot_size),
                    lens=_text(draft.lens),
                    movement=_text(draft.camera_movement),
                ),
                dialogue=str(draft.dialogue or "").strip(),
                sound=_text(draft.sound),
            )
        )
    return out, no_prompt, bad_timing


def order_shots(shots: list[Shot]) -> list[Shot]:
    """
    Shots in time order, numbered, with no two claiming the same seconds.

    An untimed shot keeps its place after the timed shot it followed. Overlaps
    are trimmed from the earlier shot's end: a cut happens once.
    """
    keyed = []
    key = -1.0
    for index, shot in enumerate(shots):
        if shot.start_sec is not None:
            key = shot.start_sec
        keyed.append((key, index, shot))
    keyed.sort(key=lambda t: (t[0], t[1]))
    ordered = [shot for _key, _index, shot in keyed]

    previous: Optional[Shot] = None
    for shot in ordered:
        if shot.start_sec is None:
            continue
        if previous is not None and previous.end_sec is not None and previous.end_sec > shot.start_sec:
            previous.end_sec = round(max(previous.start_sec + MIN_SHOT_SEC, shot.start_sec), 2)
        previous = shot

    for number, shot in enumerate(ordered, start=1):
        shot.shot_id = number
        shot.time_range = (
            f"{format_timecode(shot.start_sec)} - {format_timecode(shot.end_sec)}"
            if shot.start_sec is not None and shot.end_sec is not None
            else ""
        )
    return ordered


# How far a model-reported boundary may move to land on a detected cut. The
# model reads at one to three frames a second, so its boundaries are within
# about half a second of the truth; a cut further away than this is a
# different cut, not the one it meant.
SNAP_TOLERANCE_SEC = 0.75


def snap_to_cuts(
    shots: list[Shot], cuts: list[float], *, tolerance: float = SNAP_TOLERANCE_SEC
) -> tuple[list[Shot], int]:
    """
    Move each timed boundary onto the nearest detected cut within tolerance.

    Returns the shots, re-ordered and renumbered, and how many moved. A
    boundary with no cut near it — a dissolve, a fade, or a cut the detector
    missed — keeps the model's timing. A move that would leave a shot shorter
    than MIN_SHOT_SEC is not made: two boundaries snapping to one cut means
    the model saw a shot that is not there, and that is not this function's
    call to make.
    """
    if not cuts:
        return shots, 0

    import bisect

    def nearest(t: float) -> Optional[float]:
        i = bisect.bisect_left(cuts, t)
        candidates = [cuts[j] for j in (i - 1, i) if 0 <= j < len(cuts)]
        best = min(candidates, key=lambda c: abs(c - t), default=None)
        return best if best is not None and abs(best - t) <= tolerance else None

    # A boundary two neighbouring shots share is one cut, and moves for both
    # at once; snapping each shot's ends on their own left slivers between
    # them when only one side was near enough to move.
    shared = lambda a, b: abs(a - b) <= 0.05
    timed = [s for s in shots if s.start_sec is not None and s.end_sec is not None]
    changed: set[int] = set()

    for i, shot in enumerate(timed):
        before = timed[i - 1] if i > 0 else None
        if before is None or not shared(before.end_sec, shot.start_sec):
            cut = nearest(shot.start_sec)
            if cut is not None and shot.end_sec - cut >= MIN_SHOT_SEC and cut != shot.start_sec:
                shot.start_sec = round(cut, 2)
                changed.add(id(shot))

        cut = nearest(shot.end_sec)
        if cut is None or cut == shot.end_sec:
            continue
        after = timed[i + 1] if i + 1 < len(timed) and shared(shot.end_sec, timed[i + 1].start_sec) else None
        if cut - shot.start_sec < MIN_SHOT_SEC or (after and after.end_sec - cut < MIN_SHOT_SEC):
            continue
        shot.end_sec = round(cut, 2)
        changed.add(id(shot))
        if after:
            after.start_sec = round(cut, 2)
            changed.add(id(after))

    moved = len(changed)
    return order_shots(shots), moved


def _name_table(names: list[str], aliases: Optional[dict[str, str]] = None) -> dict[str, str]:
    table = {n.casefold(): n for n in names if n}
    table.update(aliases or {})
    return table


def canonical(names: list[str], table: dict[str, str]) -> list[str]:
    """Names as the cast list writes them, once each."""
    out: list[str] = []
    seen: set[str] = set()
    for name in names:
        name = _text(name)
        if not name:
            continue
        name = table.get(name.casefold(), name)
        if name.casefold() in seen:
            continue
        seen.add(name.casefold())
        out.append(name)
    return out


# A dialogue segment as the prompt asks for it: NAME: "line".
_LINE = re.compile(r'([^:"\n]{1,40}?):\s*["\u201c]([^"\u201d]*)["\u201d]')


def _addresses(name: str, text: str) -> bool:
    """Whether `text` speaks TO `name` — "Yo Benny", "Benny, come here",
    "thanks, Benny" — rather than about them or as them ("I'm Benny")."""
    n = re.escape(name)
    return bool(
        re.search(rf"\b(?:yo|hey|hi|oi|ok|okay|look|listen|come on|bro)\s*,?\s+{n}\b", text, re.I)
        or re.search(rf"^\s*{n}\s*[,!?]", text, re.I)
        or re.search(rf",\s*{n}\s*[.!?]?\s*$", text, re.I)
    )


def self_addressed(shots: list[Shot]) -> list[int]:
    """Shots with a line given to the very person it speaks to.

    The live run that prompted this gave "Yo Benny, this stuff hitting" to
    Benny: the two boys' names were swapped. A person does not call
    themselves by name, so a line that does is a line on the wrong speaker —
    and usually a sign that the names are swapped everywhere.
    """
    found = []
    for shot in shots:
        for speaker, text in _LINE.findall(shot.dialogue or ""):
            speaker = speaker.strip()
            if speaker and _addresses(speaker, text):
                found.append(shot.shot_id)
                break
    return found


def _sheets(drafts: list[SheetDraft]) -> list[CharacterSheet]:
    out: list[CharacterSheet] = []
    seen: set[str] = set()
    for i, draft in enumerate(drafts):
        prompt = _text(draft.prompt)
        if len(prompt) < MIN_PROMPT_CHARS:
            continue
        name = _text(draft.character_name) or f"Character {i + 1}"
        if name.casefold() in seen:
            continue
        seen.add(name.casefold())
        out.append(CharacterSheet(character_name=name, prompt=prompt))
    return out


# ──────────────────────────────────────────────────────────────────────────
# Calling the model
# ──────────────────────────────────────────────────────────────────────────


def _config(
    types_mod: Any,
    schema: type[BaseModel],
    *,
    max_tokens: int,
    thinking: str,
    low_media: bool = False,
    system: str = SYSTEM,
) -> Any:
    """Request settings, built as defensively as clipping's — see _build_config."""
    kwargs: dict[str, Any] = {
        "system_instruction": system,
        "response_mime_type": "application/json",
        "response_schema": schema,
        # Gemini 3 warns that lowering temperature can loop or degrade output.
        "max_output_tokens": max_tokens,
    }

    media = getattr(types_mod, "MediaResolution", None)
    if low_media and media is not None and hasattr(media, "MEDIA_RESOLUTION_LOW"):
        kwargs["media_resolution"] = media.MEDIA_RESOLUTION_LOW

    thinking_cfg = getattr(types_mod, "ThinkingConfig", None)
    level = getattr(types_mod, "ThinkingLevel", None)
    if thinking_cfg is not None and level is not None and hasattr(level, thinking):
        try:
            kwargs["thinking_config"] = thinking_cfg(thinking_level=getattr(level, thinking))
        except TypeError:                                    # older signature
            pass

    return types_mod.GenerateContentConfig(**kwargs)


def _video_part(
    types_mod: Any,
    source: Any,
    window: tuple[float, float],
    mime_type: str,
    fps: float,
) -> Any:
    """The video, clipped to one window."""
    if isinstance(source, str):                       # a gs:// or https:// uri
        part = types_mod.Part.from_uri(file_uri=source, mime_type=mime_type)
    else:                                             # an uploaded File object
        part = types_mod.Part.from_uri(
            file_uri=source.uri, mime_type=getattr(source, "mime_type", mime_type)
        )

    video_meta = getattr(types_mod, "VideoMetadata", None)
    if video_meta is not None:
        fields: dict[str, Any] = {
            "start_offset": f"{window[0]:.3f}s",
            "end_offset": f"{window[1]:.3f}s",
        }
        if "fps" in getattr(video_meta, "model_fields", {}):
            fields["fps"] = fps
        part.video_metadata = video_meta(**fields)
    return part


async def _merge(
    client: Any,
    parts: list[tuple[tuple[float, float], WindowReading]],
    *,
    options: ExtractionOptions,
    model: str,
    warnings: list[str],
    say: Callable[[str], None],
) -> tuple[str, str, list[CharacterSheet], str, Optional[MasterPrompt], dict[str, str]]:
    """
    One account of the whole video from the accounts of its parts.

    Returns (concept, characters description, sheets, master prompt, master
    fields, alias table). Text only — the parts already watched the video.
    A failure here costs the whole-video polish, not the extraction: the
    fallback stitches the parts together and says it did.
    """
    from google.genai import types

    say("Putting the parts together...")
    try:
        response = await _generate_window(
            client,
            model=model,
            contents=[build_merge_prompt(parts, options)],
            config=_config(types, MergedReading, max_tokens=MERGE_MAX_TOKENS, thinking="MEDIUM"),
            say=lambda _line: None,
            timeout=MERGE_TIMEOUT_SEC,
        )
        parsed = getattr(response, "parsed", None)
        if parsed is None:
            parsed = MergedReading.model_validate(json.loads(_strip_fences(response.text or "")))
        elif not isinstance(parsed, MergedReading):
            parsed = MergedReading.model_validate(
                parsed.model_dump() if isinstance(parsed, BaseModel) else parsed
            )
    except Exception as exc:                                   # noqa: BLE001
        log.warning("merge failed: %s", exc)
        warnings.append(
            "The parts of this video could not be combined into one account, so the "
            "concept and character sheets are stitched together part by part, and the "
            "master prompt describes the opening part only."
        )
        sheets = _sheets([s for _w, r in parts for s in r.character_sheets])
        return (
            " ".join(r.video_concept for _w, r in parts if r.video_concept),
            " ".join(r.characters_description for _w, r in parts if r.characters_description),
            sheets,
            parts[0][1].master_prompt,
            parts[0][1].master_prompt_json,
            {},
        )

    aliases: dict[str, str] = {}
    for member in parsed.cast:
        name = _text(member.name)
        if not name:
            continue
        aliases[name.casefold()] = name
        for alias in member.aliases:
            if _text(alias):
                aliases[_text(alias).casefold()] = name

    return (
        _text(parsed.video_concept),
        _text(parsed.characters_description),
        _sheets(parsed.character_sheets),
        _text(parsed.master_prompt),
        parsed.master_prompt_json,
        aliases,
    )


async def extract_video(
    client: Any,
    source: Any,
    *,
    duration_sec: float,
    section: Optional[tuple[float, float]] = None,
    options: Optional[ExtractionOptions] = None,
    model: str,
    source_mime_type: str = "video/mp4",
    frame: str = "",
    source_ratio: str = "",
    on_progress: Optional[Callable[[str], None]] = None,
) -> Extraction:
    """
    Watch a video, or a section of one, and write the prompts that recreate it.

    Windows run concurrently. One failing window costs its own shots and a
    warning saying which minutes are missing; only every window failing fails
    the extraction — a person who waited three minutes for a long video is
    better served by eleven parts of twelve than by an error.
    """
    from google.genai import types

    say = on_progress or (lambda _line: None)
    options = options or ExtractionOptions()
    start, end = section or (0.0, duration_sec)
    whole = start <= 0.5 and end >= duration_sec - 0.5

    windows = plan_windows(start, end)
    if not windows:
        raise RuntimeError("The video has no length to analyse.")

    span = end - start
    fps = sampling_fps(span)
    hints = split_shot_count(options.shot_count, windows)
    config = _config(
        types,
        WindowReading,
        max_tokens=WINDOW_MAX_TOKENS,
        thinking="LOW",
        low_media=span > LONG_VIDEO_SEC,
    )
    gate = asyncio.Semaphore(MAX_CONCURRENT_WINDOWS)
    warnings: list[str] = []
    finished = 0

    async def one(index: int, window: tuple[float, float]) -> Optional[WindowReading]:
        nonlocal finished
        label = f"{_clock(window[0])}–{_clock(window[1])}"
        async with gate:
            if len(windows) == 1:
                say("AI is watching your video...")
            else:
                say(f"AI is watching {label} ({finished} of {len(windows)} parts done)...")
            prompt = build_window_prompt(
                options,
                window=window,
                duration_sec=duration_sec,
                part_of=None if (whole and len(windows) == 1) else (start, end),
                frame=frame,
                shots_hint=hints[index],
            )
            response = await _generate_window(
                client,
                model=model,
                contents=[_video_part(types, source, window, source_mime_type, fps), prompt],
                config=config,
                say=lambda _line: say(f"Retrying {label}..."),
                timeout=WINDOW_TIMEOUT_SEC,
            )
        reading, note = parse_reply(response)
        finished += 1
        if note:
            where = "The reading" if len(windows) == 1 else f"The reading of {label}"
            warnings.append(f"{where} {note}.")
        return reading

    results = await asyncio.gather(
        *(one(i, w) for i, w in enumerate(windows)), return_exceptions=True
    )

    parts: list[tuple[tuple[float, float], WindowReading]] = []
    failures: list[str] = []
    for window, result in zip(windows, results):
        if isinstance(result, BaseException) or result is None:
            failures.append(f"{_clock(window[0])}–{_clock(window[1])}")
            if isinstance(result, BaseException):
                log.warning("window %s failed: %s", window, result)
            continue
        parts.append((window, result))

    if not parts:
        reason = next(
            (str(r) for r in results if isinstance(r, BaseException)),
            "every reading came back unusable",
        )
        raise RuntimeError(f"The AI could not read this video: {reason}")
    if failures:
        warnings.append(
            f"These parts could not be read and have no shots: {', '.join(failures)}."
        )

    # ── Shots ──
    shots: list[Shot] = []
    for window, reading in parts:
        checked, no_prompt, bad_timing = check_shots(
            reading.shots, window_start=window[0], window_end=window[1]
        )
        shots.extend(checked)
        where = "" if len(windows) == 1 else f" between {_clock(window[0])} and {_clock(window[1])}"
        if no_prompt:
            warnings.append(
                f"{no_prompt} shot{'' if no_prompt == 1 else 's'}{where} came back with no "
                f"usable prompt and {'was' if no_prompt == 1 else 'were'} left out."
            )
        if bad_timing:
            warnings.append(
                f"{bad_timing} shot{'' if bad_timing == 1 else 's'}{where} came back with "
                f"timings that cannot be right, so {'it has' if bad_timing == 1 else 'they have'} "
                f"no time or thumbnail. The prompts are unaffected."
            )

    if not shots:
        raise RuntimeError("The AI found no shots it could write prompts for in this video.")
    shots = order_shots(shots)

    # ── The whole video ──
    if len(parts) == 1:
        only = parts[0][1]
        concept = only.video_concept
        characters_description = only.characters_description
        sheets = _sheets(only.character_sheets)
        master = only.master_prompt
        master_fields = only.master_prompt_json
        table = _name_table(
            [c.name for c in only.characters] + [s.character_name for s in sheets]
        )
    else:
        concept, characters_description, sheets, master, master_fields, aliases = await _merge(
            client, parts, options=options, model=model, warnings=warnings, say=say
        )
        table = _name_table([s.character_name for s in sheets], aliases)

    for shot in shots:
        shot.characters = canonical(shot.characters, table)

    if not options.character_sheets:
        sheets = []

    # ── Coverage ──
    timed = [s for s in shots if s.start_sec is not None and s.end_sec is not None]
    if timed:
        covered = sum(s.end_sec - s.start_sec for s in timed)
        if covered < MIN_COVERAGE * span and not failures:
            warnings.append(
                f"The shots cover {_clock(covered)} of the {_clock(span)} analysed, so "
                f"some of the video may have no shot."
            )

    flagged = self_addressed(shots)
    if flagged:
        listed = ", ".join(str(n) for n in flagged[:6])
        warnings.append(
            f"In shot{'s' if len(flagged) != 1 else ''} {listed} a character is given a line that "
            f"calls them by their own name, so the speakers — and possibly the names — may be "
            f"swapped. Check who says what before you use the character names."
        )

    say(f"{len(shots)} shots written")

    ratio = options.aspect_ratio if options.aspect_ratio != "source" else source_ratio
    master_json = master_fields.model_dump() if master_fields is not None else None
    if master_json is not None and ratio and not master_json.get("aspect_ratio"):
        master_json["aspect_ratio"] = ratio

    return Extraction(
        video_concept=concept,
        voiceover_text="\n\n".join(
            r.voiceover_text for _w, r in parts if (r.voiceover_text or "").strip()
        ),
        characters_description=characters_description,
        character_sheets=sheets,
        shots=shots,
        master_prompt=master,
        master_prompt_json=master_json,
        duration_sec=round(duration_sec, 2),
        section=None if whole else Section(start_sec=round(start, 2), end_sec=round(end, 2)),
        aspect_ratio=ratio,
        warnings=warnings,
        model=model,
    )
