/**
 * The sounds the sheet names, and whether they are the sounds it meant.
 *
 * The audio spike settled that the encoder takes a mixed track. What was left
 * was that the sheet NAMES a sound — "whoosh", "impact", "riser" — and naming
 * is not having. These are synthesised rather than shipped: a stock sound with
 * unclear terms is a liability attached to every clip it appears in, three
 * sounds as 48kHz audio would outweigh the studio bundle, and a generated
 * sound is the same every run, which is the only reason a test can say
 * anything about one.
 *
 * So these check the sounds are what their names claim. A whoosh whose energy
 * does not move is hiss; an impact that does not fall in pitch is a hum; a
 * riser that does not get louder is neither. Those are the failures that would
 * ship silently, because all three still "produce audio".
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

import { whoosh, impact, riser, soundFor, soundName, SOUND_NAMES } from '../studio/media/sfx';

const CUT = fs.readFileSync(
  path.resolve(__dirname, '../studio/media/cut.ts'), 'utf8',
).replace(/\r\n/g, '\n');

const RATE = 48000;

/** Energy at one frequency over a window — the same Goertzel the spike used. */
function energyAt(buf: Float32Array, hz: number, rate = RATE): number {
  const w = (2 * Math.PI * hz) / rate;
  const c = 2 * Math.cos(w);
  let s1 = 0; let s2 = 0;
  for (let i = 0; i < buf.length; i++) { const s0 = buf[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - c * s1 * s2)) / buf.length;
}

/** RMS of a slice, as a fraction through the buffer. */
const rmsOf = (buf: Float32Array, from: number, to: number): number => {
  const a = Math.floor(buf.length * from); const b = Math.floor(buf.length * to);
  let sum = 0;
  for (let i = a; i < b; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / Math.max(1, b - a));
};

const peakOf = (buf: Float32Array): number => {
  let m = 0;
  for (const v of buf) { const a = Math.abs(v); if (a > m) m = a; }
  return m;
};

describe('every sound, whatever it is', () => {
  const all = [['whoosh', whoosh(RATE)], ['impact', impact(RATE)], ['riser', riser(RATE)]] as const;

  it.each(all)('%s has samples and none of them are broken', (_name, buf) => {
    expect(buf.length).toBeGreaterThan(1000);
    for (const v of buf) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });

  it.each(all)('%s sits under a voice rather than beside one', (_name, buf) => {
    /* Speech in these clips is near -6 dBFS. An effect at the same level does
       not punctuate the words, it competes with them — and on a phone speaker
       the broadband effect wins. */
    expect(peakOf(buf)).toBeCloseTo(0.22, 2);
  });

  it.each(all)('%s starts and ends near silence, so it cannot click', (_name, buf) => {
    /* A burst beginning on a hard edge clicks, and a click at a cut is heard
       as a fault in the export rather than as an effect. */
    expect(Math.abs(buf[0])).toBeLessThan(0.02);
    expect(Math.abs(buf[buf.length - 1])).toBeLessThan(0.02);
  });

  it('is the same sound every run', () => {
    /* Math.random would mean a re-encode after a cutaway landed quietly
       changed the audio of a clip somebody had already watched. */
    const a = whoosh(RATE); const b = whoosh(RATE);
    expect(Array.from(a.slice(0, 50))).toEqual(Array.from(b.slice(0, 50)));
  });
});

describe('a whoosh moves', () => {
  const w = whoosh(RATE);

  it('is short, because it covers a join rather than announces one', () => {
    expect(w.length / RATE).toBeLessThan(0.5);
  });

  it('sweeps up and back, rather than sitting still', () => {
    /* Fixed-cutoff noise is hiss. The sweep is the whole sound: high-frequency
       energy has to peak in the middle and fall away again. */
    const slice = (from: number, to: number) =>
      w.subarray(Math.floor(w.length * from), Math.floor(w.length * to));
    const early = energyAt(slice(0, 0.2), 3000);
    const mid = energyAt(slice(0.3, 0.5), 3000);
    const late = energyAt(slice(0.8, 1), 3000);
    expect(mid).toBeGreaterThan(early);
    expect(mid).toBeGreaterThan(late);
  });

  it('swells and fades rather than starting at full', () => {
    expect(rmsOf(w, 0.4, 0.6)).toBeGreaterThan(rmsOf(w, 0, 0.08));
    expect(rmsOf(w, 0.4, 0.6)).toBeGreaterThan(rmsOf(w, 0.92, 1));
  });
});

