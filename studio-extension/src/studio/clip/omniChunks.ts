/**
 * Splitting a clip into pieces Omni will accept.
 *
 * ── The constraint ────────────────────────────────────────────────────────
 *
 * Flow says it in its own words: "Videos longer than 10s can't be edited. Trim
 * to 10s or under to edit." So a nineteen second cut cannot be handed to Omni
 * whole. It has to go in pieces and come back in pieces.
 *
 * ── Why not 10 / 10 / 6 ───────────────────────────────────────────────────
 *
 * The obvious split of a 26 second clip is ten, ten, and whatever is left. It
 * is wrong twice.
 *
 * The runt. A six second tail next to two ten second pieces is a third of the
 * material getting a different share of whatever the model does — pacing,
 * intensity, how many graphics it feels like adding. Three pieces of about
 * nine seconds are treated alike; ten-ten-six is not.
 *
 * The boundary. Ten point zero seconds is a number, not a moment. It lands
 * mid-word about as often as not, and a join mid-word is audible however good
 * the edit either side of it is.
 *
 * So: the fewest pieces that fit under the cap, as evenly as possible, each
 * boundary nudged to the nearest gap between phrases. 26s becomes roughly
 * 8.7 / 8.7 / 8.6, and every join lands in a pause somebody already took.
 *
 * ── What this does not solve ──────────────────────────────────────────────
 *
 * Each piece is an independent generation, so the model may treat them
 * differently — that is a real cost of chunking and no arithmetic here fixes
 * it. What helps is sending the same prompt and the same style reference with
 * every piece, which is the caller's job. The seams are reported so a clipper
 * knows where to look.
 */

/** The cap Flow enforces, in its own error message. */
export const OMNI_MAX_SEC = 10;

/* A piece shorter than this is not worth a generation of its own — the tail
   gets folded into the piece before it instead, even though that makes the
   split slightly less even. */
const RUNT_SEC = 2;

/* The FLOOR on how far a boundary may move to find a pause; the real window is
   half the even spacing, computed per split. A flat value was the whole
   allowance once, and on a clip with room to spare it refused a pause 1.44s
   away and put the join inside a word instead. Evenness is worth less than a
   join a listener does not hear. */
const SNAP_WINDOW_SEC = 1.2;

export interface OmniChunk {
  /** Seconds into the CLIP. */
  startSec: number;
  endSec: number;
  seconds: number;
  /** 1-based, for labelling the piece a clipper has to find again. */
  index: number;
  of: number;
  /** True when the split had to land inside somebody speaking. */
  cutsSpeech: boolean;
}

export interface ChunkPhrase {
  startSec: number;
  endSec: number;
}

/**
 * The gaps between phrases, as candidate boundaries.
 *
 * The midpoint of a gap rather than either edge: a join at the exact moment
 * speech stops still clips the breath, and one at the exact moment it resumes
 * arrives late.
 */
function pauses(phrases: ChunkPhrase[]): number[] {
  const sorted = [...phrases]
    .filter((p) => Number.isFinite(p.startSec) && Number.isFinite(p.endSec) && p.endSec > p.startSec)
    .sort((a, b) => a.startSec - b.startSec);

  const out: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].startSec - sorted[i].endSec;
    if (gap > 0.02) out.push(sorted[i].endSec + gap / 2);
    else out.push(sorted[i].endSec);        // back to back, but still a word edge
  }
  return out;
}

/** Whether a second falls inside somebody speaking. */
function insideSpeech(at: number, phrases: ChunkPhrase[]): boolean {
  return phrases.some((p) => at > p.startSec + 1e-6 && at < p.endSec - 1e-6);
}

/**
 * Split a clip into pieces Omni will take.
 *
 * Returns one chunk covering the whole clip when it already fits — a clip
 * under the cap must not be cut up for no reason, and the caller should not
 * have to special-case that.
 */
