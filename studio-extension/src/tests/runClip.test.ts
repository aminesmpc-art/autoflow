/**
 * The five stages, wired to real asks.
 *
 * These tests assert what was SENT, not only what came back. That is where
 * this pipeline's failures live: the reply always parses, so the interesting
 * questions are whether the audio actually went up with the transcription ask,
 * whether the second locating ask was narrowed before it was made, whether a
 * repair round was spent before giving up, and whether a stage refused before
 * spending an encode on input it already knew was wrong.
 *
 * Every media operation is faked. Not to make the tests easy — decode and
 * encode need WebCodecs, which does not exist here — but the orchestration is
 * the part with the judgement in it, and it is fully reachable this way.
 */

import {
  ingestStage, transcribeStage, windowStage, cutStage, beatsStage,
  type ClipDeps, type ClipConfig, type ProbeLike, type WindowResult, type CutStageResult,
  stagesToSkip,
} from '../studio/clip/runClip';
import { LOCATE_SENTINEL } from '../studio/ask/clipperBrain';

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
    const cfg = { ...h.cfg, pastedTranscript: 'already have this' };
    const out = await transcribeStage(h.deps, cfg)(PROBE) as any;
    expect(h.sent).toHaveLength(0);
    expect(out.chunks[0].text).toBe('already have this');
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

describe('choosing the moment', () => {
  const pick = JSON.stringify({ hook_line: HOOK, closing_line: CLOSE });
  const at = (n: number) => JSON.stringify({ start_seconds: n });

  it('locates each boundary twice, narrowing the second time', async () => {
    /* The two-stage narrowing. A chunk-wide ask lands near a second; a minute
       cut around that answer is the regime that scored 0.68s. One ask would
       be "about right", which is a clip that opens mid-word. */
    const h = harness({ replies: [pick, at(120), at(30), at(300), at(30)] });
    await windowStage(h.deps, h.cfg)(TRANSCRIPT);
    const locating = h.sent.filter((s) => /At what second/.test(s.message));
    expect(locating).toHaveLength(4);            // two lines, two passes each
    for (const s of locating) expect(s.attachments).toBe(1);
  });

  it('narrows to a shorter span on the second pass', async () => {
    const h = harness({ replies: [pick, at(120), at(30), at(300), at(30)] });
    await windowStage(h.deps, h.cfg)(TRANSCRIPT);
    const spans = h.media.audioSpans.map(([a, b]) => b - a);
    expect(Math.min(...spans)).toBeLessThanOrEqual(60);
    expect(Math.max(...spans)).toBeGreaterThan(60);
  });

  it('locates the END rather than estimating it from word count', async () => {
    /* A window whose length came from counting words ends mid-sentence
       whenever the speaker slows down.
     *
       The arithmetic, because it is easy to get wrong and I did: the coarse
       ask answers against the whole chunk, then a 60s window is cut around
       that answer and the SECOND answer is relative to THAT window. So a
       coarse 120 narrows to [90,150], and a fine 30 means 90+30 = 120 — not
       30. The first version of this test asserted 30 and accused the code. */
    const h = harness({ replies: [pick, at(120), at(30), at(175), at(25)] });
    const out = await windowStage(h.deps, h.cfg)(TRANSCRIPT) as WindowResult;
    expect(out.startSec).toBeCloseTo(120, 0);              // 90 + 30
    /* Close: coarse 175 -> window [145,205], fine 25 -> 170, plus how long
       the closing line takes to say. Not start + estimate. */
    expect(out.endSec).toBeGreaterThan(170);
    expect(out.endSec).toBeLessThan(180);
  });

  it('spends one repair round on a paraphrased pick, then succeeds', async () => {
    /* A model that paraphrases the hook answered from an impression of the
       transcript, so its span is a guess too. Worth one more ask. */
    const bad = JSON.stringify({ hook_line: 'the property sector is collapsing', closing_line: CLOSE });
    const h = harness({ replies: [bad, pick, at(120), at(30), at(300), at(30)] });
    const out = await windowStage(h.deps, h.cfg)(TRANSCRIPT) as WindowResult;
    expect(out).toBeTruthy();
    expect(h.sent[1].message).toMatch(/word for word/i);
  });

  it('refuses after the repair round rather than cutting on a guess', async () => {
    const bad = JSON.stringify({ hook_line: 'nothing like this', closing_line: 'nor this' });
    const h = harness({ replies: [bad, bad] });
    await expect(windowStage(h.deps, h.cfg)(TRANSCRIPT)).rejects.toThrow(/does not match the transcript|No usable moment/);
  });

  it('refuses when the opening line cannot be found in the audio', async () => {
    const h = harness({ replies: [pick, '', ''] });
    await expect(windowStage(h.deps, h.cfg)(TRANSCRIPT)).rejects.toThrow(/could not be found in the audio/);
  });

  it('treats a sentinel echo as no answer', async () => {
    /* The measured prompt failure: an example value copied back verbatim. */
    const h = harness({ replies: [pick, JSON.stringify({ start_seconds: LOCATE_SENTINEL })] });
    await expect(windowStage(h.deps, h.cfg)(TRANSCRIPT)).rejects.toThrow(/could not be found/);
  });
});

