/**
 * The sounds the edit sheet names.
 *
 * ── Why these are synthesised rather than shipped ─────────────────────────
 *
 * editSheet asks the model to NAME a sound rather than describe one —
 * "whoosh", "impact", "riser" — because a name can be matched and a
 * description cannot. Matching it was never the problem. Having the sound was:
 * a name is not a file, and until there was something to play, the whole `sfx`
 * kind was a line of text for someone to action in CapCut.
 *
 * Three reasons this is generated instead of bundled:
 *
 *   · Licensing. A clip made with this goes on a monetised account under
 *     somebody's brief. A stock sound with unclear terms is a liability
 *     attached to every clip it ever appears in, and "it was free on a
 *     website" is not a licence.
 *   · Size. This is a Chrome extension, and the whole of it is a few hundred
 *     bytes of arithmetic. Three usable sounds as 48kHz audio would be more
 *     bytes than the studio bundle.
 *   · Determinism. A generated sound is the same sound every run, which means
 *     it can be asserted about. The tests below check the shape of the
 *     envelope and where the energy sits, which is not possible against an
 *     opaque wav.
 *
 * They are deliberately plain. A whoosh here is filtered noise with a sweep,
 * not a designed effect — the job is to cover a cut, not to be noticed. The
 * one that matters most is not even a creative choice: emitPlan inserts a
 * whoosh at every Omni seam automatically, so a four-part clip needs three of
 * them whether anybody asked for a sound or not.
 */

/* ────────────────────────────────────────────────────────────────────────
   Ingredients
   ──────────────────────────────────────────────────────────────────────── */

/**
 * A fixed-seed generator, so a sound is the same sound every time.
 *
 * Math.random would make every encode of the same clip differ in its noise,
 * which is invisible in a clip and fatal in a test — and it would mean a
 * re-encode after a cutaway lands quietly changed the audio of a clip
 * somebody had already watched.
 */
function noise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/**
 * A state-variable filter, one sample at a time.
 *
 * Chosen over a biquad because its cutoff can be changed EVERY sample without
 * recomputing coefficients, and every sound here is a sweep — that is what
 * makes a whoosh a whoosh rather than a burst of static.
 */
function svf() {
  let low = 0; let band = 0;
  return (input: number, cutoffHz: number, rate: number, q = 1.2) => {
    const f = 2 * Math.sin((Math.PI * Math.min(cutoffHz, rate * 0.45)) / rate);
    const high = input - low - q * band;
    band += f * high;
    low += f * band;
    return { low, band, high };
  };
}

/** Linear ramp from a to b across 0..1. */
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;

/** Exponential ramp, for anything the ear hears as pitch or loudness. */
const expo = (a: number, b: number, x: number) => a * Math.pow(b / a, x);

/**
 * Peak level every sound is normalised to.
 *
 * Speech in these clips sits near -6 dBFS. An effect at the same level does
 * not punctuate the words, it competes with them — and on a phone speaker the
 * effect wins, because it is broadband and the voice is not. -13 dBFS is
 * present under a sentence without covering one.
 */
const PEAK = 0.22;

function normalise(buf: Float32Array, peak = PEAK): Float32Array {
  let max = 0;
  for (const v of buf) { const a = Math.abs(v); if (a > max) max = a; }
  if (!(max > 0)) return buf;
  const g = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

/* ────────────────────────────────────────────────────────────────────────
   The sounds
   ──────────────────────────────────────────────────────────────────────── */

/**
 * whoosh — covers a transition or a cut.
 *
 * Noise through a band-pass that sweeps up and back down. The sweep is what
 * the ear reads as movement; the same noise at a fixed cutoff is just hiss.
 * Short, because it is covering a join rather than announcing one.
 */
export function whoosh(rate: number, seconds = 0.34): Float32Array {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  const rnd = noise(0x5eed01);
  const filt = svf();
  for (let i = 0; i < n; i++) {
    const x = i / n;
    /* Up then down, peaking a third of the way in — a rise that never falls
       reads as a riser, which is a different sound with a different job. */
    const arc = x < 0.35 ? x / 0.35 : 1 - (x - 0.35) / 0.65;
    const cutoff = expo(380, 3400, arc);
    /* Fades at both ends. A noise burst that starts on a hard edge clicks. */
    const env = Math.sin(Math.PI * x) ** 1.4;
    out[i] = filt(rnd(), cutoff, rate, 1.0).band * env;
  }
  return normalise(out);
}

/**
 * impact — lands a reveal, and goes AFTER it.
 *
 * A pitch drop with a transient on the front. The drop does the work: a low
 * tone falling from 95Hz to 42Hz is heard as weight, where the same tone held
 * flat is heard as a hum. The click at the start is what makes it land on a
 * frame rather than swell into one.
 */
export function impact(rate: number, seconds = 0.46): Float32Array {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  const rnd = noise(0x5eed02);
  const filt = svf();
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const hz = expo(95, 42, Math.min(1, x * 1.6));
    phase += (2 * Math.PI * hz) / rate;
    /* Fast decay. A long tail turns a punctuation mark into a drone under the
       next sentence. */
    const body = Math.sin(phase) * Math.exp(-x * 7);
    /* The transient: 25ms of filtered noise, gone before the ear separates it
       from the tone, which is what fuses the two into one sound. */
    const click = i < rate * 0.025
      ? filt(rnd(), 1800, rate, 0.8).band * (1 - i / (rate * 0.025)) * 0.7
      : 0;
    out[i] = body + click;
  }
  /* A 1.5ms attack.
     An impact wants the fastest attack of the three — that is what makes it
     land on a frame rather than swell into one — but starting at full
     amplitude on sample zero is a step from silence, and a step is a tick.
     Measured at 0.027 before this, against a 0.22 peak: small, and exactly
     the kind of small that is heard as a fault in the export rather than as
     part of the sound. A ramp this short is still instant to the ear. */
  const attack = Math.round(rate * 0.0015);
  for (let i = 0; i < attack && i < out.length; i++) out[i] *= i / attack;
  return normalise(out);
}

