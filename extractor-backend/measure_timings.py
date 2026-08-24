"""
Does the model actually know WHEN things were said?

Everything built on top of the reading assumes it does. If the timings are
good, a clip is cut without asking anything; if they are not, every cut falls
back to locating from the audio and the only thing gained is the transcript.
That is a measurement, not an opinion, and this is the measurement.

It matters because the number this replaces was measured the other way: asked
to timestamp a long recording through a CHAT, with audio attached, the model
answered confidently and wrongly — fine at 289 seconds, badly off at 400, and
at 728 it produced an evenly spaced arithmetic sequence it had invented. Native
video through the API is a different path and may be far better. This says by
how much, on your video, rather than assuming either way.

    set GEMINI_API_KEY=...
    .venv\\Scripts\\python.exe measure_timings.py "C:\\path\\to\\video.mp4" 1228.4

Add known lines and their real seconds to GROUND_TRUTH below and it will score
itself against them. With none, it still reports whether the reading looks
sane: how much was dropped, whether the phrases march forward in time, and
whether the speech rate is one a human could produce.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from app.clip_analysis import CLIP_MODEL


# Lines whose real position is already known, from cutting this video by hand.
# The two below are from the MrBeast escape video, located by the extension's
# two-stage narrowing and then snapped to a real pause in the audio.
GROUND_TRUTH: list[tuple[str, float]] = [
    ("Look at these straw bales right here", 83.13),
    ("Start the timer", 9.43),
]

TOLERANCE_SEC = 2.0


def words(text: str) -> list[str]:
    import re

    return re.sub(r"[^a-z0-9 ]+", " ", text.lower()).split()


def find_line(segments, needle: str):
    """Where a known line starts, by matching words across segment edges."""
    stream: list[tuple[str, float]] = []
    for seg in segments:
        for w in words(seg.text):
            stream.append((w, seg.start))

    target = words(needle)
    if not target:
        return None
    for i in range(len(stream) - len(target) + 1):
        if [w for w, _ in stream[i : i + len(target)]] == target:
            return stream[i][1]
    return None


async def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2

    video = Path(sys.argv[1])
    duration = float(sys.argv[2])
    if not video.exists():
        print(f"No such file: {video}")
        return 2

    if not os.getenv("GEMINI_API_KEY"):
        print("Set GEMINI_API_KEY first — this calls the real model.")
        return 2

    from google import genai
    from app.clip_analysis import read_video

    print(f"Reading {video.name} ({duration:.0f}s) with {CLIP_MODEL}…")
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    uploaded = client.files.upload(file=video)
    import time

    while getattr(uploaded.state, "name", str(uploaded.state)) == "PROCESSING":
        time.sleep(2)
        uploaded = client.files.get(name=uploaded.name)

    started = time.time()
    reading = await read_video(
        client, uploaded, duration, on_progress=lambda line: print(f"  · {line}")
    )
    elapsed = time.time() - started

    print()
    print(f"read in {elapsed:.1f}s")
    print(f"{len(reading.segments)} phrases, {len(reading.scenes)} scenes")
    words_total = sum(len(s.text.split()) for s in reading.segments)
    print(f"{words_total} words = {words_total / duration * 60:.0f} wpm")
    print(f"{sum(1 for s in reading.scenes if s.speaker_x is not None)} scenes place the speaker")

    if reading.dropped:
        print(f"\ndropped {len(reading.dropped)}:")
        for line in reading.dropped[:10]:
            print(f"  - {line}")

    # Does time run forwards, and is anything a duplicate?
    out_of_order = sum(
        1 for a, b in zip(reading.segments, reading.segments[1:]) if b.start < a.start
    )
    print(f"\nout of order: {out_of_order}")

    # THE test: the evenly spaced arithmetic sequence that gave the game away
    # last time. Real speech does not arrive on a metronome.
    gaps = [b.start - a.start for a, b in zip(reading.segments, reading.segments[1:])]
    if len(gaps) > 5:
        mean = sum(gaps) / len(gaps)
        var = sum((g - mean) ** 2 for g in gaps) / len(gaps)
        sd = var ** 0.5
        print(f"gap between phrases: mean {mean:.2f}s, sd {sd:.2f}s")
        if sd < 0.05:
            print("  !! evenly spaced — this is a pattern, not a measurement")

    if GROUND_TRUTH:
        print("\nagainst known positions:")
        hits = 0
        for line, real in GROUND_TRUTH:
            found = find_line(reading.segments, line)
            if found is None:
                print(f'  MISSING  "{line[:44]}"  (expected {real:.2f}s)')
                continue
            delta = found - real
            ok = abs(delta) <= TOLERANCE_SEC
            hits += ok
            print(
                f'  {"OK  " if ok else "OFF "}     "{line[:44]}"  '
                f"got {found:.2f}s, expected {real:.2f}s, out by {delta:+.2f}s"
            )
        print(f"\n{hits}/{len(GROUND_TRUTH)} within {TOLERANCE_SEC}s")
        if hits == len(GROUND_TRUTH):
            print("Timings are good enough to cut from without asking.")
        else:
            print("Not good enough to cut from. Cuts will fall back to locating,")
            print("which still works — the transcript is the win, not the timings.")

    try:
        client.files.delete(name=uploaded.name)
    except Exception:                                          # noqa: BLE001
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
