/**
 * Finding the pause to cut on.
 *
 * Every signal here is built by hand, so the answer is known exactly rather
 * than judged by ear. That matters more than usual for this file: a snap that
 * lands 200ms out still "works" on every clip you happen to try, and the only
 * thing that catches it is a fixture whose pause is at a number you wrote.
 *
 * The behaviour worth defending is not that it finds a pause — it is that it
 * REFUSES to when there isn't one. A snapper that always moves the cut
 * somewhere plausible is worse than none, because the cut is then wrong and
 * confident instead of wrong and honest.
 */

import { energyProfile, snapToSilence } from '../studio/media/silence';

const RATE = 16000;

/** Deterministic pseudo-noise. Math.random would make failures unrepeatable. */
function noise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

/**
 * Build mono PCM from a script of segments.
 * `level` 0 is silence; 0.3 is ordinary speech; 0.02 is room tone.
 */
function build(segments: Array<{ sec: number; level: number }>, seed = 7): Float32Array {
  const rnd = noise(seed);
  const total = Math.round(segments.reduce((a, s) => a + s.sec, 0) * RATE);
  const out = new Float32Array(total);
  let i = 0;
  for (const seg of segments) {
    const n = Math.round(seg.sec * RATE);
    for (let k = 0; k < n && i < total; k++, i++) out[i] = rnd() * seg.level;
  }
  return out;
}

/** speech · pause · speech, with the pause at a time we choose. */
const withPause = (beforeSec: number, pauseSec: number, afterSec: number, floor = 0.0) =>
  build([
    { sec: beforeSec, level: 0.3 },
    { sec: pauseSec, level: floor },
    { sec: afterSec, level: 0.3 },
  ]);

/* ------------------------------------------------------------------ */

