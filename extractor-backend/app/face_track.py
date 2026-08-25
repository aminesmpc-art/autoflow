"""
Where the speaker is, frame by frame, without asking a model.

── Why this exists ───────────────────────────────────────────────────────

Framing a vertical clip means knowing where the person talking is across the
frame. Three ways to learn that were measured on the same forty seconds — ten
stills of a woman talking to camera, held four seconds each:

  the whole-video reading   8 scenes, 0 carrying a position
  a dedicated model ask     right, and 18.6 seconds per clip
  this                      agrees with the ask to 0.009 of frame width,
                            at 14.8 ms per frame

The reading simply does not answer: a null speaker_x turned out to mean "I did
not say", not "nobody is on camera", and believing otherwise left every clip
letterboxed on a blurred backdrop instead of cropped onto the speaker.

The model ask is accurate but costs a round trip per clip and returns eight
points. This returns two per second for the whole video, once, alongside the
read that was happening anyway — so a nine-clip run pays nothing extra and gets
a track dense enough to follow a person who moves.

── Picking the right face ────────────────────────────────────────────────

The largest box is not the speaker. Measured on a mirror shot, the largest was
the BACK of the speaker's head while the shot everyone actually sees is her
reflection; on another frame it was a picture hanging on the wall. What
separates them is geometry the detector already returns:

                          eye gap   nose between eyes   frontality
  her reflection (right)    0.455        0.24              0.219
  back of her head (left)   0.027        7.82              0.000
  a picture on the wall     0.169        0.27              0.090

A face turned away has its eyes bunched together and its nose nowhere near
between them. Weighting by frontality took the mean error from 0.091 to 0.009
and left the worst frame at 0.026.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Callable, Optional

MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "face_detection_yunet_2023mar.onnx")

# Two per second. Dense enough to follow someone crossing the frame, sparse
# enough that a twenty minute video costs about half a minute of CPU — which is
# spent while the model is reading the same file, so it lands for free.
SAMPLE_FPS = 2.0

# A ceiling on work, not on quality. A very long upload otherwise scales
# without bound; past this the sampling thins out instead.
MAX_SAMPLES = 4000

# Detection runs on a downscaled copy. A face worth cropping to is a large
# fraction of the frame, so 640 wide loses nothing and a 4K source stops
# costing sixteen times as much as a 1080p one.
DETECT_WIDTH = 640

# Below this the detector is guessing. Kept lower than the default because a
# re-encoded frame is softer than the still it came from, and a missed face is
# worse than a weak one — a weak one still gets weighted down by frontality.
SCORE_THRESHOLD = 0.5


@dataclass
class FacePoint:
    """One sample of where the speaker is."""
    t: float
    """Centre of the face across the frame, 0 at the left edge and 1 at the right."""
    x: float
    """Face width as a fraction of frame width — how close they are to camera."""
    size: float
    """How much this looked like a person facing the camera. See the header."""
    weight: float


def _frontality(face) -> float:
    """
    How much a detection looks like a face turned towards the camera.

    YuNet returns five landmarks after the box: right eye, left eye, nose, and
    the two mouth corners. Two things fall out of them cheaply:

      eye gap   how far apart the eyes are relative to the box. A profile
                bunches them together; a rear view collapses them entirely.
      nose      where the nose sits along the span between the eyes. Dead
                centre is a face looking at you; outside the span at all is a
                head turned away.
    """
    fw = float(face[2])
    if fw <= 0:
        return 0.0
    right_eye_x, left_eye_x, nose_x = float(face[4]), float(face[6]), float(face[8])

    eye_gap = abs(left_eye_x - right_eye_x) / fw

    lo, hi = min(right_eye_x, left_eye_x), max(right_eye_x, left_eye_x)
    span = max(hi - lo, 1e-6)
    between = (nose_x - lo) / span
    centred = 1.0 - min(1.0, abs(between - 0.5) * 2.0)

    return eye_gap * centred


def _pick(faces, frame_width: int):
    """
    The face a viewer would call the speaker, or None.

    Frontality decides, confidence confirms, and size only breaks ties — the
    square root keeps a big turned-away head from beating a smaller face that
    is actually looking at the camera, which is exactly the mirror case.
    """
    best, best_weight = None, 0.0
    for face in faces:
        weight = (
            float(face[-1])
            * _frontality(face)
            * math.sqrt(max(float(face[2]), 0.0) / max(frame_width, 1))
        )
        if weight > best_weight:
            best, best_weight = face, weight
    return best, best_weight


class FaceTrackingUnavailable(RuntimeError):
    """OpenCV or the detector model is missing on this server.

    Its own type because the caller must carry on without a track rather than
    fail the reading: face tracking is an improvement to framing, and a read
    that returns words and scenes but no track is still a useful read.
    """


def track_faces(
    video_path: str,
    on_progress: Optional[Callable[[str], None]] = None,
    sample_fps: float = SAMPLE_FPS,
) -> list[FacePoint]:
    """
    Sample the video and report where the speaker is in each sampled frame.

    Frames with nobody in them are simply absent from the result rather than
    recorded as a position — the caller needs to tell "no face here" from "a
    face at the middle", and a placeholder would erase that difference and drag
    a crop to the centre of frames where the speaker was off to one side.
    """
    try:
        import cv2                                             # noqa: PLC0415
    except ImportError as exc:                                 # pragma: no cover
        raise FaceTrackingUnavailable("opencv is not installed on this server") from exc

    if not os.path.exists(MODEL_PATH):
        raise FaceTrackingUnavailable("the face detection model is not on this server")

    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        raise FaceTrackingUnavailable("this video could not be opened for face tracking")

    try:
        fps = capture.get(cv2.CAP_PROP_FPS) or 0.0
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

        if not (fps > 0 and width > 0 and height > 0):
            raise FaceTrackingUnavailable("this video reports no usable dimensions")

        step = max(1, int(round(fps / max(sample_fps, 0.1))))
        if total > 0:
            expected = total / step
            if expected > MAX_SAMPLES:
                # Thin out rather than stop early: half a long video tracked
                # densely is worse than all of it tracked a little coarsely.
                step = max(step, int(math.ceil(total / MAX_SAMPLES)))

        scale = min(1.0, DETECT_WIDTH / float(width))
        dw, dh = max(1, int(width * scale)), max(1, int(height * scale))

        detector = cv2.FaceDetectorYN.create(
            MODEL_PATH, "", (dw, dh), score_threshold=SCORE_THRESHOLD
        )

        out: list[FacePoint] = []
        index = 0
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if index % step == 0:
                small = cv2.resize(frame, (dw, dh)) if scale < 1.0 else frame
                _, faces = detector.detect(small)
                if faces is not None and len(faces):
                    best, weight = _pick(faces, dw)
                    if best is not None and weight > 0:
                        out.append(
                            FacePoint(
                                t=index / fps,
                                x=min(1.0, max(0.0, (float(best[0]) + float(best[2]) / 2) / dw)),
                                size=min(1.0, max(0.0, float(best[2]) / dw)),
                                weight=round(weight, 4),
                            )
                        )
                if on_progress and len(out) and len(out) % 500 == 0:
                    on_progress(f"tracked {len(out)} faces")
            index += 1

        return out
    finally:
        capture.release()
