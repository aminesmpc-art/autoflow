/* ============================================================
   Templates are data, and data has no compiler.

   A template with an edge pointing at a node that isn't there, or wired to a
   port that node doesn't expose, type-checks perfectly and then renders as a
   canvas with a missing connection. Nothing throws; the run just skips the
   reference and produces a subtly wrong result. These tests are the only
   thing standing between a typo in a node id and a broken template on a
   user's canvas.

   The handle map below mirrors the Handle ids declared in src/studio/nodes/.
   If a node gains or renames a port, this map has to move with it — that is
   the point: the failure shows up here rather than as a dead wire.
   ============================================================ */

/// <reference types="node" />
import { existsSync } from 'fs';
import { join } from 'path';

import { TEMPLATES } from '../studio/templates';

/** Ports each node type actually renders, keyed by node type. */
const PORTS: Record<string, { in: string[]; out: string[] }> = {
  prompt: { in: [], out: ['text'] },
  image: { in: [], out: ['image'] },
  frame: { in: ['image_ref'], out: ['image'] },
  // A generate node's ports depend on what it makes: a prompt writer emits
  // text, everything else emits a result. Both take reference images.
  generate: { in: ['text', 'image_ref'], out: ['result'] },
  'generate:text': { in: ['text', 'image_ref'], out: ['text'] },
  // An agent wires exactly where an Ask AI node does — a goal in, its final
  // answer out — so it can be swapped for one without redrawing anything.
  agent: { in: ['text'], out: ['text'] },
  /* A Story node: the idea in, prompts out to every node it writes for. No
     image_ref — it plans the words, and the references belong to the nodes
     that generate. This map is a deliberate second copy of the one in
     validate.ts: a test that imported the implementation's map would agree
     with it by construction and prove nothing. */
  story: { in: ['text'], out: ['text'] },
};

const portsFor = (node: any) => {
  const key = node.type === 'generate' && node.data?.mediaType === 'text'
    ? 'generate:text'
    : node.type;
  return PORTS[key];
};

