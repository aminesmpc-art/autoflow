/**
 * Reading Flow's batchexecute traffic.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * The interceptor used to watch for four tRPC procedure names in the request
 * URL — batchCheckAsyncVideoGenerationStatus and friends. Measured on the live
 * site, flow.google.com makes 19 API calls to load a project and NONE of them
 * match any of those names. The whole tRPC API is gone. Every call now goes to
 *
 *     /_/AiSandboxAngularFrontend/data/batchexecute
 *
 * and the procedure is an opaque, per-build id in the query string: nzlxg,
 * Zzl0ze, WuwhI, DTaVef, xI9TVb, UpteDb, NfrxTb, ngNC2, mrlkwd, as29s. So the
 * URL filter matched nothing, the status cache never filled, and the panel
 * showed "API Passive" forever. It was not a credentials problem — the filter
 * could not match, ever.
 *
 * Two other things were measured at the same time and both shape this file:
 *
 *   all 19 calls were XHR, zero fetch    Angular's HttpClient does not use
 *                                        fetch, so the fetch half of the old
 *                                        interceptor is dead on this site
 *   no enum strings anywhere             the old API sent readable statuses
 *                                        like MEDIA_GENERATION_STATUS_SUCCESSFUL;
 *                                        a search of real response bodies for
 *                                        any six-letter-plus capitalised token
 *                                        found none
 *
 * ── The two record shapes, and why only one of them counts ───────────────
 *
 * Payloads are positional arrays with no field names. Flow sends two kinds,
 * and the difference is the whole job. A media-LIST record describes what
 * exists — media id first, project last, a title before its timestamp:
 *
 *   ["6a5b21d8-…", null, null,
 *     ["Woman smiling with athletic build", [1787817903, 283461000], …],
 *    "f1f353d5-…"]
 *
 * A STATUS record describes what is happening — three ids, then a metadata
 * block that leads with the timestamp instead. Recorded from a video
 * generated live, mid-flight:
 *
 *   ["8a0059c8-…",   scene
 *    "f1f353d5-…",   project
 *    "b14eade5-…",   media
 *    "CAE", null,
 *    [[1788575632,79153000], "A single red paper boat drifting across …",
 *     …, [["veo_3_1_t2v_lite",1,…]], …, [6], 1]]
 *
 * Only status records are read here. The list has no status in it, so reading
 * it reported 39 finished August videos as running on one real project, with
 * uploaded ingredients among them — af_155e2676.png arriving as a generation
 * whose prompt was a filename. A cache full of confident wrong answers is
 * worse than the empty cache this replaces.
 *
 * ── How completion is decided ─────────────────────────────────────────────
 *
 * Not from the status enum. It does move — [6] while running, [3] when done —
 * but it is a bare integer whose meaning is a proto detail, and a renumbering
 * would silently invert the reading with no error to catch it.
 *
 * The same generation, watched from submission to completion, showed what to
 * use instead: at the moment the tile filled in, the record grew from 734 to
 * 1067 characters and gained two things it had never had — a
 * flow-content.google/video URL and a byte size, 2213724, the finished file.
 * A generation that has media is finished; one that has not, is not. That is
 * a fact about the generation rather than a position in an array, so it
 * survives fields being inserted above it.
 *
 * ── How to check any of this again ────────────────────────────────────────
 *
 * In the page console on a project, while something is generating:
 *
 *     const o = XMLHttpRequest.prototype.send;
 *     XMLHttpRequest.prototype.send = function () {
 *       this.addEventListener('load', () => {
 *         if ((this.__af_url || '').includes('batchexecute'))
 *           console.log(this.responseText.slice(0, 600));
 *       });
 *       return o.apply(this, arguments);
 *     };
 *
 * Then compare one record before and after its tile finishes.
 */

/* Type-only, and written as such: this module is bundled into the MAIN-world
   interceptor, where pulling a runtime import out of the types barrel would
   ship the whole thing into Flow's own page. */
import type { FlowGenerationStatus, FlowGenerationState, FlowMediaKind } from '../../types';

/** The path every Flow API call goes to now. */
export const BATCH_PATH = '/data/batchexecute';

