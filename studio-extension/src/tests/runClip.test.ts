/**
 * The stages, wired to real asks, and the single cut that runs on its own.
 *
 * These tests assert what was SENT, not only what came back. That is where
 * this pipeline's failures live: the reply always parses, so the interesting
 * questions are whether the audio actually went up with the transcription ask,
 * whether the second locating ask was narrowed before it was made, whether a
 * repair round was spent before giving up, and whether a stage refused before
 * spending an encode on input it already knew was wrong.
 *
 * The node surveys; it no longer cuts. What used to be tested here as three
 * more stages — choose the window, cut it, direct the beats over it — is now
 * one Cut node per moment, so those claims are tested against runOneCut.
 *
 * Every media operation is faked. Not to make the tests easy — decode and
 * encode need WebCodecs, which does not exist here — but the orchestration is
 * the part with the judgement in it, and it is fully reachable this way.
 */

import {
  ingestStage, transcribeStage, surveyStage,
  type ClipDeps, type ClipConfig, type ProbeLike,
  stagesToSkip,
  runOneCut,
} from '../studio/clip/runClip';

/* ------------------------------------------------------------------ */

interface Sent { message: string; attachments: number; }

const HOOK = 'the housing market is about to crash and nobody is talking about it';
const CLOSE = 'so when someone tells you the market is fine you already know better';
const CLIP_TEXT = `${HOOK} the banks are hiding the real numbers from the public right now `
  + `they reported three percent growth but the real figure is far worse ${CLOSE}`;

const PROBE: ProbeLike = {
  durationSec: 600,
  video: { width: 1920, height: 1080, rotation: 0, decodable: true },
  audio: { sampleRate: 48000, channels: 2, decodable: true },
  alreadyVertical: false,
};

function harness(opts: {
  replies?: string[];
  probe?: Partial<ProbeLike>;
  noSource?: boolean;
  pcm?: { seconds: number } | null;
} = {}) {
  const sent: Sent[] = [];
  const media = { audioSpans: [] as Array<[number, number]>, frameTimes: [] as number[][], cuts: [] as any[] };
  const stored = new Map<string, Blob>();
  const logs: string[] = [];
  let reply = 0;

  const probe = { ...PROBE, ...(opts.probe || {}) } as ProbeLike;

  const deps: ClipDeps = {
    ask: async (message, options) => {
      sent.push({ message, attachments: options?.attachments?.length ?? 0 });
      const r = opts.replies?.[reply];
      reply++;
      return r ?? '';
    },
    getSource: (key) => (opts.noSource ? undefined : ({ name: 'p.mp4', size: 10, lastModified: 1, key } as unknown as File)),
    putMedia: (k, b) => stored.set(k, b),
    log: (l) => logs.push(l),
    media: {
      probe: async () => probe,
      audioDataUrl: async (_f, a, b) => { media.audioSpans.push([a, b]); return `data:audio/wav;base64,AAA${a}`; },
      /* Three seconds of speech centred on whatever was asked about, with a
         pause just before the middle. Returning a buffer that does NOT span
         the target makes snapToSilence correctly refuse — which is right, and
         made an earlier version of this fake look like a broken snapper. */
      pcmAround: async (_f, target, radius) => (opts.pcm === null ? null : {
        samples: (() => {
          const rate = 16000;
          const s = new Float32Array(rate * 3);
          for (let i = 0; i < s.length; i++) s[i] = ((i * 7919) % 100) / 100 - 0.5;
          /* Off-centre on purpose. Centred, the midpoint of the pause lands
             exactly on the target, and a working snap is indistinguishable
             from no snap at all — which is how an earlier version of this
             test failed against correct code. */
          for (let i = Math.floor(rate * 0.9); i < Math.floor(rate * 1.3); i++) s[i] = 0;
          return s;
        })(),
        sampleRate: 16000,
        startSec: target - radius,
      }),
      frames: async (_f, times) => { media.frameTimes.push(times); return times.map((t) => `data:image/png;base64,F${t}`); },
      cut: async (_f, o) => {
        media.cuts.push(o);
        return { blob: new Blob(['x']), width: 608, height: 1080, mode: 'locked', report: 'cut' };
      },
    },
  };

  const cfg: ClipConfig = { sourceKey: 'src-1' };
  return { deps, cfg, sent, media, stored, logs };
}

const TRANSCRIPT = { chunks: [{ index: 0, start: 0, end: 600, text: CLIP_TEXT }], duration: 600 };

