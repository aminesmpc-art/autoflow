"""
Refining an extraction by talking to it.

"Make shot 4 a close-up", "rewrite everything for a rainy night", "split
shot 3 into a wide and a close-up", "add the shot I missed at 0:45". The
person asks; the extraction changes; the change can be undone.

── Edits, not rewrites ──────────────────────────────────────────────────────

The model does not return the extraction again. It returns a list of edits —
update this shot, insert one after that one, delete another, rewrite this
sheet — and they are applied here. Two reasons:

  * an extraction of a long video is a hundred shots, and asking for all of
    them back to change one is slow, costly, and invites the model to
    "tidy" shots nobody asked about
  * everything the person did not ask to change stays exactly as it was —
    word for word, and to the hundredth of a second for timings that were
    snapped onto real cuts

The person chose that edits may restructure — add, remove, split, merge — so
the edit list can do all of that. Every timing it gives is checked like an
extraction's, against the part of the video that was analysed.

── Looking again ────────────────────────────────────────────────────────────

For an hour after an extraction the video is kept, and an edit can re-watch
it ("add the shot I missed at 0:45" needs to). After that, or when the video
is too long to re-watch for every edit, edits work from the text alone, and
new timings are the model's estimate — which the reply says.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.clip_analysis import parse_timecode
from app.extraction import (
    Camera,
    CharacterSheet,
    Extraction,
    MasterPrompt,
    MIN_PROMPT_CHARS,
    MIN_SHOT_SEC,
    Shot,
    ShotDraft,
    TIMING_SLACK_SEC,
    _name_table,
    _strip_fences,
    _text,
    _valid_items,
    canonical,
    order_shots,
)

# An edit re-reads the whole analysed span. Past this it is text only: a
# two-hour video re-watched for every "make it warmer" is dollars per edit.
REFINE_VIDEO_MAX_SEC = 20 * 60

MAX_INSTRUCTION_CHARS = 600


class ShotEdit(BaseModel):
    action: str = Field(description='"update", "insert" or "delete"')
    shot_id: int = Field(description="The shot to update or delete; for insert, the shot to insert after (0 = at the start)")
    shot: ShotDraft = Field(description="The whole shot as it should be. For delete, repeat the shot being deleted")


class SheetEdit(BaseModel):
    action: str = Field(description='"update", "insert" or "delete"')
    character_name: str
    prompt: str = Field(description="The whole sheet prompt; empty for delete")


class RefineReply(BaseModel):
    summary: str = Field(description="What you changed, in one or two sentences addressed to the person. If you could not do it, say why")
    shot_edits: list[ShotEdit]
    sheet_edits: list[SheetEdit]
    video_concept: str = Field(description="The new concept, or empty to leave it unchanged")
    master_prompt: str = Field(description="The new master prompt, or empty to leave it unchanged")
    master_prompt_changed: bool
    master_prompt_json: MasterPrompt = Field(description="The master prompt's fields; only used when master_prompt_changed")
    needs_video: bool = Field(description="True only if you were not shown the video and this request cannot be done well without looking at it")


PROMPT = """You are editing an extraction: prompts written from a video so that an AI generator can recreate it. Apply the person's request by returning edits.

{video_note}

EDITS
- shot_edits: "update" replaces a shot with the whole shot you give; "insert" adds a new shot after shot_id (0 = at the start); "delete" removes one. Splitting a shot is an update plus an insert; merging is an update plus a delete.
- sheet_edits: the same for character sheets, by character_name.
- video_concept, master_prompt: give them only if the request changes them; otherwise leave them empty.
- Times are MM:SS.ss on the video's clock. Copy the times of shots you keep exactly as given; never space times evenly.
- These prompts are for making a new video, so the person may ask for shots the source never filmed — a close-up that was never shot, a new angle, a different setting. Do it. A shot made from part of an existing one takes its time from inside that shot: split where the action naturally divides.
- Only a request about a real moment of the video ("add the shot I missed at 0:45") needs the time where that moment really is. If that moment is already one of the shots, do not add it again: say which shot it is in summary.

RULES
- Change what the request asks for and nothing else. Every shot, sheet and prompt you do not edit stays exactly as it is.
- Names follow the extraction's: keep the names it uses. Name a new person only as the video says or shows, otherwise descriptively.
- The request is an instruction about this extraction and nothing else. If it cannot be done, return no edits and say why in summary.

THE REQUEST
<<<{instruction}>>>