/** True for a request this module can read. */
export function isBatchExecuteUrl(url: string): boolean {
  return url.includes(BATCH_PATH);
}

/**
 * The rpcid, for diagnostics only.
 *
 * Never route on this. It is a per-build obfuscated symbol: the ten ids in the
 * header above were read off one build and are not promised to survive the
 * next one.
 */
export function rpcIdOf(url: string): string {
  const m = /[?&]rpcids=([^&]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : '';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a Flow id: media, project and workflow ids are all plain UUIDs. */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

/**
 * Where Flow serves media from.
 *
 * Both live hosts are here — the signed content host and the app host under
 * /asb/ — plus the labs.google pattern, so a user still on the old site reads
 * the same way.
 *
 * This is NOT the completion test. It used to be, and the note it carried
 * ("ingredient and source images come from the signed content host") was the
 * bug written down as a feature: an ingredient is an INPUT. A Frames run
 * carries its two uploaded frames in the record from the moment it is
 * submitted, so every such generation read as finished before a single frame
 * of video existed — 1 ✅ and "All videos processed!" against a tile still
 * climbing through 45%.
 *
 * mediaKindOf decides completion now, and it asks what the URL is OF.
 */
const MEDIA_HOST_HINTS = ['flow-content.google', '/asb/', 'getMediaUrlRedirect'];

/** True when a string is a URL for media of any kind — input, output or poster. */
export function isMediaUrl(v: unknown): boolean {
  if (typeof v !== 'string' || v.length < 12) return false;
  return MEDIA_HOST_HINTS.some((h) => v.includes(h));
}

/**
 * The id a signed media URL is issued under.
 *
 * Which of a record's ids that is, is not worth guessing at. Measured on the
 * generation these fixtures were recorded from, the finished video came back
 * as
 *
 *     flow-content.google/video/8a0059c8-…     the SCENE id, ids[0]
 *
 * while the record's media id was b14eade5-…, ids[2]. So the test is
 * membership of the record's own id set, not equality with any one of them —
 * an assumption about WHICH id signs the asset would have to be re-checked at
 * every Flow deploy, and this one does not.
 *
 * What it still separates is the thing that matters: an input frame or an
 * ingredient is signed under an id this record does not contain at all.
 *
 * An /asb/ token is not an id and yields '' here, deliberately.
 */
const MEDIA_PATH_ID = /\/(?:image|video)\/([0-9a-f][0-9a-f-]{11,})/i;

export function mediaPathId(url: string): string {
  const m = MEDIA_PATH_ID.exec(url);
  return m ? m[1] : '';
}

/**
 * One decoded envelope from a batchexecute response.
 *
 * `data` is the already-parsed payload — the wire carries it as a JSON string
 * nested inside the outer JSON, which is why it needs parsing twice.
 */
export interface BatchEnvelope {
  rpcid: string;
  data: unknown;
}

/**
 * Split a batchexecute response into its envelopes.
 *
 * The wire format is a close-bracket-brace-paren prefix, then repeating pairs
 * of a decimal length on its own line and a JSON chunk of that length:
 *
 *     )]}'
 *
 *     285
 *     [["wrb.fr","ngNC2","<payload as a JSON string>",null,…],["di",308],…]
 *     25
 *     [["e",4,null,null,144]]
 *
 * The lengths are ignored. They are counted in bytes while JavaScript slices
 * in UTF-16 code units, so any prompt with an accent in it — and these are
 * French projects — makes the two disagree and every subsequent offset walks
 * off. Scanning for the balanced array needs no such agreement, and a chunk
 * that fails to parse costs only itself rather than the rest of the response.
 */
export function parseBatchExecute(text: string): BatchEnvelope[] {
  const out: BatchEnvelope[] = [];
  if (!text) return out;

  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('[', i);
    if (start < 0) break;

    const chunk = readBalancedArray(text, start);
    if (!chunk) break;

    let rows: unknown;
    try {
      rows = JSON.parse(chunk.text);
    } catch {
      /* Not a chunk — step past this bracket and keep looking. */
      i = start + 1;
      continue;
    }

    if (Array.isArray(rows)) for (const row of rows) collectEnvelope(row, out);
    i = chunk.end;
  }

  return out;
}

/** Pull one `["wrb.fr", rpcid, "<json>"]` row into the output list. */
function collectEnvelope(row: unknown, out: BatchEnvelope[]): void {
  if (!Array.isArray(row) || row[0] !== 'wrb.fr') return;
  const rpcid = typeof row[1] === 'string' ? row[1] : '';
  const raw = row[2];
  if (typeof raw !== 'string' || !raw) return;
  try {
    out.push({ rpcid, data: JSON.parse(raw) });
  } catch {
    /* A payload we cannot read is skipped, never thrown — one bad envelope
       must not cost us the others in the same response. */
  }
}

/**
 * Read one balanced JSON array starting at `from`, respecting strings and
 * escapes so a bracket inside a prompt does not end the chunk early.
 */
function readBalancedArray(text: string, from: number): { text: string; end: number } | null {
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = from; i < text.length; i++) {
    const c = text[i];

    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }

    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return { text: text.slice(from, i + 1), end: i + 1 };
    }
  }
  return null;
}

