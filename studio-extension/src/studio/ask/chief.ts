import type { Edge, Node } from '@xyflow/react';

import { orderShotTargets, readJsonObject, type ShotTarget } from './storyboard';
import { readSettingsReply, type CastMember, type StorySettings } from './storyPlan';

export interface ChiefDirector {
  id: string;
  label: string;
  targets: ShotTarget[];
}

export interface ChiefPlan {
  story: string;
  settings: Partial<StorySettings>;
  assignments: Map<string, string>;
}

export function chiefLayoutProblem(directors: ChiefDirector[]): string | undefined {
  if (directors.length < 2 || directors.length > 3) {
    return `Director Chief needs two or three connected Directors; found ${directors.length}.`;
  }
  const empty = directors.filter((director) => director.targets.length === 0);
  if (empty.length) {
    return `Connect at least one generated target to ${empty.map((d) => `“${d.label}”`).join(', ')}.`;
  }
  return undefined;
}

export function connectedDirectors(chiefId: string, nodes: Node[], edges: Edge[]): ChiefDirector[] {
  const seen = new Set<string>();
  return edges
    .filter((edge) => edge.source === chiefId && edge.targetHandle === 'text')
    .map((edge) => nodes.find((node) => node.id === edge.target))
    .filter((node): node is Node => {
      if (!node || seen.has(node.id)) return false;
      const isDirector = node.type === 'story' || (node.data as any)?.type === 'story';
      if (isDirector) seen.add(node.id);
      return isDirector;
    })
    .sort((a, b) => ((a.position?.x || 0) - (b.position?.x || 0))
      || ((a.position?.y || 0) - (b.position?.y || 0)))
    .map((node) => ({
      id: node.id,
      label: String((node.data as any)?.label || node.id),
      targets: orderShotTargets(node.id, nodes as any, edges as any),
    }));
}

const targetLine = (target: ShotTarget): string => {
  const kind = target.media === 'video' ? 'video' : target.media === 'image' ? 'image' : 'text';
  const spec = [kind, target.duration, target.aspectRatio].filter(Boolean).join(', ');
  return `${target.label || target.id} — ${spec}`;
};

export function chiefPrompt(idea: string, directors: ChiefDirector[]): string {
  /* Numbered, because the assignments are SEQUENTIAL — each group has to begin
     where the last one ended. The order comes from where the nodes sit on the
     canvas, left to right, and listing them without saying so left the model to
     infer a sequence from the order of a list, which it may or may not read as
     one. "GROUP 2 OF 3" removes the inference. */
  const groups = directors.flatMap((director, index) => [
    `GROUP ${index + 1} OF ${directors.length}`,
    `DIRECTOR ${director.id} — ${director.label}`,
    ...(director.targets.length
      ? director.targets.map((target) => `  · ${targetLine(target)} [targetId: ${target.id}]`)
      : ['  · No generated targets are connected yet.']),
  ]);

  return [
    'You are the Director Chief. Plan one coherent production, then delegate bounded sections',
    'to the Director nodes listed below. Do NOT write final generator prompts; each child',
    'Director writes those after receiving your assignment.',
    '',
    'THE USER BRIEF',
    idea.trim(),
    '',
    'CONNECTED DIRECTORS AND THE NODES EACH ONE CONTROLS',
    ...groups,
    '',
    'Choose one immutable cast, world and visual look for the entire production. Give every',
    'child a self-contained assignment that states its narrative range, opening state, ending',
    'state, continuity inherited from earlier groups, and the exact job of every listed target.',
    'Assignments must not overlap, contradict, reset the world, rename a character, or change',
    'camera/style rules. A later group must begin from the state the previous group leaves.',
    '',
    `The groups run in this order: ${directors.map((d, i) => `${i + 1}. ${d.label}`).join('  →  ')}.`,
    'Every assignment must be different work. Two groups given the same job is the one',
    'failure this structure exists to prevent — if the brief does not divide into',
    `${directors.length} distinct sections, say so in "story" rather than repeating an assignment.`,
    '',
    'Reply with ONE JSON object only. Use every directorId exactly as written:',
    '{',
    '  "story": "one-sentence global arc",',
    '  "cast": [{ "name": "...", "look": "permanent physical identity", "role": "..." }],',
    '  "world": "immutable environment and object positions",',
    '  "look": "immutable visual language, palette and lighting",',
    '  "structure": "hook|twist|transform|buildTimelapse|craftTransform|loop|ugcAd|free",',
    '  "cameraProgression": "dynamic|establishingToClose|actionTracking|macroOrbit|mountedPOV|propped|fixed|lockedWide",',
    '  "audioMode": "cinematic|ambient|dialogue|asmrCraft|none",',
    '  "visualPreset": "liveAction|miniatureMacro|smartphonePOV|cinema35mm|cgi3d|anime|none",',
    '  "colorTemp": "daylight|tungsten|amber|moon|none",',
    '  "lighting": "hero|intimate|tension|none",',
    '  "rules": ["samePerson"],',
    '  "timedBeats": true,',
    '  "avoid": "things absent from every shot",',
    '  "directors": [',
    ...directors.map((director, index) =>
      `    { "directorId": "${director.id}", "brief": "self-contained assignment" }${
        index === directors.length - 1 ? '' : ','}`),
    '  ]',
    '}',
  ].join('\n');
}

