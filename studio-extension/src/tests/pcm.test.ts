/// <reference types="node" />
/**
 * Turning decoded audio into something the silence detector can read.
 *
 * These are small functions, and the temptation is to trust them. The reason
 * not to: every failure mode here is SILENT. A resampler that reads one past
 * the end writes NaN, and NaN compares false against every threshold, so the
 * energy profile looks fine, no window is ever "quiet", and the detector
 * reports no pauses in audio that is half silence. Nothing throws. Nothing
 * logs. The clips just come out cut in the wrong places.
 *
 * So the assertions here are about exact values and finiteness, not shapes.
 */

import {
  toMono, resampleLinear, decodeWindow, concatFloat32, ANALYSIS_SAMPLE_RATE,
  wavBytes, wavDataUrl,
} from '../studio/media/pcm';

const allFinite = (a: Float32Array) => Array.prototype.every.call(a, Number.isFinite);

/* ------------------------------------------------------------------ */

describe('mixing to mono', () => {
  it('passes mono through untouched', () => {
    const s = new Float32Array([0.1, 0.2, 0.3]);
    expect(toMono(s, 1)).toBe(s);
  });

  it('averages a stereo pair rather than taking one side', () => {
    /* Two mics on separate channels is the normal podcast setup. Channel 0
       alone is one person's track, and their "pauses" are the other person
       talking — the opposite of the gap we want to cut on. */
    const s = new Float32Array([1, 0, 0.5, -0.5, 0.2, 0.4]);
    expect(Array.from(toMono(s, 2))).toEqual([0.5, 0, expect.closeTo(0.3, 6)]);
  });

  it('handles more than two channels', () => {
    const s = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from(toMono(s, 4))).toEqual([2.5, 6.5]);
  });

  it('drops a trailing partial frame instead of reading past the end', () => {
    /* Five samples across two channels is two frames and a stray. Reading the
       stray's missing partner gives undefined, which becomes NaN. */
    const out = toMono(new Float32Array([1, 1, 2, 2, 3]), 2);
    expect(out.length).toBe(2);
    expect(allFinite(out)).toBe(true);
  });

  it('survives an empty buffer', () => {
    expect(toMono(new Float32Array(0), 2).length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

describe('resampling', () => {
  it('returns the same buffer when the rate already matches', () => {
    const s = new Float32Array([1, 2, 3]);
    expect(resampleLinear(s, 16000, 16000)).toBe(s);
  });

  it('downsamples 48k to 16k at exactly one third the length', () => {
    const s = new Float32Array(48000);
    expect(resampleLinear(s, 48000, 16000).length).toBe(16000);
  });

  it('upsamples to the right length too', () => {
    const s = new Float32Array(1000);
    expect(resampleLinear(s, 8000, 16000).length).toBe(2000);
  });

  it('leaves a constant signal constant', () => {
    /* Any interpolation between equal neighbours must give the same value.
       If this drifts, the arithmetic is wrong somewhere obvious. */
    const s = new Float32Array(1000).fill(0.25);
    const out = resampleLinear(s, 48000, 16000);
    for (const v of out) expect(v).toBeCloseTo(0.25, 6);
  });

  it('interpolates a ramp linearly', () => {
    /* The real correctness check. A ramp resampled 2:1 should read every
       other input sample exactly; nearest-neighbour or an off-by-one in the
       fraction shows up here and nowhere else. */
    const s = new Float32Array(100);
    for (let i = 0; i < s.length; i++) s[i] = i;
    const out = resampleLinear(s, 2, 1);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(2, 5);
    expect(out[10]).toBeCloseTo(20, 5);
  });

  it('never produces NaN at the final sample', () => {
    /* THE bug this file exists to prevent. Reading i0+1 unclamped on the last
       output sample gives undefined, which is NaN, which compares false
       against every threshold — so the energy profile looks normal and the
       detector silently finds no pauses at all. */
    for (const [from, to] of [[48000, 16000], [44100, 16000], [16000, 16000], [8000, 16000], [3, 2]]) {
      const s = new Float32Array(from === 3 ? 3 : 1000).fill(0.5);
      const out = resampleLinear(s, from, to);
      expect(allFinite(out)).toBe(true);
      if (out.length) expect(Number.isFinite(out[out.length - 1])).toBe(true);
    }
  });

  it('handles a rate that does not divide evenly', () => {
    const s = new Float32Array(44100).fill(0.1);
    const out = resampleLinear(s, 44100, 16000);
    expect(out.length).toBe(16000);
    expect(allFinite(out)).toBe(true);
  });

  it('survives empty input and nonsense rates without throwing', () => {
    expect(resampleLinear(new Float32Array(0), 48000, 16000).length).toBe(0);
    expect(resampleLinear(new Float32Array([1, 2]), 0, 16000).length).toBe(0);
    expect(resampleLinear(new Float32Array([1, 2]), 48000, 0).length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

describe('choosing the slice to decode', () => {
  it('takes a window either side of the target', () => {
    expect(decodeWindow(100, 1.5, 600)).toEqual({ start: 98.5, end: 101.5 });
  });

  it('clamps at the start of the file', () => {
    /* Asking a decoder for -1.2s is how a cut near the opening turns into an
       exception rather than a clip. */
    expect(decodeWindow(0.3, 1.5, 600)).toEqual({ start: 0, end: 1.8 });
  });

  it('clamps at the end of the file', () => {
    expect(decodeWindow(599.8, 1.5, 600)).toEqual({ start: 598.3, end: 600 });
  });

  it('never returns an end before its start', () => {
    for (const [t, r, d] of [[-50, 1.5, 600], [900, 1.5, 600], [5, 0, 600]]) {
      const w = decodeWindow(t, r, d);
      expect(w.end).toBeGreaterThanOrEqual(w.start);
    }
  });

  it('returns an empty window for a file with no duration', () => {
    expect(decodeWindow(10, 1.5, 0)).toEqual({ start: 0, end: 0 });
  });
});

/* ------------------------------------------------------------------ */

describe('joining decoded chunks', () => {
  it('concatenates in order', () => {
    const out = concatFloat32([
      new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([4, 5]),
    ]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns a single chunk without copying it', () => {
    const only = new Float32Array([1, 2, 3]);
    expect(concatFloat32([only])).toBe(only);
  });

  it('handles an empty list and empty chunks', () => {
    expect(concatFloat32([]).length).toBe(0);
    expect(concatFloat32([new Float32Array(0), new Float32Array([1])]).length).toBe(1);
  });
});

describe('the analysis rate', () => {
  it('is high enough for the 20ms energy window to mean something', () => {
    /* 320 samples per window at 16 kHz. Named in one place so the decoder and
       the detector cannot drift apart on it. */
    expect(ANALYSIS_SAMPLE_RATE).toBe(16000);
    expect((ANALYSIS_SAMPLE_RATE * 20) / 1000).toBeGreaterThan(100);
  });
});

/* ------------------------------------------------------------------ */

describe('the WAV wrapper', () => {
  const str = (b: Uint8Array, at: number, n: number) =>
    String.fromCharCode(...Array.from(b.subarray(at, at + n)));
  const u32 = (b: Uint8Array, at: number) =>
    new DataView(b.buffer, b.byteOffset).getUint32(at, true);
  const u16 = (b: Uint8Array, at: number) =>
    new DataView(b.buffer, b.byteOffset).getUint16(at, true);
  const i16 = (b: Uint8Array, at: number) =>
    new DataView(b.buffer, b.byteOffset).getInt16(at, true);

  const SAMPLES = new Float32Array([0, 0.5, -0.5, 1, -1]);

  it('writes the chunk names a reader looks for', () => {
    const b = wavBytes(SAMPLES, 16000);
    expect(str(b, 0, 4)).toBe('RIFF');
    expect(str(b, 8, 4)).toBe('WAVE');
    expect(str(b, 12, 4)).toBe('fmt ');
    expect(str(b, 36, 4)).toBe('data');
  });

  it('sizes the RIFF field as everything AFTER it, not the whole file', () => {
    /* The classic mistake. Counting the whole file makes some readers trim
       the last samples, and the failure looks like a model mishearing the end
       of a sentence rather than like a broken header. */
    const b = wavBytes(SAMPLES, 16000);
    expect(u32(b, 4)).toBe(b.length - 8);
  });

  it('sizes the data chunk as the samples alone', () => {
    const b = wavBytes(SAMPLES, 16000);
    expect(u32(b, 40)).toBe(SAMPLES.length * 2);
    expect(b.length).toBe(44 + SAMPLES.length * 2);
  });

  it('declares mono 16-bit PCM at the rate it was given', () => {
    /* A wrong rate here is heard, not thrown: the audio plays fast and the
       transcript comes back as gibberish. */
    const b = wavBytes(SAMPLES, 16000);
    expect(u16(b, 20)).toBe(1);          // format: PCM
    expect(u16(b, 22)).toBe(1);          // channels
    expect(u32(b, 24)).toBe(16000);      // sample rate
    expect(u32(b, 28)).toBe(16000 * 2);  // byte rate
    expect(u16(b, 32)).toBe(2);          // block align
    expect(u16(b, 34)).toBe(16);         // bits
  });

  it('carries a different rate through', () => {
    const b = wavBytes(SAMPLES, 44100);
    expect(u32(b, 24)).toBe(44100);
    expect(u32(b, 28)).toBe(44100 * 2);
  });

  it('converts samples to signed 16-bit', () => {
    const b = wavBytes(SAMPLES, 16000);
    expect(i16(b, 44)).toBe(0);
    expect(i16(b, 46)).toBeCloseTo(0.5 * 0x7fff, -1);
    expect(i16(b, 48)).toBeCloseTo(-0.5 * 0x8000, -1);
    expect(i16(b, 50)).toBe(0x7fff);
    expect(i16(b, 52)).toBe(-0x8000);
  });

  it('clamps rather than wrapping a sample past full scale', () => {
    /* A float slightly over 1.0 wraps to a large NEGATIVE sixteen-bit value,
       which is a click — and clicks every few samples read as noise, not
       speech. */
    const b = wavBytes(new Float32Array([1.5, -1.5, 3, -3]), 16000);
    expect(i16(b, 44)).toBe(0x7fff);
    expect(i16(b, 46)).toBe(-0x8000);
    expect(i16(b, 48)).toBe(0x7fff);
    expect(i16(b, 50)).toBe(-0x8000);
  });

  it('produces a valid empty file for no samples', () => {
    const b = wavBytes(new Float32Array(0), 16000);
    expect(b.length).toBe(44);
    expect(u32(b, 40)).toBe(0);
    expect(u32(b, 4)).toBe(36);
  });

  it('wraps as a data URL the adapter will recognise as audio', () => {
    /* The mime matters: dataUrlToFile in the Gemini adapter reads it to name
       the file, so audio/wav is what makes the attachment a .wav rather than
       a .png the chat then refuses. */
    const url = wavDataUrl(SAMPLES, 16000);
    expect(url.startsWith('data:audio/wav;base64,')).toBe(true);
    expect(url.length).toBeGreaterThan(60);
  });

  it('round-trips through base64 without corruption', () => {
    const url = wavDataUrl(SAMPLES, 16000);
    const b64 = url.slice(url.indexOf(',') + 1);
    const back = Uint8Array.from(Buffer.from(b64, 'base64'));
    expect(Array.from(back)).toEqual(Array.from(wavBytes(SAMPLES, 16000)));
  });

  it('handles a buffer large enough to break a naive apply()', () => {
    /* String.fromCharCode.apply throws on very large arrays, so the base64 is
       chunked. Four minutes at 16kHz is ~3.8M samples; this is a smaller but
       still over-the-limit case. */
    const big = new Float32Array(200_000).fill(0.25);
    expect(() => wavDataUrl(big, 16000)).not.toThrow();
  });
});
