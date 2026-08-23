/**
 * The clipper's brain.
 *
 * Every rule here guards one class of failure: a reply that is perfectly
 * formed and wrong. A model asked about audio answers whatever happens — the
 * question is never "did it answer" but "does its answer agree with the
 * transcript we already have". Schema checking cannot tell the difference,
 * which is why every check below compares a reply against the source rather
 * than against a shape.
 *
 * Three of these tests encode failures measured on 23 Aug 2026 rather than
 * imagined:
 *
 *   · readLocate rejecting the sentinel — a prompt whose example read
 *     `"start_seconds": 0.0` got 0.0 back nine times, and that was written up
 *     as a model failure before the second experiment showed it was the
 *     prompt's fault.
 *   · looksFabricated, run on the real numbers from that session: Gemini's
 *     twelve-minute answer had gap σ 0.000 against the truth's 1.148.
 *   · windowAsk refusing to ask for a timestamp at all, which is the entire
 *     reason the pipeline is shaped the way it is.
 */

import {
  windowAsk, readWindow, locateWindow, findPhrase, flatten, estimateSeconds,
  locateAsk, readLocate, LOCATE_SENTINEL, looksFabricated, wordsOf,
  beatAsk, readBeats, checkBeats, repairBeats, repairWindow,
  blockingClipProblems, VOX_PAPER,
  MAX_BROLL_SECONDS, MAX_AROLL_RUN_SECONDS, MIN_CLIP_SECONDS, WORDS_PER_SECOND,
  type Transcript, type Beat,
} from '../studio/ask/clipperBrain';

const codes = (ps: Array<{ code: string }>) => ps.map((p) => p.code);

/* A transcript in the shape the Transcript stage produces: text, plus chunk
   bounds we cut ourselves and therefore know exactly. */
const T: Transcript = {
  duration: 480,
  chunks: [
    {
      index: 0, start: 0, end: 240,
      text: 'so the thing people get wrong about this is that they assume the numbers were always public '
        + 'and I want to be careful here because there is a version of this story that is too simple '
        + 'what actually happened was slower and honestly a lot more boring than people remember',
    },
    {
      index: 1, start: 240, end: 480,
      text: 'the housing market is about to crash and nobody is talking about it '
        + 'the banks are hiding the real numbers from the public right now '
        + 'they reported three percent growth but the real figure is far worse '
        + 'i talked to a banker who told me off the record what happens next '
        + 'so when someone tells you the market is fine you already know better',
    },
  ],
};

/* ------------------------------------------------------------------ */

describe('the window ask', () => {
  const ask = windowAsk(T);

  it('never asks for a timestamp', () => {
    /* THE design decision, in one assertion. Gemini cannot locate a passage
       in a long file and will not say so — at twelve minutes it returned a
       flawless arithmetic sequence. So the ask must give it no opening to
       invent one. If this test ever fails, the pipeline has quietly gone back
       to depending on the thing that was measured not to work. */
    expect(ask).toMatch(/DO NOT give timestamps/);
    expect(ask).not.toMatch(/start_seconds/);
    expect(ask).not.toMatch(/start_time/);
  });

  it('asks for the boundaries as quoted lines instead', () => {
    expect(ask).toMatch(/"hook_line"/);
    expect(ask).toMatch(/"closing_line"/);
    expect(ask).toMatch(/WORD FOR WORD/);
  });

  it('says why a paraphrase is fatal', () => {
    /* A rule stated without its reason is a rule a model talks itself out of. */
    expect(ask).toMatch(/unfindable/);
  });

  it('shows the transcript', () => {
    expect(ask).toContain('housing market is about to crash');
  });
});

