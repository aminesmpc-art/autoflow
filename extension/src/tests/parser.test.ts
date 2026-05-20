/* ============================================================
   AutoFlow – Tests: Prompt Parser
   ============================================================ */

import { parsePrompts, validatePrompts, ParsedPromptNode } from '../shared/parser';

describe('parsePrompts', () => {
  test('splits by blank lines into base nodes', () => {
    const raw = 'First prompt\n\nSecond prompt\n\nThird prompt';
    const result = parsePrompts(raw);
    expect(result).toEqual([
      { text: 'First prompt', isExtension: false, baseIndex: 0 },
      { text: 'Second prompt', isExtension: false, baseIndex: 1 },
      { text: 'Third prompt', isExtension: false, baseIndex: 2 }
    ]);
  });

  test('handles bracket chains', () => {
    const raw = 'Base 1\n\n[Chain Base\nChain Ext 1\nChain Ext 2]\n\nBase 2';
    const result = parsePrompts(raw);
    expect(result).toHaveLength(5);
    
    // Base 1
    expect(result[0]).toEqual({ text: 'Base 1', isExtension: false, baseIndex: 0 });
    
    // Chain Base
    expect(result[1]).toEqual({ text: 'Chain Base', isExtension: false, baseIndex: 1 });
    // Chain Ext 1
    expect(result[2]).toEqual({ text: 'Chain Ext 1', isExtension: true, baseIndex: 1 });
    // Chain Ext 2
    expect(result[3]).toEqual({ text: 'Chain Ext 2', isExtension: true, baseIndex: 1 });

    // Base 2
    expect(result[4]).toEqual({ text: 'Base 2', isExtension: false, baseIndex: 4 });
  });

  test('returns empty array for empty input', () => {
    expect(parsePrompts('')).toEqual([]);
    expect(parsePrompts('   ')).toEqual([]);
    expect(parsePrompts('\n\n\n')).toEqual([]);
  });
});

describe('validatePrompts', () => {
  test('returns error for empty array', () => {
    expect(validatePrompts([])).toBe('No prompts found. Enter at least one prompt.');
  });

  test('returns null for valid prompts', () => {
    const nodes: ParsedPromptNode[] = [
      { text: 'prompt 1', isExtension: false, baseIndex: 0 },
      { text: 'prompt 2', isExtension: false, baseIndex: 1 }
    ];
    expect(validatePrompts(nodes)).toBeNull();
  });

  test('returns error for oversized prompt', () => {
    const bigPrompt = 'x'.repeat(20001);
    const nodes: ParsedPromptNode[] = [
      { text: bigPrompt, isExtension: false, baseIndex: 0 }
    ];
    const result = validatePrompts(nodes);
    expect(result).toContain('exceeds 20,000 characters');
  });
});