export function planOmniChunks(
  clipSeconds: number,
  phrases: ChunkPhrase[] = [],
  maxSec: number = OMNI_MAX_SEC,
): OmniChunk[] {
  const runtime = Math.max(0, clipSeconds);
  if (!(runtime > 0)) return [];

  const cap = Math.max(1, maxSec);
  if (runtime <= cap) {
    return [{
      startSec: 0, endSec: runtime, seconds: runtime,
      index: 1, of: 1, cutsSpeech: false,
    }];
  }

  const candidates = pauses(phrases);

  /* ── How many pieces ──────────────────────────────────────────────────
     The fewest that fit is the cheapest answer and sometimes an impossible
     one. A 39.57s cut needs four pieces of at most 10s, so the four lengths
     share 40 − 39.57 = 0.43s of give BETWEEN THEM. Every boundary is pinned to
     within a fraction of a second of the even split, a pause has to fall
     inside that sliver to be usable, and when none does the result is an even
     split with every join inside a word:

         4 pieces: 9.9 + 9.9 + 9.9 + 9.9s — 3 joins land mid-sentence

     which is what the splitter exists to prevent. One more piece turns 0.43s
     of slack into 10.43s — the difference between hunting for a pause and
     having a choice of them.

     So: try the fewest, and only buy another piece if it actually pays for
     clean joins. Fewest still wins when it already joins cleanly, and one
     extra is the whole budget — a clean join is worth an extra upload, not
     six. */
  const fewest = Math.ceil(runtime / cap);
  let edges = edgesFor(fewest);
  if (countCutting(edges) > 0) {
    const roomier = edgesFor(fewest + 1);
    if (countCutting(roomier) < countCutting(edges)) edges = roomier;
  }

  /** How many joins of a set of edges fall inside somebody speaking. */
  function countCutting(within: number[]): number {
    let n = 0;
    for (let i = 1; i < within.length - 1; i++) {
      if (insideSpeech(within[i], phrases)) n++;
    }
    return n;
  }

  /** The boundaries for a given number of pieces, cap enforced. */
  function edgesFor(count: number): number[] {
  const even = runtime / count;

  /* How far a join may move to find a pause.
   *
   * A flat 1.2s was too mean once there was room to spend. On the reported
   * clip the fourth join wanted a pause 1.44s away, with every piece still
   * comfortably under the cap — the search refused to look, and the join
   * landed inside a word for the sake of a tidier arithmetic.
   *
   * Half the even spacing instead, never narrower than the old constant.
   * Drifting cannot produce an illegal split: the cap guards below reject any
   * position that would, so the only thing given up is evenness — and Flow
   * does not care how even the pieces are, while a listener hears every join
   * that lands mid-word. */
  const snap = Math.max(SNAP_WINDOW_SEC, even / 2);

  const boundaries: number[] = [];

  for (let i = 1; i < count; i++) {
    const want = even * i;
    const previous = boundaries.length ? boundaries[boundaries.length - 1] : 0;

    /* Nearest pause, but only one that leaves a legal split on BOTH sides.
     *
     * The second condition is the one that was missing, and it produced a
     * 9.1 + 10.2 split of a 19.3 second clip — the join moved earlier to find
     * a pause, which is right, and grew the piece after it past the cap, which
     * Flow would have refused. Guarding only the piece before a boundary is
     * half a guard: what remains has to fit in the pieces that are left. */
    const remaining = count - i;                 // pieces after this boundary
    let best = want;
    let bestGap = Infinity;
    for (const pause of candidates) {
      const drift = Math.abs(pause - want);
      if (drift > snap || drift >= bestGap) continue;
      if (pause - previous > cap) continue;            // the piece before it
      if (runtime - pause > cap * remaining) continue; // everything after it
      if (pause <= previous + RUNT_SEC) continue;
      if (runtime - pause <= 0) continue;
      best = pause;
      bestGap = drift;
    }
    boundaries.push(best);
  }

  const edges = [0, ...boundaries, runtime];

  /* Make the cap true, rather than hoping the choices above kept it true.
   *
   * Every boundary is picked greedily, one at a time, against a guess at what
   * the rest will need. That is not a guarantee, and twice it was not enough:
   * a real clip came out 9.1 + 10.2, and a sweep across pause positions then
   * found a 10.65. The cap is the one thing Flow will not forgive, so it is
   * enforced here as an invariant instead of argued for upstream.
   *
   * A join gives up its pause when it has to. Prettiness is a preference; a
   * piece Flow refuses is a piece that does not exist. */
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] - edges[i - 1] > cap) edges[i] = edges[i - 1] + cap;
  }
  /* Clamping walks every boundary earlier, which can leave the tail too long
     for one piece. Split it as many times as it takes. */
  while (edges[edges.length - 1] - edges[edges.length - 2] > cap) {
    edges.splice(edges.length - 1, 0, edges[edges.length - 2] + cap);
  }

  /* Fold away a tail too short to be worth its own generation. */
  if (edges.length > 2) {
    const last = edges[edges.length - 1] - edges[edges.length - 2];
    if (last < RUNT_SEC && edges[edges.length - 1] - edges[edges.length - 3] <= cap) {
      edges.splice(edges.length - 2, 1);
    }
  }

  return edges;
  }

  const of = edges.length - 1;
  const chunks: OmniChunk[] = [];
  for (let i = 0; i < of; i++) {
    const startSec = edges[i];
    const endSec = edges[i + 1];
    chunks.push({
      startSec,
      endSec,
      seconds: endSec - startSec,
      index: i + 1,
      of,
      /* Only the joins can cut speech; the clip's own ends are where the cut
         already decided to be. */
      cutsSpeech: i > 0 && insideSpeech(startSec, phrases),
    });
  }
  return chunks;
}

