/**
 * "When we change the place, make it consistent over the whole clips."
 *
 * Every piece is generated on its own; the setting image they share is the
 * only thing tying piece two's place to piece one's. Rendering the prompts
 * with a place attached showed why that was not enough. The director was told,
 * in the same turn:
 *
 *   rule 2       "match the lighting, grade and framing of the input video"
 *   place rules  "Integrate the subject with the place lighting"
 *   and then     "Reference-role rules above take precedence…"
 *
 * — so each piece settled the contradiction its own way — and nothing stopped
 * it putting the place into its own words, which each piece then re-imagined.
 * Omni, for its part, got "match the lighting of the input video" beside
 * "matching its light", and nothing saying the place must not change.
 *
 * These tests hold the place still: the director points at the setting and
 * never describes it, the light is the setting's, and the video model gets
 * the same SETTING block on every piece.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  motionBriefAsk, motionPieceAsk, motionSubjectRedoAsk, plainMotionPrompt, SETTING_POINTER,
  type MotionBrief, type MotionMode, type MotionPiece,
} from '../studio/ask/motionControl';
import {
  motionFidelity, motionFinalPrompt, referenceGuidance, settingLock, subjectDescriptionTerms,
} from '../studio/ask/motionGuidance';

const MODES: MotionMode[] = ['move', 'swap', 'restyle'];
const SAME_PLACE = 'in the provided setting image, lit by its light';
/* The no-place look rule. With a setting attached it is the contradiction. */
const VIDEO_LIGHT = /match the lighting, grade and framing of the input video/i;

const brief = (over: Partial<MotionBrief> = {}): MotionBrief =>
  ({ mode: 'move', wish: '', hasCharacter: true, hasPlace: true, ...over });
const piece = (index: number, of: number): MotionPiece =>
  ({ index, of, startSec: (index - 1) * 8, endSec: index * 8, seconds: 8, cutsSpeech: false });