const beatsReply = (clipSeconds: number) => JSON.stringify({
  beats: [
    { n: 1, start: 0, end: 6, edit: 'a-roll', caption: HOOK },
    {
      n: 2, start: 6, end: 14, edit: 'b-roll',
      caption: 'the banks are hiding the real numbers from the public',
      still_prompt: 'a torn paper bar chart on cream, charcoal bars, one orange',
      motion_prompt: 'the bars grow, camera dollies in',
    },
    { n: 3, start: 14, end: clipSeconds, edit: 'a-roll', caption: CLOSE },
  ],
});

/* ------------------------------------------------------------------ */

describe('ingest', () => {
  it('refuses with instructions when the file is gone', async () => {
    /* The bytes live in memory and the run lives in node data, so reopening
       Studio keeps the work and loses the file. The message has to say which. */
    const h = harness({ noSource: true });
    await expect(ingestStage(h.deps, h.cfg)(undefined)).rejects.toThrow(/drop the same file/i);
  });

  it('refuses a file with no audio', async () => {
    const h = harness({ probe: { audio: null } });
    await expect(ingestStage(h.deps, h.cfg)(undefined)).rejects.toThrow(/no audio track/i);
  });

  it('refuses audio this browser cannot decode', async () => {
    /* Found at probe time costs nothing; found mid-run costs whatever has
       already been spent. */
    const h = harness({ probe: { audio: { sampleRate: 48000, channels: 2, decodable: false } } });
    await expect(ingestStage(h.deps, h.cfg)(undefined)).rejects.toThrow(/no decoder/i);
  });

  it('refuses a recording too short to clip from', async () => {
    const h = harness({ probe: { durationSec: 12 } });
    await expect(ingestStage(h.deps, h.cfg)(undefined)).rejects.toThrow(/shorter than/i);
  });

  it('passes a usable recording through', async () => {
    const h = harness();
    await expect(ingestStage(h.deps, h.cfg)(undefined)).resolves.toMatchObject({ durationSec: 600 });
  });
});

/* ------------------------------------------------------------------ */

