/**
 * The real media operations, built from the modules that need a browser.
 *
 * Thin on purpose. Every function here is a few lines of glue over decode.ts,
 * cut.ts and pcm.ts, all of which are either unit tested or verified in a
 * browser against a file whose contents are known. What is NOT tested is this
 * file, because it cannot be — so it must be small enough to read.
 *
 * The one piece of judgement in it: audio for the chat and audio for the
 * silence detector are the same audio. Both want mono at the analysis rate,
 * so one decode path serves both and no second format has to be maintained.
 */

import {
  decodeMonoPcm, openSource, probeSource, type MonoPcm,
} from '../media/decode';
import { cutClip } from '../media/cut';
import { ANALYSIS_SAMPLE_RATE, wavDataUrl } from '../media/pcm';
import type { ClipMedia } from './runClip';
import type { Input } from 'mediabunny';
import { ALL_FORMATS, BlobSource, CanvasSink, Input as MbInput } from 'mediabunny';

/**
 * One Input per file, reused across every stage.
 *
 * Opening a source is cheap — nothing is read until something is asked for —
 * but the format parsing and track discovery are not free, and a run touches
 * the same file a dozen times. Keyed by the File object itself so a replaced
 * file gets a fresh Input rather than the previous one's tracks.
 */
const inputs = new WeakMap<File, Input>();

function inputFor(file: File): Input {
  const existing = inputs.get(file);
  if (existing) return existing;
  const created = openSource(file);
  inputs.set(file, created);
  return created;
}

/** Decode a span as mono PCM at the analysis rate. */
async function pcmSpan(file: File, startSec: number, endSec: number, durationSec: number): Promise<MonoPcm | null> {
  const mid = (startSec + endSec) / 2;
  const radius = Math.max(0.05, (endSec - startSec) / 2);
  return decodeMonoPcm(inputFor(file), mid, radius, durationSec, ANALYSIS_SAMPLE_RATE);
}

export const clipMedia: ClipMedia = {
  async probe(file) {
    return probeSource(inputFor(file));
  },

  async audioDataUrl(file, startSec, endSec) {
    const probe = await probeSource(inputFor(file));
    const pcm = await pcmSpan(file, startSec, endSec, probe.durationSec);
    if (!pcm || !pcm.samples.length) {
      throw new Error(
        `No audio could be decoded between ${Math.round(startSec)}s and ${Math.round(endSec)}s.`,
      );
    }
    return wavDataUrl(pcm.samples, pcm.sampleRate);
  },

  async pcmAround(file, targetSec, radiusSec, durationSec) {
    return decodeMonoPcm(inputFor(file), targetSec, radiusSec, durationSec, ANALYSIS_SAMPLE_RATE);
  },

  async frames(file, timesSec) {
    const input = inputFor(file);
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return [];

    /* Asked for at a small size: the model is being shown these to say where
       a person is horizontally, and a 1920-wide still costs a megabyte per
       frame in the message for detail nobody reads. */
    const sink = new CanvasSink(track, { width: 480, fit: 'contain' });
    const out: string[] = [];
    for (const t of timesSec) {
      const wrapped = await sink.getCanvas(t);
      if (!wrapped) continue;
      const canvas = wrapped.canvas as HTMLCanvasElement | OffscreenCanvas;
      if ('convertToBlob' in canvas) {
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
        out.push(await blobToDataUrl(blob));
      } else {
        out.push((canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.7));
      }
    }
    return out;
  },

  async cut(file, options) {
    return cutClip(inputFor(file), options);
  },
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Could not read the frame.'));
    reader.readAsDataURL(blob);
  });
}

/** Open a produced clip, so a finished blob can be inspected or re-read. */
export function openProduced(blob: Blob): Input {
  return new MbInput({ formats: ALL_FORMATS, source: new BlobSource(blob) });
}
