/**
 * The boundary between the pipeline and WebCodecs.
 *
 * Deliberately thin. Nothing in this file can run under Jest — WebCodecs does
 * not exist in Node — so every line here is a line that only a browser can
 * check. The arithmetic lives in pcm.ts, which is fully tested; what remains
 * is opening a file, asking for a slice, and copying bytes out.
 *
 * ── Why the whole file is never read ──────────────────────────────────────
 *
 * Mediabunny's BlobSource reads lazily: only the bytes needed to answer the
 * question actually leave the disk. Seeking to 512s in a two-gigabyte podcast
 * and decoding three seconds of audio touches a few megabytes, not two
 * gigabytes. That is the single reason the v2/v3 plans' file-size gate — the
 * IndexedDB staging, the Blob.slice() chunking, the >500MB server fallback —
 * is absent from this codebase: all of it existed to survive holding the file
 * in memory, and nothing here ever does.
 */

import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';

import {
  ANALYSIS_SAMPLE_RATE,
  concatFloat32,
  decodeWindow,
  resampleLinear,
  toMono,
} from './pcm';

export interface VideoProbe {
  /** Rotation-aware, so a phone clip reports the shape a viewer will see. */
  width: number;
  height: number;
  /** Degrees. Ignoring this is how a portrait phone clip exports sideways. */
  rotation: number;
  codec: string | null;
  decodable: boolean;
}

export interface AudioProbe {
  sampleRate: number;
  channels: number;
  codec: string | null;
  decodable: boolean;
}

export interface SourceProbe {
  durationSec: number;
  video: VideoProbe | null;
  audio: AudioProbe | null;
  /** True when the source is already taller than it is wide — skip reframing. */
  alreadyVertical: boolean;
}

/** Open a dropped file. Nothing is read until something is asked for. */
export function openSource(file: Blob): Input {
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
}

/**
 * What we are dealing with, before committing to anything expensive.
 *
 * `decodable` is asked rather than assumed. A source can be a perfectly valid
 * MP4 carrying a codec this browser has no decoder for, and finding that out
 * at probe time costs nothing, where finding it out mid-run costs whatever
 * has already been spent.
 */
export async function probeSource(input: Input): Promise<SourceProbe> {
  const [videoTrack, audioTrack] = await Promise.all([
    input.getPrimaryVideoTrack(),
    input.getPrimaryAudioTrack(),
  ]);

  const [durationSec, video, audio] = await Promise.all([
    input.computeDuration(),
    describeVideo(videoTrack),
    describeAudio(audioTrack),
  ]);

  return {
    durationSec,
    video,
    audio,
    alreadyVertical: !!video && video.height > video.width,
  };
}

async function describeVideo(track: InputVideoTrack | null): Promise<VideoProbe | null> {
  if (!track) return null;
  return {
    /* displayWidth/displayHeight already account for rotation, which is why
       they are used here rather than codedWidth/codedHeight. A 1080x1920
       phone clip stored as 1920x1080 with rotation 90 must not be treated as
       landscape and then "reframed" into a crop of a sideways picture. */
    width: track.displayWidth,
    height: track.displayHeight,
    rotation: track.rotation,
    codec: track.codec,
    decodable: await track.canDecode(),
  };
}

async function describeAudio(track: InputAudioTrack | null): Promise<AudioProbe | null> {
  if (!track) return null;
  return {
    sampleRate: track.sampleRate,
    channels: track.numberOfChannels,
    codec: track.codec,
    decodable: await track.canDecode(),
  };
}

export interface MonoPcm {
  samples: Float32Array;
  sampleRate: number;
  /**
   * Where sample 0 sits on the SOURCE timeline.
   *
   * Taken from the first sample actually returned, not from what was asked
   * for. A decoder hands back the sample containing the requested time, so
   * the audio usually begins slightly earlier — and passing the requested
   * time to snapToSilence instead of the real one shifts every cut by that
   * difference, silently and in the same direction every time.
   */
  startSec: number;
}

/**
 * Decode a slice of the audio track to mono PCM at the analysis rate.
 *
 * The only audio path in the pipeline. It exists to feed snapToSilence, so it
 * optimises for "small and cheap" over "faithful": mono, 16 kHz, linear
 * resampling. Nobody listens to this.
 */
export async function decodeMonoPcm(
  input: Input,
  targetSec: number,
  radiusSec: number,
  durationSec: number,
  targetRate: number = ANALYSIS_SAMPLE_RATE,
): Promise<MonoPcm | null> {
  const track = await input.getPrimaryAudioTrack();
  if (!track || !(await track.canDecode())) return null;

  const { start, end } = decodeWindow(targetSec, radiusSec, durationSec);
  if (!(end > start)) return null;

  const sink = new AudioSampleSink(track);
  const chunks: Float32Array[] = [];
  let startSec: number | null = null;
  const sourceRate = track.sampleRate;

  for await (const sample of sink.samples(start, end)) {
    if (startSec === null) startSec = sample.timestamp;

    const options = { planeIndex: 0, format: 'f32' as const };
    const bytes = sample.allocationSize(options);
    const interleaved = new Float32Array(bytes / Float32Array.BYTES_PER_ELEMENT);
    sample.copyTo(interleaved, options);
    chunks.push(toMono(interleaved, sample.numberOfChannels));

    /* Decoded samples hold their own memory until released, and a three
       second window is a few hundred of them. Not closing here is how a long
       run walks up the tab's memory until the decoder starts failing. */
    sample.close();
  }

  if (!chunks.length || startSec === null) return null;

  return {
    samples: resampleLinear(concatFloat32(chunks), sourceRate, targetRate),
    sampleRate: targetRate,
    startSec,
  };
}