describe('finding a quoted line in the transcript', () => {
  const words = flatten(T);

  it('finds an exact quote', () => {
    expect(findPhrase(words, 'the banks are hiding the real numbers')).toBeGreaterThan(-1);
  });

  it('survives punctuation and case', () => {
    /* Must not fire on a model that types "The Banks Are Hiding the real
       numbers!" — that is the same line, and a repair round spent on it is a
       round wasted. */
    expect(findPhrase(words, 'The Banks, Are Hiding The REAL Numbers!')).toBeGreaterThan(-1);
  });

  it('refuses a paraphrase', () => {
    /* The one worth catching. A model that paraphrases is answering from an
       impression of the transcript rather than from the transcript, so
       everything else it says about that passage is a guess too. */
    expect(findPhrase(words, 'the lenders are concealing the true figures')).toBe(-1);
  });

  it('reports which chunk the line sits in', () => {
    const at = findPhrase(words, 'the housing market is about to crash');
    expect(words[at].chunk).toBe(1);
  });
});

describe('reading the window back', () => {
  it('takes a bare object', () => {
    expect(readWindow({ hook_line: 'a', closing_line: 'b' }))
      .toMatchObject({ hookLine: 'a', closingLine: 'b' });
  });

  it('digs the object out of prose', () => {
    const got = readWindow('Sure! Here is my pick:\n{"hook_line":"a","closing_line":"b"}\nHope that helps.');
    expect(got).toMatchObject({ hookLine: 'a', closingLine: 'b' });
  });

  it('unwraps a one-element array', () => {
    /* Two of the planning documents specified an array and one an object.
       Models copy whichever they saw last, and that is not worth a round. */
    expect(readWindow('[{"hook_line":"a","closing_line":"b"}]'))
      .toMatchObject({ hookLine: 'a', closingLine: 'b' });
  });

  it('reads a fenced reply', () => {
    expect(readWindow('```json\n{"hook_line":"a","closing_line":"b"}\n```'))
      .toMatchObject({ hookLine: 'a', closingLine: 'b' });
  });

  it('refuses a pick missing an end', () => {
    /* Half a window would clip from the hook to nowhere and look like a run. */
    expect(readWindow({ hook_line: 'a' })).toBeNull();
  });

  it('returns null on prose rather than throwing', () => {
    expect(readWindow('I could not find a good clip, sorry.')).toBeNull();
  });
});

describe('locating the window in the transcript', () => {
  const pick = {
    hookLine: 'the housing market is about to crash and nobody is talking about it',
    closingLine: 'so when someone tells you the market is fine you already know better',
  };

  it('accepts a pick whose lines are both really there', () => {
    const { window, problems } = locateWindow(pick, T);
    expect(blockingClipProblems(problems)).toHaveLength(0);
    expect(window).not.toBeNull();
    expect(window!.chunk).toBe(1);
  });

  it('estimates the length from word count, asking nobody', () => {
    /* The one number that would otherwise have to come from the thing we
       proved cannot supply it.
     *
     * The span runs from the START of the hook line to the END of the closing
     * line — everything the viewer will hear, not just the two quoted lines.
     * Here those two lines are the first and last sentences of chunk 1, so
     * the span is the whole chunk. Computed from the fixture rather than
     * written out, because the first version of this test hardcoded the
     * wrong number and accused the code of it. */
    const { window } = locateWindow(pick, T);
    const wholeChunk = wordsOf(T.chunks[1].text).length;
    expect(window!.estimatedSeconds).toBeCloseTo(wholeChunk / WORDS_PER_SECOND, 1);
  });

  it('catches an invented hook', () => {
    const { problems } = locateWindow({ ...pick, hookLine: 'the property sector is collapsing' }, T);
    expect(codes(problems)).toContain('hookMissing');
  });

  it('catches an invented closing line', () => {
    const { problems } = locateWindow({ ...pick, closingLine: 'and that is the whole story of it' }, T);
    expect(codes(problems)).toContain('closingMissing');
  });

  it('catches a window that runs backwards', () => {
    const { problems } = locateWindow(
      { hookLine: pick.closingLine, closingLine: pick.hookLine }, T,
    );
    expect(codes(problems)).toContain('windowOrder');
  });

  it('catches a pick far too short to post', () => {
    const { problems } = locateWindow({
      hookLine: 'the banks are hiding the real numbers',
      closingLine: 'from the public right now',
    }, T);
    expect(codes(problems)).toContain('windowShort');
  });

  it('returns no window when it could not be found, rather than a partial one', () => {
    const { window } = locateWindow({ ...pick, hookLine: 'nothing like this was said' }, T);
    expect(window).toBeNull();
  });

  it('says something useful about an empty transcript', () => {
    const { problems } = locateWindow(pick, { duration: 0, chunks: [] });
    expect(codes(problems)).toContain('transcriptEmpty');
  });
});

