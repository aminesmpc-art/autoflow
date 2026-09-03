/**
 * Reading a video on the server, in one call.
 *
 * The chat path cuts the audio into four-minute chunks and asks a chat to
 * transcribe each one in turn: six round trips and about 145 seconds on a
 * twenty-minute video, producing text with NO TIMINGS in it. Every clip cut
 * from that text then needs two to four more asks just to find where its own
 * first and last lines were spoken.
 *
 * This is one upload. The model reads the video natively — which only the API
 * can do, and the API needs a key that must never ship inside an extension
 * anyone can unpack — and returns the words WITH the seconds they occupy, plus
 * where the speaker is standing.
 *
 * That removes three separate model conversations from a run:
 *   · the six transcription asks
 *   · the two-to-four locate asks per cut
 *   · the frame-sampling ask that finds the speaker
 *
 * ── Still not trusted ─────────────────────────────────────────────────────
 *
 * The server already refuses timings that cannot be true. This refuses a
 * READING that cannot be true — a payload whose shape is wrong, or a job that
 * finished with nothing in it. A stage that returns a plausible empty answer
 * is worse than one that fails, because the failure is discovered four stages
 * later by a ranking ask choosing nonsense.
 */

import { getAccessToken, getExtractorBase } from '../../shared/api';

/* ------------------------------------------------------------------ */
/* Credentials, for callers that are not the extension                 */
/* ------------------------------------------------------------------ */

/**
 * Where the token and the host come from when there is no chrome.storage.
 *
 * The website runs this same pipeline from a page, and a page has no
 * extension storage to read — `getAccessToken()` there is not "signed out",
 * it is a ReferenceError. Set once at startup by the web entry; null in the
 * extension, where the stored values are the right answer.
 */
let injected: { token: string; baseUrl: string } | null = null;

/** Supply the credentials directly. See src/web/clipWeb.ts. */
export function useInjectedCredentials(
  credentials: { token: string; baseUrl: string } | null,
): void {
  injected = credentials;
}

/** The token to send, from whichever store this build has. */
async function tokenFor(): Promise<string | null> {
  if (injected) return injected.token || null;
  return getAccessToken();
}

/** The host to call. An explicit baseUrl still wins, as it did before. */
async function baseFor(options: { baseUrl?: string }): Promise<string> {
  if (options.baseUrl) return options.baseUrl;
  if (injected) return injected.baseUrl;
  return getExtractorBase();
}

/* ------------------------------------------------------------------ */
/* What one run may spend                                              */
/* ------------------------------------------------------------------ */

/**
 * The run has asked as much as it is allowed to.
 *
 * Not a ReadingUnavailable, and the distinction is the whole point: that class
 * means "this server cannot answer", and serverFirstAsk responds to it by
 * putting the same question to a chat tab instead. A budget that redirected
 * spending rather than stopping it would be worse than no budget, because it
 * would look like one.
 */
export class AskBudgetSpent extends Error {
  readonly budgetSpent = true;
  constructor(spent: number, ceiling: number) {
    super(
      `This run has used its ${ceiling} model asks (${spent} spent). `
      + 'Anything still unanswered was left alone rather than charged for.',
    );
    this.name = 'AskBudgetSpent';
  }
}

export const isBudgetSpent = (e: unknown): boolean =>
  !!e && typeof e === 'object' && (e as { budgetSpent?: boolean }).budgetSpent === true;

let budget: { ceiling: number; spent: number } | null = null;

/**
 * Open a budget for one run, or clear it.
 *
 * Module-level because askOnServer is reached through serverFirstAsk from four
 * different places, none of which are given the run's configuration. Passing a
 * counter down to all of them would mean changing every signature between here
 * and the stage that owns the run, for a number none of them care about.
 *
 * One run at a time, which is what both callers do — the extension runs a node
 * at a time, the website one video at a time.
 */
export function startAskBudget(ceiling: number | null): void {
  budget = typeof ceiling === 'number' && ceiling > 0
    ? { ceiling: Math.floor(ceiling), spent: 0 }
    : null;
}

/** What the open run has spent, or null when nothing is being counted. */
export function askBudget(): { ceiling: number; spent: number; left: number } | null {
  if (!budget) return null;
  return { ceiling: budget.ceiling, spent: budget.spent, left: Math.max(0, budget.ceiling - budget.spent) };
}

