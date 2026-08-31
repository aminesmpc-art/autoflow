/**
 * Turning decoded audio into something the silence detector can read.
 *
 * Everything here is arithmetic on sample arrays, deliberately: WebCodecs
 * does not exist in Node, so anything that touches a decoder cannot be unit
 * tested. Keeping the maths out of decode.ts means the part that can be
 * verified on every run is the part where an off-by-one actually costs
 * something — a resampler that reads one sample past the end produces a NaN,
 * and a NaN in the energy profile makes every window compare false, so the
 * detector reports "no pause here" for audio full of pauses.
 */

/**
 * Average interleaved channels down to mono.
 *
 * Averaging rather than taking channel 0. A podcast recorded with two mics on
 * separate channels has one speaker per side, so channel 0 alone is one
 * person's track — and their pauses are the other person talking, which is
 * the opposite of the gap we want to cut on.
 */
export function toMono(interleaved: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return interleaved;
  const frames = Math.floor(interleaved.length / channels);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * channels;
    for (let c = 0; c < channels; c++) sum += interleaved[base + c];
    out[f] = sum / channels;
  }
  return out;
}

/**
 * Linear resample to a target rate.
 *
 * Good enough on purpose. This audio is measured, never listened to — the
 * only consumer is an RMS energy profile at 20ms resolution, where the
 * aliasing a proper windowed-sinc filter would prevent is far below the
 * threshold that separates a pause from a word. Spending a real filter here
 * would buy nothing and cost the decode budget.
 */
export function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || !samples.length) return samples;
  if (fromRate <= 0 || toRate <= 0) return new Float32Array(0);

  const ratio = fromRate / toRate;
  const count = Math.floor(samples.length / ratio);
  const out = new Float32Array(Math.max(0, count));
  const last = samples.length - 1;

  for (let i = 0; i < count; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    /* Clamped, not i0 + 1. The final output sample lands on or just past the
       final input sample, and reading one beyond gives undefined — which in a
       Float32Array is NaN, which then poisons every comparison downstream. */
    const i1 = i0 + 1 <= last ? i0 + 1 : last;
    const frac = pos - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

/**
 * The slice of the source to decode around a cut point.
 *
 * Clamped to the file, so a target near either end does not ask for audio
 * that is not there. Returned in source-timeline seconds because that is what
 * both the decoder and snapToSilence take — nothing downstream should have to
 * remember to add an offset back on.
 */
export function decodeWindow(
  targetSec: number,
  radiusSec: number,
  durationSec: number,
): { start: number; end: number } {
  if (!(durationSec > 0)) return { start: 0, end: 0 };
  const r = Math.max(0, radiusSec);
  const start = Math.max(0, Math.min(targetSec - r, durationSec));
  const end = Math.min(durationSec, Math.max(targetSec + r, 0));
  return end > start ? { start, end } : { start, end: start };
}

/** Join decoded chunks into one buffer. */
export function concatFloat32(chunks: Float32Array[]): Float32Array {
  if (chunks.length === 1) return chunks[0];
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * The rate to decode audio at.
 *
 * 16 kHz is well past what the energy profile needs — a 20ms window holds 320
 * samples at that rate — and it is a quarter of the data of 48 kHz to move
 * around. Named rather than inlined so the decoder and the tests cannot
 * disagree about it.
 */
export const ANALYSIS_SAMPLE_RATE = 16000;

/* ------------------------------------------------------------------ */
/* WAV                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Wrap mono float samples as a 16-bit PCM WAV.
 *
 * WAV rather than MP3 or Opus, for one reason: it needs no encoder. Chrome's
 * WebCodecs can encode AAC and Opus but not MP3, so reaching for a compressed
 * format means either a WASM encoder — reintroducing the exact dependency this
 * pipeline was designed to avoid — or verifying which containers the chat UI
 * accepts. A WAV is a 44-byte header and the samples, and every one of those
 * bytes is arithmetic.
 *
 * Which is also why it is worth testing. A header with the wrong byte order or
 * a size field that counts the wrong thing produces a file that is rejected,
 * or worse, played at the wrong rate — and the failure surfaces as a chat
 * model politely transcribing four minutes of chipmunk.
 */
export function wavBytes(samples: Float32Array, sampleRate: number): Uint8Array {
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  /* Everything after this field — the whole file minus the 8 bytes of "RIFF"
     and the size itself. Counting the whole file here is the classic mistake
     and makes some readers trim the last samples. */
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');

  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);                       // PCM header length
  view.setUint16(20, 1, true);                        // format: PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);  // byte rate
  view.setUint16(32, channels * bytesPerSample, true);               // block align
  view.setUint16(34, bitsPerSample, true);

  ascii(36, 'data');
  view.setUint32(40, dataSize, true);

  /* Clamped before scaling. A float slightly past 1.0 wraps to a large
     negative sixteen-bit value, which is heard as a click — and a decoder
     hearing clicks every few samples reports noise, not speech. */
  let at = 44;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    at += bytesPerSample;
  }

  return new Uint8Array(buffer);
}

/** Base64 without assuming which runtime this is. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;   // chunked: apply() throws on very large arrays
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + step)) as unknown as number[],
    );
  }
  if (typeof btoa === 'function') return btoa(binary);
  /* Node, for the tests. */
  return (globalThis as any).Buffer.from(binary, 'binary').toString('base64');
}

/** A WAV as a data URL, ready to hand to the chat adapter as an attachment. */
export function wavDataUrl(samples: Float32Array, sampleRate: number): string {
  return `data:audio/wav;base64,${toBase64(wavBytes(samples, sampleRate))}`;
}
