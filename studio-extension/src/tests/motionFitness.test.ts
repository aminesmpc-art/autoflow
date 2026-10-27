/**
 * "Sometimes in the fitness videos the new character doesn't follow the
 * original movements."
 *
 * Two of the reasons were in our own words, not in the model:
 *
 *   · Every generation told Omni "Do not add, skip, repeat, loop … any
 *     movement". Written to stop an invented extra step, it argued with any
 *     workout, which is one movement repeated — ten squats, twenty jumping
 *     jacks — and the output came back with fewer reps or a shorter range.
 *
 *   · The director was allowed to name the action in a few words, and the
 *     example it was given was "a dance". A label that is wrong for the clip,
 *     or only roughly right, is a paraphrase competing with the footage — the
 *     same blend that turned one dancer's moves into a generic bouncy dance.
 *
 * And a workout drifts in ways the general block does not name: the count,
 * the range of motion, hands and feet sliding on the floor. The Fitness preset
 * says those to Omni directly rather than hoping the director passes them on.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  MOTION_PRESETS, motionFidelity, motionFinalPrompt, presetForOmni, presetInstruction,
} from '../studio/ask/motionGuidance';
import { motionBriefAsk, motionPieceAsk, type MotionBrief, type MotionPiece } from '../studio/ask/motionControl';

const brief = (over: Partial<MotionBrief> = {}): MotionBrief => ({ mode: 'move', wish: '', hasCharacter: true, ...over });
const piece = (index: number, of: number): MotionPiece => ({ index, of, startSec: 0, endSec: 7, seconds: 7, cutsSpeech: false });
const DIRECTOR = 'Apply the pose and motion from input video to provided character from this image. '
  + 'Match the lighting, grade and framing of the input video.';
/* Exercises a label could name — none of them may appear in what we write. */
const EXERCISE = /\b(squats?|push-?ups?|lunges?|burpees?|planks?|jumping jacks?|sit-?ups?|crunch(es)?|yoga|dance|dancing)\b/i;

describe('the motion block protects the count instead of forbidding repetition', () => {
  it.each(['move', 'swap', 'restyle'])('%s no longer tells Omni not to repeat a movement', (mode) => {
    const f = motionFidelity(mode, false);
    expect(f).not.toMatch(/\brepeat\b/i);
    expect(f).toMatch(/exactly as many repetitions as the input video — no more, no fewer/);
    /* Still no looping the clip to fill time. */
    expect(f).toMatch(/do not loop the clip/);
  });
});

describe('the director names no action in the modes the footage carries', () => {
  it.each(['move', 'swap'] as const)('%s: the brief forbids a label, where it used to offer "a dance"', (mode) => {
    const ask = motionBriefAsk(brief({ mode }), 2);
    expect(ask).not.toMatch(/Name the action in a few words/);
    expect(ask).toMatch(/Do not name the action either — not "a dance", not "a workout", not the exercise/);
    expect(ask).toMatch(/Say only that the motion comes from the input video/);
  });

  it.each(['move', 'swap'] as const)('%s: so does every piece', (mode) => {
    for (const i of [1, 2]) {
      const ask = motionPieceAsk(brief({ mode }), piece(i, 2));
      expect(ask).not.toMatch(/Name the action in a few words/);
      expect(ask).toMatch(/NOT the movement, and no name for it either/);
    }
  });

  it('restyle still describes the movement, because it has to', () => {
    /* It re-expresses the motion in another material; that cannot be done
       without putting the motion into words. */
    expect(motionBriefAsk(brief({ mode: 'restyle' }), 2)).toMatch(/THIS MODE NEEDS THE MOVEMENT DESCRIBED/);
  });
});

describe('the Fitness preset', () => {
  it('is offered in the focus list, next to Dance', () => {
    const ids = MOTION_PRESETS.map((p) => p.id);
    expect(ids).toContain('fitness');
    expect(ids.indexOf('fitness')).toBe(ids.indexOf('dance') + 1);
    expect(MOTION_PRESETS.find((p) => p.id === 'fitness')?.title).toBe('Fitness / workout');
  });

  it('tells the director to keep every rep, and to name nothing', () => {
    const say = presetInstruction('fitness');
    expect(say).toMatch(/keep every repetition, the full range of motion and the tempo/);
    expect(say).toMatch(/do not name or count the exercises/);
  });

  it('reaches Omni itself, after the motion block and before the image roles', () => {
    const lines = motionFinalPrompt({ prompt: DIRECTOR, mode: 'move', muted: false, characters: 1, places: 0, preset: 'fitness' }).split('\n');
    expect(lines[0]).toBe(DIRECTOR);
    expect(lines[1]).toMatch(/^MOTION: /);
    expect(lines[2]).toMatch(/^WORKOUT: This is an exercise set\./);
    expect(lines[2]).toMatch(/the same number of repetitions, the same full range of motion and the same tempo/);
    expect(lines[2]).toMatch(/Hands and feet touch the floor, the mat or the equipment exactly where and when they do in the input video, without sliding/);
    expect(lines[3]).toMatch(/^REFERENCES: /);
  });

  it('names no exercise to Omni either', () => {
    expect(presetForOmni('fitness')).not.toMatch(EXERCISE);
    for (const mode of ['move', 'swap', 'restyle']) expect(motionFidelity(mode, false)).not.toMatch(EXERCISE);
  });

  it('adds nothing for the other presets, or for none', () => {
    for (const preset of [undefined, 'custom', 'dance', 'walk', 'performance', 'material', 'nonsense']) {
      expect(motionFinalPrompt({ prompt: DIRECTOR, mode: 'move', muted: false, characters: 1, places: 0, preset }))
        .not.toMatch(/WORKOUT:/);
    }
  });

  it('keeps the audio override last when the sound was removed', () => {
    const f = motionFinalPrompt({ prompt: DIRECTOR, mode: 'move', muted: true, characters: 1, places: 0, preset: 'fitness' });
    expect(f.indexOf('AUDIO OVERRIDE')).toBeGreaterThan(f.indexOf('WORKOUT:'));
  });
});

describe('the runner hands the preset to the prompt Omni receives', () => {
  const RUNNER = readFileSync(join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');
  const at = RUNNER.indexOf('private async executeMotionNode');
  const body = RUNNER.slice(at, RUNNER.indexOf('private async askAgent(', at));

  it('passes the panel\'s preset to motionFinalPrompt', () => {
    expect(body).toMatch(/places: place\.length, preset: nodeData\.motionPreset/);
  });
});