export interface ReadSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
}

export interface ReadScene {
  start: number;
  end: number;
  description: string;
  shot?: string | null;
  /** Where the speaker is across the frame, 0..1, or null when nobody is. */
  speaker_x?: number | null;
  on_screen_text?: string | null;
}

/**
 * One sample of where the person talking is, measured on the server.
 *
 * Not asked for — detected. The scenes carry a speaker_x too, and on real
 * footage it came back null for 8 of 8 scenes while this agreed with a
 * dedicated model ask to 0.009 of frame width. These are what framing uses.
 */
export interface TrackedFace {
  /** Seconds into the WHOLE video, not into any clip. */
  t: number;
  /** Centre of the face across the frame, 0 at the left edge and 1 at the right. */
  x: number;
  /** Face width as a fraction of frame width — how close they are to camera. */
  size?: number;
  /** How much this looked like a person facing the camera. */
  weight?: number;
}

export interface VideoReading {
  durationSec: number;
  language: string;
  summary: string;
  segments: ReadSegment[];
  scenes: ReadScene[];
  /* Where the speaker is over time, about twice a second.
     Empty means NOT MEASURED — this server cannot track faces, or the codec
     defeated it. It must never be read as "nobody was on camera": believing
     that of a missing answer is exactly what left every clip letterboxed on a
     blurred backdrop instead of cropped onto the speaker. */
  faces: TrackedFace[];
  /** Anything the server threw away, in words a person can act on. */
  dropped: string[];
  model: string;
}

/**
 * The server cannot do this — as opposed to refusing this particular request.
 *
 * A distinction worth a class, because the two need opposite handling. A quota
 * refusal or a video over the size limit is the user's to act on and must be
 * shown. A server that has never heard of the endpoint, or has no key
 * configured, is nothing the user did: the extension ships and the service
 * deploys separately, so an extension that knows about video reading will
 * routinely meet a service that does not yet. That has to fall back to the
 * chat, not fail the run.
 */
export class ReadingUnavailable extends Error {
  readonly unavailable = true;
  constructor(message: string) {
    super(message);
    this.name = 'ReadingUnavailable';
  }
}

export const isUnavailable = (e: unknown): boolean =>
  !!e && typeof e === 'object' && (e as { unavailable?: boolean }).unavailable === true;

export interface ReadOptions {
  signal?: AbortSignal;
  onProgress?: (line: string) => void;
  /** Overrides the stored host. Only used by tests and local development. */
  baseUrl?: string;
}

/* How often to ask whether the reading has finished.
   Two seconds: a twenty-minute video takes tens of seconds to read, so this
   is a handful of requests, and a shorter interval would spend more time on
   round trips than on waiting. */
const POLL_INTERVAL_MS = 2000;

/* When to give up.
   Generous, because the server may be uploading a 350MB file to the model
   before it can start. Bounded, because a job that never finishes must fail
   rather than leave a stage running for the life of the tab. */
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Whether this build can even try — there is no point offering it signed out. */
export async function canReadOnServer(): Promise<boolean> {
  return !!(await tokenFor());
}