/* ------------------------------------------------------------------ */

describe('the location ask', () => {
  it('tells the model not to extrapolate', () => {
    /* Measured: told to locate one phrase in a file it had already answered
       about, it returned its earlier extrapolation unchanged. */
    const ask = locateAsk('the housing market lost eleven percent', 240);
    expect(ask).toMatch(/Locate it in the audio itself/);
    expect(ask).toMatch(/do not assume it is evenly placed/i);
  });

  it('uses a sentinel as its example, not a plausible number', () => {
    expect(locateAsk('x', 240)).toContain(String(LOCATE_SENTINEL));
  });
});

describe('reading a located time back', () => {
  it('takes the documented shape', () => {
    expect(readLocate({ start_seconds: 57.04 })).toBeCloseTo(57.04);
  });

  it('takes a bare number, which is a legitimate answer to this question', () => {
    expect(readLocate('595')).toBe(595);
  });

  it('REJECTS the sentinel, because that is the example being copied back', () => {
    /* The measured failure. A prompt whose example read `"start_seconds": 0.0`
       got 0.0 for all nine phrases, and it was written up as a model failure
       before a second run with a different placeholder scored 3.12s on the
       same file. Treating an echo as data is how that happened. */
    expect(readLocate({ start_seconds: LOCATE_SENTINEL })).toBeNull();
    expect(readLocate(`{"start_seconds": ${LOCATE_SENTINEL}}`)).toBeNull();
  });

  it('still accepts a real answer that merely looks similar', () => {
    /* The sentinel check must reject the value, not the neighbourhood. */
    expect(readLocate({ start_seconds: LOCATE_SENTINEL + 0.01 })).toBeCloseTo(12.35);
  });

  it('rejects a time outside the chunk it was asked about', () => {
    expect(readLocate({ start_seconds: 900 }, 240)).toBeNull();
  });

  it('rejects a negative time', () => {
    expect(readLocate({ start_seconds: -4 })).toBeNull();
  });

  it('returns null on prose rather than throwing', () => {
    expect(readLocate('I am not able to determine that from the audio.')).toBeNull();
  });
});

