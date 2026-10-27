export const DISTORTIONS = [
  { id: 'auto', name: 'Lens default' },
  { id: 'rectilinear', name: 'Straight lines' },
  { id: 'mildBarrel', name: 'Subtle barrel distortion' },
  { id: 'fisheye', name: 'Noticeable fisheye' },
] as const;
export const FOCUS_DEPTHS = [
  { id: 'auto', name: 'Director decides' },
  { id: 'deep', name: 'Deep focus' },
  { id: 'shallow', name: 'Shallow focus' },
] as const;
export const MOTION_BLURS = [
  { id: 'auto', name: 'Natural blur' },
  { id: 'crisp', name: 'Crisp motion' },
  { id: 'directional', name: 'Directional during fast action' },
] as const;
export const MOVEMENT_RESPONSES = [
  { id: 'auto', name: 'Use body movement setting' },
  { id: 'adaptive', name: 'Follow the action' },
] as const;
export const COLOR_TREATMENTS = [
  { id: 'auto', name: 'Use visual style' },
  { id: 'earth', name: 'Desaturated earth tones' },
  { id: 'neutral', name: 'Natural neutral colours' },
  { id: 'vibrant', name: 'Vibrant colours' },
] as const;

export interface ActionCameraLookSettings {
  distortion?: typeof DISTORTIONS[number]['id'];
  focusDepth?: typeof FOCUS_DEPTHS[number]['id'];
  motionBlur?: typeof MOTION_BLURS[number]['id'];
  movementResponse?: typeof MOVEMENT_RESPONSES[number]['id'];
  colorTreatment?: typeof COLOR_TREATMENTS[number]['id'];
}

export function readActionCameraLook(raw: Record<string, unknown>): ActionCameraLookSettings {
  const result: Record<string, string> = {};
  const options = { distortion: DISTORTIONS, focusDepth: FOCUS_DEPTHS, motionBlur: MOTION_BLURS,
    movementResponse: MOVEMENT_RESPONSES, colorTreatment: COLOR_TREATMENTS };
  for (const [key, values] of Object.entries(options)) {
    if (values.some(option => option.id === raw[key])) result[key] = raw[key] as string;
  }
  return result as ActionCameraLookSettings;
}

export function actionCameraLookLines(p: ActionCameraLookSettings): string[] {
  const lines: string[] = [];
  if (p.distortion === 'fisheye') lines.push('Noticeable fisheye barrel distortion: straight lines bow near the edges; keep anatomy intact.');
  if (p.distortion === 'mildBarrel') lines.push('Subtle optical barrel distortion at the frame edges.');
  if (p.distortion === 'rectilinear') lines.push('Rectilinear lens rendering with straight edges and no fisheye curvature.');
  if (p.focusDepth === 'deep') lines.push('Deep focus: nearby hands, companions and distant terrain remain readable together.');
  if (p.focusDepth === 'shallow') lines.push('Shallow depth of field: keep the active subject sharp with a softly defocused background.');
  if (p.motionBlur === 'crisp') lines.push('Short-exposure motion rendering; fast movement stays crisp with minimal blur.');
  if (p.motionBlur === 'directional') lines.push('Directional motion blur grows during rapid turns and sprinting; quiet moments and the threat reveal stay readable.');
  if (p.colorTreatment === 'earth') lines.push('Raw documentary colour treatment: desaturated earth tones, restrained contrast and natural skin and hide textures.');
  if (p.colorTreatment === 'neutral') lines.push('Natural neutral colours with realistic skin and material textures.');
  if (p.colorTreatment === 'vibrant') lines.push('Vibrant colours while preserving realistic skin and material textures.');
  if (lines.length) return ['ACTION-CAMERA LOOK — repeat these choices in every connected shot prompt.', ...lines.map(line => `  ${line}`)];
  return [];
}
