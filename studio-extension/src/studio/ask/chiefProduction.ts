import { dialogueBudget, readJsonObject } from './storyboard';
import type { ChiefDirector } from './chief';

export interface SceneContract {
  targetId: string;
  opening: string;
  action: string;
  ending: string;
  voiceover: string;
  continuesFrom: string | null;
}

export interface ProductionCheckpoint {
  version: 1;
  key: string;
  reply: string;
  prompts: Record<string, string[]>;
  approved: boolean;
}

export function readContracts(reply: string, directors: ChiefDirector[]): SceneContract[] {
  const raw = readJsonObject(reply);
  if (!Array.isArray(raw?.contracts)) throw new Error('Missing scene contracts.');
  const targets = new Map(directors.flatMap(d => d.targets.map(t => [t.id, t] as const)));
  const seen = new Map<string, SceneContract>();
  for (const row of raw.contracts) {
    if (!row || !targets.has(row.targetId) || seen.has(row.targetId)) {
      throw new Error('Scene contracts contain an unknown or duplicate target ID.');
    }
    for (const field of ['opening', 'action', 'ending']) {
      if (typeof row[field] !== 'string' || !row[field].trim()) {
        throw new Error(`Contract ${row.targetId} needs ${field}.`);
      }
    }
    if (typeof row.voiceover !== 'string') throw new Error('Every contract needs voiceover (empty for silence).');
    const target = targets.get(row.targetId)!;
    if (target.media !== 'video' && row.voiceover.trim()) throw new Error('Still contracts must be silent.');
    if (target.media === 'video' && row.voiceover.trim().split(/\s+/).filter(Boolean).length > dialogueBudget(target.duration)) {
      throw new Error(`Voiceover for ${row.targetId} exceeds its clip duration.`);
    }
    if (row.continuesFrom !== null && (typeof row.continuesFrom !== 'string' || !row.continuesFrom.trim())) {
      throw new Error('continuesFrom must be a target ID or null.');
    }
    seen.set(row.targetId, row as SceneContract);
  }
  if (seen.size !== targets.size) throw new Error('A contract is required for every connected target.');
  for (const row of seen.values()) {
    if (!row.continuesFrom) continue;
    const previous = seen.get(row.continuesFrom);
    if (!previous || previous.targetId === row.targetId) throw new Error('Invalid continuity predecessor.');
    if (previous.ending.trim() !== row.opening.trim()) {
      throw new Error(`State handoff differs between ${previous.targetId} and ${row.targetId}.`);
    }
    const visited = new Set([row.targetId]);
    let current: SceneContract | undefined = previous;
    while (current) {
      if (visited.has(current.targetId)) throw new Error('Scene continuity contains a cycle.');
      visited.add(current.targetId);
      current = current.continuesFrom ? seen.get(current.continuesFrom) : undefined;
    }
  }
  return Array.from(seen.values());
}

export function contractAsk(): string {
  return '\nAlso include "contracts": an array with EXACTLY one object per listed target ID: '
    + '{"targetId":"id","opening":"exact starting state","action":"one bounded action",'
    + '"ending":"exact ending state","voiceover":"exact spoken words or empty",'
    + '"continuesFrom":null}. Use continuesFrom for narrative continuity only; copy the '
    + 'predecessor ending verbatim into opening. Stills and boards are silent. Reference '
    + 'boards are planning assets, not preceding scenes. Respect each clip voice budget '
    + '(about two words per second). Preserve the requested scene count and dialogue.';
}

export function reviewAsk(reply: string, directors: ChiefDirector[], prompts: Record<string, string[]>): string {
  return 'Review ALL Director prompts against the shared bible and scene contracts. '
    + 'Check identities, room assignments, starting/ending states, scene coverage and exact voiceover. '
    + 'Return ONLY {"approved":true,"issues":[]} or {"approved":false,"issues":'
    + '[{"targetId":"exact target ID","problem":"specific conflict"}]}. Do not rewrite prompts.\n'
    + JSON.stringify({ plan: readJsonObject(reply), groups: directors.map(d => ({
      directorId: d.id, targets: d.targets.map((t, i) => ({ ...t, prompt: prompts[d.id]?.[i] })),
    })) });
}

/**
 * The same review, asked of a Chief that still remembers writing the plan.
 *
 * reviewAsk above carries `plan: readJsonObject(reply)` — the entire bible,
 * cast, world and every scene contract — because it was always asked in a
 * chat that had never seen any of it. Each review round opened a new one, so
 * a three-round review sent the whole production three times and the Chief
 * read its own work back as though a stranger had written it.
 *
 * When the thread is still open, none of that needs saying. What is new since
 * the last turn is the prompts the Directors returned, so that is what is
 * sent. The answer contract is repeated because it governs THIS turn's reply,
 * and a model that has written prose in between will otherwise drift back to
 * it.
 */
export function reviewFollowUp(directors: ChiefDirector[], prompts: Record<string, string[]>): string {
  return 'The Directors have written their prompts from the plan you just made. '
    + 'Review them against that plan — identities, room assignments, '
    + 'starting/ending states, scene coverage and exact voiceover. '
    + 'Return ONLY {"approved":true,"issues":[]} or {"approved":false,"issues":'
    + '[{"targetId":"exact target ID","problem":"specific conflict"}]}. Do not rewrite prompts.\n'
    + JSON.stringify({ groups: directors.map(d => ({
      directorId: d.id, targets: d.targets.map((t, i) => ({ ...t, prompt: prompts[d.id]?.[i] })),
    })) });
}

export function readReview(reply: string, directors: ChiefDirector[]): Array<{targetId: string; problem: string}> {
  const raw = readJsonObject(reply);
  const ids = new Set(directors.flatMap(d => d.targets.map(t => t.id)));
  if (typeof raw?.approved !== 'boolean' || !Array.isArray(raw.issues)) throw new Error('Malformed Chief review.');
  if (raw.issues.some((i: any) => !ids.has(i?.targetId) || typeof i.problem !== 'string' || !i.problem.trim())) {
    throw new Error('Chief review must identify existing targets and specific problems.');
  }
  if (raw.approved !== (raw.issues.length === 0)) throw new Error('Chief review approval contradicts its issues.');
  return raw.issues;
}
