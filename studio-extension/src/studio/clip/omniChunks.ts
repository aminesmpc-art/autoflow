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

/* How far a boundary may move to find a pause. Beyond this it is no longer
   the boundary that was planned, and evenness matters more than the join. */
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

  /* The fewest pieces that fit, then spread evenly across them. Evenness is
     the goal, not filling each piece to the cap — see the header. */
  const count = Math.ceil(runtime / cap);
  const even = runtime / count;

  const candidates = pauses(phrases);
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
      if (drift > SNAP_WINDOW_SEC || drift >= bestGap) continue;
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
    + (rough ? ` — ${rough} join${rough === 1 ? '' : 's'} lands mid-sentence` : ' — every join is in a pause');
}
