"""
Picking the speaker out of a frame.

The numbers in these tests are not invented. They were read off YuNet's own
output on a real still — a woman holding a serum bottle up to a bathroom
mirror, so the frame contains the back of her head on the left and her
reflection, facing camera, on the right:

                          centre   size    score   eye gap   nose between
  her reflection           0.714   0.160    0.95     0.455       0.24
  the back of her head     0.253   0.133    0.84     0.027       7.82
  a picture on the wall    0.652   0.121    0.79     0.169       0.27

Picking the largest box gets this wrong, and got it wrong in production: the
back of a head is a bigger box than a reflection, so the crop followed the back
of her head and the shot the viewer actually sees left the frame. That single
shot took the mean error across the clip from 0.009 to 0.091.
"""

from __future__ import annotations

import os

import pytest

from app.face_track import (
    FaceTrackingUnavailable,
    MODEL_PATH,
    _frontality,
    _pick,
    track_faces,
)


def a_face(*, centre: float, size: float, score: float, eye_gap: float,
           nose_between: float, frame_width: int = 640):
    """A YuNet detection, built from the numbers a viewer could check.

    The layout is the detector's own: box, then five landmark pairs — right
    eye, left eye, nose, right mouth corner, left mouth corner — then score.
    """
    fw = size * frame_width
    x = centre * frame_width - fw / 2
    right_eye = x + fw * 0.3
    span = eye_gap * fw
    left_eye = right_eye + span
    nose = right_eye + nose_between * span
    return [
        x, 100.0, fw, fw,
        right_eye, 120.0,
        left_eye, 120.0,
        nose, 140.0,
        x + fw * 0.35, 160.0,
        x + fw * 0.65, 160.0,
        score,
    ]


REFLECTION = dict(centre=0.714, size=0.160, score=0.95, eye_gap=0.455, nose_between=0.24)
BACK_OF_HEAD = dict(centre=0.253, size=0.133, score=0.84, eye_gap=0.027, nose_between=7.82)
WALL_PICTURE = dict(centre=0.652, size=0.121, score=0.79, eye_gap=0.169, nose_between=0.27)


class TestFrontality:
    def test_a_face_looking_at_the_camera_scores_well(self):
        assert _frontality(a_face(**REFLECTION)) > 0.2

    def test_a_head_turned_away_scores_nothing(self):
        """Eyes bunched together and a nose nowhere near between them."""
        assert _frontality(a_face(**BACK_OF_HEAD)) == pytest.approx(0.0, abs=1e-6)

    def test_something_on_a_wall_scores_between_the_two(self):
        front = _frontality(a_face(**WALL_PICTURE))
        assert 0 < front < _frontality(a_face(**REFLECTION))

    def test_a_box_with_no_width_is_not_a_face(self):
        face = a_face(**REFLECTION)
        face[2] = 0.0
        assert _frontality(face) == 0.0


class TestPickingTheSpeaker:
    def test_prefers_the_reflection_over_the_larger_back_of_a_head(self):
        """The regression this whole module exists to avoid."""
        best, weight = _pick([a_face(**BACK_OF_HEAD), a_face(**REFLECTION)], 640)
        centre = (best[0] + best[2] / 2) / 640
        assert centre == pytest.approx(0.714, abs=0.01)
        assert weight > 0

    def test_order_does_not_decide_it(self):
        for faces in (
            [a_face(**REFLECTION), a_face(**BACK_OF_HEAD)],
            [a_face(**BACK_OF_HEAD), a_face(**REFLECTION)],
        ):
            best, _ = _pick(faces, 640)
            assert (best[0] + best[2] / 2) / 640 == pytest.approx(0.714, abs=0.01)

    def test_prefers_a_real_face_over_a_picture_on_the_wall(self):
        best, _ = _pick([a_face(**WALL_PICTURE), a_face(**REFLECTION)], 640)
        assert (best[0] + best[2] / 2) / 640 == pytest.approx(0.714, abs=0.01)

    def test_size_only_breaks_ties_between_faces_that_both_look_at_you(self):
        """A closer speaker wins over a further one, all else equal — but only
        when both are actually facing the camera."""
        near = a_face(centre=0.3, size=0.25, score=0.9, eye_gap=0.45, nose_between=0.5)
        far = a_face(centre=0.7, size=0.10, score=0.9, eye_gap=0.45, nose_between=0.5)
        best, _ = _pick([far, near], 640)
        assert (best[0] + best[2] / 2) / 640 == pytest.approx(0.3, abs=0.01)

    def test_returns_nothing_when_no_detection_looks_like_a_face(self):
        best, weight = _pick([a_face(**BACK_OF_HEAD)], 640)
        assert best is None and weight == 0.0

    def test_returns_nothing_for_an_empty_frame(self):
        assert _pick([], 640) == (None, 0.0)


class TestTracking:
    def test_the_model_is_bundled(self):
        """It is 232KB and committed on purpose. Downloading it at boot would
        make face tracking depend on the network, on a server whose whole job
        is to avoid asking anything twice."""
        assert os.path.exists(MODEL_PATH)

    def test_says_so_rather_than_crashing_on_something_that_is_not_a_video(self, tmp_path):
        junk = tmp_path / "notes.txt"
        junk.write_text("hello")
        with pytest.raises(FaceTrackingUnavailable):
            track_faces(str(junk))

    def test_says_so_when_the_file_is_not_there(self, tmp_path):
        with pytest.raises(FaceTrackingUnavailable):
            track_faces(str(tmp_path / "missing.mp4"))

    def test_reports_nothing_rather_than_a_centre_for_frames_with_nobody_in_them(
        self, tmp_path
    ):
        """A placeholder at 0.5 would be indistinguishable from a speaker
        standing in the middle, and would drag a crop onto empty background."""
        cv2 = pytest.importorskip("cv2")
        import numpy as np

        path = str(tmp_path / "blank.mp4")
        writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (320, 240))
        for _ in range(20):
            writer.write(np.zeros((240, 320, 3), dtype=np.uint8))
        writer.release()

        assert track_faces(path) == []
