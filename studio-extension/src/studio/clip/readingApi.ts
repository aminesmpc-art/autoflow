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

export interface VideoReading {
  durationSec: number;
  language: string;
  summary: string;
  segments: ReadSegment[];
  scenes: ReadScene[];
  /** Anything the server threw away, in words a person can act on. */
  dropped: string[];
  model: string;
}

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
  return !!(await getAccessToken());
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
  return {
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : fallbackDuration,
    language: String(o.language ?? 'en'),
    summary: String(o.summary ?? ''),
    segments,
    scenes,
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
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Reading a video on the server needs you to be signed in.');
  }

  const base = options.baseUrl || (await getExtractorBase());

  const form = new FormData();
  form.append('file', file, file.name || 'video.mp4');
  form.append('duration_sec', String(durationSec));

  say(`sending ${(file.size / 1e6).toFixed(0)} MB up to be read`);
  const started = await fetch(`${base}/api/clip/read`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: options.signal,
  });

  if (!started.ok) {
    throw new Error(await describeFailure(started));
  }

  const { job_id: jobId } = (await started.json()) as { job_id?: string };
  if (!jobId) throw new Error('The server accepted the video but named no job.');

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStep = '';

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
    return detail || 'The reading service is not configured on the server.';
  }
  return detail || `The reading service answered ${response.status}.`;
}
