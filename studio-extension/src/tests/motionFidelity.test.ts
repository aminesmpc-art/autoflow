/**
 * "Fix the lapsing — it must follow the motion exactly."
 *
 * What Omni actually received, per piece, was the director's prompt plus
 * `REFERENCE ROLES: ${referenceGuidance(...)}` — and referenceGuidance is
 * written for the DIRECTOR:
 *
 *   "…the prompt must NOT describe their appearance. No hair, face, skin,
 *    build, age or clothing. Name the subject only as…"
 *
 * Instructions about writing a prompt, sent to a model that makes video, with
 * a list of body attributes in them — and beyond Google's one opening
 * sentence, nothing asking it to follow the motion exactly. The director, for
 * its part, was told the first piece "carries the hook" and the last "has to
 * land": two invitations to change the motion.
 *
 * These tests read the prompt the way Omni reads it.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

import { motionFidelity, referenceRoles, motionFinalPrompt, subjectDescriptionTerms, referenceGuidance } from '../studio/ask/motionGuidance';
import { motionBriefAsk, motionPieceAsk, type MotionBrief, type MotionPiece } from '../studio/ask/motionControl';

const DIRECTOR = 'Apply the pose and motion from input video to provided character from this image, a dance. '
  + 'Keep the environment from the input video. Match the lighting, grade and framing of the input video.';

describe('the exact-follow block every generation carries', () => {
  it.each(['move', 'swap', 'restyle'])('asks %s to keep every movement, in order, at its own speed', (mode) => {
    const f = motionFidelity(mode, false);
    expect(f).toMatch(/^MOTION: /);
    expect(f).toMatch(/every movement in the same order, at the same speed and timing, with the same pauses/);
    expect(f).toMatch(/exactly as many repetitions as the input video — no more, no fewer/);
    expect(f).toMatch(/Do not add, skip, smooth out, exaggerate, speed up or slow down any movement, and do not loop the clip/);
    expect(f).toMatch(/camera/i);
  });

  it('holds the character steady from frame to frame', () => {
    /* Morphing and flicker are the other way a clip "lapses" from its source. */
    for (const mode of ['move', 'swap']) expect(motionFidelity(mode, false)).toMatch(/no morphing, flicker or drift/);
    expect(motionFidelity('restyle', false)).toMatch(/no flicker/);
  });

  it('follows the mouth only while there is sound to follow', () => {
    /* With the audio removed, the override forbids speech and lip-sync — the
       two blocks must not argue. */
    expect(motionFidelity('move', false)).toMatch(/Mouth movements follow the input video/);
    expect(motionFidelity('move', true)).not.toMatch(/Mouth/);
    expect(motionFidelity('swap', false)).toMatch(/Lip movements match the input video's speech exactly/);
    expect(motionFidelity('swap', true)).not.toMatch(/Lip|dialogue/);
  });

  it('says what each mode is allowed to change, and nothing else', () => {
    expect(motionFidelity('swap', false)).toMatch(/only the\s+character changes/);
    expect(motionFidelity('restyle', false)).toMatch(/Only the material and the look change/);
  });

  it('commands fidelity without narrating a single movement', () => {
    /* The footage carries the motion; a paraphrase competes with it. This
       block forbids changes and names no move. */
    for (const mode of ['move', 'swap', 'restyle']) {
      expect(motionFidelity(mode, false)).not.toMatch(/\b(dance|step|spin|jump|walk|arm|hip|turn)\b/i);
    }
  });
});

describe('what each image is for, told to the video model', () => {
  it('names the character image, and keeps the video\'s own setting', () => {
    expect(referenceRoles(1, 0)).toBe(
      'REFERENCES: The provided image is the character who performs the motion. Keep the environment from the input video.',
    );
  });

  it('separates the character from the setting, and keeps motion with the video', () => {
    const r = referenceRoles(1, 1);
    expect(r).toMatch(/The first image is the character/);
    expect(r).toMatch(/The last image is the setting/);
    expect(r).toMatch(/The input video still decides the motion, the timing and the camera/);
  });

  it('handles a place with no character, and neither', () => {
    expect(referenceRoles(0, 1)).toMatch(/Keep the subject from the input video\. The provided image is the setting: place the subject/);
    expect(referenceRoles(0, 0)).toBe('REFERENCES: Keep the subject from the input video. Keep the environment from the input video.');
  });
});