/* ------------------------------------------------------------------ */

describe('cutting', () => {
  const win: WindowResult = { window: {} as any, startSec: 100, endSec: 160, text: CLIP_TEXT };

  it('snaps both boundaries onto a pause before encoding', async () => {
    /* The buffer spans target±1.5s with its pause at 0.9-1.3s into it, so the
       middle of that pause is 0.4s BEFORE the asked-for moment. A working
       snap moves the boundary there; no snap leaves it where it was. */
    const h = harness({ replies: [JSON.stringify({ positions: [{ n: 1, x: 0.5 }] })] });
    const out = await cutStage(h.deps, h.cfg)(win, undefined) as CutStageResult;
    expect(out.startSec).toBeCloseTo(win.startSec - 0.4, 1);
    expect(out.endSec).toBeCloseTo(win.endSec - 0.4, 1);
    expect(h.logs.join(' ')).toMatch(/clip start: snapped/);
    expect(h.logs.join(' ')).toMatch(/clip end: snapped/);
  });

  it('asks where the speaker is ONCE, with every still attached', async () => {
    /* One ask carrying eight stills, not eight asks carrying one. */
    const h = harness({ replies: [JSON.stringify({ positions: [{ n: 1, x: 0.4 }, { n: 2, x: 0.4 }] })] });
    await cutStage(h.deps, h.cfg)(win, undefined);
    const faceAsks = h.sent.filter((s) => /horizontal position/.test(s.message));
    expect(faceAsks).toHaveLength(1);
    expect(faceAsks[0].attachments).toBeGreaterThan(1);
  });

  it('samples the stills from inside the chosen clip, not the whole file', async () => {
    const h = harness({ replies: ['{}'] });
    await cutStage(h.deps, h.cfg)(win, undefined);
    const times = h.media.frameTimes[0];
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(win.startSec);
      expect(t).toBeLessThanOrEqual(win.endSec + 1);
    }
  });

  it('skips the reframe on a source that is already vertical', async () => {
    const h = harness({ probe: { alreadyVertical: true }, replies: [] });
    const out = await cutStage(h.deps, h.cfg)(win, undefined) as CutStageResult;
    expect(h.sent.filter((s) => /horizontal position/.test(s.message))).toHaveLength(0);
    expect(out.reframe).toBe('none');
    expect(h.logs.join(' ')).toMatch(/already vertical/);
  });

  it('centres the crop when it cannot tell where the speaker is', async () => {
    /* Given nothing, do the thing that is never embarrassing. */
    const h = harness({ replies: ['I could not identify a speaker.'] });
    const out = await cutStage(h.deps, h.cfg)(win, undefined) as CutStageResult;
    expect(out.reframe).toBe('centre');
  });

  it('keeps the finished clip somewhere node data can point at', async () => {
    const h = harness({ replies: ['{}'] });
    const out = await cutStage(h.deps, h.cfg)(win, undefined) as CutStageResult;
    expect(h.stored.has(out.mediaKey)).toBe(true);
  });

  it('refuses if snapping collapses the clip', async () => {
    const h = harness({ replies: ['{}'] });
    /* Both boundaries snap to the same pause, so a clip whose end was already
       level with its start comes back with no length at all. Refusing beats
       handing the encoder a zero-length range. */
    await expect(
      cutStage(h.deps, h.cfg)({ ...win, endSec: win.startSec }, undefined),
    ).rejects.toThrow(/no length/);
  });
});