function readReading(body: unknown, fallbackDuration: number): VideoReading | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;

  const segments: ReadSegment[] = [];
  for (const raw of Array.isArray(o.segments) ? o.segments : []) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    const start = Number(s.start);
    const end = Number(s.end);
    const text = String(s.text ?? '').trim();
    /* The server checked these already. Checking again is not distrust of the
       server — it is that a version skew between the two, which is the normal
       state of a browser extension and a service that deploy separately, must
       not put a cut in the wrong place. */
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) continue;
    segments.push({ start, end, text, speaker: (s.speaker as string) ?? null });
  }

  const scenes: ReadScene[] = [];
  for (const raw of Array.isArray(o.scenes) ? o.scenes : []) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    const start = Number(s.start);
    const end = Number(s.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const x = Number(s.speaker_x);
    scenes.push({
      start,
      end,
      description: String(s.description ?? ''),
      shot: (s.shot as string) ?? null,
      speaker_x: Number.isFinite(x) && x >= 0 && x <= 1 ? x : null,
      on_screen_text: (s.on_screen_text as string) ?? null,
    });
  }

  const duration = Number(o.duration_sec);
  /* Checked rather than taken. A position outside the frame is not a position,
     and a NaN would travel all the way into a crop rectangle before anything
     noticed — the resulting clip is not obviously wrong, it is just framed on
     nothing. */
  const faces: TrackedFace[] = [];
  for (const raw of Array.isArray(o.faces) ? o.faces : []) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Record<string, unknown>;
    const t = Number(f.t);
    const x = Number(f.x);
    if (!Number.isFinite(t) || t < 0) continue;
    if (!Number.isFinite(x) || x < 0 || x > 1) continue;
    faces.push({
      t,
      x,
      size: Number.isFinite(Number(f.size)) ? Number(f.size) : undefined,
      weight: Number.isFinite(Number(f.weight)) ? Number(f.weight) : undefined,
    });
  }
  faces.sort((a, b) => a.t - b.t);

  return {
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : fallbackDuration,
    language: String(o.language ?? 'en'),
    summary: String(o.summary ?? ''),
    segments,
    scenes,
    faces,
    dropped: (Array.isArray(o.dropped) ? o.dropped : []).map(String),
    model: String(o.model ?? ''),
  };
}

/**
 * Send the video up and wait for the reading.
 *
 * Throws with something a person can act on. Every failure here is one a user
 * can do something about — sign in, shorten the video, try again — so none of
 * them may surface as "undefined".
 */