describe('transcribe', () => {
  const words = (n: number) => new Array(n).fill('word').join(' ');

  it('uses a pasted transcript and asks nobody anything', async () => {
    /* The escape hatch. Many podcasts publish a transcript, and using it
       turns eight minutes into nothing. */
    const h = harness();
    const real = words(1500);                 // 600s at a normal speaking rate
    const cfg = { ...h.cfg, pastedTranscript: real };
    const out = await transcribeStage(h.deps, cfg)(PROBE) as any;
    expect(h.sent).toHaveLength(0);
    expect(out.chunks[0].text).toBe(real);
  });

  it('refuses text wired into T that cannot be a transcript', async () => {
    /* This happened. T is the obvious port to wire a Prompt node into, and a
       Prompt node is the obvious place to write direction, so "we want good
       video with motion graphics" became the transcript of a 20-minute video.
       Six words were sliced across ten candidate moments, a chat was asked
       which were worth posting, and it correctly answered {"clips":[]} — and
       the node blamed the ranking stage, two stages after the real mistake. */
    const h = harness();
    const cfg = { ...h.cfg, pastedTranscript: 'we want good video with motion graphics' };
    await expect(transcribeStage(h.deps, cfg)(PROBE)).rejects.toThrow(/summary, not a transcript/);
    await expect(transcribeStage(h.deps, cfg)(PROBE)).rejects.toThrow(/put it in Settings/);
    expect(h.sent).toHaveLength(0);
  });

  it('refuses a pasted transcript with impossibly many words too', async () => {
    const h = harness();
    const cfg = { ...h.cfg, pastedTranscript: words(9000) };   // 900 wpm
    await expect(transcribeStage(h.deps, cfg)(PROBE)).rejects.toThrow(/more than anyone can say/);
  });

  it('sends the audio up with every chunk', async () => {
    /* The claim the whole design rests on: transcription is done on audio,
       four minutes at a time. An ask with no attachment is a model inventing
       a transcript of nothing. */
    const h = harness({ replies: new Array(4).fill(words(600)) });
    await transcribeStage(h.deps, h.cfg)(PROBE);
    expect(h.sent.length).toBeGreaterThanOrEqual(3);
    for (const s of h.sent) expect(s.attachments).toBe(1);
  });

  it('forbids timestamps rather than requesting them', async () => {
    /* Measured: at twelve minutes the model returns a flawless arithmetic
       sequence rather than saying it cannot place a passage. So the ask must
       give it no opening to invent one.
     *
       Asserted as "no timestamp FIELD is requested" — an earlier version
       checked the word `timestamp` did not appear, which failed against a
       prompt whose whole point is the sentence "No timestamps". */
    const h = harness({ replies: new Array(4).fill(words(600)) });
    await transcribeStage(h.deps, h.cfg)(PROBE);
    for (const s of h.sent) {
      expect(s.message).not.toMatch(/start_seconds|start_time|"timestamp"/i);
      expect(s.message).toMatch(/No timestamps/);
    }
  });

  it('cuts the chunks at the planned spans', async () => {
    const h = harness({ replies: new Array(4).fill(words(600)) });
    await transcribeStage(h.deps, h.cfg)(PROBE);
    expect(h.media.audioSpans[0][0]).toBe(0);
    expect(h.media.audioSpans[h.media.audioSpans.length - 1][1]).toBe(600);
  });

  it('refuses a summary dressed as a transcript', async () => {
    /* Twenty words for four minutes. It comes back well formed with no error
       attached, which is the only reason this is checked at all. */
    const h = harness({ replies: [words(20)] });
    await expect(transcribeStage(h.deps, h.cfg)(PROBE)).rejects.toThrow(/summary, not a transcript/);
  });

  it('stitches the chunks into one transcript', async () => {
    const h = harness({ replies: new Array(4).fill(words(600)) });
    const out = await transcribeStage(h.deps, h.cfg)(PROBE) as any;
    expect(out.duration).toBe(600);
    expect(out.chunks.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */

describe('what campaign mode still decides', () => {
  /* Campaign mode used to skip the beats stage, because a brief forbidding
     "content that is not affiliated with this campaign" forbids a generated
     graphic. The rule survives; the stage does not. It is now enforced where
     the decision is actually made — surveyAsk does not OFFER B-roll under a
     campaign, and emitPlan drops any that arrives anyway. Both are tested in
     emitPlan.test.ts, which is where this claim went.

     What used to sit here besides this was five tests of the window stage's
     campaign branch — the audio shortlist, the rules in the prompt, the
     verbatim-quote demand. That stage is gone: the moment is chosen by the
     survey now, and those claims are tested against surveyStage. */
  it('skips nothing, in either mode', () => {
    expect(stagesToSkip({ sourceKey: 'x', mode: 'campaign' })).toEqual({});
    expect(stagesToSkip({ sourceKey: 'x', mode: 'explainer' })).toEqual({});
    expect(stagesToSkip({ sourceKey: 'x' })).toEqual({});
  });
});


/* ------------------------------------------------------------------ */

describe('a cut whose boundaries were already read', () => {
  /* These count asks made THROUGH A CHAT, so they pin readOnServer: false.
     Not to dodge the change — where those asks go by default moved to the API,
     and the block at the end of this file covers that — but because the claim
     each one makes is "an ask still happens here", and the chat is where an
     ask is countable in this harness. The chat path is still reachable: it is
     what a run falls back to when the service cannot answer. */
  /* THE saving. Locating a clip from the audio costs up to four asks — coarse
     then narrowed, for each of two lines — plus one more to find the speaker
     in sampled stills. When the video was read on the server, all five of
     those were answered once, for the whole video, before any clip existed.

     These count asks rather than checking output, because the output is the
     same either way; what changed is what it cost. */

  const KNOWN = {
    sourceKey: 'p',
    hookLine: 'Look at these straw bales right here',
    closingLine: 'Darius has already been arrested',
  };

  it('asks nothing at all when the times and the framing are known', async () => {
    const h = harness();
    await runOneCut(h.deps, {
      ...KNOWN,
      startSec: 83.1,
      endSec: 108.3,
      faces: [{ t: 0, x: 0.46 }, { t: 12, x: 0.38 }, { t: 24, x: 0.5 }],
    });
    expect(h.sent).toHaveLength(0);
  });

  it('cuts the seconds it was given, snapped to the nearest pauses', async () => {
    const h = harness();
    const cut = await runOneCut(h.deps, {
      ...KNOWN,
      startSec: 83.1,
      endSec: 108.3,
      faces: [{ t: 0, x: 0.5 }, { t: 12, x: 0.5 }],
    });
    /* Snapping still happens: it is local arithmetic on audio already in
       hand, it costs nothing, and it is what stops a clip opening mid-word. */
    expect(cut.startSec).toBeCloseTo(83.1, 0);
    expect(cut.endSec).toBeCloseTo(108.3, 0);
    expect(cut.clipSeconds).toBeGreaterThan(20);
  });

  it('still asks where the speaker is when the reading did not say', async () => {
    const h = harness({ replies: ['{"positions":[{"n":1,"x":0.4}]}'] });
    await runOneCut(h.deps, { ...KNOWN, startSec: 83.1, endSec: 108.3, readOnServer: false });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].message).toMatch(/horizontal position/i);
  });

  it('refuses a single described position rather than framing on it', async () => {
    /* One sample is a fixed crop, which the frame-sampling ask does better. */
    const h = harness({ replies: ['{"positions":[{"n":1,"x":0.4}]}'] });
    await runOneCut(h.deps, {
      ...KNOWN, startSec: 83.1, endSec: 108.3, faces: [{ t: 0, x: 0.46 }],
      readOnServer: false,
    });
    expect(h.sent).toHaveLength(1);
  });

  it('locates from the audio when the boundaries were not read', async () => {
    const h = harness({ replies: ['{"start_seconds": 20}', '{"start_seconds": 20}',
      '{"start_seconds": 40}', '{"start_seconds": 40}', '{"positions":[{"n":1,"x":0.5}]}'] });
    await runOneCut(h.deps, { ...KNOWN, nearSec: 30, readOnServer: false });
    expect(h.sent.length).toBeGreaterThanOrEqual(4);
    expect(h.sent[0].message).toMatch(/At what second/i);
  });

  it('ignores boundaries that cannot be true and locates instead', async () => {
    /* A start past the end of the video is a version skew between the
       extension and the service, not a measurement. */
    const h = harness({ replies: ['{"start_seconds": 20}', '{"start_seconds": 20}',
      '{"start_seconds": 40}', '{"start_seconds": 40}', '{"positions":[{"n":1,"x":0.5}]}'] });
    await runOneCut(h.deps, { ...KNOWN, startSec: 99999, endSec: 100050, readOnServer: false });
    expect(h.sent.length).toBeGreaterThanOrEqual(4);
  });

  it('caps a clip whose read end runs past the longest allowed', async () => {
    const h = harness();
    const cut = await runOneCut(h.deps, {
      ...KNOWN, startSec: 10, endSec: 500, maxSeconds: 60,
      faces: [{ t: 0, x: 0.5 }, { t: 30, x: 0.5 }],
    });
    expect(cut.clipSeconds).toBeLessThanOrEqual(62);
  });
});


/* ------------------------------------------------------------------ */

jest.mock('../studio/clip/readingApi', () => {
  class ReadingUnavailable extends Error {
    readonly unavailable = true;
  }
  return {
    ReadingUnavailable,
    isUnavailable: (e: unknown) =>
      !!e && typeof e === 'object' && (e as any).unavailable === true,
    canReadOnServer: async () => true,
    readVideoOnServer: jest.fn(),
    askOnServer: jest.fn(),
  };
});

describe('reading on the server, when the server cannot', () => {
  /* The extension ships through a store review and the service deploys on a
     push, so a build that knows about video reading routinely meets a service
     that does not yet. On the day this was written the deployed extractor
     answered 404 to the new endpoint — with readOnServer defaulting on, that
     would have failed Transcribe for every user, over a feature nobody had
     asked for and whose absence costs nothing but time. */

  const readingApi = jest.requireMock('../studio/clip/readingApi');

  const serverCfg = (h: ReturnType<typeof harness>) => ({ ...h.cfg, readOnServer: true });

  beforeEach(() => {
    readingApi.readVideoOnServer.mockReset();
  });

  it('keeps the reason on the run, not just in a log line', async () => {
    /* This happened. A run fell back to the chat, said why once, and the next
       progress line overwrote it — so afterwards a fallback run and a normal
       one were indistinguishable, and the most actionable fact about it (two
       minutes instead of ten seconds, for a fixable reason) was gone. */
    const h = harness({ replies: new Array(6).fill('word '.repeat(600)) });
    readingApi.readVideoOnServer.mockRejectedValue(
      new readingApi.ReadingUnavailable('this server does not offer video reading yet'),
    );

    const out = await transcribeStage(h.deps, serverCfg(h))(PROBE) as any;

    expect(out.fallback).toBe('this server does not offer video reading yet');
    // and it survives later progress, because it is on the result
    expect(h.logs[h.logs.length - 1]).not.toMatch(/does not offer/);
  });

  it('leaves no fallback reason when the server did the reading', async () => {
    const h = harness();
    readingApi.readVideoOnServer.mockResolvedValue({
      durationSec: 600, language: 'en', summary: '', model: 'gemini-3.7-flash',
      dropped: [], scenes: [],
      segments: [{ start: 1, end: 4, text: 'a phrase that is long enough' }],
    });
    const out = await transcribeStage(h.deps, serverCfg(h))(PROBE) as any;
    expect(out.fallback).toBeUndefined();
  });

  it('falls back to the chat when the endpoint is not deployed', async () => {
    const h = harness({ replies: new Array(6).fill('word '.repeat(600)) });
    readingApi.readVideoOnServer.mockRejectedValue(
      new readingApi.ReadingUnavailable('this server does not offer video reading yet'),
    );

    const out = await transcribeStage(h.deps, serverCfg(h))(PROBE) as any;

    expect(out.chunks.length).toBeGreaterThan(0);      // the run continued
    expect(out.reading).toBeUndefined();
    expect(h.sent.length).toBeGreaterThan(0);          // via the chat
    expect(h.logs.join(' ')).toMatch(/does not offer video reading yet/);
    expect(h.logs.join(' ')).toMatch(/chat instead/);
  });

  it('falls back when the service cannot be reached at all', async () => {
    const h = harness({ replies: new Array(6).fill('word '.repeat(600)) });
    readingApi.readVideoOnServer.mockRejectedValue(
      new readingApi.ReadingUnavailable('the reading service could not be reached'),
    );
    const out = await transcribeStage(h.deps, serverCfg(h))(PROBE) as any;
    expect(out.chunks.length).toBeGreaterThan(0);
  });

  it('does NOT fall back when the refusal is the user to act on', async () => {
    /* A quota refusal hidden behind two minutes of chat transcription is a
       bill they did not expect and a limit they never saw. */
    const h = harness({ replies: new Array(6).fill('word '.repeat(600)) });
    readingApi.readVideoOnServer.mockRejectedValue(
      new Error('You are out of video readings on your current plan.'),
    );

    await expect(transcribeStage(h.deps, serverCfg(h))(PROBE)).rejects.toThrow(/out of video readings/);
    expect(h.sent).toHaveLength(0);       // nothing was spent in the chat
  });

  it('uses the reading and asks nobody anything when the server can', async () => {
    const h = harness();
    readingApi.readVideoOnServer.mockResolvedValue({
      durationSec: 600,
      language: 'en',
      summary: 'a chase',
      model: 'gemini-3.7-flash',
      dropped: [],
      segments: [
        { start: 83.1, end: 85.4, text: 'Look at these straw bales right here.' },
        { start: 104.0, end: 108.3, text: 'Darius has already been arrested.' },
      ],
      scenes: [{ start: 80, end: 110, description: 'a field', speaker_x: 0.4 }],
    });

    const out = await transcribeStage(h.deps, serverCfg(h))(PROBE) as any;

    expect(h.sent).toHaveLength(0);                    // no chat transcription
    expect(out.reading).toBeDefined();
    expect(out.chunks).toHaveLength(2);
    expect(out.chunks[0]).toMatchObject({ start: 83.1, end: 85.4 });
    expect(h.logs.join(' ')).toMatch(/gemini-3\.7-flash/);
  });

  it('never asks the server when the node was set to use the chat', async () => {
    const h = harness({ replies: new Array(6).fill('word '.repeat(600)) });
    await transcribeStage(h.deps, { ...h.cfg, readOnServer: false })(PROBE);
    expect(readingApi.readVideoOnServer).not.toHaveBeenCalled();
  });
});


/* ------------------------------------------------------------------ */

describe('ranking through the server', () => {
  /* The ranking was the last step still going through a chat tab, and on a
     real twenty-minute run it failed three times in a row — message channel
     closed, did not finish answering, lost connection — while the API calls
     either side of it worked first time. It is also the cheap part: reading
     the video costs about 160k tokens and ranking about 3.5k. */

  const readingApi = jest.requireMock('../studio/clip/readingApi');

  const REPLY = JSON.stringify({ clips: [{
    moment: 1, hook_line: 'Look at these straw bales right here',
    closing_line: 'Darius has already been arrested', why: 'an arrest',
    hook: 26, value: 35, standalone: 18, shareable: 8, score: 87,
  }] });

  /* Phrase-level chunks, which is what a server reading produces — and what
     findTextMoments needs. The harness's fake audio is deliberately flat, so
     the shortlist here comes entirely from what is said, which is the case
     this whole path exists for. */
  const LINES = [
    'Most people lose money because they enter far too early.',
    'The mistake is chasing the candle instead of waiting for it.',
    'You should never enter without a confirmed structure shift.',
    'That is why I wait for the fifteen minute retest every time.',
    'Here is what nobody tells you about position sizing.',
    'You need to risk one percent, not ten, on any single idea.',
    'The problem is that greed feels exactly like conviction.',
    'And that is how you survive a bad month.',
  ];
  const transcript = {
    duration: 600,
    chunks: LINES.map((text, i) => ({ index: i, start: i * 4, end: i * 4 + 3.6, text })),
  };

  beforeEach(() => {
    readingApi.askOnServer.mockReset();
  });

  const cfgFor = (h: ReturnType<typeof harness>, over: Partial<ClipConfig> = {}) =>
    ({ ...h.cfg, readOnServer: true, ...over });

  it('puts the ranking to the server, not to a chat tab', async () => {
    const h = harness();
    readingApi.askOnServer.mockResolvedValue(REPLY);

    const out = await surveyStage(h.deps, cfgFor(h))(transcript, undefined) as any;

    expect(readingApi.askOnServer).toHaveBeenCalledTimes(1);
    expect(h.sent).toHaveLength(0);                       // no chat ask at all
    expect(out.moments).toHaveLength(1);
    expect(h.logs.join(' ')).toMatch(/ranked on the server/);
  });

  it('sends the same prompt it would have sent the chat', async () => {
    /* The prompt and the parser stay on this side. Only where the question is
       put changes — a copy of either in Python would drift from the tested
       one here. */
    const h = harness();
    readingApi.askOnServer.mockResolvedValue(REPLY);
    await surveyStage(h.deps, cfgFor(h))(transcript, undefined);

    const prompt = readingApi.askOnServer.mock.calls[0][0];
    expect(prompt).toMatch(/hook       0-30/);
    expect(prompt).toMatch(/MOMENT 1/);
  });

  it('falls back to the chat when the server cannot rank', async () => {
    const h = harness({ replies: [REPLY] });
    readingApi.askOnServer.mockRejectedValue(
      new readingApi.ReadingUnavailable('not signed in'),
    );

    const out = await surveyStage(h.deps, cfgFor(h))(transcript, undefined) as any;

    expect(h.sent).toHaveLength(1);                       // it asked the chat
    expect(out.moments).toHaveLength(1);
    expect(h.logs.join(' ')).toMatch(/ranking in the chat instead/);
  });

  it('does NOT fall back when the refusal is the user to act on', async () => {
    const h = harness({ replies: [REPLY] });
    readingApi.askOnServer.mockRejectedValue(new Error('You are out of readings.'));

    await expect(surveyStage(h.deps, cfgFor(h))(transcript, undefined))
      .rejects.toThrow(/out of readings/);
    expect(h.sent).toHaveLength(0);
  });

  it('uses the chat when the node was set to use the chat', async () => {
    const h = harness({ replies: [REPLY] });
    await surveyStage(h.deps, cfgFor(h, { readOnServer: false }))(transcript, undefined);
    expect(readingApi.askOnServer).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(1);
  });
});


/* ------------------------------------------------------------------ */

describe('the asks a cut cannot avoid go to the API, not to a chat tab', () => {
  /* The reading answers both of these outright whenever it covers the clip,
     and the tests above pin that down by counting asks. These are about what
     happens when it does NOT: a clip the reading never described, or one whose
     quoted lines could not be found in it.

     Before this, those fell through to the chat — which meant opening a
     conversation, uploading eight stills through a composer, waiting on a
     streamed reply, and leaving a thread behind. Same question, same parser,
     one HTTP request. */

  const readingApi = jest.requireMock('../studio/clip/readingApi');

  const UNLOCATED = {
    sourceKey: 'p',
    hookLine: 'Look at these straw bales right here',
    closingLine: 'Darius has already been arrested',
    nearSec: 100,
  };

  beforeEach(() => {
    readingApi.askOnServer.mockReset();
  });

  it('locates a line through the server', async () => {
    const h = harness();
    readingApi.askOnServer.mockResolvedValue('{"start_seconds": 12}');

    await runOneCut(h.deps, { ...UNLOCATED, readOnServer: true });

    expect(readingApi.askOnServer).toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);                    // nothing went to a chat
  });

  it('sends the audio with it', async () => {
    /* The question is "when is this line said in THIS span". Without the span
       attached the model is being asked to recall a video it has never heard,
       and will answer anyway. */
    const h = harness();
    readingApi.askOnServer.mockResolvedValue('{"start_seconds": 12}');

    await runOneCut(h.deps, { ...UNLOCATED, readOnServer: true });

    const [, options] = readingApi.askOnServer.mock.calls[0];
    expect(options.attachments).toHaveLength(1);
    expect(options.attachments[0]).toMatch(/^data:audio\/wav;base64,/);
  });

  it('sends the sampled stills with the framing question', async () => {
    const h = harness();
    readingApi.askOnServer.mockResolvedValue(
      JSON.stringify({ positions: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ n, x: 0.3 })) }),
    );

    await runOneCut(h.deps, {
      sourceKey: 'p',
      hookLine: 'Look at these straw bales right here',
      closingLine: 'Darius has already been arrested',
      startSec: 83.1, endSec: 95.4,
      readOnServer: true,
    });

    const framing = readingApi.askOnServer.mock.calls.at(-1);
    expect(framing[1].attachments.length).toBeGreaterThan(1);
    expect(framing[1].attachments[0]).toMatch(/^data:image\//);
    expect(h.sent).toHaveLength(0);
  });

  it('is what a cut does by default, including one saved before the flag', async () => {
    /* Node data is persisted, so cuts laid out by an older build come back
       with readOnServer undefined. Defaulting that to the chat would leave
       every existing workflow on the slow path silently. */
    const h = harness();
    readingApi.askOnServer.mockResolvedValue('{"start_seconds": 12}');

    await runOneCut(h.deps, { ...UNLOCATED });        // no flag at all

    expect(readingApi.askOnServer).toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);
  });

  it('uses the chat when the director was set to the chat', async () => {
    const h = harness({ replies: ['{"start_seconds": 12}', '{"start_seconds": 20}', '{"positions":[]}'] });

    await runOneCut(h.deps, { ...UNLOCATED, readOnServer: false });

    expect(readingApi.askOnServer).not.toHaveBeenCalled();
    expect(h.sent.length).toBeGreaterThan(0);
  });

  it('falls back to the chat when the server cannot answer at all', async () => {
    const h = harness({ replies: ['{"start_seconds": 12}', '{"start_seconds": 20}', '{"positions":[]}'] });
    readingApi.askOnServer.mockRejectedValue(
      new readingApi.ReadingUnavailable('not signed in'),
    );

    await runOneCut(h.deps, { ...UNLOCATED, readOnServer: true });

    expect(h.sent.length).toBeGreaterThan(0);
    expect(h.logs.join(' ')).toMatch(/not signed in/);
    expect(h.logs.join(' ')).toMatch(/chat instead/);
  });

  it('raises a real refusal rather than quietly re-asking a chat', async () => {
    /* A quota refusal, a rejected attachment, or a model error is an ANSWER.
       Retrying it through a chat tab would spend a minute arriving at the same
       place, and hide the reason the run should have stopped on. */
    const h = harness({ replies: ['{"start_seconds": 12}'] });
    readingApi.askOnServer.mockRejectedValue(
      new Error('You are out of video readings on your current plan.'),
    );

    await expect(
      runOneCut(h.deps, { ...UNLOCATED, readOnServer: true }),
    ).rejects.toThrow(/out of video readings/);
    expect(h.sent).toHaveLength(0);
  });
});