/* ------------------------------------------------------------------ */

describe('directing the beats', () => {
  const cut: CutStageResult = {
    mediaKey: 'k', startSec: 100, endSec: 130, clipSeconds: 30,
    width: 608, height: 1080, reframe: 'locked', report: '',
  };

  it('sends the clip AUDIO up with the ask', async () => {
    /* The Editor is deciding when to cut away from a face, and what decides
       it is delivery — where the speaker leans in, pauses before the
       punchline. A transcript cannot carry that. */
    const h = harness({ replies: [beatsReply(30)] });
    await beatsStage(h.deps, h.cfg, () => CLIP_TEXT)(cut);
    const ask = h.sent.find((s) => /a-roll/.test(s.message));
    expect(ask).toBeDefined();
    expect(ask!.attachments).toBe(1);
    expect(h.media.audioSpans).toContainEqual([100, 130]);
  });

  it('returns the beats when they tile the clip', async () => {
    const h = harness({ replies: [beatsReply(30)] });
    const out = await beatsStage(h.deps, h.cfg, () => CLIP_TEXT)(cut) as any;
    expect(out.beats).toHaveLength(3);
    expect(out.beats[2].end).toBe(30);
  });

  it('spends one repair round on a map with a hole in it', async () => {
    /* A gap is a stretch of finished video with nothing assigned to it —
       invisible in the reply, fatal at the end of a run. */
    const holed = JSON.stringify({
      beats: [
        { n: 1, start: 0, end: 6, edit: 'a-roll', caption: HOOK },
        { n: 2, start: 20, end: 30, edit: 'a-roll', caption: CLOSE },
      ],
    });
    const h = harness({ replies: [holed, beatsReply(30)] });
    const out = await beatsStage(h.deps, h.cfg, () => CLIP_TEXT)(cut) as any;
    expect(h.sent[1].message).toMatch(/cannot be built as written/);
    expect(out.beats).toHaveLength(3);
  });

  it('refuses after the repair round rather than shipping a holed map', async () => {
    const holed = JSON.stringify({
      beats: [{ n: 1, start: 0, end: 6, edit: 'a-roll', caption: HOOK }],
    });
    const h = harness({ replies: [holed, holed] });
    await expect(beatsStage(h.deps, h.cfg, () => CLIP_TEXT)(cut)).rejects.toThrow(/cannot be built/);
  });

  it('passes advisories through instead of failing on them', async () => {
    /* Opening on a graphic is a preference, not a defect. Blocking on taste
       is how a repair loop spends its rounds arguing. */
    const opensOnGraphic = JSON.stringify({
      beats: [
        {
          n: 1, start: 0, end: 8, edit: 'b-roll', caption: HOOK,
          still_prompt: 'a paper chart on cream', motion_prompt: 'it grows',
        },
        { n: 2, start: 8, end: 30, edit: 'a-roll', caption: CLOSE },
      ],
    });
    const h = harness({ replies: [opensOnGraphic] });
    const out = await beatsStage(h.deps, h.cfg, () => CLIP_TEXT)(cut) as any;
    expect(out.beats).toHaveLength(2);
    expect(out.advisories.join(' ')).toMatch(/opens on a graphic|talking head/);
  });
});

/* ------------------------------------------------------------------ */