describe('the fabrication fingerprint', () => {
  /* Both arrays are real, from the 23 Aug measurement run on a 12-minute file. */
  const GEMINI = [55, 115, 175, 235, 295, 355, 415, 475, 535, 595, 655, 715];
  const TRUTH = [57.04, 117.33, 177.02, 238.07, 296.65, 359.32,
    419.78, 479.77, 541.34, 603.60, 663.26, 724.10];

  it('catches the answer that was invented', () => {
    /* Gap σ 0.000. Perfectly even spacing is not what measurement produces. */
    expect(looksFabricated(GEMINI)).toBe(true);
  });

  it('does not fire on the truth those answers were meant to be', () => {
    /* Gap σ 1.148 — nearly the same mean, but it varies. This is the pair
       that makes the check meaningful: same length, same rough spacing, and
       only one of them is real. */
    expect(looksFabricated(TRUTH)).toBe(false);
  });

  it('does not fire on ordinary beat boundaries', () => {
    expect(looksFabricated([0, 6.2, 14.1, 22.0, 30.0])).toBe(false);
  });

  it('says nothing about too few points to judge', () => {
    /* Three timestamps can be evenly spaced by chance. Refusing work on that
       basis would cost more than the occasional miss. */
    expect(looksFabricated([0, 10, 20])).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe('the directing ask', () => {
  const ask = beatAsk(30, 'the housing market is about to crash', VOX_PAPER);

  it('states the generator ceiling as a hard rule', () => {
    /* Omni Flash renders ~10s and VideoDuration stops at '10s'. A beat map
       ignoring this fails at generation time, which is the expensive place. */
    expect(ask).toContain(String(MAX_BROLL_SECONDS));
    expect(ask).toMatch(/two consecutive b-roll beats/i);
  });

  it('gives the a-roll/b-roll rule as a test on the sentence, not a quota', () => {
    /* A quota puts graphics over a personal anecdote and a face over a chart
       — the two places each is worst. */
    expect(ask).toMatch(/personal story/i);
    expect(ask).toMatch(/cannot picture/i);
  });

  it('carries the look, and says why it must be restated per beat', () => {
    expect(ask).toMatch(/#F5F0E8/);
    expect(ask).toMatch(/#FF6B35/);
    expect(ask).toMatch(/no memory between/i);
  });

  it('forbids drawn text', () => {
    expect(ask).toMatch(/Do not write text/i);
  });

  it('says the timestamps are clip-relative, twice', () => {
    /* Ambiguity here is a whole beat map in the wrong coordinate space. */
    expect(ask).toMatch(/START OF THE CLIP/);
    expect(ask).toMatch(/first beat starts at 0/);
  });
});

describe('reading the beat map back', () => {
  it('accepts the documented shape', () => {
    const b = readBeats('{"beats":[{"n":1,"start":0,"end":5,"edit":"a-roll","caption":"hi"}]}');
    expect(b).toHaveLength(1);
    expect(b[0].edit).toBe('a-roll');
  });

  it('accepts a bare array', () => {
    expect(readBeats('[{"start":0,"end":5,"edit":"a-roll","caption":"hi"}]')).toHaveLength(1);
  });

  it('normalises every spelling of the edit type the plans used', () => {
    /* The six planning documents spell it "A-Roll", "a-roll", "A Roll" and
       "B-Roll-Graphic". Models copy whichever they saw. */
    for (const s of ['A-Roll', 'a roll', 'A_Roll', 'a-roll', '  A-ROLL  ']) {
      expect(readBeats(`[{"start":0,"end":5,"edit":"${s}","caption":"x"}]`)[0].edit).toBe('a-roll');
    }
    for (const s of ['B-Roll-Graphic', 'b-roll', 'B Roll', 'broll', 'B-Roll-Map']) {
      expect(readBeats(`[{"start":0,"end":5,"edit":"${s}","caption":"x"}]`)[0].edit).toBe('b-roll');
    }
  });

  it('treats an unrecognised edit type as b-roll', () => {
    /* The safe reading: a graphic beat gets prompts written for it, so the
       worst case is an unused prompt. Guessing a-roll leaves a silent hole
       where a graphic should have been. */
    expect(readBeats('[{"start":0,"end":5,"edit":"montage","caption":"x"}]')[0].edit).toBe('b-roll');
  });

  it('takes the alternate field names the plans use', () => {
    const b = readBeats('[{"scene_index":2,"start":0,"end":5,"edit_type":"B-Roll","caption":"x",'
      + '"still_image_prompt":"a chart","motion_prompt":"it grows","visual_focus":"the bar"}]');
    expect(b[0].stillPrompt).toBe('a chart');
    expect(b[0].motionPrompt).toBe('it grows');
    expect(b[0].focus).toBe('the bar');
  });

  it('sorts by time and renumbers, so n is always the running order', () => {
    /* A model emitting beats out of order must not leave the compositor
       splicing them in reply order. */
    const b = readBeats('[{"n":9,"start":10,"end":15,"edit":"a-roll","caption":"b"},'
      + '{"n":4,"start":0,"end":10,"edit":"a-roll","caption":"a"}]');
    expect(b.map((x) => x.n)).toEqual([1, 2]);
    expect(b.map((x) => x.start)).toEqual([0, 10]);
  });

  it('drops a beat with no usable times instead of inventing them', () => {
    expect(readBeats('[{"start":0,"end":5,"edit":"a-roll","caption":"ok"},{"edit":"b-roll"}]'))
      .toHaveLength(1);
  });

  it('returns nothing on prose rather than throwing', () => {
    expect(readBeats('I think beat one should be the speaker.')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

describe('checking the beat map', () => {
  const CLIP = 30;
  const TEXT = 'the housing market is about to crash and nobody is talking about it '
    + 'the banks are hiding the real numbers from the public right now '
    + 'they reported three percent growth but the real figure is far worse '
    + 'so when someone tells you the market is fine you already know better';

  const beat = (o: Partial<Beat>): Beat => ({
    n: 1, start: 0, end: 5, edit: 'a-roll', caption: 'the housing market is about to crash', ...o,
  });

  const sound: Beat[] = [
    beat({ n: 1, start: 0, end: 6, caption: 'the housing market is about to crash and nobody' }),
    beat({
      n: 2, start: 6, end: 14, edit: 'b-roll',
      caption: 'the banks are hiding the real numbers from the public',
      stillPrompt: 'a torn paper bar chart on cream, charcoal bars, one orange',
      motionPrompt: 'the bars grow, camera dollies in slowly',
    }),
    beat({
      n: 3, start: 14, end: 22, edit: 'b-roll',
      caption: 'they reported three percent growth but the real figure is far worse',
      stillPrompt: 'a paper cutout shape peeling away on cream',
      motionPrompt: 'the top layer peels back',
    }),
    beat({ n: 4, start: 22, end: 30, caption: 'so when someone tells you the market is fine you already know better' }),
  ];

  it('passes a sound map', () => {
    expect(blockingClipProblems(checkBeats(sound, CLIP, TEXT))).toHaveLength(0);
  });

  it('catches a hole in the middle', () => {
    /* THE reason this function exists. A gap is invisible in the reply and
       surfaces as finished video with nothing assigned to it. */
    const holed = sound.map((b, i) => (i === 2 ? { ...b, start: 16 } : b));
    expect(codes(checkBeats(holed, CLIP, TEXT))).toContain('beatsGap');
  });

  it('catches two beats claiming the same second', () => {
    const lapped = sound.map((b, i) => (i === 2 ? { ...b, start: 12 } : b));
    expect(codes(checkBeats(lapped, CLIP, TEXT))).toContain('beatsOverlap');
  });

  it('catches a map that stops before the clip does', () => {
    const short = sound.map((b, i) => (i === 3 ? { ...b, end: 27 } : b));
    expect(codes(checkBeats(short, CLIP, TEXT))).toContain('beatsEnd');
  });

  it('catches a map that does not start at zero', () => {
    const late = sound.map((b, i) => (i === 0 ? { ...b, start: 2 } : b));
    expect(codes(checkBeats(late, CLIP, TEXT))).toContain('beatsStart');
  });

  it('tolerates rounding, so a round is not spent on 0.02s', () => {
    const jitter = sound.map((b) => ({ ...b, start: b.start + 0.02, end: b.end + 0.02 }));
    jitter[0].start = 0;
    jitter[jitter.length - 1].end = CLIP;
    expect(codes(checkBeats(jitter, CLIP, TEXT))).not.toContain('beatsGap');
  });

  it('catches b-roll longer than the generator can make', () => {
    const long = [
      beat({ n: 1, start: 0, end: 6, caption: 'the housing market is about to crash and nobody' }),
      beat({
        n: 2, start: 6, end: 24, edit: 'b-roll', caption: 'the banks are hiding the real numbers',
        stillPrompt: 'a chart', motionPrompt: 'it grows',
      }),
      beat({ n: 3, start: 24, end: 30, caption: 'so when someone tells you the market is fine' }),
    ];
    const ps = checkBeats(long, CLIP, TEXT);
    expect(codes(ps)).toContain('beatTooLong');
    expect(blockingClipProblems(ps).length).toBeGreaterThan(0);
  });

  it('does not apply that ceiling to a-roll', () => {
    /* A-roll is cut from footage that already exists — nothing generates it,
       so the generator's limit is irrelevant to it. */
    const face = [beat({ n: 1, start: 0, end: 30, caption: 'the housing market is about to crash' })];
    expect(codes(checkBeats(face, CLIP, TEXT))).not.toContain('beatTooLong');
  });

  it('catches b-roll with no still or motion prompt', () => {
    const bare = [
      beat({ n: 1, start: 0, end: 10, caption: 'the housing market is about to crash and nobody is' }),
      beat({ n: 2, start: 10, end: 20, edit: 'b-roll', caption: 'they reported three percent growth but the real' }),
      beat({ n: 3, start: 20, end: 30, caption: 'so when someone tells you the market is fine you' }),
    ];
    const got = codes(checkBeats(bare, CLIP, TEXT));
    expect(got).toContain('beatNoStill');
    expect(got).toContain('beatNoMotion');
  });

  it('catches a still that asks the generator to draw words', () => {
    /* Generators asked for letters produce misspelt letters, every time. The
       still is the last place this is free to fix. */
    const texty = sound.map((b, i) => (
      i === 1 ? { ...b, stillPrompt: 'a bar chart with the label INFLATION in bold text' } : b
    ));
    expect(codes(checkBeats(texty, CLIP, TEXT))).toContain('beatDrawnText');
  });

  it('catches a caption nobody said', () => {
    const invented = sound.map((b, i) => (
      i === 1 ? { ...b, caption: 'and interest rates will double again next spring' } : b
    ));
    expect(codes(checkBeats(invented, CLIP, TEXT))).toContain('beatCaptionDrift');
  });

  it('catches beats whose captions run backwards through the clip', () => {
    /* Ordering, checked with no timing at all. Every caption here is real, so
       the drift check passes each one individually — but beat 2 quotes the
       last sentence and beat 3 quotes the second, so the beats were assigned
       to the wrong moments. Only comparing them to each other finds it. */
    const shuffled = [
      sound[0],
      { ...sound[1], caption: 'so when someone tells you the market is fine you already know better' },
      { ...sound[2], caption: 'the banks are hiding the real numbers from the public' },
      sound[3],
    ];
    expect(codes(checkBeats(shuffled, CLIP, TEXT))).toContain('beatCaptionOrder');
  });

  it('skips the caption checks when no clip text was supplied', () => {
    /* The node can run from a pasted window with no transcript. The check
       must be skipped, not failed. */
    const got = codes(checkBeats(sound, CLIP));
    expect(got).not.toContain('beatCaptionDrift');
    expect(got).not.toContain('beatCaptionOrder');
  });

  it('warns about a long unbroken talking head without blocking it', () => {
    const talky = [
      beat({ n: 1, start: 0, end: 20, caption: 'the housing market is about to crash and nobody is talking' }),
      beat({
        n: 2, start: 20, end: 26, edit: 'b-roll', caption: 'the banks are hiding the real numbers',
        stillPrompt: 'a paper silhouette on cream', motionPrompt: 'it slides in',
      }),
      beat({ n: 3, start: 26, end: 30, caption: 'so when someone tells you the market is fine' }),
    ];
    const ps = checkBeats(talky, CLIP, TEXT);
    expect(codes(ps)).toContain('aRollRun');
    /* Advisory: a personal story sometimes earns a longer hold, and blocking
       on taste spends repair rounds arguing. */
    expect(codes(blockingClipProblems(ps))).not.toContain('aRollRun');
  });

  it('notices a clip that is all talking head', () => {
    const ps = checkBeats([beat({ n: 1, start: 0, end: 30, caption: 'the housing market is about to crash' })], CLIP, TEXT);
    expect(codes(ps)).toContain('noGraphics');
  });

  it('catches a beat map that was divided rather than directed', () => {
    /* The fabrication fingerprint applied to the beats themselves. Perfectly
       even boundaries mean the clip was sliced into equal pieces, not cut
       where the sentences turn. */
    const even = [0, 7.5, 15, 22.5].map((s, i) => beat({
      n: i + 1, start: s, end: s + 7.5,
      edit: i % 2 ? 'b-roll' : 'a-roll',
      caption: 'the housing market is about to crash',
      stillPrompt: i % 2 ? 'a chart on cream' : undefined,
      motionPrompt: i % 2 ? 'it grows' : undefined,
    }));
    expect(codes(checkBeats(even, CLIP))).toContain('beatsFabricated');
  });

  it('says something useful about an empty reply', () => {
    expect(codes(checkBeats([], CLIP))).toContain('beatsEmpty');
  });

  it('does not throw on a backwards beat', () => {
    expect(() => checkBeats([beat({ start: 10, end: 5 })], CLIP)).not.toThrow();
    expect(codes(checkBeats([beat({ start: 10, end: 5 })], CLIP))).toContain('beatOrder');
  });
});

/* ------------------------------------------------------------------ */

describe('the repair turns', () => {
  const problems = [
    { shot: 2, code: 'beatTooLong', detail: 'is 18s of b-roll.' },
    { shot: 5, code: 'beatsGap', detail: 'starts at 24 but beat 4 ended at 20.' },
    { shot: 3, code: 'openNotFace', detail: 'opens on a graphic.' },
  ];

  it('names only the beats that failed', () => {
    /* Re-asking for the whole map is how one bad timestamp in beat 7 loses
       the six good beats before it. */
    const msg = repairBeats(problems, 60);
    expect(msg).toMatch(/beat 2/);
    expect(msg).toMatch(/beat 5/);
    expect(msg).not.toMatch(/beat 3/);
  });

  it('repeats the tiling requirement, which a repair easily breaks', () => {
    expect(repairBeats(problems, 60)).toMatch(/tile the clip end to end, from 0 to 60/);
  });

  it('still demands bare JSON', () => {
    expect(repairBeats(problems, 60)).toMatch(/no code fence/i);
  });

  it('falls back to the advisories when nothing is blocking', () => {
    /* Otherwise a map with only soft problems produces an empty complaint. */
    const msg = repairBeats([{ shot: 1, code: 'openNotFace', detail: 'opens on a graphic.' }], 60);
    expect(msg).toMatch(/opens on a graphic/);
    expect(msg).toMatch(/beat 1/);
  });

  it('asks a bad window to be re-picked, quoting properly', () => {
    const msg = repairWindow([{ shot: 0, code: 'hookMissing', detail: 'quotes a line that is not there.' }]);
    expect(msg).toMatch(/word for word/i);
    expect(msg).toMatch(/not there/);
  });
});

describe('the constants agree with the rest of Studio', () => {
  it('caps b-roll at what a generate node can actually produce', () => {
    /* VideoDuration in src/types/index.ts stops at '10s'. If that grows, this
       should grow with it; if it shrinks, this test is where the mismatch
       surfaces rather than in a failed run. */
    expect(MAX_BROLL_SECONDS).toBe(10);
  });

  it('keeps the attention limit inside the window the format allows', () => {
    expect(MAX_AROLL_RUN_SECONDS).toBeGreaterThan(5);
    expect(MAX_AROLL_RUN_SECONDS).toBeLessThan(MIN_CLIP_SECONDS);
  });

  it('estimates a minute of speech at roughly a hundred and fifty words', () => {
    expect(estimateSeconds(new Array(150).fill('word').join(' '))).toBeCloseTo(60, 0);
  });
});
