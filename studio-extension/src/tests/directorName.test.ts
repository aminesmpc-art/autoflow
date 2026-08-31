/**
 * The node is called Director.
 *
 * Every instance in the shipped templates was already labelled one — "Story
 * Director", "Comedy Director", "GameCourt 2 Director" — while the toolbar
 * button said "Story". The node directs a whole piece; a story is only one of
 * the things it can write.
 *
 * The LABEL changed and the stored type did not. `type: 'story'` is held by
 * every saved workflow, all 26 bundled templates, the 24 live on the server
 * and the builder's plan format, so renaming it would be a migration rather
 * than a rename. These tests pin both halves: the new name where a person
 * reads it, and the old string everywhere something is stored.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { getNodeDoc } from '../studio/nodes/nodeInfo';
import { BUILTIN_TEMPLATES } from '../studio/templates/index';
import { buildSpec } from '../studio/builder/spec';
import { compilePlan } from '../studio/builder/plan';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const CANVAS = read('studio', 'components', 'Canvas.tsx');
const NODE = read('studio', 'nodes', 'StoryNode.tsx');

describe('what a person reads', () => {
  it('labels the toolbar button Director', () => {
    expect(CANVAS).toMatch(/<span className="studio-toolbar__btn-label">Director<\/span>/);
    expect(CANVAS).not.toMatch(/btn-label">Story</);
  });

  it('names it Director for a screen reader too', () => {
    expect(CANVAS).toMatch(/aria-label="Add Director node"/);
  });

  it('names a newly added one Director 1, not Story 1', () => {
    expect(CANVAS).toMatch(/label: `Director \$\{nodes\.filter/);
  });

  it('titles the info card Director', () => {
    expect(getNodeDoc('story')?.title).toBe('Director');
  });

  it('defaults the name field to Director', () => {
    expect(NODE).toMatch(/value=\{d\.label \|\| 'Director'\}/);
    expect(NODE).toMatch(/placeholder="Director"/);
  });
});

describe('what is stored did not move', () => {
  it('still registers under the type saved workflows hold', () => {
    /* Renaming this would need a migration in normalizeWorkflow, plus the plan
       format, NODE_PORTS, nine checks, 26 bundled templates and the 24 already
       published. The label was the ask; this is the line that keeps every
       existing workflow opening. */
    expect(CANVAS).toMatch(/story: guarded\(StoryNode, 'Director'\)/);
    expect(CANVAS).toMatch(/type: 'story',/);
  });

  it('leaves every shipped template on the old type', () => {
    const stories = (BUILTIN_TEMPLATES as any[])
      .flatMap((t) => t.nodes || [])
      .filter((n: any) => n.data?.type === 'story' || n.type === 'story');
    expect(stories.length).toBeGreaterThan(0);
    for (const n of stories) expect(n.type).toBe('story');
  });

  it('still finds the doc by the stored type', () => {
    /* getNodeDoc is called with node.type. Renaming the KEY rather than the
       title would have silently dropped the info card. */
    expect(getNodeDoc('story')).not.toBeNull();
    expect(getNodeDoc('director')).toBeNull();
  });
});

describe('the builder speaks the same language', () => {
  const SPEC = buildSpec('a shoe ad');

  it('calls it the Director where the model reads it', () => {
    /* A person asking the builder for "a director" has to land on this node.
       The manual said STORY DIRECTOR in one place, "story node" in another and
       "story director" in a third — three names for one thing, none of them
       the one now on the button. */
    expect(SPEC).toMatch(/THE DIRECTOR \(ONE WRITER FOR ALL SHOTS\)/);
    expect(SPEC).not.toMatch(/Connect one story node/);
  });

  it('says the type string did NOT change', () => {
    /* The dangerous half. Renaming the vocabulary without this invites a model
       to emit "type": "director", which compiles to nothing. */
    expect(SPEC).toMatch(/The type string stays\s*\n?\s*"story"/);
    expect(SPEC).toMatch(/write\s*\n?\s*"type": "story" even though the node is named Director/);
  });

  it('labels a built one Director, like a hand-added one', () => {
    const { template } = compilePlan({
      name: 't',
      steps: [{ id: 's', type: 'story', platform: 'gemini', prompt: 'a shoe ad' }],
    } as any);
    const node = (template?.nodes || []).find((n: any) => n.id === 's');
    expect(node?.data?.label).toBe('Director');
    /* And still the type every saved workflow holds. */
    expect(node?.type).toBe('story');
  });
});