describe.each(TEMPLATES.map((t) => [t.name, t] as const))('%s', (_name, tpl) => {
  const byId = new Map(tpl.nodes.map((n) => [n.id, n]));

  it('declares the number of nodes it actually has', () => {
    // The card shows this number before the user commits to loading it.
    expect(tpl.nodeCount).toBe(tpl.nodes.length);
  });

  it('has unique node and edge ids', () => {
    expect(byId.size).toBe(tpl.nodes.length);
    const edgeIds = new Set(tpl.edges.map((e) => e.id));
    expect(edgeIds.size).toBe(tpl.edges.length);
  });

  it('knows every node type it uses', () => {
    for (const node of tpl.nodes) {
      expect(portsFor(node)).toBeDefined();
    }
  });

  it('connects edges to nodes that exist, on ports they expose', () => {
    for (const edge of tpl.edges) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      expect(`${edge.id} source ${edge.source}`).toBe(
        source ? `${edge.id} source ${edge.source}` : 'a node in this template');
      expect(`${edge.id} target ${edge.target}`).toBe(
        target ? `${edge.id} target ${edge.target}` : 'a node in this template');

      // Wrong handle = an edge React Flow drops on render. Silent, and the
      // node downstream then generates with no reference at all.
      expect({ edge: edge.id, port: edge.sourceHandle })
        .toEqual({ edge: edge.id, port: expect.stringMatching(
          new RegExp(`^(${portsFor(source).out.join('|')})$`)) });
      expect({ edge: edge.id, port: edge.targetHandle })
        .toEqual({ edge: edge.id, port: expect.stringMatching(
          new RegExp(`^(${portsFor(target).in.join('|')})$`)) });
    }
  });

  it('leaves no node stacked exactly on another', () => {
    const seen = new Set<string>();
    for (const n of tpl.nodes) {
      const at = `${n.position.x},${n.position.y}`;
      expect({ node: n.id, at, alreadyTaken: seen.has(at) })
        .toEqual({ node: n.id, at, alreadyTaken: false });
      seen.add(at);
    }
  });

  it('feeds every generate node a prompt', () => {
    // A generate node with no text input runs with an empty prompt box, which
    // fails at Flow rather than here — worth catching while it is still data.
    const hasText = new Set(
      tpl.edges.filter((e) => e.targetHandle === 'text').map((e) => e.target));
    for (const n of tpl.nodes.filter((n) => n.type === 'generate')) {
      expect({ node: n.id, hasPrompt: hasText.has(n.id) })
        .toEqual({ node: n.id, hasPrompt: true });
    }
  });

  it('addresses only the model in its prompt text', () => {
    /* A prompt has one reader, and it is not the user. The car template
       carried "↑ Change this line to any car" as a hint for whoever opened
       it; ChatGPT could not tell it was not being spoken to, and asked for a
       BMW M3 E46 it duly changed the line to any car and returned a Nissan
       Skyline R34. Editing hints belong in node labels, which are shown on
       the canvas and sent nowhere. */
    for (const n of tpl.nodes.filter((n) => n.type === 'prompt')) {
      const text: string = (n.data as any).text || '';
      const aimedAtTheUser = /(change|edit|replace|swap) (this|the) (line|text)|↑ ?change|paste your|type your/i.test(text);
      expect({ node: n.id, aimedAtTheUser }).toEqual({ node: n.id, aimedAtTheUser: false });
    }
  });

  it('gives every Last Frame node a clip to take a frame from', () => {
    for (const n of tpl.nodes.filter((n) => n.type === 'frame')) {
      const incoming = tpl.edges.filter((e) => e.target === n.id);
      // Exactly one: a frame node shows *the* last frame, and two upstream
      // clips would make which one it shows a race.
      expect({ node: n.id, upstream: incoming.length }).toEqual({ node: n.id, upstream: 1 });
      const from = byId.get(incoming[0].source);
      expect({ node: n.id, sourceType: from?.type }).toEqual({ node: n.id, sourceType: 'generate' });
      expect({ node: n.id, media: (from?.data as any)?.mediaType })
        .toEqual({ node: n.id, media: 'video' });
    }
  });
});

/* Card artwork fails silently in both directions: a missing file falls back to
   the emoji, and the copy plugin runs with noErrorOnMissing so the build stays
   green. Water Wipeouts shipped pointing at a file nobody had created and the
   card quietly showed 🌊 instead. */
