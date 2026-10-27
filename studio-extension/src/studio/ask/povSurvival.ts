/* ============================================================
   POV / Action Camera — the settings a first-person piece needs
   that the Director had no words for.

   ── Why this is its own file ──────────────────────────────────────────────

   storyPlan.ts already holds the Director's settings, and everything in it is
   flat: cameraProgression, audioMode, visualPreset, colorTemp, lighting. That
   shape works because each is one choice.

   This is twenty-odd choices about one thing. Flattening them would double the
   size of StorySettings, and readStorySettings — the single reader that exists
   because there used to be two and each forgot a different field — would grow
   twenty more lines to forget. One optional object, one reader, one place to
   add the next.

   ── What is NOT here ──────────────────────────────────────────────────────

   Three of the settings this format needs already exist, and are reused
   rather than restated:

     audio strategy      → audioMode. 'none' is 'none', environment-only is
                           'ambient', native scene audio is 'cinematic'.
     camera rig (coarse) → cameraProgression 'mountedPOV'. `rig` below refines
                           WHERE it is mounted; it does not replace coverage.
     shot duration       → each shot's own `duration`. `preferredShotDuration`
                           here is advice about pacing, never a parameter.

   ── What these settings are ───────────────────────────────────────────────

   Prompt guidance. Flow exposes no lens, no stabilisation and no camera
   height; there is nothing to send them to. They exist to be turned into
   prose the video model obeys, which is what povBriefLines does.
   ============================================================ */

import { actionCameraLookLines, readActionCameraLook, type ActionCameraLookSettings } from './actionCameraLook';

export type PerspectiveId = 'firstPerson' | 'thirdPerson' | 'cinematic';
export type CameraRigId = 'goproHead' | 'goproChest' | 'bodyMounted' | 'handheld' | 'cinematic';
export type PovLensId = '14mm' | '18mm' | '20mm' | '24mm' | '35mm';
export type StabilizationId = 'none' | 'low' | 'medium' | 'smooth';
export type BodyMovementId = 'subtle' | 'natural' | 'strong';
export type CameraHeightId = 'eyeLevel' | 'chestLevel' | 'crouched' | 'groundLevel';
export type FramingId = 'clean' | 'natural' | 'imperfectDocumentary';
export type AwarenessId = 'never' | 'natural' | 'frequent';
export type InteractionDistanceId = 'distant' | 'normal' | 'close';
export type PovContinuityId = 'normal' | 'high' | 'strict';
export type PovDurationId = '4s' | '6s' | '8s' | '10s';
export type NarrationStrategyId = 'none' | 'separateVoiceover' | 'firstPersonDiary';
export type NarrationPersonId = 'firstPerson' | 'thirdPerson' | 'none';
export type HookTimingId = 'immediate' | 'firstThreeSeconds' | 'gradual';
export type ActionDensityId = 'low' | 'medium' | 'mediumHigh' | 'high';
export type DialogueDensityId = 'none' | 'low' | 'medium' | 'high';
export type EndingStyleId = 'resolved' | 'softCliffhanger' | 'cliffhanger';
export type RevealStyleId = 'direct' | 'delayed' | 'visualBeforeExplanation';
export type POVParticipationId = 'passive' | 'natural' | 'active';
export type AnimalStyleId = 'naturalRealism' | 'cinematic' | 'fantasy';
export type GroupStagingId = 'distant' | 'natural' | 'embedded';

/** Kept as the old name so nothing that imported it has to change. */
export type DensityId = ActionDensityId;

export interface PovSettings extends ActionCameraLookSettings {
  perspective: PerspectiveId;
  rig: CameraRigId;
  lens: PovLensId;
  stabilization: StabilizationId;
  bodyMovement: BodyMovementId;
  cameraHeight: CameraHeightId;
  framing: FramingId;

  /* What the camera's owner shows of themselves. */
  showHands: boolean;
  showForearms: boolean;
  showForegroundProp: boolean;
  /** Normally false for this format — it is what makes it first-person. */
  protagonistFaceVisible: boolean;
  /**
   * Whether the RIG itself is in shot — a strap, a harness rim, a housing edge.
   *
   * False by default, and the default matters. The Body-Mounted POV coverage
   * used to demand it in every prompt on the reasoning that without visible
   * hardware the shot renders as a floating camera. Measured on a real
   * eight-shot episode, that produced "The dark leather rim of the chest
   * harness mount is visible along the bottom edge of the frame" in all eight
   * prompts — a piece of modern equipment, permanently, in a prehistoric
   * story that had banned modern objects in the same brief.
   *
   * What actually sells a body-mounted camera is the body: the bounce, the
   * micro-vibration, the imperfect reframing, the hands arriving from below.
   * Those are described whether or not this is on.
   */
  showCameraMount: boolean;

  awareness: AwarenessId;
  interactionDistance: InteractionDistanceId;
  continuity: PovContinuityId;
  /** Pacing advice for the writer. The shot node owns the real duration. */
  preferredShotDuration: PovDurationId;

  narrationStrategy: NarrationStrategyId;
  narrationPerson: NarrationPersonId;
  hookTiming: HookTimingId;
  actionDensity: ActionDensityId;
  dialogueDensity: DialogueDensityId;
  endingStyle: EndingStyleId;
  revealStyle: RevealStyleId;

  /* ── Added for the prehistoric survival / POV diary upgrade ── */