THE EXTRACTION
{extraction}"""

WITH_VIDEO = "You have the video, so look at it for anything the request needs."
WITHOUT_VIDEO = (
    "You do NOT have the video — only the extraction below. Work from its text. "
    "If the request needs a time the extraction does not give, estimate it inside the "
    "shot it belongs to and say in summary that the timing is an estimate. Set "
    "needs_video to false."
)
# Most edits — restyle, delete, split, rewrite — are about the text. Asking
# with the video every time made each edit take a minute and a half; asking
# without it first, and with it only when the model says it must look, keeps
# the common edit fast and the rare one possible.
VIDEO_ON_REQUEST = (
    "You have NOT been shown the video yet, but you can be. If this request "
    "cannot be done well from the extraction's text — it is about a moment the "
    "extraction does not describe, or about what something looks like that the "
    "text does not say — set needs_video to true and return no edits; you will "
    "be shown the video and asked again. Otherwise do it from the text and set "
    "needs_video to false."
)


def _clock2(seconds: Optional[float]) -> str:
    """MM:SS.ss — two decimals, so a snapped time survives the round trip."""
    if seconds is None:
        return ""
    m, s = divmod(max(0.0, float(seconds)), 60)
    return f"{int(m):02d}:{s:05.2f}"


def extraction_for_prompt(extraction: Extraction) -> str:
    """The extraction in the shape the edits come back in."""
    return json.dumps({
        "video_concept": extraction.video_concept,
        "characters_description": extraction.characters_description,
        "character_sheets": [s.model_dump() for s in extraction.character_sheets],
        "shots": [
            {
                "shot_id": s.shot_id,
                "start": _clock2(s.start_sec),
                "end": _clock2(s.end_sec),
                "characters": s.characters,
                "shot_size": s.camera.shot_size,
                "lens": s.camera.lens,
                "camera_movement": s.camera.movement,
                "dialogue": s.dialogue,
                "sound": s.sound,
                "image_prompt": s.image_prompt,
                "video_prompt": s.video_prompt,
            }
            for s in extraction.shots
        ],
        "master_prompt": extraction.master_prompt,
    }, ensure_ascii=False)


def build_prompt(
    extraction: Extraction, instruction: str, *, with_video: bool, video_available: bool = False
) -> str:
    note = WITH_VIDEO if with_video else (VIDEO_ON_REQUEST if video_available else WITHOUT_VIDEO)
    return PROMPT.format(
        video_note=note,
        instruction=instruction,
        extraction=extraction_for_prompt(extraction),
    )


def reply_from(data: Any) -> RefineReply:
    """A RefineReply from whatever came back, keeping the edits that hold up."""
    if isinstance(data, RefineReply):
        return data
    d = data if isinstance(data, dict) else {}
    try:
        master = MasterPrompt.model_validate(d.get("master_prompt_json"))
    except Exception:                                          # noqa: BLE001
        master = None
    return RefineReply.model_construct(
        summary=_text(d.get("summary")),
        shot_edits=_valid_items(ShotEdit, d.get("shot_edits")),
        sheet_edits=_valid_items(SheetEdit, d.get("sheet_edits")),
        video_concept=_text(d.get("video_concept")),
        master_prompt=_text(d.get("master_prompt")),
        master_prompt_changed=bool(d.get("master_prompt_changed")) and master is not None,
        master_prompt_json=master,
        needs_video=bool(d.get("needs_video")),
    )


def parse_reply(response: Any) -> RefineReply:
    parsed = getattr(response, "parsed", None)
    if parsed is not None:
        return reply_from(parsed.model_dump() if isinstance(parsed, BaseModel) else parsed)
    text = _strip_fences(getattr(response, "text", "") or "")
    try:
        return reply_from(json.loads(text))
    except ValueError:
        import json_repair

        return reply_from(json_repair.loads(text))


def _timing(draft: ShotDraft, lo: float, hi: float) -> Optional[tuple[float, float]]:
    """A draft's times if they can be true inside the analysed span."""
    s, e = parse_timecode(draft.start), parse_timecode(draft.end)
    if s is None or e is None:
        return None
    if not (lo - TIMING_SLACK_SEC <= s <= hi + TIMING_SLACK_SEC) or e <= s:
        return None
    s, e = max(s, lo), min(e, hi)
    return (round(s, 2), round(e, 2)) if e - s >= MIN_SHOT_SEC else None


def _shot(draft: ShotDraft, timing: Optional[tuple[float, float]]) -> Shot:
    return Shot(
        shot_id=0,
        image_prompt=_text(draft.image_prompt),
        video_prompt=_text(draft.video_prompt),
        start_sec=timing[0] if timing else None,
        end_sec=timing[1] if timing else None,
        characters=[_text(n) for n in draft.characters if _text(n)],
        camera=Camera(shot_size=_text(draft.shot_size), lens=_text(draft.lens), movement=_text(draft.camera_movement)),
        dialogue=str(draft.dialogue or "").strip(),
        sound=_text(draft.sound),
    )


