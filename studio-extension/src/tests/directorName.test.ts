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
