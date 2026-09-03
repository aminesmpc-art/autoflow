/**
 * The check that had gone silent.
 *
 * `static` says "this becomes a moving clip but nothing in it moves". It could
 * not fire on a prompt the director wrote, and had not been able to for as
 * long as guardrails have existed. Measured before the fix: it spoke on one
 * realistic prompt in six.
 *
 * Three separate leaks, all in the same word list.
 *
 *   the guardrails   Every prompt carries the things it must NOT do, and the
 *                    brief asks for them woven into the description rather
 *                    than appended — "an empty road with no cars or people",
 *                    which is Google's own guidance and why the prompts land.
 *                    So there is no block to split off, and "no camera
 *                    movement, ... dolly movement, orbiting" read as movement.
 *   `camera`         In almost every prompt by construction, because the brief
 *                    asks each one to name its camera. "One fixed camera,
 *                    locked off, nothing moves" passed the motion rule while
 *                    saying the opposite.
 *   `crane`          A camera move, and also the largest stationary object on
 *                    a building site — the subject of a whole niche these
 *                    prompts are written for.
 *
 * The fix reads the prompt with long negative lists removed, and asks for a
 * named camera MOVE or something the subject does, rather than for the word
 * "camera" to appear somewhere.
 */

/// <reference types="node" />

import {
  checkShots, positiveText, type Shot, type ShotTarget,
} from '../studio/ask/storyboard';

/* Verbatim from the run this came out of. */
const GUARD = ' The scene is without camera movement, camera angle changes, zooming, '
  + 'panning, rotation, dolly movement, orbiting, changing room layout, inconsistent door '
  + 'themes, mismatched character uniforms, on-screen text, captions, subtitles, '
  + 'watermarks, stickers, or logos overlaid on the picture.';

const CLIP: ShotTarget[] = [{
  id: 'a', label: 'Clip', media: 'video', platform: 'flow', duration: '8s', role: 'shot',
}];

const fires = (prompt: string) =>
  checkShots([{ n: 1, title: 'Clip', prompt } as Shot], CLIP).some((x) => x.code === 'static');

const TABLEAU = 'Inside the tall pink lounge, floor already lit, the designer seated on the '
  + 'low couch beside the glowing rails, warm light from below.';

describe('a clip in which nothing happens', () => {
  it('is caught', () => {
    expect(fires(TABLEAU)).toBe(true);
  });

  it('is still caught when it carries its guardrails', () => {
    /* The reported failure. Identical shot, one sentence appended, and the
       check fell silent. */
    expect(fires(TABLEAU + GUARD)).toBe(true);
  });

  it('is caught when it names a camera that does not move', () => {
    /* `camera` used to satisfy the motion rule on its own, so the clearest
       possible statement that nothing moves was read as movement. */
    expect(fires('One fixed camera on the tall pink lounge, the designer seated on the low '
      + 'couch beside the glowing rails, warm light from below, nothing else.')).toBe(true);
  });

  it('is caught on a building site where the only crane is standing still', () => {
    expect(fires('A tall crane stands motionless over the half-built tower, scaffolding '
      + 'wrapped around the concrete core under flat grey daylight.')).toBe(true);
  });
});

describe('a clip in which something does happen', () => {
  it.each([
    ['a named camera move', 'The camera pushes in slowly toward the jar on the marble counter, the key light travelling over the glaze.'],
    ['a subject walking', 'She walks in carrying the glowing floor rails and lays them across the bare boards.'],
    ['a subject spinning', 'The same dancer in the red tracksuit spins across a polished floor as the camera holds steady on her.'],
    ['a crane that actually cranes', 'A slow crane up from the finished courtyard, the whole facade coming into frame.'],
    ['machinery working', 'Bulldozers roll across the cleared plot and excavators lower their buckets into the exposed soil.'],
  ] as Array<[string, string]>)('stays quiet on %s', (_name, prompt) => {
    expect(fires(prompt)).toBe(false);
    /* And with the guardrails on, which is how it actually arrives. */
    expect(fires(prompt + GUARD)).toBe(false);
  });
});

describe('reading a prompt without the things it promises to avoid', () => {
  it('drops a long negative list', () => {
    expect(positiveText(`A locked wide of the plot.${GUARD}`)).not.toMatch(/panning/);
    expect(positiveText(`A locked wide of the plot.${GUARD}`)).toMatch(/locked wide of the plot/);
  });

  it('keeps a short woven absence, and what follows it', () => {
    /* The case the brief actually asks for — "an empty road with no cars or
       people" — where cutting to the end of the sentence would throw away the
       camera move that comes after it. */
    const woven = 'An empty road with no cars or people, the camera drifting slowly along '
      + 'the white line as the light fails.';
    expect(positiveText(woven)).toMatch(/drifting slowly along/);
    expect(fires(woven)).toBe(false);
  });

  it('leaves an ordinary prompt untouched', () => {
    expect(positiveText(TABLEAU)).toBe(TABLEAU);
  });

  it('does not fall over on nothing', () => {
    expect(positiveText('')).toBe('');
    expect(positiveText(undefined as unknown as string)).toBe('');
  });
});