/* ── Reading a media record out of a payload ─────────────────────────────── */

/** Seconds-since-epoch bounds a Flow timestamp must fall inside. */
const TS_MIN = 1_600_000_000; // 2020
const TS_MAX = 4_000_000_000; // 2096

/** True for the seconds-and-nanos pair Flow uses for times. */
function isTimestampPair(v: unknown): v is [number, number] {
  return Array.isArray(v)
    && v.length >= 1
    && typeof v[0] === 'number'
    && v[0] > TS_MIN
    && v[0] < TS_MAX;
}

/** Every string anywhere inside a value, depth-limited so nothing can hang us. */
function walkStrings(v: unknown, hit: (s: string) => void, depth = 0): void {
  if (depth > 12) return;
  if (typeof v === 'string') { hit(v); return; }
  if (Array.isArray(v)) for (const x of v) walkStrings(x, hit, depth + 1);
}

/**
 * A candidate media record: an array whose first element is a UUID.
 *
 * Flow's records all lead with the media id, and nothing else in these
 * payloads is an array beginning with a bare UUID, so this finds them without
 * depending on where in the tree they sit.
 */
function isRecordShape(v: unknown): v is unknown[] {
  return Array.isArray(v) && isUuid(v[0]);
}

/** Collect record-shaped arrays from anywhere in a payload. */
export function findRecords(v: unknown, depth = 0, acc: unknown[][] = []): unknown[][] {
  if (depth > 12 || !Array.isArray(v)) return acc;
  if (isRecordShape(v)) acc.push(v);
  for (const x of v) findRecords(x, depth + 1, acc);
  return acc;
}

/**
 * The metadata block inside a record: the array carrying the prompt and the
 * creation time. Found by that pairing, in either order.
 *
 * The order matters and cost a round to learn. The media-list record leads
 * its metadata with the title:
 *
 *   ["Woman smiling with athletic build", [1787817903, 283461000], …]
 *
 * The status record — the one that actually reports progress — leads with the
 * timestamp instead:
 *
 *   [[1788575632, 79153000], "A single red paper boat drifting across …", …]
 *
 * Requiring a string at index 0 accepted the first and rejected the second,
 * so every status record was dropped and the only things reaching the cache
 * were list entries, which carry no status and therefore all read as running.
 */
function metadataOf(record: unknown[]): unknown[] | null {
  for (const el of record) {
    if (!Array.isArray(el)) continue;
    if (el.some(isTimestampPair) && el.some((x) => typeof x === 'string' && x.length > 1)) {
      return el;
    }
  }
  return null;
}

/**
 * The prompt inside a metadata block: its longest piece of prose.
 *
 * "Longest string" alone is not enough — run live, it returned
 * https://lh3.googleusercontent.com/ as the prompt of a real generation,
 * because a URL is longer than most prompts. A prompt is text a person typed,
 * so a URL is excluded outright and an unbroken token is treated as an
 * identifier rather than a sentence.
 */
