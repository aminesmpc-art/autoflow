"""
Where the cuts actually are.

The model reads a video at a few frames a second, so a shot boundary it
reports can be off by a frame or several — enough that a thumbnail lands on
the previous shot, or an exported cut list cuts a beat late. A hard cut is
the one thing in a video that is cheap to find exactly: the picture changes
completely from one frame to the next.

So this decodes the video at thumbnail size and marks every frame whose colour
make-up differs sharply from the frame before it. The model's boundaries are
then moved onto the nearest of these, within a tolerance (see
extraction.snap_to_cuts). It runs while the model is reading the same file,
so it costs no wall-clock time.

── What it does not find ────────────────────────────────────────────────────

Dissolves and fades change the picture gradually; no single pair of frames
differs enough to call. Those boundaries keep the model's timing, which is
the right outcome — a soft transition has no single frame to snap to.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

log = logging.getLogger(__name__)

# Small enough to decode a frame's colour in well under a millisecond, large
# enough that a cut between two similar-looking shots still shows.
SAMPLE_SIZE = (64, 36)

# Bhattacharyya distance between consecutive colour histograms: 0 is the same
# picture, 1 is nothing in common. Camera moves and people walking through
# frame stay well under this; a cut to a different shot clears it.
MIN_DISTANCE = 0.35

# And the picture itself must change: the mean per-pixel difference, out of
# 255. Colour alone is not enough — a flat colour dissolving into another
# flips from one histogram bin to the next in a single frame while each pixel
# moves by a few levels. A cut moves most pixels a long way at once.
MIN_PIXEL_CHANGE = 18.0

# A cut must also stand out from the frames around it. Handheld footage of a
# flickering neon street changes a lot every frame without ever cutting.
LOCAL_FACTOR = 3.0
LOCAL_WINDOW = 12

# Two cuts closer than this are one transition seen twice (a flash frame).
MIN_GAP_SEC = 0.3

# Past these lengths every frame is too many to decode in the time the model
# takes; every second or third frame still places a cut within a tenth of a
# second at normal frame rates.
STRIDE_2_AFTER_SEC = 20 * 60
STRIDE_3_AFTER_SEC = 60 * 60


def detect_cuts(
    video_path: str,
    *,
    start_sec: float = 0.0,
    end_sec: Optional[float] = None,
    should_stop: Optional[Callable[[], bool]] = None,
) -> list[float]:
    """Seconds at which a hard cut happens, in order, within [start, end].

    When should_stop turns true, returns the cuts found up to that point
    rather than nothing: the caller stops a long decode once the reading is
    back, and the first hour's cuts still place the first hour's shots.
    """
    import cv2
    import numpy as np

    capture = cv2.VideoCapture(video_path)
    try:
        if not capture.isOpened():
            return []
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
        frames = float(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if fps <= 0:
            return []
        duration = frames / fps if frames > 0 else None
        end = min(end_sec, duration) if (end_sec is not None and duration) else (end_sec or duration)
        span = (end or 0) - start_sec
        stride = 3 if span > STRIDE_3_AFTER_SEC else 2 if span > STRIDE_2_AFTER_SEC else 1

        if start_sec > 0:
            capture.set(cv2.CAP_PROP_POS_MSEC, start_sec * 1000.0)

        distances: list[float] = []
        changes: list[float] = []
        times: list[float] = []
        previous = None
        previous_small = None
        index = 0
        while True:
            if should_stop and index % 100 == 0 and should_stop():
                break
            if not capture.grab():
                break
            index += 1
            if (index - 1) % stride:
                continue
            t = float(capture.get(cv2.CAP_PROP_POS_MSEC) or 0.0) / 1000.0
            if end is not None and t > end:
                break
            ok, frame = capture.retrieve()
            if not ok or frame is None:
                continue
            small = cv2.resize(frame, SAMPLE_SIZE, interpolation=cv2.INTER_AREA)
            hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
            hist = cv2.calcHist([hsv], [0, 1, 2], None, [8, 4, 4], [0, 180, 0, 256, 0, 256])
            cv2.normalize(hist, hist)
            if previous is not None:
                distances.append(float(cv2.compareHist(previous, hist, cv2.HISTCMP_BHATTACHARYYA)))
                changes.append(float(cv2.absdiff(previous_small, small).mean()))
                times.append(t)
            previous = hist
            previous_small = small
    finally:
        capture.release()

    return _pick_cuts(distances, changes, times)


def _pick_cuts(distances: list[float], changes: list[float], times: list[float]) -> list[float]:
    """Frames that differ sharply from the last one — in colour make-up AND in
    pixels — and stand out from what their neighbours usually do."""
    import numpy as np

    cuts: list[float] = []
    for i, d in enumerate(distances):
        if d < MIN_DISTANCE or changes[i] < MIN_PIXEL_CHANGE:
            continue
        lo, hi = max(0, i - LOCAL_WINDOW), min(len(distances), i + LOCAL_WINDOW + 1)
        around = [distances[j] for j in range(lo, hi) if j != i]
        usual = float(np.median(around)) if around else 0.0
        if d < LOCAL_FACTOR * usual:
            continue
        # The frame that differs is the first frame of the new shot; the cut
        # is the boundary just before it.
        t = times[i]
        if cuts and t - cuts[-1] < MIN_GAP_SEC:
            continue
        cuts.append(round(t, 3))
    return cuts


def detect_cuts_quietly(video_path: str, **kwargs) -> list[float]:
    """detect_cuts, or nothing. Never raises: the cuts refine a finished
    reading, and an unusual codec must not fail the extraction they refine."""
    try:
        return detect_cuts(video_path, **kwargs)
    except Exception as exc:                                   # noqa: BLE001
        log.warning("cut detection failed: %s", exc)
        return []