  /**
   * Whether the protagonist is an active member of the group or a passive camera.
   *
   * 'passive' — the protagonist follows, watches and films. Others do things.
   * 'natural' — the protagonist participates when the story calls for it.
   * 'active' — the protagonist walks beside, helps carry, crouches next to,
   *            physically reacts — they are IN the group, not behind it.
   *
   * The default failure without this: family always far ahead, POV always
   * follows from behind, other characters perform every action, POV only
   * watches. 'active' fixes that by asking for explicit physical participation
   * in at least 5 of 8 shots.
   */
  povParticipation: POVParticipationId;

  /**
   * How real animals are described.
   *
   * 'naturalRealism' — realistic anatomy, proportions, fur, scale, weight.
   *                    No monstrous, colossal, hulking, glowing, supernatural.
   * 'cinematic'      — larger than life but physically plausible.
   * 'fantasy'        — anything goes.
   *
   * The default failure without this: a brown bear becomes a "hulking apex
   * monster with glowing eyes" and a survival encounter turns into fantasy.
   */
  animalStyle: AnimalStyleId;

  /**
   * How the protagonist is positioned relative to the group.
   *
   * 'distant'  — the group is far ahead or behind; the POV observes.
   * 'natural'  — whatever the story calls for.
   * 'embedded' — the POV walks beside, crouches next to, stands among.
   *             Hands working close to lens, companion one arm's length away,
   *             partial bodies crossing frame edge. No family-lineup.
   */
  groupStaging: GroupStagingId;
}

/** id → label, for the node's dropdowns. */
export interface PovOption<T extends string> { id: T; name: string; hint?: string }

export const PERSPECTIVES: PovOption<PerspectiveId>[] = [
  { id: 'firstPerson', name: 'First person', hint: 'The camera IS the protagonist.' },
  { id: 'thirdPerson', name: 'Third person', hint: 'The protagonist is filmed from outside.' },
  { id: 'cinematic', name: 'Cinematic', hint: 'Whatever the shot needs.' },
];

export const CAMERA_RIGS: PovOption<CameraRigId>[] = [
  { id: 'goproHead', name: 'GoPro — head', hint: 'Turns exactly when the head turns.' },
  { id: 'goproChest', name: 'GoPro — chest', hint: 'Arms reach up into frame; horizon sits low.' },
  { id: 'bodyMounted', name: 'Body-mounted', hint: 'Worn. The body drives the frame.' },
  { id: 'handheld', name: 'Handheld', hint: 'Held by the protagonist or a companion.' },
  { id: 'cinematic', name: 'Cinematic rig', hint: 'Operated, not worn.' },
];

export const POV_LENSES: PovOption<PovLensId>[] = [
  { id: '14mm', name: '14mm — very wide' },
  { id: '18mm', name: '18mm — action cam' },
  { id: '20mm', name: '20mm — natural wide' },
  { id: '24mm', name: '24mm — mild wide' },
  { id: '35mm', name: '35mm — near-human' },
];

export const STABILIZATIONS: PovOption<StabilizationId>[] = [
  { id: 'none', name: 'None — raw' },
  { id: 'low', name: 'Low — body motion reads' },
  { id: 'medium', name: 'Medium' },
  { id: 'smooth', name: 'Smooth — gimbal-like' },
];

export const BODY_MOVEMENTS: PovOption<BodyMovementId>[] = [
  { id: 'subtle', name: 'Subtle' },
  { id: 'natural', name: 'Natural walking bounce' },
  { id: 'strong', name: 'Strong — running, climbing' },
];

export const CAMERA_HEIGHTS: PovOption<CameraHeightId>[] = [
  { id: 'eyeLevel', name: 'Eye level', hint: 'Where a standing adult looks from.' },
  { id: 'chestLevel', name: 'Chest level', hint: 'Only for a chest rig; people read taller.' },
  { id: 'crouched', name: 'Crouched' },
  { id: 'groundLevel', name: 'Ground level' },
];

export const FRAMINGS: PovOption<FramingId>[] = [
  { id: 'clean', name: 'Clean — composed' },
  { id: 'natural', name: 'Natural' },
  { id: 'imperfectDocumentary', name: 'Imperfect / documentary' },
];

export const AWARENESS: PovOption<AwarenessId>[] = [
  { id: 'never', name: 'Never — nobody looks at the lens' },
  { id: 'natural', name: 'Natural — they react to the person' },
  { id: 'frequent', name: 'Frequent — they engage directly' },
];

export const INTERACTION_DISTANCES: PovOption<InteractionDistanceId>[] = [
  { id: 'distant', name: 'Distant' },
  { id: 'normal', name: 'Normal' },
  { id: 'close', name: 'Close — they come to the lens' },
];

export const POV_CONTINUITIES: PovOption<PovContinuityId>[] = [
  { id: 'normal', name: 'Normal' },
  { id: 'high', name: 'High — repeat the anchors' },
  { id: 'strict', name: 'Strict — repeat them verbatim' },
];

export const POV_DURATIONS: PovOption<PovDurationId>[] = [
  { id: '4s', name: '4s' }, { id: '6s', name: '6s' },
  { id: '8s', name: '8s' }, { id: '10s', name: '10s' },
];

export const NARRATION_STRATEGIES: PovOption<NarrationStrategyId>[] = [
  { id: 'none', name: 'None' },
  { id: 'separateVoiceover', name: 'Separate voice-over', hint: 'Added after the clips.' },
  { id: 'firstPersonDiary', name: 'First-person diary', hint: 'Added after the clips.' },
];

export const NARRATION_PERSONS: PovOption<NarrationPersonId>[] = [
  { id: 'firstPerson', name: 'First person — "I"' },
  { id: 'thirdPerson', name: 'Third person' },
  { id: 'none', name: 'None' },
];

