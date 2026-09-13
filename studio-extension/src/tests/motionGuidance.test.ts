/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  presetInstruction, referenceGuidance, motionPromptWarnings,
  subjectDescriptionTerms, subjectDescriptionWarning,
} from '../studio/ask/motionGuidance';
import { readMotionPrompt, motionPieceAsk } from '../studio/ask/motionControl';
import { canConnect } from '../studio/canvas/connect';
import { NODE_PORTS } from '../studio/templates/validate';

describe('Motion guidance', () => {
  it('keeps custom or unknown presets neutral', () => {
    expect(presetInstruction('custom')).toBe('');
    expect(presetInstruction('unknown')).toBe('');
    expect(presetInstruction('dance')).toContain('original rhythm');
  });
  it('separates place and character roles and defaults to the source location', () => {
    expect(referenceGuidance(1, 1)).toContain('first 1');
    expect(referenceGuidance(1, 1)).toContain('final 1');
    expect(referenceGuidance(0, 1)).toContain('Keep the subject from the input video');
    expect(referenceGuidance(1, 0)).toContain('Keep the environment from the input video');
  });
  it('accepts image wiring to the new place port but rejects text', () => {
    expect(NODE_PORTS.motion.in).toContain('place_ref');
    expect(canConnect({ source: 'a', target: 'b', sourceHandle: 'image', targetHandle: 'place_ref' })).toBe(true);
    expect(canConnect({ source: 'a', target: 'b', sourceHandle: 'text', targetHandle: 'place_ref' })).toBe(false);
  });
  it('keeps only two unique usable alternatives and tolerates missing alternatives', () => {
    const prompt = 'Transfer the movement while preserving this character.';
    const alternative = 'Keep source timing and use the character reference exactly.';
    const result = readMotionPrompt(JSON.stringify({ prompt, alternatives: [null, 'short', alternative, alternative, prompt] }), 1);
    expect(result.alternatives).toEqual([alternative]);
    expect(readMotionPrompt(JSON.stringify({ prompt }), 1).alternatives).toBeUndefined();
  });
  it('asks for alternatives only on request', () => {
    const piece = { index: 1, of: 1, startSec: 0, endSec: 5, seconds: 5, cutsSpeech: false };
    const brief = { mode: 'move' as const, wish: '', hasCharacter: true };
    expect(motionPieceAsk(brief, piece)).not.toContain('Also include "alternatives"');
    expect(motionPieceAsk({ ...brief, offerAlternatives: true }, piece)).toContain('Also include "alternatives"');
  });
  it('warns about possible conflicts without rewriting user intent', () => {
    expect(motionPromptWarnings('Slow motion, lip-sync.', 'move', true)).toHaveLength(2);
    expect(motionPromptWarnings('Use the source movement.', 'move', false)).toEqual([]);
  });

  /* The reference image goes to every generation, so describing the person it
     shows adds nothing — and an identifiable person described in text beside a
     photo of her is refused before a frame is made. */
  it('tells the director the image IS the character, and to describe nobody', () => {
    const rules = referenceGuidance(1, 0);
    expect(rules).toContain('first 1');
    expect(rules).toMatch(/must\s+NOT describe their appearance/);
    expect(rules).toContain('the provided character from this image');
    /* The enumeration that invited the description in the first place. */
    expect(rules).not.toMatch(/define the CHARACTER only/);
  });

  it('says not to describe the subject even with no character image', () => {
    expect(referenceGuidance(0, 0)).toMatch(/do not describe their appearance/i);
  });

  /* The exact prompt that came back "This generation might violate our
     policies", twice, uncharged. */
  const REFUSED = 'Apply the pose and motion from input video to provided character from '
    + 'this image. The woman from the provided image, with short dark hair and clear '
    + 'glasses, wearing a black sleeveless top and black shorts with a white waistband, '
    + 'performing a dance. Keep the environment from the input video. Match the lighting, '
    + 'grade and framing of the input video.';

  it('catches the wording that actually got refused', () => {
    expect(subjectDescriptionTerms(REFUSED).sort())
      .toEqual(['glasses', 'hair', 'shorts', 'sleeveless', 'waistband']);
    const warning = subjectDescriptionWarning(REFUSED, 'move');
    expect(warning).toMatch(/appearance and clothing/);
    expect(warning).toMatch(/might violate/);
    expect(warning).toContain('the provided character from this image');
  });

  it('keeps the refusal warning out of the advisory list', () => {
    /* Shown beside "check that this is intentional" it reads as the same
       weight of remark. It is not: one disappoints, the other generates
       nothing at all. The node gives it its own box. */
    expect(motionPromptWarnings(REFUSED, 'move', false)).toEqual([]);
  });

  it('leaves the prompt that should have been written alone', () => {
    /* Google's own sentence plus the two pointers. Nothing here describes a
       person, and a warning on it would teach the user to ignore warnings. */
    const clean = 'Apply the pose and motion from input video to provided character from '
      + 'this image, a dance. Keep the environment from the input video. Match the '
      + 'lighting, grade and framing of the input video.';
    expect(subjectDescriptionTerms(clean)).toEqual([]);
    expect(subjectDescriptionWarning(clean, 'move')).toBe('');
    expect(motionPromptWarnings(clean, 'move', false)).toEqual([]);
  });

  it('does not cry wolf on ordinary direction', () => {
    /* "top" and "short" are everywhere in camera language, which is why the
       bare words are not in the patterns. */
    for (const ordinary of [
      'Keep her in the top third of the frame.',
      'A short beat, then she turns.',
      'Match the grade and framing of the input video.',
    ]) {
      expect(subjectDescriptionWarning(ordinary, 'move')).toBe('');
      expect(motionPromptWarnings(ordinary, 'move', false)).toEqual([]);
    }
  });

  it('lets restyle describe its material, because a material is not a person', () => {
    const material = 'Fluid reflective material, a mirrored skin with no face and no hair, '
      + 'forming the shape of the movement.';
    expect(subjectDescriptionWarning(material, 'restyle')).toBe('');
    expect(subjectDescriptionWarning(material, 'move')).not.toBe('');
  });

  it('gives the refusal warning its own box on the node, not a muted hint', () => {
    const node = readFileSync(join(__dirname, '../studio/nodes/MotionNode.tsx'), 'utf8');
    expect(node).toContain('subjectDescriptionWarning(p.prompt, mode)');
    expect(node).toContain('Likely to be refused');
  });
});
