/**
 * The capability lists must describe the build they are in.
 *
 * RENDERABLE_NODE_TYPES and SUPPORTED_PLATFORMS decide which templates the
 * gallery is allowed to show. When a template needs something not on those
 * lists it is dropped with a console.info and no user-visible sign — the
 * gallery just quietly contains fewer things, which is indistinguishable from
 * "that is all there is".
 *
 * Both lists had gone stale without anyone noticing:
 *
 *   - 'agent' was missing while Canvas.tsx registered an agent node type and
 *     the rail offered an Agent button, so the agent template was invisible.
 *   - 'claude' was missing while claude-content.js shipped in the manifest,
 *     so any template naming Claude would have been invisible too.
 *
 * A capability list is a claim about other files. Nothing enforced it, so it
 * drifted twice. These tests read the other files.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { RENDERABLE_NODE_TYPES, SUPPORTED_PLATFORMS } from '../studio/templates/validate';

const ROOT = join(__dirname, '..', '..');
const canvas = () => readFileSync(join(ROOT, 'src', 'studio', 'components', 'Canvas.tsx'), 'utf8');
const manifest = () => JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

describe('the capability lists match the build', () => {
  it('claims every node type the canvas registers', () => {
    /* The nodeTypes map React Flow is handed. Anything in it can be drawn, so
       anything in it must be claimed — otherwise templates using it vanish. */
    const block = /const nodeTypes[^=]*=\s*\{([\s\S]*?)\n\}/.exec(canvas());
    expect(block).not.toBeNull();
    const registered = Array.from((block as RegExpExecArray)[1].matchAll(/^\s{2}([a-z][a-zA-Z]*)\s*:/gm))
      .map((m: RegExpMatchArray) => m[1]);

    expect(registered.length).toBeGreaterThan(3);
    const unclaimed = registered.filter((t) => !(RENDERABLE_NODE_TYPES as readonly string[]).includes(t));
    expect({ registeredButNotClaimed: unclaimed }).toEqual({ registeredButNotClaimed: [] });
  });

  it('does not claim a node type the canvas cannot draw', () => {
    const block = /const nodeTypes[^=]*=\s*\{([\s\S]*?)\n\}/.exec(canvas()) as RegExpExecArray;
    const registered = Array.from(block[1].matchAll(/^\s{2}([a-z][a-zA-Z]*)\s*:/gm))
      .map((m: RegExpMatchArray) => m[1]);
    const overclaimed = (RENDERABLE_NODE_TYPES as readonly string[]).filter((t) => !registered.includes(t));
    // The opposite failure: a template is shown, then renders as nothing.
    expect({ claimedButNotRegistered: overclaimed }).toEqual({ claimedButNotRegistered: [] });
  });

  it('claims every platform that ships a content script', () => {
    /* A platform is drivable exactly when something is injected into its site.
       "<name>-content.js" is the naming this extension uses throughout. */
    const scripts: string[] = (manifest().content_scripts || [])
      .flatMap((cs: any) => cs.js || []);
    const shipped = scripts
      .map((f) => /^([a-z]+)-content\.js$/.exec(f)?.[1])
      .filter((n): n is string => !!n);

    expect(shipped.length).toBeGreaterThan(3);
    const unclaimed = shipped.filter((p) => !(SUPPORTED_PLATFORMS as readonly string[]).includes(p));
    expect({ shippedButNotClaimed: unclaimed }).toEqual({ shippedButNotClaimed: [] });
  });

  it('does not claim a platform with no adapter in the manifest', () => {
    const scripts: string[] = (manifest().content_scripts || []).flatMap((cs: any) => cs.js || []);
    const shipped = scripts
      .map((f) => /^([a-z]+)-content\.js$/.exec(f)?.[1])
      .filter((n): n is string => !!n);
    const overclaimed = (SUPPORTED_PLATFORMS as readonly string[]).filter((p) => !shipped.includes(p));
    expect({ claimedWithNoAdapter: overclaimed }).toEqual({ claimedWithNoAdapter: [] });
  });

  it('shows every bundled template on the build that bundles it', () => {
    /* The strongest form of the rule. A template shipped inside the extension
       cannot need a capability that same extension lacks — if it does, it was
       dead weight in the bundle and nobody would ever have seen it. */
    // Required lazily: importing the gallery pulls in the whole template set.
    const { BUILTIN_TEMPLATES } = require('../studio/templates/index');
    const { capabilityGap } = require('../studio/templates/validate');
    const version = manifest().version as string;

    const hidden = (BUILTIN_TEMPLATES as any[])
      .filter((t) => !t.disabled)
      .map((t) => ({ id: t.id, gap: capabilityGap(t, { version }) }))
      .filter((r) => r.gap);

    expect(hidden).toEqual([]);
  });
});