export const HOOK_TIMINGS: PovOption<HookTimingId>[] = [
  { id: 'immediate', name: 'Immediate' },
  { id: 'firstThreeSeconds', name: 'First 3 seconds' },
  { id: 'gradual', name: 'Gradual' },
];

export const ACTION_DENSITIES: PovOption<ActionDensityId>[] = [
  { id: 'low', name: 'Low — shots may breathe' },
  { id: 'medium', name: 'Medium' },
  { id: 'mediumHigh', name: 'Medium-high — every shot does something' },
  { id: 'high', name: 'High — nothing is only scenery' },
];

export const DIALOGUE_DENSITIES: PovOption<DialogueDensityId>[] = [
  { id: 'none', name: 'None — nobody speaks' },
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
];

/** The old name, kept so existing imports keep working. */
export const DENSITIES = ACTION_DENSITIES;

export const ENDING_STYLES: PovOption<EndingStyleId>[] = [
  { id: 'resolved', name: 'Resolved' },
  { id: 'softCliffhanger', name: 'Soft cliffhanger' },
  { id: 'cliffhanger', name: 'Cliffhanger' },
];

export const REVEAL_STYLES: PovOption<RevealStyleId>[] = [
  { id: 'direct', name: 'Direct' },
  { id: 'delayed', name: 'Delayed' },
  { id: 'visualBeforeExplanation', name: 'Show it, then explain' },
];

export const POV_PARTICIPATIONS: PovOption<POVParticipationId>[] = [
  { id: 'passive', name: 'Passive — camera only', hint: 'The protagonist follows, watches and films.' },
  { id: 'natural', name: 'Natural', hint: 'Participates when the story calls for it.' },
  { id: 'active', name: 'Active — in the group', hint: 'Walks beside, helps carry, physically reacts.' },
];

export const ANIMAL_STYLES: PovOption<AnimalStyleId>[] = [
  { id: 'naturalRealism', name: 'Natural realism', hint: 'Realistic anatomy, proportions, scale. No monster escalation.' },
  { id: 'cinematic', name: 'Cinematic', hint: 'Larger than life but physically plausible.' },
  { id: 'fantasy', name: 'Fantasy', hint: 'Anything goes — monsters, supernatural, glowing eyes.' },
];

export const GROUP_STAGINGS: PovOption<GroupStagingId>[] = [
  { id: 'distant', name: 'Distant', hint: 'The group is far ahead or behind; the POV observes.' },
  { id: 'natural', name: 'Natural', hint: 'Whatever the story calls for.' },
  { id: 'embedded', name: 'Embedded — beside them', hint: 'Close, intimate, among. Hands and bodies at arm\'s length.' },
];

/**
 * The defaults the POV Survival / GoPro Diary preset applies.
 *
 * Also what an un-configured POV block resolves to, so a Director that names
 * the preset and nothing else still writes a coherent first-person piece.
 */
export const POV_SURVIVAL_DEFAULTS: PovSettings = {
  perspective: 'firstPerson',
  rig: 'bodyMounted',
  lens: '20mm',
  stabilization: 'low',
  bodyMovement: 'natural',
  /* Eye level, not chest. A body-mounted rig can sit anywhere on a body, and
     where a first-person story wants it is where the person looks from. */
  cameraHeight: 'eyeLevel',
  framing: 'imperfectDocumentary',
  showHands: true,
  showForearms: true,
  showForegroundProp: true,
  protagonistFaceVisible: false,
  showCameraMount: false,
  awareness: 'natural',
  interactionDistance: 'close',
  /* strict, not high. Word-for-word repetition of anchors is what keeps a
     character from drifting across eight prompts a generator reads one at a
     time. Changed from 'high' because rewording is how "grey-streaked hair"
     becomes "silver hair" becomes "white hair" over the length of a piece. */
  continuity: 'strict',
  /* 8s, not 6s. Prehistoric survival source clips are intended to be edited
     around 1.3× later, and 8s at natural speed gives enough room for one
     action, its development and the reaction without cramming. */
  preferredShotDuration: '8s',
  narrationStrategy: 'firstPersonDiary',
  narrationPerson: 'firstPerson',
  hookTiming: 'immediate',
  actionDensity: 'mediumHigh',
  dialogueDensity: 'none',
  endingStyle: 'cliffhanger',
  revealStyle: 'visualBeforeExplanation',
  povParticipation: 'active',
  animalStyle: 'naturalRealism',
  groupStaging: 'embedded',
};

/** The visual preset id that turns this format on. camelCase, as every other. */
export const POV_SURVIVAL_PRESET_ID = 'povSurvival';

const pick = <T extends string>(
  value: unknown, options: PovOption<T>[], fallback: T,
): T => (options.some((o) => o.id === value) ? value as T : fallback);

/**
 * Read a POV block off node data, or nothing.
 *
 * Returns undefined when there is no block, which is what keeps every Director
 * that predates this feature behaving exactly as it did: no block, no POV
 * section in the brief, not one word of the prompt different.
 *
 * Unknown values are normalised to the preset's own default rather than
 * rejected, which is how readStorySettings already treats a setting it does
 * not recognise. A plan naming a 50mm lens gets a working 20mm piece instead
 * of a failed build.
 */
