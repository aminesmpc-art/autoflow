/**
 * Finding moments from what is said, not from how loud it is.
 *
 * The claim: loudness is the right signal for a chase and the wrong one for a
 * tutorial, and nothing should have to be told which it is looking at.
 *
 * That is not theory. Run against a real trading video, the audio shortlist
 * picked a chart section as the strongest moment and rated a genuine piece of
 * advice "unremarkable" — because advice is not loud. This exists because of
 * that, and the blending test at the bottom is the part that matters: the
 * content decides which signal wins, so nobody has to classify a video and
 * nobody can classify it wrongly.
 */

import {
  blendMoments,
  closesCleanly,
  findTextMoments,
  opensCleanly,
  phraseScore,
} from '../studio/clip/textMoments';
import type { TranscriptChunk } from '../studio/ask/clipperBrain';

/** Phrases at a natural speaking rate, three seconds apart. */
const phrases = (texts: string[], from = 0, gap = 3): TranscriptChunk[] =>
  texts.map((text, i) => ({
    index: i,
    start: from + i * gap,
    end: from + i * gap + gap - 0.2,
    text,
  }));

/* ------------------------------------------------------------------ */

describe('what makes a phrase promising', () => {
  it('rewards a turn in the argument', () => {
    expect(phraseScore('But actually the problem is your entry')).toBeGreaterThan(
      phraseScore('And we kept going for a while'),
    );
  });

  it('rewards advice aimed at the viewer', () => {
    expect(phraseScore('You should never enter without confirmation')).toBeGreaterThan(
      phraseScore('The chart was moving around a lot'),
    );
  });

  it('rewards something checkable over a platitude', () => {
    expect(phraseScore('It dropped 40% in one hour')).toBeGreaterThan(
      phraseScore('It dropped quite a lot in a short time'),
    );
  });

  it('rewards a question, which is a hook by construction', () => {
    expect(phraseScore('So why does this keep happening?')).toBeGreaterThan(
      phraseScore('So this keeps happening'),
    );
  });

  it('scores an empty phrase at nothing', () => {
    expect(phraseScore('')).toBe(0);
  });
});