export function chiefRepairPrompt(problem: string, directors: ChiefDirector[]): string {
  return [
    `That plan cannot be delegated: ${problem}`,
    'Send the entire corrected JSON object again. No prose and no code fence.',
    `It must contain exactly one non-empty assignment for: ${directors.map((d) => d.id).join(', ')}.`,
  ].join('\n');
}

export function parseChiefReply(
  reply: string,
  directors: ChiefDirector[],
): { plan?: ChiefPlan; problem?: string } {
  const raw = readJsonObject(reply);
  if (!raw) return { problem: 'No JSON object was found.' };

  const rows = Array.isArray(raw.directors) ? raw.directors : [];
  const assignments = new Map<string, string>();
  const expectedIds = new Set(directors.map((director) => director.id));
  for (const row of rows) {
    const directorId = typeof row?.directorId === 'string' ? row.directorId.trim() : '';
    const brief = typeof row?.brief === 'string' ? row.brief.trim() : '';
    if (!directorId || !brief) continue;
    if (!expectedIds.has(directorId)) {
      return { problem: `Unknown Director id “${directorId}”.` };
    }
    if (assignments.has(directorId)) {
      return { problem: `Duplicate assignment for Director id “${directorId}”.` };
    }
    assignments.set(directorId, brief);
  }

  /* The failure this whole node exists to prevent, which the parser could not
     see. Every id present and unique still admits the same assignment written
     three times — a model taking the cheap way out — and that gives three
     groups the same section of the story, which is worse than one Director
     doing the lot. Compared on the words, ignoring case and spacing, because a
     model repeating itself rarely repeats itself byte for byte. */
  const seenBriefs = new Map<string, string>();
  for (const [directorId, brief] of assignments) {
    const key = brief.toLowerCase().replace(/\s+/g, ' ').trim();
    const first = seenBriefs.get(key);
    if (first) {
      const a = directors.find((d) => d.id === first)?.label || first;
      const b = directors.find((d) => d.id === directorId)?.label || directorId;
      return { problem: `“${a}” and “${b}” were given the same assignment.` };
    }
    seenBriefs.set(key, directorId);
  }

  const missing = directors.filter((director) => !assignments.has(director.id));
  if (missing.length) {
    return { problem: `No usable assignment for ${missing.map((d) => `“${d.label}”`).join(', ')}.` };
  }

  const story = typeof raw.story === 'string' ? raw.story.trim() : '';
  const world = typeof raw.world === 'string' ? raw.world.trim() : '';
  const look = typeof raw.look === 'string' ? raw.look.trim() : '';
  if (!story || !world || !look) {
    return { problem: 'The global story, world and look must all be non-empty.' };
  }

  const cast: CastMember[] = Array.isArray(raw.cast)
    ? raw.cast.filter((member: any) => typeof member?.name === 'string'
      && member.name.trim() && typeof member?.look === 'string' && member.look.trim())
      .map((member: any) => ({
        name: member.name.trim(),
        look: member.look.trim(),
        ...(typeof member.role === 'string' && member.role.trim()
          ? { role: member.role.trim() }
          : {}),
        ...(typeof member.voice === 'string' && member.voice.trim()
          ? { voice: member.voice.trim() }
          : {}),
      }))
    : [];

  const settings: Partial<StorySettings> = {
    ...readSettingsReply(raw),
    cast,
    world,
    look,
  };
  if (typeof raw.beats === 'number' && raw.beats >= 0) settings.beats = raw.beats;

  const childBriefs = new Map<string, string>();
  directors.forEach((director, index) => {
    /* Where this group sits, and what it hands to and from. The assignment
       carries its own continuity, but a Director that does not know it is the
       middle of three has no way to tell a handover from an opening — and the
       one it writes will read like a beginning. */
    const before = index > 0 ? directors[index - 1].label : '';
    const after = index < directors.length - 1 ? directors[index + 1].label : '';
    childBriefs.set(director.id, [
      `GLOBAL STORY: ${story}`,
      `YOU ARE PART ${index + 1} OF ${directors.length} (${director.label}).`,
      before
        ? `“${before}” comes immediately before you. Open in the state it leaves.`
        : 'Nothing comes before you. This is where the production opens.',
      after
        ? `“${after}” follows you. End in the state it is expecting.`
        : 'Nothing follows you. This is where the production ends.',
      `YOUR ASSIGNMENT (${director.label}): ${assignments.get(director.id)}`,
      'The Director Chief has locked cast, world, look and production rules on this node.',
      'Write only for your connected targets. Preserve the opening and ending state exactly.',
    ].join('\n\n'));
  });

  return { plan: { story, settings, assignments: childBriefs } };
}