describe('the prompt Omni receives', () => {
  const final = (over: Partial<Parameters<typeof motionFinalPrompt>[0]> = {}) =>
    motionFinalPrompt({ prompt: DIRECTOR, mode: 'move', muted: false, characters: 1, places: 0, ...over });

  it('is the director\'s words, then the exact-follow block, then the image roles', () => {
    const lines = final().split('\n');
    expect(lines[0]).toBe(DIRECTOR);
    expect(lines[1]).toMatch(/^MOTION: Follow the input video's motion exactly, frame for frame/);
    expect(lines[2]).toMatch(/^REFERENCES: /);
    expect(lines).toHaveLength(3);
  });

  it('carries no instructions meant for the director', () => {
    /* "the prompt must NOT describe…" was going to the video model. */
    const f = final();
    expect(f).not.toMatch(/the prompt must/i);
    expect(f).not.toMatch(/Name the subject only as/);
    expect(f).not.toContain(referenceGuidance(1, 0));
  });

  it('carries no body-attribute wording beyond what the director wrote', () => {
    /* A list of hair, face, skin and clothing beside a photo is the shape the
       policy filter refuses. */
    expect(subjectDescriptionTerms(final())).toEqual(subjectDescriptionTerms(DIRECTOR));
    expect(subjectDescriptionTerms(final())).toEqual([]);
  });

  it('lets the audio override have the last word when the sound was removed', () => {
    const f = final({ muted: true });
    expect(f.indexOf('AUDIO OVERRIDE')).toBeGreaterThan(f.indexOf('REFERENCES:'));
    expect(f).not.toMatch(/Mouth movements/);
  });
});

describe('the director is not invited to change the motion', () => {
  const brief = (over: Partial<MotionBrief> = {}): MotionBrief => ({ mode: 'move', wish: '', hasCharacter: true, ...over });
  const piece = (index: number, of: number): MotionPiece => ({ index, of, startSec: 0, endSec: 7, seconds: 7, cutsSpeech: false });

  it('is told the motion is fixed, and where a request that would change it goes', () => {
    const ask = motionBriefAsk(brief(), 2);
    expect(ask).toMatch(/THE MOTION IS FIXED/);
    expect(ask).toMatch(/no new poses, moves, gestures or endings/);
    expect(ask).toMatch(/nothing faster, slower, smoother, bigger or more dramatic, no slow motion/);
    expect(ask).toMatch(/apply it to everything else/);
  });

  it('no longer hears that the first piece carries a hook or the last must land', () => {
    for (const ask of [motionPieceAsk(brief(), piece(1, 3)), motionPieceAsk(brief(), piece(3, 3))]) {
      expect(ask).not.toMatch(/hook/i);
      expect(ask).not.toMatch(/has to land|trail off|makes someone stay/);
    }
  });

  it('is told, on every piece, that this piece\'s motion is fixed', () => {
    for (const i of [1, 2, 3]) {
      expect(motionPieceAsk(brief(), piece(i, 3))).toMatch(/Write nothing that would add, cut, re-time or change any of it/);
    }
  });
});

describe('the runner sends that prompt', () => {
  const RUNNER = readFileSync(join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');
  const at = RUNNER.indexOf('private async executeMotionNode');
  const body = RUNNER.slice(at, RUNNER.indexOf('private async askAgent(', at));

  it('builds every generation prompt with motionFinalPrompt', () => {
    expect(body).toMatch(/prompt: motionFinalPrompt\(\{/);
    expect(body).toMatch(/characters: character\.length, places: place\.length/);
  });

  it('no longer appends the director\'s rules to it', () => {
    expect(body).not.toMatch(/REFERENCE ROLES: \$\{referenceRules\}/);
  });
});
