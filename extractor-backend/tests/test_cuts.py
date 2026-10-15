"""
Finding the cuts, and moving the model's boundaries onto them.

The detector runs for real against a generated video whose cuts are known to
the frame. What it must get right is both halves: every hard cut found within
a frame, and nothing found where the picture only moves or fades.
"""

from __future__ import annotations

import pytest

from app.cuts import detect_cuts
from app.extraction import Shot, snap_to_cuts

FPS = 25.0


@pytest.fixture(scope="module")
def video(tmp_path_factory) -> str:
    """Eight seconds at 25fps:

    0.0–2.0  red with noise, the camera "panning" (a bar sliding across)
    2.0–4.0  blue                                    ← hard cut at 2.0
    4.0–5.0  green                                   ← hard cut at 4.0
    5.0–6.0  green dissolving into yellow           (no hard cut)
    6.0–8.0  textured grey                           ← hard cut at 6.0
    """
    import cv2
    import numpy as np

    rng = np.random.default_rng(7)
    path = str(tmp_path_factory.mktemp("cuts") / "v.mp4")
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (320, 180))
    for i in range(int(8 * FPS)):
        t = i / FPS
        if t < 2.0:
            frame = np.full((180, 320, 3), (30, 30, 200), np.uint8)
            x = int(i * 6) % 320
            frame[:, x:x + 30] = (40, 40, 230)              # a moving highlight
        elif t < 4.0:
            frame = np.full((180, 320, 3), (200, 60, 20), np.uint8)
        elif t < 5.0:
            frame = np.full((180, 320, 3), (40, 190, 40), np.uint8)
        elif t < 6.0:
            a = (t - 5.0) / 1.0
            green, yellow = np.array((40, 190, 40)), np.array((30, 210, 230))
            frame = np.full((180, 320, 3), ((1 - a) * green + a * yellow).astype(np.uint8), np.uint8)
        else:
            frame = rng.integers(90, 140, (180, 320, 3), dtype=np.uint8)
        noise = rng.integers(-6, 6, frame.shape)
        writer.write(np.clip(frame.astype(int) + noise, 0, 255).astype(np.uint8))
    writer.release()
    return path


class TestDetectCuts:
    def test_finds_every_hard_cut_within_a_frame(self, video):
        cuts = detect_cuts(video)
        assert len(cuts) == 3, cuts
        for found, true in zip(cuts, (2.0, 4.0, 6.0)):
            assert abs(found - true) <= 1 / FPS + 1e-6, (found, true)

    def test_ignores_movement_and_dissolves(self, video):
        cuts = detect_cuts(video)
        assert not any(0.1 < c < 1.9 for c in cuts)       # the moving bar
        assert not any(4.1 < c < 5.9 for c in cuts)       # the dissolve

    def test_only_looks_inside_a_section(self, video):
        cuts = detect_cuts(video, start_sec=3.0, end_sec=7.0)
        assert len(cuts) == 2
        assert all(3.0 <= c <= 7.0 for c in cuts)

    def test_a_file_that_is_not_a_video_has_no_cuts(self, tmp_path):
        path = tmp_path / "x.mp4"
        path.write_bytes(b"\x00" * 1024)
        assert detect_cuts(str(path)) == []

    def test_stops_when_asked(self, video):
        assert detect_cuts(video, should_stop=lambda: True) == []

    def test_a_stop_keeps_the_cuts_found_so_far(self, video):
        # Asked at frame 0 (no) and frame 100 (yes): four seconds decoded.
        answers = iter([False, True])
        cuts = detect_cuts(video, should_stop=lambda: next(answers, True))
        assert len(cuts) == 1 and abs(cuts[0] - 2.0) <= 1 / FPS + 1e-6


class TestSnapToCuts:
    def shots(self, *spans):
        return [Shot(shot_id=0, image_prompt="x" * 20, start_sec=a, end_sec=b) for a, b in spans]

    def test_boundaries_land_on_nearby_cuts(self):
        shots, moved = snap_to_cuts(self.shots((0.0, 2.4), (2.4, 4.3), (4.3, 8.0)), [2.0, 4.0, 6.0])
        assert [(s.start_sec, s.end_sec) for s in shots] == [(0.0, 2.0), (2.0, 4.0), (4.0, 8.0)]
        assert moved == 3
        assert shots[1].time_range == "00:02.0 - 00:04.0"

    def test_a_boundary_far_from_any_cut_keeps_the_models_timing(self):
        shots, moved = snap_to_cuts(self.shots((0.0, 3.0), (3.0, 8.0)), [2.0, 6.0])
        assert [(s.start_sec, s.end_sec) for s in shots] == [(0.0, 3.0), (3.0, 8.0)]
        assert moved == 0

    def test_never_collapses_a_shot_onto_one_cut(self):
        # Both ends of the middle shot are near the same cut.
        shots, _moved = snap_to_cuts(self.shots((0.0, 1.8), (1.8, 2.3), (2.3, 5.0)), [2.0])
        middle = shots[1]
        assert middle.end_sec - middle.start_sec >= 0.2

    def test_untimed_shots_are_left_alone_and_kept_in_place(self):
        shots = self.shots((0.0, 2.3), (2.3, 4.0))
        shots.insert(1, Shot(shot_id=0, image_prompt="untimed"))
        snapped, _moved = snap_to_cuts(shots, [2.0])
        assert [s.image_prompt for s in snapped][1] == "untimed"
        assert snapped[0].end_sec == 2.0 and snapped[2].start_sec == 2.0

    def test_no_cuts_changes_nothing(self):
        shots = self.shots((0.0, 2.3))
        assert snap_to_cuts(shots, []) == (shots, 0)