describe('an impact lands', () => {
  const im = impact(RATE);

  it('puts its weight low, where a drop is felt', () => {
    const head = im.subarray(0, Math.floor(RATE * 0.12));
    expect(energyAt(head, 80)).toBeGreaterThan(energyAt(head, 1200));
  });

  it('falls in pitch instead of holding a tone', () => {
    /* A flat low tone is a hum. The fall is what is heard as weight. */
    /* Windows chosen from the sweep rather than guessed. The pitch runs
       95Hz -> 42Hz over the first 62% of the sound, so at 3% it is still near
       90 and by 55% it is near 47. An earlier version of this test compared
       12-20%, where the tone is ~75Hz and neither claim holds — the sound was
       right and the measurement was not. */
    const early = im.subarray(0, Math.floor(RATE * 0.06));
    const later = im.subarray(Math.floor(im.length * 0.4), Math.floor(im.length * 0.7));
    expect(energyAt(early, 90)).toBeGreaterThan(energyAt(early, 45));
    expect(energyAt(later, 47)).toBeGreaterThan(energyAt(later, 90));
  });

  it('decays fast, so it punctuates instead of droning', () => {
    /* A long tail sits under the next sentence. */
    expect(rmsOf(im, 0.75, 1)).toBeLessThan(rmsOf(im, 0, 0.15) * 0.2);
  });
});

describe('a riser builds', () => {
  const r = riser(RATE);

  it('is the long one, because the wait is its job', () => {
    expect(r.length / RATE).toBeGreaterThan(0.7);
  });

  it('gets louder the whole way', () => {
    const q1 = rmsOf(r, 0, 0.25);
    const q2 = rmsOf(r, 0.25, 0.5);
    const q3 = rmsOf(r, 0.5, 0.75);
    const q4 = rmsOf(r, 0.75, 1);
    expect(q2).toBeGreaterThan(q1);
    expect(q3).toBeGreaterThan(q2);
    expect(q4).toBeGreaterThan(q3);
  });

  it('climbs in frequency as well as in level', () => {
    const slice = (from: number, to: number) =>
      r.subarray(Math.floor(r.length * from), Math.floor(r.length * to));
    expect(energyAt(slice(0.8, 0.95), 5000))
      .toBeGreaterThan(energyAt(slice(0.05, 0.2), 5000));
  });

  it('is loudest at the very end, where the reveal is', () => {
    /* A riser that fades out has resolved itself and left the reveal nothing
       to do. */
    expect(rmsOf(r, 0.85, 0.99)).toBeGreaterThan(rmsOf(r, 0.4, 0.6));
  });
});

describe('matching what the model called it', () => {
  it('knows the three the prompt asks for by name', () => {
    expect(SOUND_NAMES.sort()).toEqual(['impact', 'riser', 'whoosh']);
    for (const n of SOUND_NAMES) expect(soundName(n)).toBe(n);
  });

  it('takes the name out of a sentence, since models write sentences', () => {
    expect(soundName('a soft whoosh over the cut')).toBe('whoosh');
    expect(soundName('IMPACT')).toBe('impact');
  });

  it('accepts the words it reaches for instead', () => {
    expect(soundName('swoosh')).toBe('whoosh');
    expect(soundName('boom')).toBe('impact');
    expect(soundName('build')).toBe('riser');
  });

  it('makes nothing for a sound it does not have', () => {
    /* Playing a whoosh where a record scratch was asked for is worse than
       silence: the sheet still says "record scratch", so anyone comparing the
       clip to the plan finds a sound that contradicts its own description. */
    expect(soundName('record scratch')).toBe('');
    expect(soundName('air horn')).toBe('');
    expect(soundFor('slide whistle', RATE)).toBeNull();
    expect(soundFor('', RATE)).toBeNull();
  });

  it('hands back the same buffer for a repeated name', () => {
    /* emitPlan puts a whoosh on every Omni seam, so a four-part clip asks for
       the same sound three times. */
    expect(soundFor('whoosh', RATE)).toBe(soundFor('whoosh', RATE));
  });

  it('makes a sound at the rate it is asked for', () => {
    /* mediabunny may resample before the hook runs, and a sound built at the
       source rate would play at the wrong pitch and length. */
    const a = soundFor('whoosh', 48000) as Float32Array;
    const b = soundFor('whoosh', 24000) as Float32Array;
    expect(Math.round(a.length / b.length)).toBe(2);
  });
});

describe('the mix, in the code that ships', () => {
  it('adds to the speech rather than replacing it', () => {
    expect(CUT).toMatch(/buf\[j\] \+ v/);
  });

  it('clamps, so a loud sentence plus an effect cannot crackle', () => {
    /* Out-of-range samples reach the encoder as distortion that sounds like a
       broken export rather than like a loud moment. */
    expect(CUT).toMatch(/Math\.max\(-1, Math\.min\(1, buf\[j\] \+ v\)\)/);
  });

  it('leaves a silent clip silent', () => {
    /* B-roll is handed over silent on purpose; adding a whoosh to it would
       give a cutaway its own soundtrack. */
    expect(CUT).toMatch(/const sounds = silent\s*\?\s*\[\]/);
  });

  it('does not install the hook when there is nothing to play', () => {
    /* An audio process hook forces every sample through a copy and a rebuild.
       A clip with no sfx must not pay for that. */
    expect(CUT).toMatch(/\(sounds\.length[\s\S]{0,40}\?\s*\{/);
  });

  it('resolves each sound against the sample rate it is handed', () => {
    expect(CUT).toMatch(/soundFor\(s\.what, rate\)/);
  });

  it('skips a sample no sound overlaps', () => {
    expect(CUT).toMatch(/if \(!live\.length\) return sample;/);
  });
});
