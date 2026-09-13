import { presetInstruction, referenceGuidance, motionPromptWarnings } from '../studio/ask/motionGuidance';
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
});