export async function readVideoOnServer(
  file: File,
  durationSec: number,
  options: ReadOptions = {},
): Promise<VideoReading> {
  const say = options.onProgress || (() => {});
  const token = await tokenFor();
  if (!token) {
    throw new ReadingUnavailable('not signed in');
  }

  const base = await baseFor(options);

  const form = new FormData();
  form.append('file', file, file.name || 'video.mp4');
  form.append('duration_sec', String(durationSec));

  say(`sending ${(file.size / 1e6).toFixed(0)} MB up to be read`);
  let started: Response;
  try {
    started = await fetch(`${base}/api/clip/read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: options.signal,
    });
  } catch (e) {
    /* Aborting is the user stopping the run, not the server being absent. */
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ReadingUnavailable(`the reading service could not be reached at ${base}`);
  }

  if (!started.ok) {
    const message = await describeFailure(started);
    /* 404 is the ordinary case while a build is ahead of its server; 503 is a
       server with no model credentials. Neither is the user's problem. */
    if (started.status === 404 || started.status === 503) {
      throw new ReadingUnavailable(message);
    }
    throw new Error(message);
  }

  const { job_id: jobId } = (await started.json()) as { job_id?: string };
  if (!jobId) throw new Error('The server accepted the video but named no job.');

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStep = '';

  try {
    while (Date.now() < deadline) {
      if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      await sleep(POLL_INTERVAL_MS);

      const poll = await fetch(`${base}/api/clip/status/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: options.signal,
      });
      if (!poll.ok) throw new Error(await describeFailure(poll));

      const status = (await poll.json()) as {
        status?: string; step?: string; error?: string; result?: unknown;
      };

      if (status.step && status.step !== lastStep) {
        lastStep = status.step;
        say(lastStep);
      }

      if (status.status === 'failed') {
        throw new Error(status.error || 'The server could not read that video.');
      }
      if (status.status === 'cancelled') {
        throw new DOMException('The video reading was cancelled.', 'AbortError');
      }
      if (status.status === 'completed') {
        const reading = readReading(status.result, durationSec);
        if (!reading) throw new Error('The reading came back in a shape this build cannot use.');
        if (!reading.segments.length) {
          throw new Error(
            reading.dropped[0]
              ? `Nothing usable came back: ${reading.dropped[0]}`
              : 'The reading found no speech in that video.',
          );
        }
        return reading;
      }
    }

    throw new Error('The server was still reading the video after fifteen minutes.');
  } catch (error) {
    /* Uploading and model reading keep consuming server resources after a tab
       abort unless the owner explicitly cancels the accepted job. Do this
       without the already-aborted signal, and never hide the original error. */
    try {
      await fetch(`${base}/api/clip/status/${jobId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      /* Best effort: the original failure is the useful one to report. */
    }
    throw error;
  }
}

/**
 * Put one text question to the model through the server.
 *
 * The prompt is built here and the reply is parsed here, exactly as they are
 * for the chat path — the server only adds the key. Keeping the prompt and
 * the parser on this side is the point: they are tested here, and a copy in
 * Python would drift from them.
 *
 * This exists because the ranking was the last step still going through a
 * chat tab, and on a real twenty-minute run it failed three times in a row —
 * message channel closed, did not finish answering, lost connection — while
 * the API calls either side of it worked first time. It is also the cheap
 * part: reading the video costs about 160k tokens and this about 3.5k.
 */
export interface AskOptions extends ReadOptions {
  /* data: URLs the model should see alongside the question — a span of audio
     to find a line in, or the stills sampled across a clip.

     The server refuses anything that is not audio or an image. A video belongs
     on /read, which is metered as the expensive call it is; smuggling one
     through here would route it around its own accounting. */
  attachments?: string[];
}

export async function askOnServer(
  prompt: string,
  options: AskOptions = {},
): Promise<string> {
  /* Before the token, before the fetch. A refusal that has already sent the
     request has not saved anything. */
  if (budget && budget.spent >= budget.ceiling) {
    throw new AskBudgetSpent(budget.spent, budget.ceiling);
  }

  const token = await tokenFor();
  if (!token) throw new ReadingUnavailable('not signed in');

  const base = await baseFor(options);
  const attachments = (options.attachments || []).filter(
    (a) => typeof a === 'string' && a.startsWith('data:'),
  );

  /* Counted at the point of sending. A request that is made and then fails is
     a request the model may still have been paid for, and a budget that only
     counted successes would let a run retry its way past the ceiling. */
  if (budget) budget.spent++;

  let response: Response;
  try {
    response = await fetch(`${base}/api/clip/ask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        attachments.length ? { prompt, json_only: true, attachments } : { prompt, json_only: true },
      ),
      signal: options.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ReadingUnavailable(`the reading service could not be reached at ${base}`);
  }

  if (!response.ok) {
    const message = await describeFailure(response);
    if (response.status === 404 || response.status === 503) {
      throw new ReadingUnavailable(message);
    }
    throw new Error(message);
  }

  const body = (await response.json()) as { text?: string; attachments_received?: number };

  /* An answer about the attachments, or an answer about nothing.
     A build of the service that predates attachments ignores the field — the
     server's model drops unknown keys — and answers the prompt as plain text.
     "Where is the speaker in each of these 8 stills" then comes back with
     eight confident positions for images the model never saw, which is a
     fabricated answer wearing the shape of a real one.

     Observed during the rolling deploy that shipped attachments: one instance
     refused a video and the other answered it. The extension ships through a
     store review and the service deploys on a push, so a client ahead of its
     server is the normal state.

     Unavailable rather than an error, because it is precisely "this server
     cannot do this" — so the caller falls back to the chat, which CAN carry
     the attachments, instead of failing the run. */
  if (attachments.length && Number(body?.attachments_received) !== attachments.length) {
    throw new ReadingUnavailable(
      'this server answered without looking at the attachment',
    );
  }

  const text = String(body?.text || '').trim();
  /* An empty answer parses to no clips, which the survey reads as "nothing in
     this video is worth posting" — a wrong answer wearing the shape of a
     right one. */
  if (!text) throw new Error('The model returned nothing to the server.');
  return text;
}

/** An HTTP failure, in words rather than a status code. */
async function describeFailure(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = await response.json();
    detail = String((body as any)?.detail || '');
  } catch {
    /* a proxy error page rather than the service's own JSON */
  }
  if (response.status === 401) {
    return 'The server did not accept your sign-in. Sign in again and retry.';
  }
  if (response.status === 402 || response.status === 429) {
    return detail || 'You are out of video readings on your current plan.';
  }
  if (response.status === 413) {
    return detail || 'That video is larger than the server will accept.';
  }
  if (response.status === 503) {
    return detail || 'the server has no model credentials configured';
  }
  if (response.status === 404) {
    return 'this server does not offer video reading yet';
  }
  return detail || `The reading service answered ${response.status}.`;
}
