import { readPovSettings, povBriefLines, POV_SURVIVAL_DEFAULTS } from '../studio/ask/povSurvival';
import { chestDocumentaryPresetPatch, DEFAULT_STORY, readStorySettings, storyBrief } from '../studio/ask/storyPlan';

test('documentary preset sets the camera and preserves authored story fields', () => {
  const story = { ...DEFAULT_STORY, world: 'Pleistocene tundra', look: 'weathered hides', beats: 5 };
  const patch = chestDocumentaryPresetPatch(story);
  const restored = readStorySettings(JSON.parse(JSON.stringify({ ...story, ...patch })));
  expect(restored.world).toBe(story.world);
  expect(restored.look).toBe(story.look);
  expect(restored.beats).toBe(5);
  expect(restored.pov).toMatchObject({ rig: 'goproChest', lens: '14mm', distortion: 'fisheye', focusDepth: 'deep', movementResponse: 'adaptive', motionBlur: 'directional' });
  const brief = storyBrief('A hunter leaves shelter and encounters a hyena.', restored, []);
  expect(brief).toMatch(/fisheye barrel distortion/);
  expect(brief).toMatch(/Deep focus/);
  expect(brief).toMatch(/slate-grey overcast sky/);
  expect(brief).toMatch(/desaturated earth tones/);
  expect(brief).toMatch(/walking.*crouching.*reveal.*escape/);
  expect(brief).toMatch(/Head turns alone do not rotate/);
});
test('old POV settings retain their defaults and omit the added look block', () => {
  expect(readPovSettings(POV_SURVIVAL_DEFAULTS)).toEqual(POV_SURVIVAL_DEFAULTS);
  expect(povBriefLines(POV_SURVIVAL_DEFAULTS).join('\n')).not.toContain('ACTION-CAMERA LOOK');
  expect(readPovSettings(undefined)).toBeUndefined();
});
test('unsupported look choices are discarded when loading a workflow', () => {
  const p = readPovSettings({ distortion: '<invalid>', focusDepth: 'unknown', motionBlur: 'fake' })!;
  expect(p.distortion).toBeUndefined();
  expect(p.focusDepth).toBeUndefined();
  expect(p.motionBlur).toBeUndefined();
});
test('explicit straight lens and crisp motion avoid contradictory fallback wording', () => {
  const p = readPovSettings({ lens: '14mm', distortion: 'rectilinear', motionBlur: 'crisp' })!;
  const lines = povBriefLines(p).join('\n');
  expect(lines).toContain('Rectilinear');
  expect(lines).toContain('minimal blur');
  expect(lines).not.toContain('visible edge distortion');
  expect(lines).not.toContain('Realistic motion blur');
});
