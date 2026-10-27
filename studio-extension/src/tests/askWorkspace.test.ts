/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { composeAskRequest, normalizeAskWritingOptions } from '../studio/presets';

describe('Ask AI workspace', () => {
  it('preserves requests exactly when customization is unset or reset', () => {
    const original = composeAskRequest('place_environment', 'Garden', true, 'Wide', 'Stone');
    expect(composeAskRequest('place_environment', 'Garden', true, 'Wide', 'Stone', {})).toBe(original);
  });
  it('includes all writing preferences without replacing the preset or brief', () => {
    const prompt = composeAskRequest('place_environment', 'Garden', true, 'Wide', 'Stone', {
      detail: 'detailed', language: 'French', tone: 'Cinematic', include: 'Fixed camera', avoid: 'People',
    });
    for (const part of ['Garden', 'Wide', 'Stone', 'Read only the environment', 'specific and detailed', 'French', 'Cinematic', 'Fixed camera', 'People', 'preserve the preset']) {
      expect(prompt).toContain(part);
    }
  });
  it('does not turn preferences alone into a runnable task', () => {
    expect(composeAskRequest('none', '', false, '', '', { language: 'English', include: 'Trees' })).toBe('');
  });
  it('handles malformed imported preferences and limits text lengths', () => {
    expect(normalizeAskWritingOptions(null)).toEqual(normalizeAskWritingOptions({}));
    const result = normalizeAskWritingOptions({ detail: 'wrong', language: 5, tone: 'x'.repeat(200), include: [] });
    expect(result.detail).toBe('');
    expect(result.language).toBe('');
    expect(result.include).toBe('');
    expect(result.tone).toHaveLength(160);
  });
  it('supports concise output and ignores irrelevant place notes', () => {
    const prompt = composeAskRequest('none', 'A room', false, '', 'Unused', { detail: 'concise' });
    expect(prompt).toContain('Be concise');
    expect(prompt).not.toContain('Unused');
  });
  it('works directly from a local brief', () => {
    expect(composeAskRequest('none', '', false, 'A rooftop')).toBe('A rooftop');
  });
  it('combines upstream text and local details without losing either', () => {
    expect(composeAskRequest('none', 'A rooftop', false, 'Sunset')).toBe('A rooftop\n\nSunset');
  });
  it('preserves empty pass-through and place customization', () => {
    expect(composeAskRequest('none', '', false)).toBe('');
    expect(composeAskRequest('place_environment', 'Garden', true, 'Wide view', 'Stone floor')).toContain('Stone floor');
    expect(composeAskRequest('place_environment', 'Garden', true, 'Wide view')).toContain('Read only the environment');
  });
  it('uses the same composition function for the preview and execution', () => {
    const read = (path: string) => readFileSync(join(__dirname, '../studio', path), 'utf8');
    expect(read('components/AskBriefEditor.tsx')).toContain('composeAskRequest(data.preset');
    expect(read('engine/WorkflowRunner.ts')).toContain('composeAskRequest(nodeData.preset');
    expect(read('components/AskBriefEditor.tsx')).toContain('Upstream output and available references may change');
    expect(read('nodes/GenerateNode.tsx')).toContain('{isText && <AskBriefEditor');
  });
});