describe('card artwork', () => {
  const withArt = TEMPLATES.filter((t) => t.thumbnailImage);

  it('points every thumbnailImage at a file that exists', () => {
    for (const tpl of withArt) {
      const path = join(__dirname, '../../', tpl.thumbnailImage!);
      expect({ template: tpl.id, art: tpl.thumbnailImage, present: existsSync(path) })
        .toEqual({ template: tpl.id, art: tpl.thumbnailImage, present: true });
    }
  });

  it('keeps artwork under assets/, which is the only folder webpack copies', () => {
    for (const tpl of withArt) {
      expect(tpl.thumbnailImage).toMatch(/^assets\//);
    }
  });
});

/* The car template's whole promise is "type a name, get a video". That rests
   on there being nothing to upload and on the carve starting from the sheet
   ChatGPT's prompt produced — both easy to undo by accident. */
describe('Miniature Car', () => {
  const tpl = TEMPLATES.find((t) => t.id === 'tpl_miniature_car')!;
  const byId = new Map(tpl.nodes.map((n) => [n.id, n]));

  it('asks the user for nothing but text', () => {
    // An image node here would be an empty upload slot the user has to fill,
    // which is the thing this template exists to remove.
    expect(tpl.nodes.filter((n) => n.type === 'image')).toHaveLength(0);
  });

  it('routes the car name through the car_sheet preset', () => {
    /* The prompt node now holds only "BMW M3 E46, 2003, Laguna Seca Blue".
       The 150 words of sheet instructions live in studio/presets, where every
       template can reach them and a bad wording is fixable without a store
       review — rather than being duplicated inline here. */
    const from = (id: string) => tpl.edges.filter((e) => e.source === id).map((e) => e.target);
    expect(from('p_car')).toEqual(['ask_sheet']);
    expect(from('ask_sheet')).toContain('g_sheet');

    const ask = byId.get('ask_sheet')!.data as any;
    expect({ media: ask.mediaType, preset: ask.preset })
      .toEqual({ media: 'text', preset: 'car_sheet' });
  });

  it('asks the user for the car and nothing more', () => {
    // The whole point of the preset: what is typed is a car, not a brief.
    const text: string = (byId.get('p_car')!.data as any).text;
    expect(text.length).toBeLessThan(80);
    expect(text).toMatch(/BMW/);
  });


  it('starts the carve from the generated sheet, not from a later clip', () => {
    const intoFirstClip = tpl.edges.filter(
      (e) => e.target === 'g_block' && e.targetHandle === 'image_ref');
    expect(intoFirstClip).toHaveLength(1);
    expect(intoFirstClip[0].source).toBe('g_sheet');
    // From a generate node the reference leaves on `result`; wiring it as
    // `image` would be a dead edge React Flow drops on render.
    expect(intoFirstClip[0].sourceHandle).toBe('result');
  });

  it('chains the four clips through three visible frames', () => {
    const count = (type: string) => tpl.nodes.filter((n) => n.type === type).length;
    // 4 carve clips + the reference sheet + the Ask AI node.
    expect({ generate: count('generate'), frames: count('frame') })
      .toEqual({ generate: 6, frames: 3 });
    // The reveal ends the chain, so it feeds no frame.
    expect(tpl.edges.some((e) => e.source === 'g_reveal' && e.targetHandle === 'image_ref'))
      .toBe(false);
  });
});

/* The styrofoam chain is the reason the frame node exists, so its shape is
   pinned rather than left to the generic rules above. */
describe('ASMR styrofoam carving', () => {
  const tpl = TEMPLATES.find((t) => t.id === 'tpl_styrofoam_asmr')!;

  it('exists', () => expect(tpl).toBeDefined());

  it('runs six clips joined by five visible handoff frames', () => {
    const count = (type: string) => tpl.nodes.filter((n) => n.type === type).length;
    expect({ clips: count('generate'), frames: count('frame'), refs: count('image') })
      .toEqual({ clips: 6, frames: 5, refs: 1 });
  });

  it('starts from the user photo and then from frames, never from raw clips', () => {
    const refEdges = tpl.edges.filter((e) => e.targetHandle === 'image_ref'
      && tpl.nodes.find((n) => n.id === e.target)?.type === 'generate');
    // One reference into each of the six clips.
    expect(refEdges).toHaveLength(6);
    const sourceTypes = refEdges.map(
      (e) => tpl.nodes.find((n) => n.id === e.source)!.type);
    expect(sourceTypes.filter((t) => t === 'image')).toHaveLength(1);
    expect(sourceTypes.filter((t) => t === 'frame')).toHaveLength(5);
    // No clip reaches straight into the next one — that was the invisible
    // handoff this template was rebuilt to get rid of.
    expect(sourceTypes).not.toContain('generate');
  });
});

/* A template ships with real prompts, not blanks — a leftover angle-bracket
   placeholder is not a compile error and not a validation error, it is just
   text that gets submitted to a model verbatim. Caught one in the dental
   still prompt, which is why this exists. */
describe('prompt text is ready to run', () => {
  const PLACEHOLDER = /<fill[^>]*>|<insert[^>]*>|\bTODO\b|\bFIXME\b|\bLOREM\b|\bXXX\b/i;

  it('ships no unfilled placeholder in any prompt node', () => {
    const offenders: string[] = [];
    for (const tpl of TEMPLATES as any[]) {
      for (const n of tpl.nodes) {
        if (typeof n.data?.text !== 'string') continue;
        const hit = n.data.text.match(PLACEHOLDER);
        if (hit) offenders.push(`${tpl.id} / ${n.id}: "${hit[0]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
