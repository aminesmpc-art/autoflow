/* ============================================================
   AutoFlow – Tests: Prompt Parser
   ============================================================ */

import { parsePrompts, validatePrompts } from '../shared/parser';

describe('parsePrompts', () => {
  test('splits by blank lines', () => {
    const raw = 'First prompt\n\nSecond prompt\n\nThird prompt';
    const result = parsePrompts(raw);
    expect(result).toEqual(['First prompt', 'Second prompt', 'Third prompt']);
  });

  test('handles multiple blank lines between prompts', () => {
    const raw = 'Prompt A\n\n\n\nPrompt B';
    const result = parsePrompts(raw);
    expect(result).toEqual(['Prompt A', 'Prompt B']);
  });

  test('handles multi-line prompts', () => {
    const raw = 'Line 1 of prompt 1\nLine 2 of prompt 1\n\nLine 1 of prompt 2\nLine 2 of prompt 2';
    const result = parsePrompts(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('Line 1 of prompt 1\nLine 2 of prompt 1');
    expect(result[1]).toBe('Line 1 of prompt 2\nLine 2 of prompt 2');
  });

  test('trims whitespace', () => {
    const raw = '  Prompt A  \n\n  Prompt B  ';
    const result = parsePrompts(raw);
    expect(result).toEqual(['Prompt A', 'Prompt B']);
  });

  test('ignores leading/trailing blank lines', () => {
    const raw = '\n\n\nPrompt A\n\nPrompt B\n\n\n';
    const result = parsePrompts(raw);
    expect(result).toEqual(['Prompt A', 'Prompt B']);
  });

  test('returns empty array for empty input', () => {
    expect(parsePrompts('')).toEqual([]);
    expect(parsePrompts('   ')).toEqual([]);
    expect(parsePrompts('\n\n\n')).toEqual([]);
  });

  test('single prompt without blank lines', () => {
    const result = parsePrompts('Just one prompt');
    expect(result).toEqual(['Just one prompt']);
  });

  test('handles blank lines with spaces/tabs', () => {
    const raw = 'Prompt A\n   \t  \nPrompt B';
    const result = parsePrompts(raw);
    expect(result).toEqual(['Prompt A', 'Prompt B']);
  });

  test('handles Windows-style line endings', () => {
    const raw = 'Prompt A\r\n\r\nPrompt B';
    const result = parsePrompts(raw);
    expect(result).toEqual(['Prompt A', 'Prompt B']);
  });
});

describe('validatePrompts', () => {
  test('returns error for empty array', () => {
    expect(validatePrompts([])).toBe('No prompts found. Enter at least one prompt.');
  });

  test('returns null for valid prompts', () => {
    expect(validatePrompts(['prompt 1', 'prompt 2'])).toBeNull();
  });

  test('returns error for oversized prompt', () => {
    const bigPrompt = 'x'.repeat(10001);
    const result = validatePrompts([bigPrompt]);
    expect(result).toContain('exceeds 10,000 characters');
  });
});
