/**
 * Finding the pause to cut on.
 *
 * The Clipper says "the hook starts at 512.24". Measured, that number is good
 * to about a second (Clipping Pipeline v4 §2), and a second is four or five
 * words — enough to open a clip halfway through "…market is about to CRASH",
 * which is unusable however good the moment underneath it is.
 *
 * Nothing here asks a model anything. We already have the audio; the pause
 * between two sentences is arithmetic, and arithmetic does not drift, echo a
 * placeholder, or invent an evenly-spaced answer. This is the cheapest
 * accuracy in the whole pipeline: it takes an approximate timestamp and lands
 * it on a real sentence boundary for the cost of a few thousand multiplies.
 *
 * Two decisions worth naming:
 *
 *   · the threshold is RELATIVE, not an absolute dB floor. Real rooms hiss,
 *     compressors lift the noise floor, and a podcast recorded in a kitchen
 *     has no sample anywhere near zero. What separates a pause from speech is
 *     the distance between the quiet level and the loud level in THIS passage,
 *     not a number chosen in advance.
 *
 *   · when no pause is found, this says so and returns the target unchanged.
 *     It never nudges the cut somewhere arbitrary to look like it worked.
 *     An absence lies, so it is reported rather than papered over.
 */

/** Analysis window. 20ms is about one phoneme — fine enough to see a gap. */
const DEFAULT_WINDOW_MS = 20;

/**
 * The shortest gap that counts as a pause.
 *
 * Ordinary speech has 40-80ms stop gaps inside words — the closure before the
 * 't' in "matter" is a genuine silence. Cutting there is cutting mid-word.
 * 120ms is past that and short enough to catch a brisk sentence boundary.
 */
const DEFAULT_MIN_SILENCE_MS = 120;

/**
 * How far above the quiet level still counts as quiet.
 *
 * Measured against the passage's own range: floor + 0.15 * (speech - floor).
 * Low enough that a breath does not read as speech, high enough that room
 * tone does not read as a pause.
 */
const SILENCE_FRACTION = 0.15;

/**
 * The passage must actually have loud and quiet parts.
 *
 * If the 90th percentile is barely above the 10th, there is no speech here to
 * find gaps between — it is silence throughout, or noise throughout, and any
 * "pause" found would be a rounding artefact.
 */
const MIN_DYNAMIC_RANGE = 1.6;

export interface SnapOptions {
  windowMs?: number;
  minSilenceMs?: number;
  /** How far either side of the target to look, in seconds. */
  radiusSec?: number;
}