export function readPovSettings(raw: unknown): PovSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const n = raw as Record<string, unknown>;
  const d = POV_SURVIVAL_DEFAULTS;
  const bool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb);
  return {
    perspective: pick(n.perspective, PERSPECTIVES, d.perspective),
    ...readActionCameraLook(n),
    rig: pick(n.rig, CAMERA_RIGS, d.rig),
    lens: pick(n.lens, POV_LENSES, d.lens),
    stabilization: pick(n.stabilization, STABILIZATIONS, d.stabilization),
    bodyMovement: pick(n.bodyMovement, BODY_MOVEMENTS, d.bodyMovement),
    cameraHeight: pick(n.cameraHeight, CAMERA_HEIGHTS, d.cameraHeight),
    framing: pick(n.framing, FRAMINGS, d.framing),
    showHands: bool(n.showHands, d.showHands),
    showForearms: bool(n.showForearms, d.showForearms),
    showForegroundProp: bool(n.showForegroundProp, d.showForegroundProp),
    protagonistFaceVisible: bool(n.protagonistFaceVisible, d.protagonistFaceVisible),
    showCameraMount: bool(n.showCameraMount, d.showCameraMount),
    awareness: pick(n.awareness, AWARENESS, d.awareness),
    interactionDistance: pick(n.interactionDistance, INTERACTION_DISTANCES, d.interactionDistance),
    continuity: pick(n.continuity, POV_CONTINUITIES, d.continuity),
    preferredShotDuration: pick(n.preferredShotDuration, POV_DURATIONS, d.preferredShotDuration),
    narrationStrategy: pick(n.narrationStrategy, NARRATION_STRATEGIES, d.narrationStrategy),
    narrationPerson: pick(n.narrationPerson, NARRATION_PERSONS, d.narrationPerson),
    hookTiming: pick(n.hookTiming, HOOK_TIMINGS, d.hookTiming),
    actionDensity: pick(n.actionDensity, ACTION_DENSITIES, d.actionDensity),
    dialogueDensity: pick(n.dialogueDensity, DIALOGUE_DENSITIES, d.dialogueDensity),
    endingStyle: pick(n.endingStyle, ENDING_STYLES, d.endingStyle),
    revealStyle: pick(n.revealStyle, REVEAL_STYLES, d.revealStyle),
    povParticipation: pick(n.povParticipation, POV_PARTICIPATIONS, d.povParticipation),
    animalStyle: pick(n.animalStyle, ANIMAL_STYLES, d.animalStyle),
    groupStaging: pick(n.groupStaging, GROUP_STAGINGS, d.groupStaging),
  };
}

/** Nobody speaks in this piece, so no dialogue guidance belongs anywhere near it. */
export const povIsSilent = (p: PovSettings | undefined): boolean =>
  !!p && p.dialogueDensity === 'none';

/* ── Turning settings into prose ───────────────────────────────────────────
 *
 * Every line below is written as an instruction the video model can obey. The
 * enum names never reach it: "imperfectDocumentary" means nothing to a
 * generator, and "framing is allowed to be slightly off, the way a real
 * recording is" means exactly what it says.
 */

const LENS_WORDS: Record<PovLensId, string> = {
  '14mm': 'an extremely wide 14mm-equivalent lens, with visible edge distortion',
  '18mm': 'a wide 18mm-equivalent action-camera lens',
  '20mm': 'a natural wide 20mm-equivalent lens',
  '24mm': 'a mildly wide 24mm-equivalent lens',
  '35mm': 'a 35mm-equivalent lens, close to human vision',
};

const RIG_WORDS: Record<CameraRigId, string> = {
  goproHead: 'worn on the head, so the frame turns exactly when the head turns',
  goproChest: 'worn on the chest, so the arms reach up into the lower frame',
  bodyMounted: 'worn on the body, driven by the torso and the head rather than by a hand',
  handheld: 'held in one hand, with the grip visible at the frame edge from time to time',
  cinematic: 'operated by a camera person rather than worn',
};

const STAB_WORDS: Record<StabilizationId, string> = {
  none: 'no stabilisation at all — every step reads in the frame',
  low: 'very little stabilisation: the walk, the breath and the body all read',
  medium: 'moderate stabilisation — motion is present but not violent',
  smooth: 'heavy stabilisation, close to a gimbal',
};

const MOVE_WORDS: Record<BodyMovementId, string> = {
  subtle: 'restrained body movement, as if moving carefully',
  natural: 'a natural walking bounce, slight lateral sway and organic head turns',
  strong: 'strong body movement — climbing, running, scrambling — with the frame '
    + 'pitching as the body works',
};

const HEIGHT_WORDS: Record<CameraHeightId, string> = {
  eyeLevel: 'at natural eye level, where a standing adult looks from',
  chestLevel: 'at chest height, so people read slightly taller than the lens',
  crouched: 'at crouching height, low and close to the ground',
  groundLevel: 'at ground level, among the dirt and the feet',
};

const FRAMING_WORDS: Record<FramingId, string> = {
  clean: 'framing stays composed and deliberate',
  natural: 'framing is unforced, neither composed nor sloppy',
  imperfectDocumentary: 'framing is allowed to be imperfect the way a real recording is — '
    + 'the subject drifting off centre, a late correction, a moment of tilt',
};

const AWARE_WORDS: Record<AwarenessId, string> = {
  never: 'nobody looks toward the lens; the camera is unobserved',
  natural: 'people look toward the lens and react to the person carrying it, the way '
    + 'they would to anyone standing there',
  frequent: 'people turn to the person carrying the camera constantly, and direct what '
    + 'they are doing at them',
};

const DIST_WORDS: Record<InteractionDistanceId, string> = {
  distant: 'others keep their distance from the lens',
  normal: 'others come as close as the moment needs',
  close: 'others come right up to the lens, hold objects out toward it, guide or stop '
    + 'the protagonist with a hand, and pass close enough to briefly block the frame',
};