function promptOf(meta: unknown[]): string {
  let best = '';
  for (const el of meta) {
    /* UUID.test rather than isUuid here: isUuid is a `v is string` guard, so
       on a value already known to be a string TypeScript narrows its negative
       branch to never and every use below becomes an error. */
    if (typeof el !== 'string' || UUID.test(el)) continue;
    if (/^https?:\/\//i.test(el)) continue;
    if (el.length > 40 && !el.includes(' ')) continue;
    if (el.length > best.length) best = el;
  }
  return best;
}

/**
 * The model, named by itself.
 *
 * Flow puts it in the request block as a plain name — veo_3_1_t2v_lite on the
 * generation recorded here — so it is found by looking like a model name
 * rather than by living at a known depth.
 */
/*
 * Families seen or named by Flow. veo_3_1_t2v_lite was read off the wire;
 * narwhal_display appeared in a project record. "omni" is inferred from the
 * UI label "Omni 1.1 Flash" on a real generation and has NOT been confirmed
 * on the wire — two probes for its token came back empty. It is listed
 * because a miss here costs an empty string and nothing reads this field,
 * whereas leaving it out guarantees the miss.
 */
const MODEL_NAME = /^(veo|imagen|gemini|lyria|nano|narwhal|omni)[a-z0-9_.-]*$/i;

function modelOf(record: unknown[]): string {
  let found = '';
  walkStrings(record, (s) => {
    if (!found && s.length < 60 && MODEL_NAME.test(s)) found = s;
  });
  return found;
}

/** Seconds-and-nanos to an ISO string, matching what the old API sent. */
function isoFrom(pair: unknown): string {
  if (!isTimestampPair(pair)) return '';
  return new Date(pair[0] * 1000).toISOString();
}

/**
 * What state a record is in.
 *
 * Deliberately not read from a status integer. The integers are unlabeled and
 * their meaning is a proto detail that can be renumbered; whether the record
 * carries a URL to fetch the result from is a fact about the generation. A
 * record with media is finished. One carrying a failure marker failed.
 *
 * Anything else is reported as still running, which is the safe direction to
 * be wrong in: the caller polls again and corrects itself, whereas a wrong
 * "completed" ends the wait and moves the queue on from a video that is not
 * there.
 */
export function mediaUrlOf(record: unknown[], ownIds: string[] = []): string {
  let video = '', image = '';
  let ownVideo = '', ownImage = '';
  let sawForeignId = false;

  walkStrings(record, (s) => {
    if (!isMediaUrl(s)) return;
    /* /asb/ is the grid thumbnail, not the file. Downloading one and naming
       it .mp4 produces a broken video that looks like a successful download,
       which is worse than no URL at all — measured on a real project load,
       29 of 58 statuses carried a media URL and NOT ONE was a /video/ one.
       The video URL only appears while the generation is in flight. */
    if (s.includes('/asb/')) return;

    /* Prefer the asset signed under this record's own id. The bare fallbacks
       are what used to run unconditionally, and on a Frames run the first
       thing they found was the user's own uploaded start frame — saved under
       the video's name and reported as a successful download. */
    const id = mediaPathId(s);
    const own = ownIds.length > 0 && (
      (!!id && ownIds.includes(id)) || (!id && ownIds.some((o) => s.includes(o))));
    if (ownIds.length && !own && (id || s.includes('getMediaUrlRedirect'))) sawForeignId = true;

    if (s.includes('/video/')) {
      if (own && !ownVideo) ownVideo = s;
      if (!video) video = s;
      return;
    }
    if (own && !ownImage) ownImage = s;
    if (!image) image = s;
  });

  if (ownVideo || ownImage) return ownVideo || ownImage;

  /* Attributable, and none of it is ours: every URL in here belongs to some
     other asset — an ingredient, a start frame. Returning one is how an
     uploaded still ended up saved as P1_G1.mp4. No URL is recoverable; a
     wrong one is not. */
  if (sawForeignId) return '';

  /* Nothing named an id, so attribution cannot be applied. Kind alone, which
     is where this function started. */
  return video || image;
}

/**
 * Whether this record has finished.
 *
 * Note what is NOT here: a failure reason. There used to be one, scanning
 * every string in the record for FAIL / SAFETY / BLOCK / REJECT / CANCEL as a
 * substring. Two things were wrong with it.
 *
 * It could not be right. A search of real response bodies for any capitalised
 * enum-looking token found none — this API does not state a failure in words,
 * so the scan had no true positive available to it.
 *
 * And it could be badly wrong, because the user's own prompt is one of the
 * strings in the record. A prompt reading "a city block at night" contains
 * BLOCK; "cancel the wedding" contains CANCEL. The scan ran BEFORE the media
 * check, so a finished video was reported failed, and the prompt was handed
 * on as the reason — classifyError then reads a word like "prominent" in it
 * and calls it a safety block, the one class that never retries.
 *
 * That cost a run of ten prompts in the sibling extension: the first died
 * three times in a minute while the grid showed it generating and then
 * finishing correctly. This adapter carried the identical code, and
 * automation.ts acts on `entry.state === 'failed'` the same way.
 *
 * So failure is not read here at all. The API answers "is it finished"; the
 * page answers "did it fail", and it answers plainly — a failed generation
 * renders <flow-error-tile> with the reason written in it.
 */
export function inferState(
  record: unknown[],
  ownIds: string[] = [],
): { state: FlowGenerationState; rawStatus: string; mediaKind: FlowMediaKind; ownMedia: boolean } {
  const { kind, ownMedia } = mediaKindOf(record, ownIds);

  switch (kind) {
    case 'video':  return { state: 'completed',  rawStatus: 'VIDEO_PRESENT',  mediaKind: kind, ownMedia };
    case 'image':  return { state: 'completed',  rawStatus: 'IMAGE_PRESENT',  mediaKind: kind, ownMedia };
    case 'legacy': return { state: 'completed',  rawStatus: 'MEDIA_PRESENT',  mediaKind: kind, ownMedia };
    case 'thumb':  return { state: 'generating', rawStatus: 'THUMBNAIL_ONLY', mediaKind: kind, ownMedia };
    default:       return { state: 'generating', rawStatus: 'NO_MEDIA_YET',   mediaKind: 'none', ownMedia };
  }
}

/**
 * What kind of media this record actually carries, and whose it is.
 *
 * The whole point is the second question. A record references assets it did
 * not produce — the start and end frames of a Frames run, an ingredient
 * image, the grid poster — and each of those is a perfectly valid media URL.
 * Counting them is what let a video report itself finished at 45%.
 *
 * Two rules separate output from input:
 *
 *   1. A poster (/asb/) is never a result. It exists as soon as there is
 *      something to show and says nothing about whether rendering is done.
 *
 *   2. A signed URL belongs to the record whose media id it is signed under.
 *      When `mediaId` is known and SOME url in the record carries a readable
 *      id, only urls carrying THIS id count — the rest are inputs.
 *
 * That second rule has a deliberate escape: if no url in the record carries a
 * readable id at all, the id test cannot be applied and kind alone decides.
 * Without it, a change to how Flow signs its URLs would leave every
 * generation permanently "generating" — a worse failure than the one being
 * fixed here, and a silent one. It warns instead, once.
 */
export function mediaKindOf(
  record: unknown[],
  ownIds: string[] = [],
): { kind: FlowMediaKind; ownMedia: boolean } {
  let ownVideo = false, ownImage = false;
  let anyVideo = false, anyImage = false;
  let legacy = false, thumb = false;
  let sawForeignId = false;

  walkStrings(record, (s) => {
    if (!isMediaUrl(s)) return;

    if (s.includes('/asb/')) { thumb = true; return; }

    if (s.includes('getMediaUrlRedirect')) {
      /* Kind-agnostic by construction: the old site resolved this to whatever
         the media turned out to be, and only ever issued it for a media that
         existed. It carries the id as ?name=, so it can still be attributed. */
      legacy = true;
      if (ownIds.some((o) => s.includes(o))) return;
      if (ownIds.length) sawForeignId = true;
      return;
    }

    const id = mediaPathId(s);
    const isVideo = s.includes('/video/');
    if (isVideo) anyVideo = true; else anyImage = true;

    if (!id || !ownIds.length) return;
    if (ownIds.includes(id)) { if (isVideo) ownVideo = true; else ownImage = true; return; }
    sawForeignId = true;
  });

  if (ownVideo) return { kind: 'video', ownMedia: true };
  if (ownImage) return { kind: 'image', ownMedia: true };
  if (legacy && !sawForeignId) return { kind: 'legacy', ownMedia: true };

  /* Nothing of this generation's own. Report the strongest kind that IS here,
     with ownMedia false, rather than erasing it to 'none'.
   *
   * Erasing it was the first version of this function and it was too strong.
   * It rests on the assumption that a result is always signed under one of
   * the record's own ids — measured true for video, never measured for image
   * — and where that assumption fails the generation reads "generating"
   * forever. A permanent silent stall is a worse failure than the one being
   * fixed, and harder to notice.
   *
   * Reporting the kind is enough regardless. The Frames case is refused
   * because an image is not a video, which is a fact about the media and not
   * an inference about how Flow signs URLs. ownMedia is carried alongside so
   * a caller that wants the stricter test can apply it. */
  if (anyVideo) return { kind: 'video', ownMedia: false };
  if (anyImage) return { kind: 'image', ownMedia: false };
  if (legacy) return { kind: 'legacy', ownMedia: false };
  if (thumb) return { kind: 'thumb', ownMedia: false };
  return { kind: 'none', ownMedia: false };
}

/* ── Built-in tracker ──────────────────────────────────────────────────────
 *
 * Why this ships rather than being pasted in when needed: the shape of a
 * record for an ingredient / image-to-video run has never been seen. This
 * parser was written against a text-to-video generation, and a run that
 * produces no statuses is indistinguishable from one whose records were all
 * quietly declined. The counters below say which, and the skeletons say what
 * the declined ones looked like.
 *
 * Read it from the Flow page console:
 *
 *     __afReport()
 *
 * It reports STRUCTURE, never content: every string becomes "uuid", "url" or
 * "str", every number becomes num. Prompts, ids and signed URLs do not appear
 * in the output, so the result is safe to paste anywhere.
 */

interface Diag {
  responses: number;
  recordsSeen: number;
  accepted: number;
  rejects: Record<string, { n: number; sample: string }>;
}

const DIAG: Diag = { responses: 0, recordsSeen: 0, accepted: 0, rejects: {} };

/** A record's shape with every value replaced by its kind. */
function skeleton(v: unknown, depth = 0): string {
  if (depth > 6) return '…';
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return 'num';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'string') {
    /* UUID.test, not isUuid: isUuid is a `v is string` guard, so on a value
       already known to be a string TypeScript narrows the branches below it
       to never. Same trap as promptOf. */
    if (UUID.test(v)) return '"uuid"';
    if (/^https?:\/\//i.test(v)) return '"url"';
    if (MEDIA_HOST_HINTS.some((h) => v.includes(h))) return '"media"';
    return '"str"';
  }
  if (Array.isArray(v)) {
    const parts = v.slice(0, 14).map((x) => skeleton(x, depth + 1));
    if (v.length > 14) parts.push('…');
    return '[' + parts.join(',') + ']';
  }
  return '?';
}

function noteReject(reason: string, record: unknown[]): void {
  const slot = DIAG.rejects[reason] || (DIAG.rejects[reason] = { n: 0, sample: '' });
  slot.n++;
  /* Keep the biggest example seen: a longer record carries more of the shape,
     and the interesting rejects are the ones that nearly qualified. */
  const s = skeleton(record);
  if (s.length > slot.sample.length) slot.sample = s.slice(0, 600);
}

/**
 * What the tracker has seen, as a JSON string.
 *
 * responses    batchexecute bodies parsed
 * recordsSeen  arrays that led with a UUID
 * accepted     those read as a generation status
 * rejects      why the rest were declined, with one shape each
 */
export function diagnostics(): string {
  return JSON.stringify({
    /* Read from the stamp sw-bypass puts on the window, not written again
       here. This was a second copy of the literal and it went stale the first
       time the protocol was bumped — __afReport() then reported the previous
       build, which is the one question this field exists to answer. */
    build: (typeof window !== 'undefined' && (window as any).__af_interceptor_build)
      || 'not-installed',
    responses: DIAG.responses,
    recordsSeen: DIAG.recordsSeen,
    accepted: DIAG.accepted,
    rejects: DIAG.rejects,
  }, null, 1);
}

/**
 * Turn one status record into the shape the rest of the extension speaks.
 *
 * Only status records are read. The other record shape Flow sends is the media
 * list, which describes what exists rather than what is happening: it has no
 * status in it, so every entry read from it came out as "generating". On one
 * real project that put 39 finished August videos into the cache as running
 * generations, uploaded ingredients among them — af_155e2676.png arrived as a
 * generation whose prompt was a filename. A cache full of confident wrong
 * answers is worse than the empty one this replaces, so list records are
 * skipped and only records that actually report progress are returned.
 *
 * Aspect ratio and duration are left empty rather than guessed; they are not
 * identifiable in this payload, and callers already treat them as optional.
 */
export function readRecord(record: unknown[]): FlowGenerationStatus | null {
  /* A status record carries three ids at its top level, in this order:
     scene, project, media. The media-list record carries two — media first,
     project last — and no status at all, which is the whole reason to tell
     them apart. Recorded live, mid-generation:

       ["8a0059c8-…",   scene
        "f1f353d5-…",   project
        "b14eade5-…",   media
        "CAE", null,
        [[1788575632,79153000], "A single red paper boat drifting across …",
         …, [["veo_3_1_t2v_lite",1,…]], …, [6], 1]]

     Counting ids rather than reading fixed indices is not free of assumption,
     but it survives a null being inserted between them, which raw indices do
     not. If Flow ever adds a fourth id the count still holds and the order is
     what would have to be re-checked — the header says how. */
  const ids = record.filter(isUuid) as string[];
  if (ids.length < 3) { noteReject('fewer than 3 ids', record); return null; }

  const meta = metadataOf(record);
  if (!meta) { noteReject('no metadata block (title + timestamp)', record); return null; }

  const { state, rawStatus, mediaKind, ownMedia } = inferState(record, ids);

  return {
    mediaKind,
    ownMedia,
    mediaId: ids[2],
    projectId: ids[1],
    workflowId: ids[0],
    state,
    rawStatus,
    failureReason: state === 'failed' ? rawStatus : '',
    promptText: promptOf(meta),
    modelName: modelOf(record),
    aspectRatio: '',
    duration: '',
    createdAt: isoFrom(meta.find(isTimestampPair)),
    mediaUrl: mediaUrlOf(record, ids),
  };
}

/**
 * Every generation status a batchexecute response describes.
 *
 * Responses carrying no records — most of them, since this one path serves the
 * whole app — yield an empty list for the cost of walking a small array.
 */
export function readStatuses(text: string): FlowGenerationStatus[] {
  const out: FlowGenerationStatus[] = [];
  const seen = new Map<string, number>();

  DIAG.responses++;
  for (const env of parseBatchExecute(text)) {
    for (const record of findRecords(env.data)) {
      DIAG.recordsSeen++;
      const status = readRecord(record);
      if (!status) continue;

      const at = seen.get(status.mediaId);
      if (at === undefined) {
        seen.set(status.mediaId, out.length);
        out.push(status);
        continue;
      }

      /* The same media can be described twice in one response, and the two
         descriptions can disagree. Seen live: one record for a finished video
         carried its URL and another, thinner one did not, so the media read
         as completed and generating at once.

         Positive evidence wins. A record carrying media proves the
         generation finished; a record without it proves nothing — it may
         simply be the shorter listing. Preferring "completed" is also the
         asymmetry that matters to a caller: it ends a wait that is already
         over, where the reverse would restart one. */
      if (status.state === 'completed' && out[at].state !== 'completed') { out[at] = status; continue; }

      /* Both finished: keep the one that carries the generation's OWN asset.
         The other describes it through an input or a poster, and its mediaUrl
         would be downloaded under this video's name. */
      if (status.state === 'completed' && status.ownMedia && !out[at].ownMedia) out[at] = status;
    }
  }

  DIAG.accepted += out.length;
  return out;
}