describe('the director, with a setting attached', () => {
  it.each(MODES)('%s: is told to point at the setting and never describe it', (mode) => {
    const ask = motionBriefAsk(brief({ mode }), 3);
    expect(ask).toMatch(/DO NOT DESCRIBE THE SETTING/);
    expect(ask).toContain(`Write "${SETTING_POINTER}" and stop there, in the same words in every prompt`);
    expect(ask).toContain(`"${SAME_PLACE}", word for word`);
  });

  it.each(MODES)('%s: is never told to match the input video\'s lighting', (mode) => {
    expect(motionBriefAsk(brief({ mode }), 3)).not.toMatch(VIDEO_LIGHT);
    for (const i of [1, 2, 3]) expect(motionPieceAsk(brief({ mode }), piece(i, 3))).not.toMatch(VIDEO_LIGHT);
  });

  it('is told the light and colour are the setting\'s, and only the framing is the video\'s', () => {
    const ask = motionBriefAsk(brief(), 3);
    expect(ask).toMatch(/Its light and colour come from that image; only the framing and the camera come from the video/);
    expect(ask).toMatch(/Never write "match the lighting of the input video", "keep the environment" or "keep the background"/);
  });

  it('hears that the place is replaced, even in swap', () => {
    /* swap "replaces the character, everything else in the shot standing" —
       which, unqualified, keeps the old place. */
    expect(motionBriefAsk(brief({ mode: 'swap' }), 2)).toMatch(/the place is replaced too: it comes from that image, not from the video/);
  });

  it('is not sent to re-describe the setting when a wish would change the motion', () => {
    expect(motionBriefAsk(brief(), 2)).toMatch(/apply it to everything else — the character, the look — and leave/);
    expect(motionBriefAsk(brief({ hasPlace: false }), 2)).toMatch(/the character, the look, the setting —/);
  });

  it('writes a change the user asked for to the place the same way every time', () => {
    expect(motionBriefAsk(brief(), 2)).toMatch(/write that change, in the same words in every prompt, and nothing else about it/);
    expect(motionPieceAsk(brief(), piece(2, 3))).toMatch(/A change the user asked for to the place goes in the same words as last time too/);
  });

  it('gets the same setting line on every piece', () => {
    /* The per-piece reminder is what survives five turns and two videos. */
    const settingLine = (i: number) => motionPieceAsk(brief(), piece(i, 3)).split('\n').find((l) => l.includes('· the setting'));
    expect(settingLine(1)).toContain(`"${SAME_PLACE}"`);
    expect(settingLine(2)).toBe(settingLine(1));
    expect(settingLine(3)).toBe(settingLine(1));
  });

  it('keeps restyle naming its material, but not the light', () => {
    const ask = motionPieceAsk(brief({ mode: 'restyle' }), piece(1, 2));
    expect(ask).toMatch(/the material's look, named again in full/);
    expect(ask).toMatch(/The light is the setting image's/);
    expect(motionBriefAsk(brief({ mode: 'restyle' }), 2)).toContain(`the same place: "${SAME_PLACE}", word for word`);
  });

  it('is told the same in the reference rules repeated on every piece', () => {
    const rules = referenceGuidance(1, 1);
    expect(rules).toContain(`Do not describe the place either: name it only as "${SETTING_POINTER}"`);
    expect(referenceGuidance(1, 0)).not.toMatch(/Do not describe the place/);
  });

  it('is not undone by the corrective turn', () => {
    /* The rewrite used to restore "the environment, and the instruction to
       match the lighting… of the input video" — on every piece it fired on. */
    const redo = motionSubjectRedoAsk(piece(2, 3), ['shorts'], true);
    expect(redo).not.toMatch(VIDEO_LIGHT);
    expect(redo).not.toMatch(/the environment/);
    expect(redo).toContain(`"${SAME_PLACE}"`);
    expect(motionSubjectRedoAsk(piece(2, 3), ['shorts'])).toMatch(VIDEO_LIGHT);
  });

  it('carries the setting into the plain prompt too', () => {
    const plain = plainMotionPrompt(brief(), piece(1, 3));
    expect(plain).toContain(SAME_PLACE);
    expect(plain).not.toMatch(VIDEO_LIGHT);
  });
});

describe('the director, with no setting attached, reads as it did', () => {
  it('keeps the input video\'s look and environment', () => {
    const none = brief({ hasPlace: false });
    expect(motionBriefAsk(none, 3)).toMatch(VIDEO_LIGHT);
    expect(motionPieceAsk(none, piece(2, 3))).toMatch(VIDEO_LIGHT);
    expect(motionBriefAsk(none, 3)).not.toMatch(/SETTING/);
    expect(motionPieceAsk(none, piece(2, 3))).not.toMatch(/setting image/);
  });

  it('is unchanged by the field being absent rather than false', () => {
    const { hasPlace: _absent, ...legacy } = brief();
    for (const mode of MODES) {
      expect(motionBriefAsk({ ...legacy, mode }, 3)).toBe(motionBriefAsk(brief({ mode, hasPlace: false }), 3));
      expect(motionPieceAsk({ ...legacy, mode }, piece(2, 3))).toBe(motionPieceAsk(brief({ mode, hasPlace: false }), piece(2, 3)));
    }
  });
});

describe('the prompt Omni receives, with a setting attached', () => {
  const final = (prompt: string, over: Partial<Parameters<typeof motionFinalPrompt>[0]> = {}) =>
    motionFinalPrompt({ prompt, mode: 'move', muted: false, characters: 1, places: 1, ...over });

  it('ends every piece with the same SETTING block, after the image roles', () => {
    const lines = final('Apply the pose and motion from input video to provided character from this image, a dance.').split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[2]).toMatch(/^REFERENCES: /);
    expect(lines[3]).toBe(settingLock());
  });

  it('is identical from piece to piece apart from the director\'s own words', () => {
    /* Everything the place depends on is deterministic: the same image, and
       the same blocks after the director's line. */
    const one = final('Piece one, in the provided setting image, lit by its light.').split('\n').slice(1);
    const two = final('Piece two, in the provided setting image, lit by its light.').split('\n').slice(1);
    expect(two).toEqual(one);
  });

  it('holds the place still, and says which instruction wins', () => {
    const lock = settingLock();
    expect(lock).toMatch(/^SETTING: /);
    expect(lock).toMatch(/in every frame: the same layout, objects, colours, light and time of day/);
    expect(lock).toMatch(/add nothing else, remove nothing and restyle nothing/);
    expect(lock).toMatch(/Where anything above says to keep the input video's lighting, background or environment, the setting image wins/);
  });

  it('adds no wording the policy filter reads as describing a person', () => {
    expect(subjectDescriptionTerms(settingLock())).toEqual([]);
    expect(subjectDescriptionTerms(final('Apply the pose and motion from input video to provided character from this image.'))).toEqual([]);
  });

  it('no longer tells swap to keep everything else in the shot', () => {
    expect(motionFidelity('swap', false, true)).not.toMatch(/everything else in the shot/);
    expect(motionFidelity('swap', false, true)).toMatch(/only the character and the setting change/);
    expect(motionFidelity('swap', false)).toMatch(/everything else in the shot exactly as in the input video/);
    expect(motionFidelity('restyle', false, true)).toMatch(/Only the material and the look change, in the setting image/);
  });

  it('never asks for the input video\'s environment', () => {
    for (const mode of MODES) {
      const f = final('x'.repeat(30), { mode });
      expect(f).not.toMatch(/Keep the environment from the input video/);
      expect(f).not.toMatch(/everything else in the shot/);
    }
  });

  it('lets the audio override keep the last word', () => {
    const f = final('x'.repeat(30), { muted: true });
    expect(f).toContain(settingLock());
    expect(f.indexOf('AUDIO OVERRIDE')).toBeGreaterThan(f.indexOf('SETTING:'));
  });

  it('carries no SETTING block without a setting image', () => {
    expect(final('x'.repeat(30), { places: 0 })).not.toMatch(/SETTING:/);
  });
});

describe('the runner tells the director about the setting', () => {
  const RUNNER = readFileSync(join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');
  const at = RUNNER.indexOf('private async executeMotionNode');
  const body = RUNNER.slice(at, RUNNER.indexOf('private async askAgent(', at));

  it('sets hasPlace from the wired place image', () => {
    expect(body).toMatch(/hasPlace: place\.length > 0,/);
  });

  it('keeps the setting rule through the corrective turn', () => {
    expect(body).toMatch(/motionSubjectRedoAsk\(p\.piece, terms, brief\.hasPlace === true\)/);
  });
});