const REVEAL_WORDS: Record<RevealStyleId, string> = {
  direct: 'show the important thing plainly when it arrives',
  delayed: 'hold the important thing back a beat before showing it',
  visualBeforeExplanation: 'show the thing before anything explains it — the picture '
    + 'first, the meaning after',
};

const ENDING_WORDS: Record<EndingStyleId, string> = {
  resolved: 'the last beat resolves',
  softCliffhanger: 'the last beat settles but leaves one thing open',
  cliffhanger: 'the last beat is unresolved and stops mid-situation',
};

const HOOK_WORDS: Record<HookTimingId, string> = {
  immediate: 'the first shot opens already inside the action — no establishing, no '
    + 'setup, no arrival',
  firstThreeSeconds: 'something worth watching happens inside the first three seconds',
  gradual: 'the opening may build',
};

/** How much may happen in one clip, by its length. */
const DENSITY_BY_DURATION: Record<PovDurationId, string> = {
  '4s': 'ONE simple physical action. Nothing else.',
  '6s': 'ONE main physical action and ONE immediate reaction or transition out of it. '
    + 'Not three actions, not five — clarity beats completeness at this length.',
  '8s': 'ONE action, its development, and the reaction to it.',
  '10s': 'up to three linked beats: what begins, what it turns into, where it lands.',
};

const cap = (s: string): string => s.replace(/^./, (c) => c.toUpperCase());

/** The body parts the camera's owner may show, as one clause. */
function bodyClause(p: PovSettings): string {
  const parts: string[] = [];
  if (p.showHands) parts.push('their hands');
  if (p.showForearms) parts.push('their forearms');
  if (p.showForegroundProp) parts.push('whatever they are carrying or holding');
  if (!parts.length) return 'No part of the camera\'s owner enters the frame.';
  const list = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `Only ${list} may enter the frame, from below or from the side, the way they `
    + 'would if the camera were worn.';
}

/**
 * The POV block of the Director's brief.
 *
 * Empty array when there is nothing to say, so the caller can splice it in
 * without deciding whether a POV piece is being made.
 */