describe('whether a phrase can open or close a clip', () => {
  it('refuses an opening that leans on what came before', () => {
    /* Fine sentences, terrible first lines: the viewer never heard the thing
       being referred to. */
    for (const bad of [
      'And then he told me the rest',
      'So that is why it works',
      'But he was completely wrong',
      'Which is the whole point really',
    ]) {
      expect(opensCleanly(bad)).toBe(false);
    }
  });

  it('accepts an opening that stands on its own', () => {
    expect(opensCleanly('Most people lose money on the first trade')).toBe(true);
    expect(opensCleanly('Here is what nobody tells you')).toBe(true);
  });

  it('refuses a fragment as an opening', () => {
    expect(opensCleanly('Yeah exactly')).toBe(false);
    expect(opensCleanly('   ')).toBe(false);
  });

  it('accepts an ending that closes its own loop', () => {
    expect(closesCleanly('And that is why you wait for the retest.')).toBe(true);
    expect(closesCleanly('It works.')).toBe(true);
  });

  it('refuses an ending left hanging', () => {
    expect(closesCleanly('and then the next thing that happens is')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe('finding moments in a talk', () => {
  const TALK = phrases([
    'So anyway we were talking about this earlier.',
    'Most people lose money because they enter too early.',
    'The mistake is chasing the candle instead of waiting.',
    'You should never enter without a confirmed structure shift.',
    'That is why I wait for the 15 minute retest every single time.',
    'And then we went and got lunch afterwards.',
    'It was fine.',
  ]);

  it('finds a span that opens cleanly and closes resolved', () => {
    const found = findTextMoments(TALK, { minSec: 6, maxSec: 40, count: 5 });
    expect(found.length).toBeGreaterThan(0);
    const best = found[0];
    expect(best.start).toBeGreaterThanOrEqual(TALK[1].start);
    expect(best.end).toBeLessThanOrEqual(TALK[4].end);
  });

  it('starts on a phrase boundary that was actually measured', () => {
    /* Never inside a phrase. A span starting halfway through one would need a
       second invented to describe it, which is the single thing this whole
       pipeline refuses to do. */
    const found = findTextMoments(TALK, { minSec: 6, maxSec: 40, count: 5 });
    const starts = new Set(TALK.map((p) => p.start));
    const ends = new Set(TALK.map((p) => p.end));
    for (const m of found) {
      expect(starts.has(m.start)).toBe(true);
      expect(ends.has(m.end)).toBe(true);
    }
  });

  it('never returns two moments that overlap', () => {
    const found = findTextMoments(TALK, { minSec: 6, maxSec: 40, count: 5 });
    for (let i = 0; i < found.length; i++) {
      for (let j = i + 1; j < found.length; j++) {
        const a = found[i]; const b = found[j];
        expect(a.start < b.end && a.end > b.start).toBe(false);
      }
    }
  });

  it('respects the shortest and longest a clip may be', () => {
    const found = findTextMoments(TALK, { minSec: 6, maxSec: 15, count: 5 });
    for (const m of found) {
      expect(m.end - m.start).toBeGreaterThanOrEqual(6);
      expect(m.end - m.start).toBeLessThanOrEqual(15);
    }
  });

  it('says in words why it chose one', () => {
    const found = findTextMoments(TALK, { minSec: 6, maxSec: 40, count: 5 });
    expect(found[0].why).toMatch(/turns on a point|tells the viewer|numbers|closes its own loop/);
  });

  it('gives nothing when the transcript has no phrase timings', () => {
    /* A chat-built transcript is four-minute chunks. Its boundaries are not
       sentence boundaries, so everything above would be measuring nothing. */
    const chunked: TranscriptChunk[] = [
      { index: 0, start: 0, end: 240, text: 'a very long wall of text '.repeat(80) },
      { index: 1, start: 232, end: 472, text: 'another wall of text here '.repeat(80) },
      { index: 2, start: 464, end: 704, text: 'and a third one as well '.repeat(80) },
    ];
    expect(findTextMoments(chunked)).toEqual([]);
  });

  it('gives nothing rather than guessing from too few phrases', () => {
    expect(findTextMoments(phrases(['Hello there everyone.']))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

describe('blending the two shortlists', () => {
  /* THE test. Each list is normalised against itself, so whichever signal
     actually varies in this recording is the one that decides. */

  const at = (start: number, score: number, why = ''): any =>
    ({ start, end: start + 30, score, why });

  it('lets loudness decide when the words are flat', () => {
    /* A chase: one moment much louder than the rest, speech signals uniform. */
    const audio = [at(100, 3.0, 'much louder'), at(200, 0.1, 'unremarkable'), at(300, 0.1, 'unremarkable')];
    const text = [at(400, 1.0), at(500, 1.0), at(600, 1.0)];
    const out = blendMoments(audio, text, 1);
    expect(out[0].start).toBe(100);
  });

  it('lets the words decide when the loudness is flat', () => {
    /* A tutorial: level delivery throughout, one genuinely dense passage.
       This is the case that was getting it wrong. */
    const audio = [at(100, 1.0, 'unremarkable'), at(200, 1.0), at(300, 1.0)];
    const text = [at(400, 4.0, 'tells the viewer what to do'), at(500, 0.2), at(600, 0.2)];
    const out = blendMoments(audio, text, 1);
    expect(out[0].start).toBe(400);
  });

  it('drops a moment both lists found rather than offering it twice', () => {
    const audio = [at(100, 2.0, 'louder than usual')];
    const text = [at(110, 2.0, 'turns on a point')];
    expect(blendMoments(audio, text, 5)).toHaveLength(1);
  });

  it('works from one list alone', () => {
    expect(blendMoments([at(10, 1), at(80, 2)], [], 5)).toHaveLength(2);
    expect(blendMoments([], [at(10, 1), at(80, 2)], 5)).toHaveLength(2);
    expect(blendMoments([], [], 5)).toEqual([]);
  });

  it('gives no preference when every candidate scored the same', () => {
    /* Identical scores carry no information about which is better, so they
       must not be turned into a ranking by dividing by nearly zero. */
    const flat = [at(10, 1), at(80, 1), at(150, 1)];
    const out = blendMoments(flat, [], 3);
    expect(out).toHaveLength(3);
    expect(out.every((m) => m.score === 0)).toBe(true);
  });

  it('returns no more than it was asked for', () => {
    const many = Array.from({ length: 20 }, (_, i) => at(i * 60, i));
    expect(blendMoments(many, [], 5)).toHaveLength(5);
  });
});