/* ------------------------------------------------------------------ */

describe('captions are timed against the clip that was actually encoded', () => {
  /* The reported bug: "the caption not follow the voice at all".

     Cue times used to be worked out when the cut was laid out, from the second
     the reading placed the clip at. But a cut moves before a frame is encoded —
     it snaps each boundary to the nearest silence, and if the closing line was
     not found exactly it re-locates both ends from the audio entirely. The words
     stayed timed from a number that had already been thrown away.

     These assert against what reaches the ENCODER, because that is the only
     place the two timelines have to agree. */

  const PHRASES = [
    { start: 100, end: 104, text: 'the first thing said here' },
    { start: 104, end: 108, text: 'and then the second thing' },
  ];

  it('hands the encoder cues relative to the snapped start, not the planned one', async () => {
    const h = harness();
    await runOneCut(h.deps, {
      sourceKey: 'p',
      hookLine: 'Look at these straw bales right here',
      closingLine: 'Darius has already been arrested',
      startSec: 100, endSec: 108,
      captionPhrases: PHRASES,
      readOnServer: false,
    });

    const cut = h.media.cuts[0];
    expect(cut.captions?.length).toBeGreaterThan(0);

    /* The harness puts a pause just before the middle of every window it is
       asked about, so both boundaries snap slightly earlier. The first word is
       spoken at 100 and the clip now begins before it — so its cue must start
       AFTER zero, by exactly the amount the boundary moved. */
    const shift = 100 - cut.startSec;
    expect(shift).toBeGreaterThan(0);
    expect(cut.captions[0].startSec).toBeCloseTo(shift, 1);
  });

  it('never lets a cue start before the clip does', async () => {
    const h = harness();
    await runOneCut(h.deps, {
      sourceKey: 'p',
      hookLine: 'Look at these straw bales right here',
      closingLine: 'Darius has already been arrested',
      startSec: 102, endSec: 108,
      /* A phrase that began before this clip. Its tail is still heard, so it
         is captioned — but from the top of the clip, never from before it. */
      captionPhrases: PHRASES,
      readOnServer: false,
    });

    for (const cue of h.media.cuts[0].captions || []) {
      expect(cue.startSec).toBeGreaterThanOrEqual(0);
    }
  });

  it('burns nothing in when the words were not carried', async () => {
    const h = harness();
    await runOneCut(h.deps, {
      sourceKey: 'p',
      hookLine: 'Look at these straw bales right here',
      closingLine: 'Darius has already been arrested',
      startSec: 100, endSec: 108,
      readOnServer: false,
    });
    expect(h.media.cuts[0].captions).toEqual([]);
  });
});


