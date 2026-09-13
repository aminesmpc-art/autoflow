/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { composeAskRequest } from '../studio/presets';

describe('Ask AI workspace', () => {
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
