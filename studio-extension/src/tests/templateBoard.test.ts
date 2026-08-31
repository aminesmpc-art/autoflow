/**
 * A template that says "board" must produce a board.
 *
 * Three times in one sitting, a field was added to a type, accepted by the
 * compiler, and silently dropped by the thing that builds the node:
 *
 *   readStorySettings   dropped five settings the user had chosen
 *   compilePlan         had no `preset` field at all, so every Ask AI preset
 *                       was unreachable from a built workflow
 *   genNode             builds `data` field by field rather than spreading, so
 *                       adding storyboardSheet to GenOpts made it typecheck
 *                       and changed nothing — the template said board, the
 *                       node data did not, and orderShotTargets reads the node
 *
 * Each looks fine at every point a person would check. The only thing that
 * catches them is asking the far end what it actually received, which is what
 * this file does: not "is the flag in GenOpts" but "does the director see a
 * sheet".
 */

import { BUILTIN_TEMPLATES } from '../studio/templates/index';
import { orderShotTargets, panelsFor, gridFor } from '../studio/ask/storyboard';
import { readStorySettings } from '../studio/ask/storyPlan';
import { checkPlan } from '../studio/builder/check';

const byId = (id: string) => (BUILTIN_TEMPLATES as any[]).find((t) => t.id === id);

/** Every shipped template that marks one of its stills as the board. */
const withBoards = (BUILTIN_TEMPLATES as any[]).filter(
  (t) => (t.nodes || []).some((n: any) => n.data?.storyboardSheet === true),
);

describe('the flag survives the trip from template to director', () => {
  it('there is at least one board to check', () => {
    expect(withBoards.length).toBeGreaterThan(0);
  });

  it.each(withBoards.map((t) => [t.id, t]))('%s reaches the director as a sheet', (_id, t: any) => {
    const story = (t.nodes as any[]).find((n) => n.type === 'story');
    expect(story).toBeDefined();
    const targets = orderShotTargets(story.id, t.nodes, t.edges);
    const sheets = targets.filter((x: any) => x.isSheet);
    expect(sheets.length).toBeGreaterThan(0);
  });

  it.each(withBoards.map((t) => [t.id, t]))('%s marks the board on a still, never a clip', (_id, t: any) => {
    for (const n of t.nodes as any[]) {
      if (n.data?.storyboardSheet) expect(n.data.mediaType).not.toBe('video');
    }
  });
});

describe('the ten-beat short, rebuilt around a director', () => {
  const t = byId('tpl_emotional_short');
  const targets = () => orderShotTargets('director', t.nodes, t.edges);

  it('has one writer instead of ten blind prompt nodes', () => {
    /* It was ten hand-written prompts, each unaware of the other nine — so
       nothing knew that beat 4 had already turned the bakery light off. */
    expect((t.nodes as any[]).filter((n) => n.type === 'story')).toHaveLength(1);
    expect((t.nodes as any[]).filter((n) => n.type === 'prompt')).toHaveLength(1);
  });

  it('still writes all ten beats', () => {
    expect(targets().filter((x: any) => x.media === 'video')).toHaveLength(10);
  });

  it('keeps the authored beats, as a brief rather than as finished prompts', () => {
    /* The beats are why this template is worth shipping. Handing the director
       a logline and letting it invent them would be a worse template that
       happened to use a nicer mechanism. */
    const brief = (t.nodes as any[]).find((n) => n.id === 'p_idea').data.text as string;
    expect(brief).toMatch(/Hook — Something Is Wrong/);
    expect(brief).toMatch(/Resolution — Echo the Opening/);
    expect(brief.length).toBeGreaterThan(2000);
  });

  it('plans all ten on one board', () => {
    expect(panelsFor(targets())).toBe(10);
    expect(gridFor(panelsFor(targets()))).toBe('5x2');
  });

  it('gives every clip both the face and the plan', () => {
    const refs = (id: string) => (t.edges as any[]).filter(
      (e) => e.target === id && e.targetHandle === 'image_ref',
    ).length;
    for (const clip of targets().filter((x: any) => x.media === 'video')) {
      expect(refs((clip as any).id)).toBe(2);
      expect(refs((clip as any).id)).toBeLessThanOrEqual(5);   // Flow's ceiling
    }
  });

  it('leaves colorTemp unset, on purpose', () => {
    /* Every other multi-shot piece wants one white balance for the whole film.
       This one is built on a colour ARC — cold blue-grey through the tense
       half, warming to gold from the turn — and pinning a single Kelvin value
       would flatten the thing the format lives on. The arc lives in the brief,
       where it can change. */
    const s = readStorySettings((t.nodes as any[]).find((n) => n.id === 'director').data);
    expect(s.colorTemp).toBe('none');
    const brief = (t.nodes as any[]).find((n) => n.id === 'p_idea').data.text as string;
    expect(brief).toMatch(/colour arc does real work/i);
  });

  it('carries the settings the director actually reads', () => {
    const s = readStorySettings((t.nodes as any[]).find((n) => n.id === 'director').data);
    expect(s.visualPreset).toBe('cgi3d');
    expect(s.audioMode).toBe('ambient');       // the style rules out dialogue
    expect(s.rules).toContain('samePerson');
    expect(s.beats).toBe(10);
  });

  it('counts its own nodes correctly', () => {
    /* The gallery card prints this number. */
    expect(t.nodeCount).toBe((t.nodes as any[]).length);
  });
});

describe('a shared anchor is continuity', () => {
  const clip = (id: string, inputs: string[]) => ({
    id, type: 'generate', media: 'video', platform: 'flow', prompt: 'she walks', inputs,
  });
  const plan = (steps: any[]) => ({ name: 't', steps });

  const director = { id: 'd', type: 'story', platform: 'gemini', prompt: 'a short' };
  const anchor = { id: 'ref', type: 'image', media: 'image', platform: 'flow', prompt: 'a sheet' };

  it('accepts every clip drawing on the same still', () => {
    /* A frame chain carries a drifted face forward into every shot after it.
       A shared reference cannot, because each clip is measured against the
       original rather than against its predecessor — which is why a piece made
       of separate moments should use one, and why the rule flagging it was
       wrong. It fired on tpl_emotional_short, a workflow that ships. */
    const problems = checkPlan(plan([
      director, anchor,
      clip('a', ['d', 'ref']), clip('b', ['d', 'ref']), clip('c', ['d', 'ref']),
    ]));
    expect(problems.map((p: any) => p.code)).not.toContain('noContinuity');
  });

  it('still complains when the clips share nothing', () => {
    const problems = checkPlan(plan([
      director, anchor,
      clip('a', ['d', 'ref']), clip('b', ['d']), clip('c', ['d']),
    ]));
    expect(problems.map((p: any) => p.code)).toContain('noContinuity');
  });

  it('does not count the director itself as an anchor', () => {
    /* Every clip takes the director's text. If that counted, the rule could
       never fire on a directed workflow at all. */
    const problems = checkPlan(plan([
      director, clip('a', ['d']), clip('b', ['d']), clip('c', ['d']),
    ]));
    expect(problems.map((p: any) => p.code)).toContain('noContinuity');
  });
});