describe('the energy profile', () => {
  it('gives one window per slice of audio', () => {
    const p = energyProfile(build([{ sec: 1, level: 0.3 }]), RATE, 20);
    expect(p.length).toBe(50);
  });

  it('reads near zero through silence and clearly above it through speech', () => {
    const p = energyProfile(withPause(0.5, 0.5, 0.5), RATE, 20);
    expect(p[5]).toBeGreaterThan(0.1);    // inside the first speech
    expect(p[37]).toBeLessThan(0.01);     // inside the pause
    expect(p[65]).toBeGreaterThan(0.1);   // inside the second speech
  });

  it('keeps a single click well below speech level, because it is RMS not peak', () => {
    /* Peak detection would read a lone spike as full speech. RMS reads it as
       about a third — which is the useful part. It is NOT below the quiet
       threshold though, which is why smoothing exists; see the snap test
       about a click inside a pause. */
    const s = withPause(0.5, 0.5, 0.5);
    s[Math.round(0.75 * RATE)] = 1.0;
    const p = energyProfile(s, RATE, 20);
    const speech = p[5];
    expect(p[37]).toBeLessThan(speech / 2);
  });

  it('survives an empty buffer', () => {
    expect(energyProfile(new Float32Array(0), RATE, 20).length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

describe('snapping a cut onto a pause', () => {
  it('finds a pause the model missed by half a second', () => {
    /* The whole point. Speech 0-2s, pause 2-2.4s, speech from 2.4s. The
       Clipper said 2.5 — a third of a second into the next sentence. */
    const s = withPause(2, 0.4, 2);
    const r = snapToSilence(s, RATE, 2.5);
    expect(r.found).toBe(true);
    expect(r.seconds).toBeCloseTo(2.2, 1);
    expect(r.movedBy).toBeLessThan(0);
  });

  it('lands in the MIDDLE of the pause, not on its edge', () => {
    /* Cutting on the leading edge clips the previous word's decay; cutting on
       the trailing edge starts flush against the first phoneme, which is the
       "sounds clipped" complaint. The middle gives lead-in at both ends free. */
    const s = withPause(2, 1.0, 2);
    const r = snapToSilence(s, RATE, 2.1, { radiusSec: 1.5 });
    expect(r.seconds).toBeCloseTo(2.5, 1);
  });

  it('reports how long the pause was', () => {
    const r = snapToSilence(withPause(2, 0.4, 2), RATE, 2.5);
    expect(r.pauseMs).toBeGreaterThanOrEqual(340);
    expect(r.pauseMs).toBeLessThanOrEqual(440);
  });

  it('prefers the nearer of two pauses', () => {
    /* speech 0-1 · PAUSE 1.0-1.4 · speech 1.4-2.2 · PAUSE 2.2-2.6 · speech
     *
     * Both pauses sit FULLY inside the search radius from either target, and
     * both are comfortably longer than the minimum. That matters: an earlier
     * version of this test placed them so that the far pause was clipped by
     * the radius and then rejected for being too short, so "pick the nearest"
     * and "pick the first" gave the same answer and the test passed against
     * code that did neither. Mutation testing found it, not review. */
    const s = build([
      { sec: 1.0, level: 0.3 }, { sec: 0.4, level: 0 },
      { sec: 0.8, level: 0.3 }, { sec: 0.4, level: 0 },
      { sec: 1.0, level: 0.3 },
    ]);
    expect(snapToSilence(s, RATE, 1.15, { radiusSec: 1.5 }).seconds).toBeCloseTo(1.2, 1);
    /* The one that catches "always take the first": from here the SECOND
       pause is nearer, and both are candidates. */
    expect(snapToSilence(s, RATE, 2.35, { radiusSec: 1.5 }).seconds).toBeCloseTo(2.4, 1);
  });

  it('will not reach past its radius for a pause', () => {
    /* A snap that travels three seconds is not correcting a timestamp, it is
       choosing a different moment. */
    const s = withPause(4, 0.4, 2);
    const r = snapToSilence(s, RATE, 1.0, { radiusSec: 0.5 });
    expect(r.found).toBe(false);
    expect(r.seconds).toBe(1.0);
  });

  it('does not call a word gap a pause in otherwise unbroken speech', () => {
    /* The closure before the 't' in "matter" is a real silence of about 60ms.
       Here the whole region is speech apart from that, so the dynamic-range
       guard is what refuses it — see the next test for the length gate on its
       own. Both paths matter and they are not the same path. */
    const s = build([
      { sec: 1.0, level: 0.3 }, { sec: 0.06, level: 0 },
      { sec: 1.0, level: 0.3 },
    ]);
    expect(snapToSilence(s, RATE, 1.03, { radiusSec: 0.5 }).found).toBe(false);
  });

  it('rejects a word gap even when it is the CLOSEST quiet moment', () => {
    /* The minimum-pause-length gate, on its own.
     *
     * Mutation testing found this uncovered: removing the gate entirely left
     * all twenty tests green, because every fixture that contained a short gap
     * was also refused by the dynamic-range guard first. Here the region holds
     * a genuine 400ms pause AND a 60ms word gap, so the guard passes and the
     * only thing that can reject the gap is its length.
     *
     *   speech · PAUSE 0.5-1.0 · speech · gap 1.06-1.12 · speech
     *
     * Asked to cut at 1.09 — right on the word gap — it must walk back to the
     * real pause rather than take the nearer, shorter one. */
    const s = build([
      { sec: 0.5, level: 0.3 }, { sec: 0.5, level: 0 },
      { sec: 0.06, level: 0.3 }, { sec: 0.06, level: 0 },
      { sec: 0.5, level: 0.3 },
    ]);
    const r = snapToSilence(s, RATE, 1.09, { radiusSec: 0.6 });
    expect(r.found).toBe(true);
    expect(r.seconds).toBeCloseTo(0.75, 1);
    expect(r.pauseMs).toBeGreaterThan(300);
  });

  it('survives a click in the middle of a short pause', () => {
    /* Found by a failing test rather than imagined. A mouth click or a chair
       creak puts one loud window inside the gap; without smoothing it splits
       a 200ms pause into two 100ms halves, both under the minimum, and a
       pause that is plainly audible is reported as absent. */
    const s = build([
      { sec: 1.0, level: 0.3 }, { sec: 0.2, level: 0 }, { sec: 1.0, level: 0.3 },
    ]);
    s[Math.round(1.1 * RATE)] = 1.0;
    const r = snapToSilence(s, RATE, 1.15, { radiusSec: 0.6 });
    expect(r.found).toBe(true);
    expect(r.seconds).toBeCloseTo(1.1, 1);
  });

  it('still works over room tone rather than digital silence', () => {
    /* No real recording reaches zero. A fixed dB floor would find nothing
       here, which is why the threshold is relative to this passage's own
       range. */
    const s = withPause(2, 0.4, 2, 0.02);
    const r = snapToSilence(s, RATE, 2.45);
    expect(r.found).toBe(true);
    expect(r.seconds).toBeCloseTo(2.2, 1);
  });

  it('refuses when the speaker never stops', () => {
    /* THE test. Returning some plausible number here would make every cut
       look corrected and put a third of them mid-word. */
    const r = snapToSilence(build([{ sec: 4, level: 0.3 }]), RATE, 2.0);
    expect(r.found).toBe(false);
    expect(r.seconds).toBe(2.0);
    expect(r.movedBy).toBe(0);
    expect(r.why).toMatch(/does not stop/);
  });

  it('refuses when the whole stretch is silent', () => {
    const r = snapToSilence(build([{ sec: 4, level: 0 }]), RATE, 2.0);
    expect(r.found).toBe(false);
    expect(r.why).toMatch(/silent/);
  });

  it('says why it did nothing, in words a person can act on', () => {
    /* The node prints this. "found: false" explains nothing to a clipper
       looking at a cut that landed mid-sentence. */
    const r = snapToSilence(build([{ sec: 4, level: 0.3 }]), RATE, 2.0);
    expect(r.why.length).toBeGreaterThan(10);
    expect(r.why).not.toMatch(/undefined|NaN/);
  });

  it('describes the move it made', () => {
    const r = snapToSilence(withPause(2, 0.4, 2), RATE, 2.5);
    expect(r.why).toMatch(/snapped/);
    expect(r.why).toMatch(/earlier/);
    expect(r.why).toMatch(/pause/);
  });
});

/* ------------------------------------------------------------------ */

describe('working on a decoded slice rather than the whole file', () => {
  it('reports source-timeline seconds, not offsets into the buffer', () => {
    /* The caller decodes a few seconds around 512s rather than twenty
       minutes. If this returned buffer-relative time, every cut would land
       near the start of the file and the bug would look like a bad model. */
    const s = withPause(2, 0.4, 2);
    const r = snapToSilence(s, RATE, 512.5, { radiusSec: 1.5 }, 510.0);
    expect(r.found).toBe(true);
    expect(r.seconds).toBeCloseTo(512.2, 1);
    expect(r.movedBy).toBeCloseTo(-0.3, 1);
  });

  it('refuses a target that is not inside the audio it was given', () => {
    const s = withPause(2, 0.4, 2);
    const r = snapToSilence(s, RATE, 600, { radiusSec: 1.5 }, 510.0);
    expect(r.found).toBe(false);
    expect(r.why).toMatch(/outside/);
  });

  it('does not run off either end of the buffer', () => {
    const s = withPause(0.2, 0.4, 0.2);
    expect(() => snapToSilence(s, RATE, 0, { radiusSec: 1.5 })).not.toThrow();
    expect(() => snapToSilence(s, RATE, 0.8, { radiusSec: 1.5 })).not.toThrow();
  });

  it('survives an empty buffer instead of dividing by zero', () => {
    const r = snapToSilence(new Float32Array(0), RATE, 1);
    expect(r.found).toBe(false);
    expect(Number.isFinite(r.seconds)).toBe(true);
  });
});
