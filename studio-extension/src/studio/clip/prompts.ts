/**
 * What we say to the model during a clip run, beyond the brain's own asks.
 *
 * Two jobs live here: getting words out of audio, and getting the speaker's
 * position out of stills. Both are asks where the model is genuinely good and
 * the danger is elsewhere — in what we do with a confident answer that happens
 * to be wrong.
 */

import { LOCATE_SENTINEL } from '../ask/clipperBrain';
import type { FaceSample } from '../media/reframe';

/**
 * Plain transcription of one chunk.
 *
 * No timestamps are requested, deliberately. Measured, the model cannot place
 * a passage in a long file and does not say so — at twelve minutes it returned
 * a flawless arithmetic sequence. Asking only for words keeps it on the job it
 * is excellent at; the times come from chunk boundaries we cut ourselves.
 *
 * "Do not tidy" matters more than it looks: a cleaned-up transcript no longer
 * matches the audio word for word, and every later stage locates lines by
 * quoting them back.
 */
export function transcribeAsk(): string {
  return [
    'Transcribe this audio word for word.',
    '',
    'Output ONLY the transcript text, as one continuous paragraph.',
    'No timestamps, no speaker labels, no headings, no commentary, no summary.',
    'Do not correct, tidy or shorten anything — write exactly what is said,',
    'including false starts and repeated words.',
  ].join('\n');
}

/**
 * Where the speaker is in each sampled frame.
 *
 * Asked as a fraction of frame width rather than in pixels: the model is being
 * shown a still whose size it has no reason to know, and a fraction survives
 * the source being any resolution.
 *
 * The frames are numbered in the prompt and the answer is keyed by number, so
 * a reply that comes back in a different order still lands on the right time.
 */
export function faceAsk(count: number): string {
  return [
    `These are ${count} stills taken from one video, in order.`,
    '',
    'For each still, give the horizontal position of the SPEAKER — the person',
    'talking to camera — as a fraction of the frame width: 0 is the left edge,',
    '0.5 the middle, 1 the right edge.',
    '',
    'If a still has no person in it, or you cannot tell which one is speaking,',
    'give null for that still rather than guessing. A wrong position moves the',
    'crop onto a wall.',
    '',
    'Reply with JSON only, nothing else:',
    `{"positions":[{"n":1,"x":${LOCATE_SENTINEL}},{"n":2,"x":null}]}`,
  ].join('\n');
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * Read the positions back and pair them with the times they were sampled at.
 *
 * Everything unusable is DROPPED rather than defaulted. A missing position
 * becomes no sample, and planReframe already knows what to do with fewer
 * samples — or with none, where it centres the crop and stops. Substituting
 * 0.5 for "I could not tell" would look like a confident reading of the middle
 * of the frame and would drag a locked crop off the speaker.
 */
export function readFaces(reply: unknown, times: number[]): FaceSample[] {
  let parsed: unknown = reply;

  if (typeof reply === 'string') {
    const m = reply.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }

  const list = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
    ? (parsed as Record<string, unknown>).positions
    : parsed;
  if (!Array.isArray(list)) return [];

  const out: FaceSample[] = [];
  list.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const r = raw as Record<string, unknown>;
    const n = num(r.n) ?? i + 1;
    const x = num(r.x);

    /* The sentinel is the example from the prompt copied back. Measured: a
       prompt whose example read 0.0 got 0.0 for every answer, and it was
       written up as a model failure before a second run proved otherwise. */
    if (x === null || x === LOCATE_SENTINEL) return;
    if (x < 0 || x > 1) return;

    const t = times[n - 1];
    if (t === undefined || !Number.isFinite(t)) return;
    out.push({ t, x });
  });

  return out.sort((a, b) => a.t - b.t);
}

/**
 * The times to sample stills at across a clip.
 *
 * Every couple of seconds is plenty: a crop that only moves when the speaker
 * does needs to know roughly where they are, not exactly. Sampling faster
 * costs an upload per frame and buys detail the smoothing then removes.
 */
export function frameTimes(clipSeconds: number, everySec = 2, max = 8): number[] {
  if (!(clipSeconds > 0)) return [];
  const times: number[] = [];
  /* Offset half a step so the first sample is inside the clip rather than on
     its very first frame, which is often a fade or a cut. */
  for (let t = everySec / 2; t < clipSeconds && times.length < max; t += everySec) {
    times.push(Math.round(t * 100) / 100);
  }
  return times.length ? times : [Math.min(clipSeconds / 2, clipSeconds)];
}
