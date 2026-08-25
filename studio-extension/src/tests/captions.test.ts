/**
 * Captions, from timings that were already measured.
 *
 * About 85% of short-form views happen with the sound off, so a clip without
 * captions is one most of its audience cannot follow. The words and their
 * seconds arrive with the reading, so this costs nothing — which makes the
 * only interesting questions the ones about correctness: that a cue never
 * outlives its phrase, that two are never on screen at once, and that a clip
 * cut mid-sentence still shows the part of the sentence it contains.
 */

import {
  MAX_WORDS_PER_CUE,
  cueAt,
  cuesForClip,
  cuesFromPhrase,
  drawCaption,
} from '../studio/media/captions';

describe('splitting a phrase into cues', () => {
  it('keeps cues short enough to read at a glance', () => {
    const cues = cuesFromPhrase({
      start: 0, end: 8,
      text: 'Look at these straw bales right here they have been hiding behind them',
    });
    for (const c of cues) {
      expect(c.text.split(' ').length).toBeLessThanOrEqual(MAX_WORDS_PER_CUE);
    }
  });

  it('never runs a cue past the phrase it came from', () => {
    const cues = cuesFromPhrase({ start: 10, end: 14, text: 'one two three four five six seven eight' });
    expect(cues[0].startSec).toBeGreaterThanOrEqual(10);
    expect(cues[cues.length - 1].endSec).toBeCloseTo(14, 5);
  });

  it('leaves no gap between one cue and the next', () => {
    const cues = cuesFromPhrase({ start: 0, end: 6, text: 'one two three four five six seven eight nine' });
    for (let i = 0; i < cues.length - 1; i++) {
      expect(cues[i].endSec).toBeCloseTo(cues[i + 1].startSec, 5);
    }
  });

  it('gives longer words longer on screen', () => {
    /* Splitting the span evenly by cue count would run "arose" long and clip
       "complicated circumstances" short — they do not take the same time to
       say. Compared by length rather than by position, because where the long
       cue lands depends on where the grouping happens to break. */
    const cues = cuesFromPhrase({
      start: 0, end: 10, text: 'I am here now extraordinarily complicated circumstances arose',
    });
    const held = (c: { startSec: number; endSec: number }) => c.endSec - c.startSec;
    const longest = cues.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    const shortest = cues.reduce((a, b) => (b.text.length < a.text.length ? b : a));
    expect(held(longest)).toBeGreaterThan(held(shortest));
  });

  it('splits on characters as well as words', () => {
    const cues = cuesFromPhrase({
      start: 0, end: 4, text: 'extraordinarily complicated circumstances notwithstanding',
    });
    expect(cues.length).toBeGreaterThan(1);
  });

  it('has nothing to say about an empty phrase', () => {
    expect(cuesFromPhrase({ start: 0, end: 3, text: '   ' })).toEqual([]);
  });

  it('refuses a phrase with no length rather than dividing by zero', () => {
    expect(cuesFromPhrase({ start: 5, end: 5, text: 'hello there' })).toEqual([]);
    expect(cuesFromPhrase({ start: 5, end: 4, text: 'hello there' })).toEqual([]);
  });
});

