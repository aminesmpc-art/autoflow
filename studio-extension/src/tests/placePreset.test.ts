import { composeAskPrompt, findPreset, getAskPresets, setAskPresets, validatePreset } from '../studio/presets';

afterEach(() => setAskPresets(null));

describe('Place image prompt preset', () => {
  it('is a valid configurable preset', () => {
    expect(validatePreset(findPreset('place_environment'))).toEqual([]);
  });
  it('includes the subject and custom details without requiring a wired prompt', () => {
    const prompt = composeAskPrompt('place_environment', 'Rooftop', false, 'Sunset, clear floor');
    expect(prompt).toContain('Rooftop');
    expect(prompt).toContain('Sunset, clear floor');
    expect(prompt).toContain('Output only the prompt');
    expect(composeAskPrompt('place_environment', '', false, 'A garden')).toContain('A garden');
  });
  it('uses environment-only instructions when an image is connected', () => {
    const prompt = composeAskPrompt('place_environment', '', true, 'Keep the stone walls');
    expect(prompt).toContain('Read only the environment');
    expect(prompt).toContain('Do not transfer people');
    expect(prompt).toContain('Keep the stone walls');
  });
  it('does not leak place details into other presets', () => {
    expect(composeAskPrompt('none', 'Hello', false, 'A garden')).toBe('Hello');
  });
  it('survives older cloud catalogs without duplicate entries', () => {
    setAskPresets([{ id: 'none', name: 'Plain', hint: 'Plain', brief: '{{subject}}' }]);
    expect(findPreset('place_environment').id).toBe('place_environment');
    setAskPresets(getAskPresets());
    expect(getAskPresets().filter((preset) => preset.id === 'place_environment')).toHaveLength(1);
  });
});