/** The split, in one line a clipper can act on. */
export function describeChunks(chunks: OmniChunk[]): string {
  if (!chunks.length) return 'nothing to split';
  if (chunks.length === 1) return `fits in one piece (${chunks[0].seconds.toFixed(1)}s)`;

  const lengths = chunks.map((c) => c.seconds.toFixed(1)).join(' + ');
  const rough = chunks.filter((c) => c.cutsSpeech).length;
  return `${chunks.length} pieces: ${lengths}s`
    + (rough
      ? ` — ${rough} join${rough === 1 ? '' : 's'} ${rough === 1 ? 'lands' : 'land'} mid-sentence`
      : ' — every join is in a pause');
}

/* ────────────────────────────────────────────────────────────────────────
   Rebasing a clip's own data onto one chunk
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Why anything needs shifting at all.
 *
 * A reframe plan's keyframes and a caption's cues are both timed against the
 * CLIP — zero is where the clip starts. A chunk is encoded as its own video, so
 * its first frame arrives at zero too. Handing chunk three the clip's plan
 * unchanged points every keyframe seventeen seconds into a nine second piece,
 * and nothing moves; handing it the clip's cues shows the wrong words or none.
 *
 * This is the same fault captions had once already — cue times built against a
 * boundary the encoder did not end up using — so it is a pure function with
 * tests rather than three lines inside an encode loop.
 */

/** Cues that fall inside a chunk, retimed to start at zero. */
export function cuesForChunk<T extends { startSec: number; endSec: number }>(
  cues: T[],
  chunk: { startSec: number; endSec: number },
): T[] {
  const out: T[] = [];
  for (const cue of cues) {
    if (cue.endSec <= chunk.startSec || cue.startSec >= chunk.endSec) continue;
    const startSec = Math.max(cue.startSec, chunk.startSec) - chunk.startSec;
    const endSec = Math.min(cue.endSec, chunk.endSec) - chunk.startSec;
    if (endSec - startSec < 0.08) continue;
    out.push({ ...cue, startSec, endSec });
  }
  return out;
}

/**
 * A reframe plan retimed onto a chunk.
 *
 * Keyframes before the chunk are not dropped — the last one before it is kept,
 * pinned to zero, because it is what the crop should be as the chunk opens. Drop
 * it and the chunk starts at whatever the first keyframe INSIDE it says, which
 * is the crop arriving late.
 */
export function planForChunk<
  P extends { keyframes: Array<{ t: number } & Record<string, unknown>> },
>(plan: P | null | undefined, chunk: { startSec: number; endSec: number }): P | null {
  if (!plan || !Array.isArray(plan.keyframes) || !plan.keyframes.length) return plan ?? null;

  const inside = plan.keyframes.filter((k) => k.t >= chunk.startSec && k.t < chunk.endSec);
  const before = plan.keyframes.filter((k) => k.t < chunk.startSec).pop();

  const keyframes = [
    ...(before ? [{ ...before, t: 0, cut: true }] : []),
    ...inside.map((k) => ({ ...k, t: Math.max(0, k.t - chunk.startSec) })),
  ];

  /* Two keyframes at zero is the opening one twice over. Keep the real one. */
  const deduped = keyframes.filter((k, i) => i === 0 || k.t > 0);
  return { ...plan, keyframes: deduped.length ? deduped : plan.keyframes.slice(0, 1) };
}