/**
 * riser — builds a reveal, and goes BEFORE it.
 *
 * The only one of the three that is long, because its whole job is the wait.
 * Noise sweeping up under a tone sweeping up, both getting louder — three
 * things rising at once is what makes it feel like it is going somewhere.
 */
export function riser(rate: number, seconds = 1.0): Float32Array {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  const rnd = noise(0x5eed03);
  const filt = svf();
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const cutoff = expo(240, 6200, x);
    const air = filt(rnd(), cutoff, rate, 1.6).band;
    const hz = expo(180, 900, x);
    phase += (2 * Math.PI * hz) / rate;
    /* Loudest at the very end and cut off there. A riser that fades out has
       resolved itself, and there is nothing left for the reveal to do. */
    const env = Math.pow(x, 1.7) * lerp(1, 0.85, x);
    out[i] = (air * 0.8 + Math.sin(phase) * 0.35) * env;
  }
  /* A short fade on the last 8ms only, so the cut-off is abrupt without
     clicking — the click would be heard as part of what follows. */
  const tail = Math.round(rate * 0.008);
  for (let i = 0; i < tail; i++) out[n - 1 - i] *= i / tail;
  return normalise(out);
}

/* ────────────────────────────────────────────────────────────────────────
   Names to sounds
   ──────────────────────────────────────────────────────────────────────── */

type Maker = (rate: number) => Float32Array;

const SOUNDS: Record<string, Maker> = {
  whoosh: (r) => whoosh(r),
  impact: (r) => impact(r),
  riser: (r) => riser(r),
};

/**
 * What a model might call each of them.
 *
 * The prompt asks for these three by name and mostly gets them, but "swoosh"
 * for a whoosh and "boom" for an impact are the two it reaches for often
 * enough to be worth spelling out. Everything past that is left unknown on
 * purpose — see soundFor.
 */
const ALIASES: Record<string, string> = {
  swoosh: 'whoosh', swish: 'whoosh', transition: 'whoosh', sweep: 'whoosh',
  boom: 'impact', hit: 'impact', thud: 'impact', slam: 'impact', bass: 'impact',
  build: 'riser', rise: 'riser', swell: 'riser', buildup: 'riser',
};

/** The name this text asks for, or '' when it is not one we make. */
export function soundName(what: string): string {
  const words = String(what || '').toLowerCase().match(/[a-z]+/g) || [];
  for (const w of words) {
    if (SOUNDS[w]) return w;
    if (ALIASES[w]) return ALIASES[w];
  }
  return '';
}

/**
 * The samples for a named sound, or null when the name is not one of ours.
 *
 * Null rather than a substitute. Playing a whoosh where the model asked for a
 * record scratch is worse than playing nothing: the sheet still shows what was
 * asked for, so somebody comparing the clip to the plan would find a sound
 * that does not match its own description and have no way to know why. An
 * unmade sound simply stays on the sheet for CapCut, like every other kind
 * this cannot render.
 *
 * Cached per rate, because emitPlan puts a whoosh on every Omni seam and a
 * four-part clip would otherwise synthesise the same 0.34s three times.
 */
const cache = new Map<string, Float32Array>();

export function soundFor(what: string, rate: number): Float32Array | null {
  const name = soundName(what);
  if (!name) return null;
  const key = `${name}@${rate}`;
  const held = cache.get(key);
  if (held) return held;
  const made = SOUNDS[name](rate);
  cache.set(key, made);
  return made;
}

/** Every sound this can make, for anything that wants to list them. */
export const SOUND_NAMES = Object.keys(SOUNDS);