export interface SnapResult {
  /** Where to cut. Equal to the target when nothing better was found. */
  seconds: number;
  /** Signed move from the target. Negative is earlier. */
  movedBy: number;
  /** Whether a real pause was found. False means `seconds` is the target. */
  found: boolean;
  /** Length of the pause landed in, milliseconds. Zero when not found. */
  pauseMs: number;
  /** Plain words for the node's report, because a number alone explains nothing. */
  why: string;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Root-mean-square energy per window.
 *
 * RMS rather than peak: a single click should not make a window look like
 * speech, and a pause with one keyboard tap in it is still a pause.
 */
export function energyProfile(
  samples: Float32Array,
  sampleRate: number,
  windowMs: number = DEFAULT_WINDOW_MS,
): Float32Array {
  const per = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const count = Math.floor(samples.length / per);
  const out = new Float32Array(Math.max(0, count));
  for (let w = 0; w < count; w++) {
    let sum = 0;
    const base = w * per;
    for (let i = 0; i < per; i++) {
      const v = samples[base + i];
      sum += v * v;
    }
    out[w] = Math.sqrt(sum / per);
  }
  return out;
}

/** A percentile of the values, without sorting the caller's array. */
function percentile(values: ArrayLike<number>, p: number): number {
  if (!values.length) return 0;
  const arr = Array.prototype.slice.call(values).sort((a: number, b: number) => a - b);
  const idx = clamp(Math.round((arr.length - 1) * p), 0, arr.length - 1);
  return arr[idx];
}

/**
 * Median-of-three over the energy profile, to reject impulses.
 *
 * RMS already stops one loud sample from making a window read as speech — a
 * lone spike in a 20ms window measures about a third of speech level, not all
 * of it. But a third is still above the quiet threshold, so a mouth click or a
 * chair creak lands one loud window in the middle of a pause and SPLITS it.
 * A 200ms gap becomes two 100ms halves, both under the minimum, and a pause
 * that was plainly there is reported as absent.
 *
 * A median cannot be moved by a single outlier, which is exactly the shape of
 * the problem. Applied here rather than inside energyProfile so that function
 * stays an honest measurement of the audio.
 */
function smooth3(profile: Float32Array): Float32Array {
  if (profile.length < 3) return profile;
  const out = new Float32Array(profile.length);
  out[0] = Math.min(profile[0], profile[1]);
  out[profile.length - 1] = Math.min(profile[profile.length - 1], profile[profile.length - 2]);
  for (let i = 1; i < profile.length - 1; i++) {
    const a = profile[i - 1];
    const b = profile[i];
    const c = profile[i + 1];
    out[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  return out;
}

interface Run { from: number; to: number; }

/** Runs of consecutive windows at or below the threshold. */
function quietRuns(profile: ArrayLike<number>, threshold: number, minWindows: number): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let i = 0; i < profile.length; i++) {
    const quiet = profile[i] <= threshold;
    if (quiet && start < 0) start = i;
    if (!quiet && start >= 0) {
      if (i - start >= minWindows) runs.push({ from: start, to: i });
      start = -1;
    }
  }
  if (start >= 0 && profile.length - start >= minWindows) {
    runs.push({ from: start, to: profile.length });
  }
  return runs;
}

/**
 * Move a cut point onto the nearest real pause.
 *
 * `samples` is mono PCM for the WHOLE passage being searched and `offsetSec`
 * is where sample 0 sits on the source timeline, so a caller can decode a
 * small region around the target instead of the entire file — which is the
 * point, since decoding twenty minutes to place one cut would undo the reason
 * this pipeline streams in the first place.
 */
export function snapToSilence(
  samples: Float32Array,
  sampleRate: number,
  targetSec: number,
  options: SnapOptions = {},
  offsetSec = 0,
): SnapResult {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const minSilenceMs = options.minSilenceMs ?? DEFAULT_MIN_SILENCE_MS;
  const radiusSec = options.radiusSec ?? 1.5;

  const miss = (why: string): SnapResult =>
    ({ seconds: targetSec, movedBy: 0, found: false, pauseMs: 0, why });

  if (!samples.length || sampleRate <= 0) return miss('no audio to search');

  const localTarget = targetSec - offsetSec;
  const durationSec = samples.length / sampleRate;
  if (localTarget < -radiusSec || localTarget > durationSec + radiusSec) {
    return miss('the cut point is outside the audio that was decoded');
  }

  /* Search only the window either side of the target. The threshold is
     derived from this region alone on purpose: a passage that happens to sit
     between two shouted sentences should be judged against those, not against
     a quiet stretch four minutes away. */
  const from = clamp(Math.floor((localTarget - radiusSec) * sampleRate), 0, samples.length);
  const to = clamp(Math.ceil((localTarget + radiusSec) * sampleRate), 0, samples.length);
  if (to - from < sampleRate * 0.05) return miss('not enough audio around the cut point');

  const region = samples.subarray(from, to);
  const raw = energyProfile(region, sampleRate, windowMs);
  if (raw.length < 3) return miss('not enough audio around the cut point');
  const profile = smooth3(raw);

  const floor = percentile(profile, 0.1);
  const speech = percentile(profile, 0.9);

  /* Both guards matter. A silent region has floor ≈ speech ≈ 0, and dividing
     by that would call every window a pause; a region of unbroken speech has
     floor ≈ speech ≈ loud, and the "quietest" window in it is still a vowel. */
  if (speech <= 1e-6) return miss('that stretch is silent throughout');
  if (speech / Math.max(floor, 1e-9) < MIN_DYNAMIC_RANGE) {
    return miss('no pause there — the speaker does not stop');
  }

  const threshold = floor + SILENCE_FRACTION * (speech - floor);
  const minWindows = Math.max(1, Math.round(minSilenceMs / windowMs));
  const runs = quietRuns(profile, threshold, minWindows);
  if (!runs.length) return miss('no pause long enough to cut on');

  const secPerWindow = windowMs / 1000;
  const regionStartSec = offsetSec + from / sampleRate;

  /* The MIDDLE of the pause, not its edge.
     Cutting on the leading edge clips the tail of the previous word's decay;
     cutting on the trailing edge starts flush against the first phoneme, which
     is the "sounds clipped" complaint. The middle gives natural lead-in at
     both ends of the cut for free, without a padding constant to tune. */
  let best: { at: number; run: Run } | null = null;
  for (const run of runs) {
    const midWindow = (run.from + run.to) / 2;
    const at = regionStartSec + midWindow * secPerWindow;
    if (!best || Math.abs(at - targetSec) < Math.abs(best.at - targetSec)) {
      best = { at, run };
    }
  }
  if (!best) return miss('no pause long enough to cut on');

  const pauseMs = Math.round((best.run.to - best.run.from) * windowMs);
  const seconds = round2(best.at);
  const movedBy = round2(seconds - targetSec);

  return {
    seconds,
    movedBy,
    found: true,
    pauseMs,
    why: movedBy === 0
      ? `already on a ${pauseMs}ms pause`
      : `snapped ${Math.abs(movedBy)}s ${movedBy < 0 ? 'earlier' : 'later'}, `
        + `to the middle of a ${pauseMs}ms pause`,
  };
}