export function povBriefLines(p: PovSettings | undefined): string[] {
  if (!p) return [];
  const out: string[] = [];
  const first = p.perspective === 'firstPerson';

  out.push('POINT OF VIEW — true of every shot.');
  out.push('  VIDEO WRITING: state the visible opening briefly, then lead with physical action.');
  out.push('  Describe who moves which hand, what it contacts, the visible result, and how the body drives the camera.');
  out.push('  Include a specific reaction when the assigned beat calls for one; a deliberate pause must stay a pause.');
  out.push('  If timed beats are requested, put the time ranges in the actual video prompt, not only in the plan.');
  out.push('  Avoid filler such as "both the camera and subjects move". Name the movement instead.');
  out.push('  A connected start image already depicts the cast: use concise visible identity anchors in videos,');
  out.push('  keeping the full character design in the bible and image prompts. Do not describe hidden faces or legs just to repeat their biography.');

  if (first) {
    out.push('  This is a first-person piece. The camera is not observing the protagonist;');
    out.push('  it IS the protagonist\'s viewpoint, physically attached to them.');
    if (!p.protagonistFaceVisible) {
      out.push('  Their face is never visible. Not in a reflection, not over a shoulder,');
      out.push('  not in a cutaway. A shot that shows it is the wrong shot.');
    }
    out.push(`  ${bodyClause(p)}`);
  } else if (p.perspective === 'thirdPerson') {
    out.push('  The protagonist is filmed from outside, as a subject in the frame.');
  } else {
    out.push('  Shoot each beat from wherever it reads best.');
  }

  out.push(`  The camera is ${RIG_WORDS[p.rig]}, ${HEIGHT_WORDS[p.cameraHeight]}, on `
    + `${p.distortion && p.distortion !== 'auto' && p.lens === '14mm' ? 'an extremely wide 14mm-equivalent lens' : LENS_WORDS[p.lens]}.`);
  if (p.cameraHeight === 'eyeLevel') {
    out.push('  It drops lower only when the body does — crouching, kneeling, climbing,');
    out.push('  falling, leaning in to look at something.');
  }
  if (p.movementResponse === 'adaptive') {
    out.push('  Movement follows the current action: rhythmic vertical bob while walking, lower height and careful creeping when crouching, a near-still pause for a warning or reveal, and urgent shake only during running or escape.');
    out.push(`  Stabilisation: ${STAB_WORDS[p.stabilization]}. Scale the shake to this setting; do not make every shot frantic.`);
    out.push('  Keep subtle micro-jitter from breathing during pauses. Use only movement justified by the story beat; do not invent a chase.');
    if (p.rig === 'goproChest') out.push('  Tilts and turns follow the torso: bend to see hands or legs, straighten to see the horizon. Head turns alone do not rotate a chest-mounted camera.');
  } else {
    out.push(`  Movement: ${MOVE_WORDS[p.bodyMovement]}, with ${STAB_WORDS[p.stabilization]}.`);
  }
  out.push(`  ${!p.motionBlur || p.motionBlur === 'auto' ? 'Realistic motion blur, and ' : ''}${FRAMING_WORDS[p.framing]}.`);
  out.push(...actionCameraLookLines(p));

  /* The equipment, only when it was asked for. Otherwise the body sells the
     mount, which is what a body-mounted camera actually looks like. */
  if (p.showCameraMount) {
    out.push('  Part of the rig is visible at the frame edge — a strap, a harness rim,');
    out.push('  the housing edge across the bottom. Say which, in every prompt.');
  }

  /* Reframing, said as a question of WHO moved rather than a ban on movement.
     "No pan, tilt or zoom is ever chosen" reads as "the frame never turns",
     and a first-person piece is made of the frame turning. */
  out.push('  All reframing comes from the protagonist\'s body or head, never from a');
  out.push('  camera operator. Natural head turns, looking up and down, torso rotation,');
  out.push('  dropping as they crouch and pitching as they climb are all expected and');
  out.push('  wanted. What must never appear is a DELIBERATE cinematic move: a composed');
  out.push('  pan, a smooth tilt, a zoom, a dolly, a crane, a drone, or a camera that');
  out.push('  floats free of a body.');
  if (first) {
    out.push('  No third-person cutaway of the protagonist at any point.');
  }

  const silent = povIsSilent(p);
  out.push(`  ${cap(AWARE_WORDS[p.awareness])}. ${cap(DIST_WORDS[p.interactionDistance])}.`);
  if (silent) {
    out.push('  They do all of that WITHOUT SPEAKING — a look, a gesture, a held-out');
    out.push('  object, a hand on the arm. Never a spoken line toward the lens.');
  }
  out.push('  Foreground objects, arms and passing bodies may briefly obscure the frame.');
  out.push('');

  out.push('ACTION — what the shots are made of.');
  out.push('  Keep each physical action simple enough to read in one shot. Favour tactile');
  out.push('  work: carrying, tying, cutting, touching, climbing, eating, hiding, tracking,');
  out.push('  building, inspecting.');
  out.push(`  HOW MUCH FITS IN ONE CLIP, by its length — this is the most common way these`);
  out.push('  prompts go wrong. Stacking six actions into six seconds produces a clip that');
  out.push('  does none of them legibly:');
  for (const d of ['4s', '6s', '8s', '10s'] as PovDurationId[]) {
    out.push(`    ${d} — ${DENSITY_BY_DURATION[d]}`);
  }
  if (p.actionDensity === 'high') {
    out.push('  Every shot does something. No shot is only a look at scenery.');
  } else if (p.actionDensity === 'mediumHigh') {
    out.push('  Every shot does something, but one thing — not a list of things.');
  } else if (p.actionDensity === 'low') {
    out.push('  Let shots breathe; not every one needs an event in it.');
  }

  /* Variety, at the grain it actually helps. The blanket "no camera move
     appears twice" costs a POV piece its identity: walking looks like walking,
     and it should. */
  out.push('  Each shot needs a distinct physical action or story purpose. It does NOT');
  out.push('  need a different camera move, a different angle or a different distance —');
  out.push('  the POV camera is the same camera on the same body throughout, and');
  out.push('  consecutive walking shots are allowed to look like consecutive walking.');

  if (silent) {
    out.push('  NOBODY SPEAKS. No dialogue, no spoken lines, no whispering, no muttering,');
    out.push('  no voice-over inside the clip, no lines written in quotation marks.');
    out.push('  Effort sounds a body makes — breath, a grunt while lifting — are fine');
    out.push('  where they fit; words are not.');
  } else if (p.dialogueDensity === 'low') {
    out.push('  Little speech — the piece is carried by what is done, not said.');
  } else if (p.dialogueDensity === 'high') {
    out.push('  Speech is frequent and drives the beats.');
  }
  out.push('');

  out.push('SHAPE');
  out.push(`  ${cap(HOOK_WORDS[p.hookTiming])}.`);
  out.push(`  ${cap(REVEAL_WORDS[p.revealStyle])}.`);
  out.push(`  ${cap(ENDING_WORDS[p.endingStyle])}.`);

  /* Ambiguity, where the story asked for it. A cliffhanger that shows the
     creature is not a cliffhanger, and "show it before explaining it" is an
     instruction about ORDER that reads as an instruction to show everything. */
  if (p.endingStyle !== 'resolved' || p.revealStyle === 'visualBeforeExplanation') {
    out.push('  Where the story says a threat stays unseen, it stays unseen. Suggest it:');
    out.push('  faint movement, a shape that does not resolve, disturbed dark, a sound');
    out.push('  from somewhere off frame, someone else reacting to something the camera');
    out.push('  has not found yet. Do not invent an enormous silhouette, glowing eyes, a');
    out.push('  roar, or a described size. What is not shown is what the viewer stays for.');
  }

  /* Narration is written elsewhere and added after the clips exist. Saying so
     is the point: without it the model writes spoken lines into the video
     prompts, and a clip generated with a voice track cannot have one removed. */
  if (p.narrationStrategy !== 'none') {
    const person = p.narrationPerson === 'firstPerson'
      ? 'in the first person, as the protagonist remembering it'
      : p.narrationPerson === 'thirdPerson' ? 'in the third person' : '';
    out.push('  Narration is recorded separately and laid over the finished clips'
      + `${person ? `, ${person}` : ''}. Do NOT write narration, voice-over or spoken`);
    out.push('  commentary into any shot prompt. The clips carry their own environmental');
    out.push('  sound and nothing else.');
  }
  out.push('');

  /* ── Active POV participation ──────────────────────────────────────────
     The default failure this fixes: the protagonist is a passive camera —
     family always far ahead, others perform every action, POV only watches.
     'active' says the protagonist is a member of the group rather than a
     follower. */
  if (p.povParticipation !== 'passive') {
    out.push('POV PARTICIPATION — the protagonist is a member of the group.');
    if (p.povParticipation === 'active') {
      out.push('  The person carrying the camera is IN the group, not behind it.');
      out.push('  They walk beside family members, stand among them, crouch next to');
      out.push('  them, help carry something, tie or cut something, touch rock, mud,');
      out.push('  trees, tracks, push branches aside, help a child cross an obstacle,');
      out.push('  brace an older person, receive or hand an object, scout beside another');
      out.push('  character, protect the group with a weapon, physically react to danger.');
      out.push('  For an 8-shot episode, aim for explicit physical POV participation in');
      out.push('  at least 5–6 shots. Do not mechanically insert an action into every');
      out.push('  shot if it harms the story — but the default is participation, not');
      out.push('  observation.');
    } else {
      out.push('  The protagonist participates when the story calls for it.');
    }
    out.push('');
  }

  /* ── Group staging ────────────────────────────────────────────────────
     Intimate diary grammar: hands close to lens, companion one arm's length
     away, partial bodies crossing frame edge. */
  if (p.groupStaging === 'embedded') {
    out.push('GROUP STAGING — embedded, not distant.');
    out.push('  Default composition should favour:');
    out.push('    · hands working close to lens');
    out.push('    · people one arm\'s length away');
    out.push('    · a companion stepping close enough to briefly block part of the frame');
    out.push('    · crouching beside someone to inspect something together');
    out.push('    · bodies entering and leaving the frame edge naturally');
    out.push('  Do not default to the family far ahead walking away from the camera.');
    out.push('  Do not line up the group facing the lens at equal distances.');
    out.push('');
  }

  /* ── Animal realism ───────────────────────────────────────────────────
     The default failure without this: a brown bear becomes a "hulking apex
     monster with glowing eyes" and the survival encounter turns into fantasy. */
  if (p.animalStyle === 'naturalRealism') {
    out.push('ANIMAL REALISM — when a real animal appears.');
    out.push('  Do not escalate to monstrous, gigantic, colossal, hulking, glowing-eyed,');
    out.push('  supernatural or apex-horror unless the brief explicitly asks for fantasy.');
    out.push('  For a real animal — a bear, a wolf, a boar — describe:');
    out.push('    · realistic anatomy and proportions');
    out.push('    · natural fur, hide, feather texture');
    out.push('    · believable scale relative to a human');
    out.push('    · natural quadruped motion and weight');
    out.push('    · partly obscured by shadow, foliage or terrain where appropriate');
    out.push('  A survival encounter is tense because the animal is REAL, not because');
    out.push('  it is a monster.');
    out.push('');

    /* ── Fight / danger choreography ────────────────────────────────── */
    out.push('FIGHT CHOREOGRAPHY — one readable action at a time.');
    out.push('  Do not default to chaotic multi-body melee, several attacks in one');
    out.push('  short clip, or three people stabbing simultaneously.');
    out.push('  For an 8-second fight shot:');
    out.push('    one attack or action → one reaction or handoff.');
    out.push('  Example: bear lunges → hunter backs away and raises spear.');
    out.push('  Next clip: hunter makes one defensive jab → bear recoils.');
    out.push('  This improves anatomy, character consistency, spatial readability');
    out.push('  and prop consistency.');
    out.push('');
  }

  return out;
}

