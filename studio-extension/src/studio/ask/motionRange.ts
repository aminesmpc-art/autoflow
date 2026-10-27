import { OMNI_MAX_SEC, planOmniChunks, type OmniChunk } from '../clip/omniChunks';

export interface MotionRange {
  motionVideoMode?: 'full' | 'trim';
  motionTrimStart?: number;
  motionTrimEnd?: number;
}

/** Null keeps legacy full-video retry checkpoints compatible. */
export const motionRangeKey = (range: MotionRange): string | null => range.motionVideoMode === 'trim'
  ? JSON.stringify(['trim', range.motionTrimStart, range.motionTrimEnd]) : null;

export function trimProblem(duration: number, range: MotionRange): string | null {
  if (range.motionVideoMode !== 'trim') return null;
  const start = range.motionTrimStart, end = range.motionTrimEnd;
  if (!Number.isFinite(duration) || duration <= 0) return 'Choose the video again to read its duration.';
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) return 'Enter a start and end time.';
  if (start < 0 || end > duration) return 'Keep both trim points inside the source video.';
  if (end <= start) return 'End must be after start.';
  if (end - start < Math.min(1, Math.floor(duration * 1000) / 1000) - 1e-9) return 'Keep at least 1 second of video.';
  return null;
}

export function suggestedTrim(duration: number, anchor: 'start' | 'center' | 'end' = 'center'): MotionRange {
  // Millisecond precision, rounding inward so the selection never exceeds the file.
  const endMs = Math.max(0, Math.floor(duration * 1000));
  const capMs = OMNI_MAX_SEC * 1000;
  const lengthMs = Math.min(endMs, Math.max(capMs, Math.floor(endMs / capMs) * capMs));
  const startMs = anchor === 'start' ? 0 : anchor === 'end' ? endMs - lengthMs : Math.floor((endMs - lengthMs) / 2);
  return { motionVideoMode: 'trim', motionTrimStart: startMs / 1000, motionTrimEnd: (startMs + lengthMs) / 1000 };
}

/** Absolute source times: the same selected bytes are cut for analysis and upload. */
export function planMotionVideo(duration: number, range: MotionRange): OmniChunk[] {
  if (range.motionVideoMode !== 'trim') return planOmniChunks(duration);
  const problem = trimProblem(duration, range);
  if (problem) throw new Error(problem);
  return chunksBetween(range.motionTrimStart!, range.motionTrimEnd!);
}

function chunksBetween(startSec: number, endSec: number): OmniChunk[] {
  // Floating-point subtraction must not turn a user-selected 30s into 30.000000000000004s.
  const seconds = Math.round((endSec - startSec) * 1e9) / 1e9;
  return planOmniChunks(seconds).map((chunk, i, chunks) => ({
    ...chunk,
    startSec: startSec + chunk.startSec,
    endSec: i === chunks.length - 1 ? endSec : startSec + chunk.endSec,
  }));
}

/* How far past the file's own end a selection may reach and still mean "the
   end". The two lengths below differ by milliseconds; more than this is a
   different file, and is said so rather than quietly cut short. */
const MEASURE_SLACK_SEC = 0.5;

/**
 * The plan the RUN makes, from the file it measures.
 *
 * The panel takes the length from a <video> element, the run from the file's
 * own samples (mediabunny's computeDuration), and they disagree by a few
 * milliseconds: 22.87s in the panel, a hair less in the run. A selection
 * dragged to the very end — checked and accepted in the panel — then "left the
 * source video" at Generate. So the selection is checked against the length
 * it was made on, the panel's, and only the cut is held to the file's end.
 */
export function planMotionRun(measured: number, range: MotionRange & { sourceDuration?: number }): OmniChunk[] {
  if (range.motionVideoMode !== 'trim') return planOmniChunks(measured);
  const shown = typeof range.sourceDuration === 'number' && range.sourceDuration > 0 ? range.sourceDuration : measured;
  const problem = trimProblem(shown, range);
  if (problem) throw new Error(problem);
  const startSec = range.motionTrimStart!;
  if (range.motionTrimEnd! > measured + MEASURE_SLACK_SEC || startSec >= measured) {
    throw new Error('This video is shorter than the panel measured. Choose the video again, then the trim.');
  }
  return chunksBetween(startSec, Math.min(range.motionTrimEnd!, measured));
}

export const preciseSeconds = (seconds: number): string => `${Number(seconds.toFixed(3))}s`;
