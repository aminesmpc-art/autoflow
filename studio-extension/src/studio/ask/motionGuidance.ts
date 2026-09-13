export const MOTION_PRESETS = [
  { id: 'custom', title: 'Custom direction', instruction: '' },
  { id: 'dance', title: 'Dance / choreography', instruction: 'Transfer the source choreography with its original rhythm and timing. Do not invent additional steps or change the camera.' },
  { id: 'walk', title: 'Walk / body movement', instruction: 'Preserve the source gait, travel direction, body contacts and timing. Keep feet grounded and avoid sliding.' },
  { id: 'performance', title: 'Character performance', instruction: 'Preserve the source performance and gesture timing while keeping the referenced character identity consistent.' },
  { id: 'material', title: 'Material / artistic restyle', instruction: 'Re-express the source movement in the requested material while preserving its timing and overall silhouette.' },
] as const;

export function presetInstruction(id: unknown): string {
  return MOTION_PRESETS.find((p) => p.id === id)?.instruction || '';
}

export function referenceGuidance(characterCount: number, placeCount: number): string {
  const subject = characterCount
    ? `The first ${characterCount} reference image(s) define the CHARACTER only: identity, face, body and clothing. Do not copy their background.`
    : 'Keep the subject from the input video; no replacement character image is attached.';
  return `${subject} ${placeCount
    ? `The final ${placeCount} reference image(s) define the PLACE only. Use that environment, not people or objects as replacement characters. Integrate the subject with the place lighting, scale, perspective and contact shadows. The video still controls motion, timing and camera; do not copy a conflicting camera angle from the place image.`
    : 'No place image is attached. Keep the environment from the input video.'}`;
}

export function motionPromptWarnings(prompt: string, mode: string, muted: boolean): string[] {
  const warnings: string[] = [];
  if (mode !== 'restyle' && /\b(slow motion|speed up|new camera|camera orbit|zoom in)\b/i.test(prompt)) {
    warnings.push('This prompt may change source timing or camera movement. Check that this is intentional.');
  }
  if (muted && /\b(dialogue|lip.?sync|speak|singing)\b/i.test(prompt)) {
    warnings.push('Audio is removed. The silent-output instruction will override speech directions.');
  }
  return warnings;
}