/**
 * How a shot that inherits a last frame has to open.
 *
 * The repair loop's own failure mode, answered where the writer will read it.
 * A continuation was being rejected for "opening as though the scene were
 * starting" and the writer could not tell which words did it — so it rewrote
 * the action, which was never the problem, three times.
 *
 * Giving it the SHAPE of a correct opening is cheaper than giving it a list
 * of forbidden phrasings, because the shape is what the frame actually needs:
 * the inherited state first, then what happens next out of it.
 */
export function povContinuationLines(p: PovSettings | undefined): string[] {
  if (!p) return [];
  return [
    'A SHOT THAT INHERITS A FRAME — how it has to open.',
    '  Distinguish a newly generated opening still from a previous video\'s last frame.',
    '  A new still fixes the opening composition; it does not prove motion is already underway.',
    '  A shot handed the last frame of the one before it opens on that exact',
    '  moment. Name the inherited state FIRST, in the same',
    '  words the shot before it closed on, and only then say what happens next:',
    '',
    '  State the actual visible posture, grip and unfinished action directly.',
    '  For example: "Left fingers still pin the loose knot; the right hand pulls it tight."',
    '',
    '  Continuity comes from matching the actual state, not a stock introductory phrase.',
    '  An opening that begins with the camera doing something — "the camera',
    '  begins", "the camera now", "the scene opens", "the camera turns to" —',
    '  reads as a fresh take unless the inherited state has been stated first.',
    '',
  ];
}

/**
 * The continuity anchors a POV piece has to repeat, as brief lines.
 *
 * Separate from povBriefLines because it answers a different question: that
 * one says how to shoot, this one says what must not change between shots.
 * A generator sees one prompt at a time, so an anchor stated once is an anchor
 * that holds for one shot.
 */