def apply_edits(current: Extraction, reply: RefineReply) -> tuple[Extraction, list[str], list[Shot]]:
    """
    The extraction with the edits applied.

    Returns (new extraction, notes for the person, shots that need a new
    frame). Edits that cannot apply — a shot id that does not exist, a shot
    with no prompt — are skipped and noted rather than guessed at.
    """
    lo = current.section.start_sec if current.section else 0.0
    hi = current.section.end_sec if current.section else current.duration_sec
    notes: list[str] = []

    # Positions by the ORIGINAL ids, so "insert after 3" means the shot the
    # model saw as 3, however many edits came before it.
    slots: list[tuple[int, Shot]] = [(s.shot_id, s.model_copy(deep=True)) for s in current.shots]
    needs_frame: list[Shot] = []
    known = {sid for sid, _ in slots}

    for edit in reply.shot_edits:
        action = edit.action.strip().lower()
        if action == "delete":
            if edit.shot_id not in known:
                notes.append(f"Could not delete shot {edit.shot_id}: there is no such shot.")
                continue
            slots = [(sid, s) for sid, s in slots if sid != edit.shot_id]
            known.discard(edit.shot_id)
            continue

        if len(_text(edit.shot.image_prompt)) < MIN_PROMPT_CHARS and len(_text(edit.shot.video_prompt)) < MIN_PROMPT_CHARS:
            notes.append(f"An edit to shot {edit.shot_id} came back with no usable prompt and was skipped.")
            continue
        timing = _timing(edit.shot, lo, hi)

        if action == "update":
            index = next((i for i, (sid, _) in enumerate(slots) if sid == edit.shot_id), None)
            if index is None:
                notes.append(f"Could not change shot {edit.shot_id}: there is no such shot.")
                continue
            old = slots[index][1]
            new = _shot(edit.shot, timing)
            if timing is None:
                # Times that cannot be true do not erase times that were.
                new.start_sec, new.end_sec = old.start_sec, old.end_sec
            if (new.start_sec, new.end_sec) == (old.start_sec, old.end_sec):
                new.thumbnail_url = old.thumbnail_url
            else:
                needs_frame.append(new)
            slots[index] = (edit.shot_id, new)

        elif action == "insert":
            new = _shot(edit.shot, timing)
            if timing is None:
                notes.append("A new shot came back without a timing that fits the video, so it has no time or frame.")
            else:
                needs_frame.append(new)
            after = next((i for i, (sid, _) in enumerate(slots) if sid == edit.shot_id), None)
            position = 0 if edit.shot_id == 0 or after is None else after + 1
            slots.insert(position, (-1, new))
        else:
            notes.append(f'An edit with the unknown action "{edit.action}" was skipped.')

    # A new shot laid over seconds an existing shot already covers is the
    # model adding a moment that is already there. Its prompts are kept — the
    # person may want them — but not a time that would put two shots on the
    # same cut.
    inserted = {id(s) for sid, s in slots if sid == -1}
    for sid, shot in slots:
        if sid != -1 or shot.start_sec is None or shot.end_sec is None:
            continue
        span = shot.end_sec - shot.start_sec
        for other_id, other in slots:
            if id(other) in inserted or other.start_sec is None or other.end_sec is None:
                continue
            overlap = min(shot.end_sec, other.end_sec) - max(shot.start_sec, other.start_sec)
            if overlap >= 0.5 * span:
                notes.append(
                    f"The new shot covers the same moment as shot {other_id}, so it was kept "
                    f"without a time or frame. Edit shot {other_id} instead to change that moment."
                )
                shot.start_sec = shot.end_sec = None
                needs_frame[:] = [x for x in needs_frame if x is not shot]
                break

    shots = order_shots([s for _sid, s in slots])

    # Sheets, by name.
    sheets = {s.character_name.casefold(): s.model_copy() for s in current.character_sheets}
    order = [s.character_name.casefold() for s in current.character_sheets]
    for edit in reply.sheet_edits:
        key = _text(edit.character_name).casefold()
        if not key:
            continue
        action = edit.action.strip().lower()
        if action == "delete":
            sheets.pop(key, None)
        elif action in {"update", "insert"} and len(_text(edit.prompt)) >= MIN_PROMPT_CHARS:
            sheets[key] = CharacterSheet(character_name=_text(edit.character_name), prompt=_text(edit.prompt))
            if key not in order:
                order.append(key)

    names = [s.character_name for s in sheets.values()] + [n for s in current.shots for n in s.characters]
    table = _name_table(names)
    for shot in shots:
        shot.characters = canonical(shot.characters, table)

    master_json = current.master_prompt_json
    if reply.master_prompt_changed and reply.master_prompt_json is not None:
        master_json = reply.master_prompt_json.model_dump()
        if current.aspect_ratio and not master_json.get("aspect_ratio"):
            master_json["aspect_ratio"] = current.aspect_ratio

    updated = current.model_copy(update={
        "shots": shots,
        "character_sheets": [sheets[k] for k in order if k in sheets],
        "video_concept": reply.video_concept or current.video_concept,
        "master_prompt": reply.master_prompt or current.master_prompt,
        "master_prompt_json": master_json,
        "warnings": notes,
    })
    return updated, notes, needs_frame