describe('campaign mode', () => {
  const pick = JSON.stringify({ moment: 2, hook_line: HOOK, closing_line: CLOSE });
  const at = (n: number) => JSON.stringify({ start_seconds: n });

  /** Loud-and-varied in the middle, quiet either side, so peaks exist. */
  const dynamic = (target: number, radius: number) => {
    const rate = 16000;
    const n = Math.round(rate * radius * 2);
    const s = new Float32Array(n);
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed / 0xffffffff) * 2 - 1; };
    for (let i = 0; i < n; i++) {
      const t = target - radius + i / rate;
      /* A busy stretch between 300 and 360 seconds, calm elsewhere. */
      const loud = t > 300 && t < 360;
      const swing = loud && Math.floor(t * 0.7) % 2 === 0;
      s[i] = rnd() * (loud ? (swing ? 0.85 : 0.2) : 0.12);
    }
    return { samples: s, sampleRate: rate, startSec: target - radius };
  };

  function campaignHarness(replies: string[]) {
    const h = harness({ replies });
    h.deps.media.pcmAround = async (_f, target, radius) => dynamic(target, radius);
    return h;
  }

  it('shortlists from the audio and asks the model to choose', async () => {
    /* The division that matters. Asked to find a moment in a transcript
       alone, a model reaches for the most quotable sentence — which in a
       chase video is the narration, the calmest part of the recording. */
    const h = campaignHarness([pick, at(120), at(30), at(175), at(25)]);
    await windowStage(h.deps, { ...h.cfg, mode: 'campaign' })(TRANSCRIPT);
    const ask = h.sent[0].message;
    expect(ask).toMatch(/MOMENT 1/);
    expect(ask).toMatch(/shortlisted from the audio/);
    expect(ask).not.toMatch(/HOOK \(first/);      // not the explainer ask
  });

  it('puts the campaign rules in front of the model', async () => {
    const h = campaignHarness([pick, at(120), at(30), at(175), at(25)]);
    await windowStage(h.deps, {
      ...h.cfg, mode: 'campaign',
      campaignRules: 'Do not use any logos, hashtags, watermarks, or unaffiliated content.',
    })(TRANSCRIPT);
    expect(h.sent[0].message).toMatch(/logos, hashtags, watermarks/);
  });

  it('still demands the boundaries as verbatim quotes', async () => {
    /* Same reply shape as the explainer ask, so the same checking applies.
       A campaign clip that opens mid-word is the "low quality post" a brief
       rejects. */
    const h = campaignHarness([pick, at(120), at(30), at(175), at(25)]);
    await windowStage(h.deps, { ...h.cfg, mode: 'campaign' })(TRANSCRIPT);
    expect(h.sent[0].message).toMatch(/WORD FOR WORD/);
    expect(h.sent[0].message).toMatch(/mid-sentence/);
  });

  it('still refuses a paraphrased pick', async () => {
    const bad = JSON.stringify({ moment: 1, hook_line: 'nothing like this', closing_line: 'nor this' });
    const h = campaignHarness([bad, bad]);
    await expect(windowStage(h.deps, { ...h.cfg, mode: 'campaign' })(TRANSCRIPT))
      .rejects.toThrow(/does not match the transcript|No usable moment/);
  });

  it('falls back to reading the transcript when the audio has no dynamics', async () => {
    /* A lecture, or a badly levelled export. Refusing outright would be worse
       than choosing the way the explainer does. */
    const h = harness({ replies: [JSON.stringify({ hook_line: HOOK, closing_line: CLOSE }), at(120), at(30), at(175), at(25)] });
    h.deps.media.pcmAround = async (_f, target, radius) => ({
      samples: new Float32Array(16000 * radius * 2).fill(0.3),
      sampleRate: 16000,
      startSec: target - radius,
    });
    await windowStage(h.deps, { ...h.cfg, mode: 'campaign' })(TRANSCRIPT);
    expect(h.sent[0].message).toMatch(/HOOK/);
    expect(h.logs.join(' ')).toMatch(/no peaks in the audio/);
  });

  /* Campaign mode used to skip the beats stage, because a brief forbidding
     "content that is not affiliated with this campaign" forbids a generated
     graphic. The rule survives; the stage does not. It is now enforced where
     the decision is actually made — surveyAsk does not OFFER B-roll under a
     campaign, and emitPlan drops any that arrives anyway. Both are tested in
     emitPlan.test.ts, which is where this claim went. */
  it('skips nothing, in either mode', async () => {
    expect(stagesToSkip({ sourceKey: 'x', mode: 'campaign' })).toEqual({});
    expect(stagesToSkip({ sourceKey: 'x', mode: 'explainer' })).toEqual({});
    expect(stagesToSkip({ sourceKey: 'x' })).toEqual({});
  });
});