export function povContinuityLines(p: PovSettings | undefined): string[] {
  if (!p || p.continuity === 'normal') return [];
  const strict = p.continuity === 'strict';
  const out: string[] = [];
  out.push('CONTINUITY ANCHORS — carry these into every prompt that follows.');
  out.push('  Repeat the relevant visible anchors, not the entire cast biography. An offscreen trait does not need to be rendered.');
  out.push(strict
    ? '  Repeat them WORD FOR WORD. Rewording them is how a character drifts.'
    : '  Repeat them in every prompt rather than assuming the last shot is remembered.');
  out.push('    · the same recurring cast, with the same faces and the same hair');
  out.push('    · the same clothing on every person, shot to shot');
  if (p.perspective === 'firstPerson') {
    out.push('    · the same hands, forearms and sleeves on the camera\'s owner');
  }
  if (p.showForegroundProp) {
    /* Identity, not posture. The first version said "carried the same way",
       which forbids a spear being braced against rock on a climb, lowered to
       touch something, or raised at a threat — every one of which the story
       asks for. */
    out.push('    · the same primary prop or weapon: the same object, the same wood,');
    out.push('      the same wear. Its grip and angle may change with the action —');
    out.push('      braced, lowered, raised, carried one-handed — and should.');
  }
  out.push('    · the same weather and the same light');
  out.push('    · the state the location was left in by the shot before');
  /* Direction, as a default rather than a lock. A journey that never turns is
     not a journey, and the story turns on purpose: uphill, into a cave, back
     toward a noise. */
  out.push('    · the same direction of travel, unless the story turns, climbs,');
  out.push('      descends, enters somewhere, changes path or reacts to something —');
  out.push('      then the turn itself is described and the new direction holds');
  out.push('    · the state every object was left in — nothing silently repaired,');
  out.push('      moved, cleaned or replaced between shots');
  out.push('');
  return out;
}

/**
 * Camera progression guidance for a POV piece, as a suggestion.
 *
 * Offered, never imposed: the Director already has a cameraProgression
 * setting, and this reads as a shape the beats can take rather than a sequence
 * to apply shot by shot.
 */
export function povProgressionLines(p: PovSettings | undefined): string[] {
  if (!p || p.perspective !== 'firstPerson') return [];
  return [
    'HOW THE POV MOVES ACROSS THE PIECE — a shape, not a schedule.',
    '  A first-person piece earns its variety from what the body is doing rather',
    '  than from where a camera is placed. Reach for these as the beats call for',
    '  them, in whatever order the story wants:',
    '    · angled down at the hands, for work',
    '    · level and walking, for travel',
    '    · turning and searching, for looking for something',
    '    · close and still, for attending to someone',
    '    · pitching and unsteady, for climbing or running',
    '    · slowed and held, for a reveal',
    '    · dropping as the body crouches, for inspecting something',
    '    · down at a detail, then lifting to what it implies',
    '  Do not use all of them, and do not use them in this order unless the story',
    '  happens to go that way. Repeating one is fine when the action repeats.',
    '',
  ];
}

/**
 * The two kinds of visual anchor a multi-shot POV piece wants, and why they
 * are not the same thing.
 *
 * Advice to whoever is BUILDING the workflow, not to the writer — so it names
 * nodes rather than prompt language, and says plainly that one does not
 * replace the other.
 */
export function povAnchorLines(p: PovSettings | undefined, clipCount = 0): string[] {
  if (!p || clipCount < 3) return [];
  const cols = clipCount > 6 ? 4 : 3;
  const rows = Math.ceil(clipCount / cols);
  return [
    'VISUAL ANCHORS — two different jobs, both worth having.',
    `  IDENTITY AND STYLE: one image holding all ${clipCount} moments as panels on a`,
    `  single canvas — a ${cols}x${rows} board — or one shared reference still of the cast,`,
    '  their clothing and the protagonist\'s own hands, forearms and prop. Because the',
    '  panels share one canvas, the faces, the palette and the weather are composed',
    '  together, which is what holds them across every clip made from the board.',
    '  MOMENT TO MOMENT: the Last Frame chain between consecutive clips.',
    '  One does not replace the other. The board keeps them the same PEOPLE in the',
    '  same WORLD; the last frame keeps each clip continuing the one before it.',
    '  Flow takes at most five reference images on a generation, so a board plus a',
    '  handed-on frame is a working budget and a board per clip is not.',
    '',
  ];
}

/**
 * POV-specific storyboard composition rules.
 *
 * A storyboard for a first-person piece needs to show the POV participating,
 * not just observing. Without this, every panel comes back as five people
 * standing front-facing at equal distances from a floating camera, and the
 * video prompts derived from it repeat the same composition eight times.
 */
export function povSheetGuidance(p: PovSettings | undefined): string[] {
  if (!p || p.perspective !== 'firstPerson') return [];
  const out: string[] = [];
  out.push('POV STORYBOARD COMPOSITION — how the panels should look.');
  out.push('  Each panel shows a moment from the protagonist\'s viewpoint.');
  out.push('  DO:');
  out.push('    · foreground hands holding or working with something');
  out.push('    · a companion close enough to touch — one arm\'s length');
  out.push('    · the POV crouching beside someone to inspect something');
  out.push('    · a helping action — carrying, bracing, handing');
  out.push('    · partial bodies crossing the panel edge naturally');
  out.push('    · the environment seen through the activity, not as scenery alone');
  out.push('    · natural variation in group spacing between panels');
  if (p.showForegroundProp) {
    out.push('    · the primary prop or weapon visible in the protagonist\'s hands');
  }
  out.push('  AVOID:');
  out.push('    · all characters standing front-facing at equal distances');
  out.push('    · a family lineup');
  out.push('    · everyone walking away from the camera');
  out.push('    · repetitive wide shots with the group as small figures');
  out.push('    · passive scenery-only panels');
  out.push('  No dialogue captions inside panels — no text such as');
  out.push('  "Keep moving", "Stay back", "Too wet" written into the image.');
  out.push('  Panel numbers (1–8) are allowed; decorative text is not.');
  out.push('');
  return out;
}
