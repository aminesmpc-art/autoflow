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

describe('cues follow the boundaries the encoder actually used', () => {
  /* The bug this pins: captions that did not follow the voice.
     They were worked out when the cut was laid out, against the second the
     reading placed the clip at. Two things move a clip away from that second
     before a frame is encoded:

       · snapping, which slides each boundary to the nearest silence, up to
         1.5s either way
       · re-locating, which happens whenever the closing line was not found
         exactly — the cut then searches a 150 second window for both ends

     Either way the words stayed timed from a number that had been discarded.
     Cue times can only be built from the boundaries the encoder uses. */

  const phrases = [
    { start: 100, end: 104, text: 'the first thing said here' },
    { start: 104, end: 108, text: 'and then the second thing' },
  ];

  it('shifts with a boundary that snapped later', () => {
    const planned = cuesForClip(phrases, 100, 108);
    const snapped = cuesForClip(phrases, 101.5, 108);

    expect(planned[0].startSec).toBeCloseTo(0, 5);
    /* The same words, one and a half seconds earlier in the clip, because the
       clip now begins one and a half seconds later in the video. */
    expect(snapped[0].startSec).toBeCloseTo(0, 5);
    expect(snapped[0].endSec).toBeLessThan(planned[0].endSec);
  });

  it('is completely wrong when timed against a boundary that moved far', () => {
    /* The re-located case, at the scale it actually happens: the reading placed
       the clip at 100s, the cut located it at 130s. Cues timed from 100 put
       every word thirty seconds from where it is spoken. */
    const atPlanned = cuesForClip(phrases, 100, 108);
    const atLocated = cuesForClip(phrases, 130, 138);

    expect(atPlanned.length).toBeGreaterThan(0);
    expect(atLocated).toHaveLength(0);      // no speech there at all
  });

  it('keeps the first word at the top of the clip wherever it starts', () => {
    for (const start of [100, 101.5, 98.5]) {
      const cues = cuesForClip(phrases, start, start + 8);
      expect(cues[0].startSec).toBeGreaterThanOrEqual(0);
      expect(cues[0].startSec).toBeLessThan(2);
    }
  });
});

describe('the styles that light a word up', () => {
  /* The word-by-word highlight is the most used style on high-performing
     explainer content: each word lighting up is a micro-event, and the colour
     moving left to right pulls the eye along the line. Captioned clips take
     about 40% more views, and viewers are around 80% more likely to finish one.

     Word timings are divided across a cue by characters, exactly as cues are
     divided across a phrase — a fraction of a second out, which a highlight
     tolerates and a cut point does not. */

  function recorder() {
    const calls: Array<{ op: string; text: string; fill: string }> = [];
    const ctx = {
      save: () => {}, restore: () => {},
      measureText: (s: string) => ({ width: s.length * 10 }),
      strokeText: (t: string) => calls.push({ op: 'stroke', text: t, fill: String(ctx.fillStyle) }),
      fillText: (t: string) => calls.push({ op: 'fill', text: t, fill: String(ctx.fillStyle) }),
      font: '', textAlign: '', textBaseline: '', lineJoin: '',
      miterLimit: 0, strokeStyle: '', fillStyle: '', lineWidth: 0,
    };
    return { calls, ctx: ctx as unknown as CanvasRenderingContext2D };
  }

  const cue = cuesFromPhrase({ start: 0, end: 4, text: 'one two three four' })[0];

  it('gives every word its own span', () => {
    expect(cue.words).toHaveLength(4);
    expect(cue.words![0].startSec).toBeCloseTo(0, 5);
    expect(cue.words![3].endSec).toBeCloseTo(4, 5);
  });

  it('leaves no gap between one word and the next', () => {
    for (let i = 0; i < cue.words!.length - 1; i++) {
      expect(cue.words![i].endSec).toBeCloseTo(cue.words![i + 1].startSec, 5);
    }
  });

  it('colours only the word being spoken', () => {
    const { ctx, calls } = recorder();
    const mid = (cue.words![1].startSec + cue.words![1].endSec) / 2;

    drawCaption(ctx, cue, 1080, 1920, { preset: 'bold' }, mid);

    const fills = calls.filter((c) => c.op === 'fill');
    const active = fills.filter((c) => c.fill === '#ffd400').map((c) => c.text);
    expect(active).toEqual(['TWO']);
  });

  it('moves the highlight along as the clip plays', () => {
    const seen: string[] = [];
    for (const word of cue.words!) {
      const { ctx, calls } = recorder();
      drawCaption(ctx, cue, 1080, 1920, { preset: 'bold' }, (word.startSec + word.endSec) / 2);
      seen.push(calls.filter((c) => c.op === 'fill' && c.fill === '#ffd400')[0]?.text);
    }
    expect(seen).toEqual(['ONE', 'TWO', 'THREE', 'FOUR']);
  });

  it('dims what has not been said yet in karaoke', () => {
    const { ctx, calls } = recorder();
    drawCaption(ctx, cue, 1080, 1920, { preset: 'karaoke' }, 0.2);

    const fills = calls.filter((c) => c.op === 'fill');
    expect(fills[0].fill).toBe('#4ade80');
    expect(fills[1].fill).toBe('rgba(255,255,255,0.55)');
  });

  it('highlights nothing when the caller does not know the time', () => {
    /* Better a plain line than a wrong word lit up. */
    const { ctx, calls } = recorder();
    drawCaption(ctx, cue, 1080, 1920, { preset: 'bold' });
    const fills = calls.filter((c) => c.op === 'fill');
    expect(fills.every((f) => f.fill === '#ffffff')).toBe(true);
  });

  it('never highlights under the plain presets', () => {
    for (const preset of ['clean', 'minimal'] as const) {
      const { ctx, calls } = recorder();
      drawCaption(ctx, cue, 1080, 1920, { preset }, 1);
      expect(calls.filter((c) => c.op === 'fill').every((f) => f.fill === '#ffffff')).toBe(true);
    }
  });

  it('keeps the speaker\u2019s own capitals under minimal', () => {
    const { ctx, calls } = recorder();
    const mixed = cuesFromPhrase({ start: 0, end: 2, text: 'The Fed said' })[0];
    drawCaption(ctx, mixed, 1080, 1920, { preset: 'minimal' }, 0.5);
    expect(calls.filter((c) => c.op === 'fill').map((c) => c.text)).toEqual(['The', 'Fed', 'said']);
  });

  it('still draws a cue that arrived with no word spans', () => {
    /* A cut node laid out before word spans existed. */
    const { ctx, calls } = recorder();
    drawCaption(
      ctx,
      { startSec: 0, endSec: 2, text: 'older cue here' },
      1080, 1920, { preset: 'bold' }, 1,
    );
    expect(calls.filter((c) => c.op === 'fill').map((c) => c.text)).toEqual(['OLDER', 'CUE', 'HERE']);
  });

  it('strokes every word before filling it', () => {
    const { ctx, calls } = recorder();
    drawCaption(ctx, cue, 1080, 1920, { preset: 'bold' }, 1);
    for (let i = 0; i < calls.length; i += 2) {
      expect(calls[i].op).toBe('stroke');
      expect(calls[i + 1].op).toBe('fill');
      expect(calls[i].text).toBe(calls[i + 1].text);
    }
  });
});