describe('cues for one clip', () => {
  const phrases = [
    { start: 0, end: 4, text: 'before the clip starts entirely' },
    { start: 8, end: 12, text: 'right at the opening of it' },
    { start: 12, end: 16, text: 'and then the middle section here' },
    { start: 40, end: 44, text: 'long after the clip has ended' },
  ];

  it('is timed against the clip, not against the video', () => {
    /* The encoder sees clip-relative timestamps. Absolute seconds here would
       put every cue past the end of a clip taken from ten minutes in, and
       nothing would ever be drawn. */
    const cues = cuesForClip(phrases, 8, 16);
    expect(cues[0].startSec).toBeCloseTo(0, 5);
    expect(cues[cues.length - 1].endSec).toBeLessThanOrEqual(8.001);
  });

  it('ignores speech outside the clip', () => {
    const cues = cuesForClip(phrases, 8, 16);
    const text = cues.map((c) => c.text).join(' ').toLowerCase();
    expect(text).not.toContain('before');
    expect(text).not.toContain('long after');
  });

  it('keeps the part of a sentence the clip actually contains', () => {
    /* A clip opening mid-sentence still plays the tail of that sentence, and
       the viewer hears it. Dropping the phrase would caption silence. */
    const cues = cuesForClip(phrases, 10, 14);
    expect(cues.length).toBeGreaterThan(0);
    expect(cues[0].startSec).toBeGreaterThanOrEqual(0);
  });

  it('never puts two cues on screen at once', () => {
    const cues = cuesForClip(phrases, 8, 16);
    for (let i = 0; i < cues.length - 1; i++) {
      expect(cues[i].endSec).toBeLessThanOrEqual(cues[i + 1].startSec + 1e-6);
    }
  });

  it('starts every cue at or after the clip start', () => {
    for (const c of cuesForClip(phrases, 10, 14)) {
      expect(c.startSec).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('says nothing for a clip with no speech in it', () => {
    expect(cuesForClip(phrases, 20, 30)).toEqual([]);
  });
});

describe('which cue is showing', () => {
  const cues = [
    { startSec: 0, endSec: 1, text: 'one' },
    { startSec: 1, endSec: 2, text: 'two' },
  ];

  it('finds the one covering that second', () => {
    expect(cueAt(cues, 0.5)?.text).toBe('one');
    expect(cueAt(cues, 1.5)?.text).toBe('two');
  });

  it('treats the boundary as belonging to the next one', () => {
    /* Otherwise both match at exactly 1.0 and which one draws depends on
       array order. */
    expect(cueAt(cues, 1)?.text).toBe('two');
  });

  it('shows nothing before the first and after the last', () => {
    expect(cueAt(cues, -0.5)).toBeNull();
    expect(cueAt(cues, 9)).toBeNull();
  });
});

describe('drawing a cue', () => {
  /* A stand-in for the canvas context, recording what was asked of it. The
     real one lives in a worker and cannot be constructed in a test, but the
     ORDER of operations is the part worth pinning: an outline drawn after the
     fill would cover the letters it exists to separate. */
  function fakeCtx(measured = 100) {
    const calls: string[] = [];
    return {
      calls,
      ctx: {
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        measureText: (s: string) => ({ width: s.length * (measured / 10) }),
        strokeText: (s: string) => calls.push(`stroke:${s}`),
        fillText: (s: string) => calls.push(`fill:${s}`),
        font: '', textAlign: '', textBaseline: '', lineJoin: '',
        miterLimit: 0, strokeStyle: '', fillStyle: '', lineWidth: 0,
      } as unknown as CanvasRenderingContext2D,
    };
  }

  it('strokes each line before filling it', () => {
    /* Fill first and the outline is painted over the letters, which is the
       one thing keeping them readable on someone else's footage. */
    const { ctx, calls } = fakeCtx();
    drawCaption(ctx, { startSec: 0, endSec: 1, text: 'hello' }, 1080, 1920);
    expect(calls.indexOf('stroke:HELLO')).toBeLessThan(calls.indexOf('fill:HELLO'));
  });

  it('leaves the context as it found it', () => {
    const { ctx, calls } = fakeCtx();
    drawCaption(ctx, { startSec: 0, endSec: 1, text: 'hello' }, 1080, 1920);
    expect(calls[0]).toBe('save');
    expect(calls[calls.length - 1]).toBe('restore');
  });

  it('wraps rather than running off the side of the frame', () => {
    /* 80px per character against a 928px budget, so two words already
       overflow. The earlier 40px never wrapped and the test passed on a
       single line, proving nothing. */
    const { ctx, calls } = fakeCtx(800);
    drawCaption(ctx, { startSec: 0, endSec: 1, text: 'four longish words here' }, 1080, 1920);
    expect(calls.filter((c) => c.startsWith('fill:')).length).toBeGreaterThan(1);
  });

  it('draws nothing at all for an empty cue', () => {
    const { ctx, calls } = fakeCtx();
    drawCaption(ctx, { startSec: 0, endSec: 1, text: '   ' }, 1080, 1920);
    expect(calls).toEqual([]);
  });

  it('can be told not to shout', () => {
    const { ctx, calls } = fakeCtx();
    drawCaption(ctx, { startSec: 0, endSec: 1, text: 'hello' }, 1080, 1920, { uppercase: false });
    expect(calls).toContain('fill:hello');
  });
});