/* ------------------------------------------------------------------ */

describe('cutting a clip into pieces Omni will take', () => {
  /* Flow refuses anything over ten seconds, so a longer cut goes in parts or
     not at all. Every part is encoded from the SOURCE — cutting an encode out
     of an encode is a second generation loss for nothing — with the plan and
     the captions rebased, because a part is its own video starting at zero. */

  const LONG = {
    sourceKey: 'p',
    hookLine: 'Look at these straw bales right here',
    closingLine: 'Darius has already been arrested',
    readOnServer: false,
  };

  it('leaves a clip that already fits as one file', async () => {
    const h = harness();
    const out: any = await runOneCut(h.deps, {
      ...LONG, startSec: 100, endSec: 108, omniParts: true,
    });
    expect(out.omniParts).toBeUndefined();
    expect(out.omniSplit).toMatch(/one piece/);
  });

  it('cuts a long clip into parts, each under the cap', async () => {
    const h = harness();
    const out: any = await runOneCut(h.deps, {
      ...LONG, startSec: 100, endSec: 126, maxSeconds: 40, omniParts: true,
    });
    expect(out.omniParts.length).toBeGreaterThan(1);
    for (const p of out.omniParts) expect(p.seconds).toBeLessThanOrEqual(10.000001);
  });

  it('takes every part out of the source, not out of the finished clip', async () => {
    /* The bounds handed to the encoder must be SOURCE seconds. Cutting the
       already-encoded clip would cost a second generation for nothing. */
    const h = harness();
    await runOneCut(h.deps, {
      ...LONG, startSec: 100, endSec: 126, maxSeconds: 40, omniParts: true,
    });
    const parts = h.media.cuts.slice(1);          // the first cut is the whole clip
    expect(parts.length).toBeGreaterThan(1);
    for (const c of parts) expect(c.startSec).toBeGreaterThanOrEqual(99);
  });

  it('covers the clip end to end across the parts', async () => {
    const h = harness();
    await runOneCut(h.deps, {
      ...LONG, startSec: 100, endSec: 126, maxSeconds: 40, omniParts: true,
    });
    const parts = h.media.cuts.slice(1).sort((a: any, b: any) => a.startSec - b.startSec);
    for (let i = 0; i < parts.length - 1; i++) {
      expect(parts[i].endSec).toBeCloseTo(parts[i + 1].startSec, 4);
    }
  });

  it('numbers the parts so they can be found again', async () => {
    const h = harness();
    const out: any = await runOneCut(h.deps, {
      ...LONG, startSec: 100, endSec: 126, maxSeconds: 40, omniParts: true,
    });
    expect(out.omniParts.map((p: any) => `${p.index}/${p.of}`))
      .toEqual(out.omniParts.map((_: any, i: number) => `${i + 1}/${out.omniParts.length}`));
    for (const p of out.omniParts) expect(p.mediaKey).toMatch(/#part\d+$/);
  });

  it('does none of it unless asked', async () => {
    /* It is N more encodes for a clip most people will post as one. */
    const h = harness();
    const out: any = await runOneCut(h.deps, { ...LONG, startSec: 100, endSec: 126, maxSeconds: 40 });
    expect(out.omniParts).toBeUndefined();
    expect(h.media.cuts).toHaveLength(1);
  });
});
