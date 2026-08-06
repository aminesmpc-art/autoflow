/**
 * @jest-environment jsdom
 */
/* ============================================================
   Start and End frames.

   Flow's video composer has two slots, not a list:

       <div aria-haspopup="dialog">Start</div>  ⇄  <div ...>End</div>

   Given both, it interpolates between them. The engine has supported this all
   along — attachFrameImages exists — but Studio pinned creationType to
   'ingredients', so the mode was unreachable from a node.

   The design question was ordering. "Paste the images one by one and it
   follows the sorting" cannot be built on edge order: that order is invisible
   on the canvas, and it changes when a connection is remade. Swap Start and
   End and the clip runs backwards, with nothing on screen to say why. So the
   node exposes two named ports and the order is a fact about which wire went
   where.
   ============================================================ */

import {
  NODE_PORTS, portsFor, validateTemplate, retargetImagePorts, migrateFrameEdges,
} from '../studio/templates/validate';
import {
  findFrameSlots, frameSlotFilled, describeFrameSlot, findFrameSwapButton,
  findFrameSlotDialog, findAssetOptions, assetOptionId, assetOptionSelected,
  findAddToPromptButton, findUploadsTab, findFrameSlotClearButton, describeAssetDialog,
} from '../content/flow/selectors';

/** The ordering rule the runner applies. */
const orderedSources = (
  inputs: Map<string, string[]>,
  creationType: string,
  mediaType: string
): string[] => {
  const isFrames = creationType === 'frames' && mediaType === 'video';
  return isFrames
    ? [...(inputs.get('frame_start') || []), ...(inputs.get('frame_end') || [])]
    : (inputs.get('image_ref') || []);
};

describe('ports', () => {
  const gen = (data: any) => portsFor({ type: 'generate', data })!.in;

  it('gives a frames node both frame ports and no image port', () => {
    /* A swap, not an addition. image_ref here would be a socket that takes a
       wire the runner never reads. */
    expect(gen({ mediaType: 'video', creationType: 'frames' }))
      .toEqual(['text', 'frame_start', 'frame_end']);
  });

  it('gives an ingredients node the image port and no frame ports', () => {
    // Frames is a mode, not a replacement — most templates are ingredients.
    expect(gen({ mediaType: 'video', creationType: 'ingredients' }))
      .toEqual(['text', 'image_ref']);
  });

  it('does not offer frame ports on an ordinary image node', () => {
    /* The node draws its handles from portsFor. While this fell through to
       the union, every generate node on the canvas grew an S and an E that
       accepted a connection and then went nowhere. */
    expect(gen({ mediaType: 'image' })).not.toContain('frame_start');
  });

  it('does not offer frame ports on a prompt writer', () => {
    // A text answer has no first or last frame.
    expect(gen({ mediaType: 'text' })).not.toContain('frame_start');
  });

  it('keeps the union available for callers that need every port', () => {
    expect(NODE_PORTS.generate.in).toEqual(
      expect.arrayContaining(['text', 'image_ref', 'frame_start', 'frame_end'])
    );
  });
});

/* The ports the node DRAWS.
 *
 * The first release of this mode failed here and nowhere else. The runner read
 * frame_start and frame_end, the validator knew about them, and GenerateNode
 * drew a hard-coded image_ref — so there was no socket to plug a still into.
 * Every image landed on the old port, the runner found none, and the node
 * submitted a prompt with nothing attached. Flow returned a normal-looking
 * clip, so it read as "the images aren't uploading" rather than as an error.
 *
 * GenerateNode now renders its handles from portsFor, so these assertions
 * cover the component as well as the validator. */
describe('the ports a node offers', () => {
  const framesNode = { type: 'generate', data: { mediaType: 'video', creationType: 'frames' } };

  it('offers S and E in frames mode', () => {
    expect(portsFor(framesNode)!.in).toEqual(['text', 'frame_start', 'frame_end']);
  });

  it('takes image_ref away in frames mode', () => {
    // A socket that accepts a wire the runner then ignores is worse than no
    // socket: it is exactly how this shipped broken.
    expect(portsFor(framesNode)!.in).not.toContain('image_ref');
  });

  it('offers image_ref everywhere else', () => {
    for (const data of [
      { mediaType: 'video', creationType: 'ingredients' },
      { mediaType: 'video' },
      { mediaType: 'image', creationType: 'frames' }, // a still has no "between"
    ]) {
      expect({ data, ports: portsFor({ type: 'generate', data })!.in })
        .toEqual({ data, ports: expect.arrayContaining(['image_ref']) });
    }
  });

  it('still emits result in frames mode', () => {
    expect(portsFor(framesNode)!.out).toEqual(['result']);
  });
});

/* Switching FROM changes which ports exist, so the wires already attached have
   to move with it. React Flow neither errors nor deletes an edge whose handle
   stopped being rendered — it just stops drawing it, and the runner stops
   finding it. */
describe('moving wires when the mode changes', () => {
  const edges = [
    { id: 'e0', source: 'p', target: 'g', targetHandle: 'text' },
    { id: 'e1', source: 'a', target: 'g', targetHandle: 'image_ref' },
    { id: 'e2', source: 'b', target: 'g', targetHandle: 'image_ref' },
    { id: 'e3', source: 'x', target: 'other', targetHandle: 'image_ref' },
  ];

  it('sends the first image to Start and the second to End', () => {
    const { edges: out } = retargetImagePorts('g', edges, true);
    expect(out.map((e) => [e.id, e.targetHandle])).toEqual([
      ['e0', 'text'],
      ['e1', 'frame_start'],
      ['e2', 'frame_end'],
      ['e3', 'image_ref'],   // a different node — untouched
    ]);
  });

  it('leaves the prompt wire alone', () => {
    const { edges: out } = retargetImagePorts('g', edges, true);
    expect(out.find((e) => e.id === 'e0')!.targetHandle).toBe('text');
  });

  it('drops what will not fit, and says how many', () => {
    /* Frames takes exactly two. Silently keeping a third would leave an edge
       pointing at a handle that no longer renders — invisible on the canvas
       and still in the file. */
    const three = [...edges, { id: 'e4', source: 'c', target: 'g', targetHandle: 'image_ref' }];
    const { edges: out, dropped } = retargetImagePorts('g', three, true);
    expect(dropped).toBe(1);
    expect(out.some((e) => e.id === 'e4')).toBe(false);
  });

  it('reports nothing dropped in the ordinary case', () => {
    expect(retargetImagePorts('g', edges, true).dropped).toBe(0);
  });

  it('puts them back on image_ref when switching away', () => {
    const framed = retargetImagePorts('g', edges, true).edges;
    const { edges: back, dropped } = retargetImagePorts('g', framed, false);
    expect(back.filter((e) => e.targetHandle === 'image_ref').map((e) => e.id))
      .toEqual(['e1', 'e2', 'e3']);
    expect(dropped).toBe(0);   // image_ref takes a list
  });
});

/* Workflows saved before the ports existed. */
describe('opening an older frames workflow', () => {
  const framesNode = {
    id: 'g', type: 'generate',
    data: { type: 'generate', mediaType: 'video', creationType: 'frames' },
  };

  it('moves stills off image_ref onto the frame ports', () => {
    const out = migrateFrameEdges([framesNode], [
      { id: 'e1', source: 'a', target: 'g', targetHandle: 'image_ref' },
      { id: 'e2', source: 'b', target: 'g', targetHandle: 'image_ref' },
    ]);
    expect(out.map((e) => e.targetHandle)).toEqual(['frame_start', 'frame_end']);
  });

  it('leaves a correctly wired workflow exactly as it is', () => {
    // Including the order — re-deriving it from edge order would reverse a
    // clip whose author had already put Start and End where they wanted.
    const wired = [
      { id: 'e1', source: 'b', target: 'g', targetHandle: 'frame_end' },
      { id: 'e2', source: 'a', target: 'g', targetHandle: 'frame_start' },
    ];
    expect(migrateFrameEdges([framesNode], wired)).toEqual(wired);
  });

  it('does not touch an ingredients node', () => {
    const ingredients = { id: 'g', type: 'generate', data: { mediaType: 'video' } };
    const wired = [{ id: 'e1', source: 'a', target: 'g', targetHandle: 'image_ref' }];
    expect(migrateFrameEdges([ingredients], wired)).toEqual(wired);
  });

  it('does not touch a frames node that has no images at all', () => {
    expect(migrateFrameEdges([framesNode], [])).toEqual([]);
  });
});

describe('ordering', () => {
  const inputs = new Map<string, string[]>([
    ['frame_start', ['nodeA']],
    ['frame_end', ['nodeB']],
    ['image_ref', ['nodeC']],
  ]);

  it('sends Start before End', () => {
    // The entire point. Reversed, the clip plays backwards.
    expect(orderedSources(inputs, 'frames', 'video')).toEqual(['nodeA', 'nodeB']);
  });

  it('ignores the frame ports in ingredients mode', () => {
    expect(orderedSources(inputs, 'ingredients', 'video')).toEqual(['nodeC']);
  });

  it('ignores frames mode on an image node', () => {
    // There is no "between" for a still, whatever the dropdown says.
    expect(orderedSources(inputs, 'frames', 'image')).toEqual(['nodeC']);
  });

  it('does not depend on the map insertion order', () => {
    const reversed = new Map<string, string[]>([
      ['frame_end', ['nodeB']],
      ['frame_start', ['nodeA']],
    ]);
    expect(orderedSources(reversed, 'frames', 'video')).toEqual(['nodeA', 'nodeB']);
  });
});

describe('templates using frames validate', () => {
  const frameTemplate = (startHandle: string, endHandle: string) => ({
    id: 'tpl_x', name: 'X', description: 'd', useCase: 'u',
    category: 'Content', difficulty: 'Easy', nodeCount: 4, thumbnail: '🎬',
    nodes: [
      { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { type: 'prompt', text: 'go' } },
      { id: 'a', type: 'image', position: { x: 0, y: 200 }, data: { type: 'image' } },
      { id: 'b', type: 'image', position: { x: 0, y: 400 }, data: { type: 'image' } },
      {
        id: 'g1', type: 'generate', position: { x: 400, y: 0 },
        data: { type: 'generate', platform: 'flow', mediaType: 'video', creationType: 'frames' },
      },
    ],
    edges: [
      { id: 'e0', source: 'p1', target: 'g1', sourceHandle: 'text', targetHandle: 'text' },
      { id: 'e1', source: 'a', target: 'g1', sourceHandle: 'image', targetHandle: startHandle },
      { id: 'e2', source: 'b', target: 'g1', sourceHandle: 'image', targetHandle: endHandle },
    ],
  });

  it('accepts a well-formed frames workflow', () => {
    expect(validateTemplate(frameTemplate('frame_start', 'frame_end'))).toEqual([]);
  });

  it('rejects a typo in a frame handle', () => {
    /* The failure this catches is silent: React Flow drops an edge whose
       handle does not exist, so the canvas looks wired and the clip
       interpolates from one end only. */
    expect(validateTemplate(frameTemplate('frame_stat', 'frame_end')).join(' '))
      .toMatch(/does not have/);
  });
});

/* Finding the slots on the page.

   Studio pasted frame images into the prompt box — the ingredients route —
   so the Start and End slots stayed empty and Flow generated from a
   reference instead of interpolating. The clip came back looking like an
   ordinary generation, which is why it read as "not working" rather than as
   an error.

   Markup verbatim from a live composer. */
describe('the Start and End slots', () => {
  const box = (w: number, h: number) => () =>
    ({ width: w, height: h, top: 0, left: 0, bottom: h, right: w, x: 0, y: 0, toJSON() {} });

  function mountComposer(): void {
    document.body.innerHTML = `
      <div class="sc-273a6a40-0 hpgSgT">
        <div type="button" aria-haspopup="dialog" aria-expanded="false"
             aria-controls="radix-:r69:" data-state="closed"
             class="sc-2f954d7d-0 cBWhrr">Start</div>
        <button class="sc-e8425ea6-0 hOBPaw sc-2f954d7d-1 ewGlDn"></button>
        <div type="button" aria-haspopup="dialog" aria-expanded="false"
             aria-controls="radix-:r6a:" data-state="closed"
             class="sc-2f954d7d-0 cBWhrr">End</div>
      </div>`;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      (el as any).getBoundingClientRect = box(50, 50);
    }
  }

  beforeEach(() => { document.body.innerHTML = ''; });

  it('finds both slots in the live markup', () => {
    mountComposer();
    const slots = findFrameSlots();
    expect(slots).not.toBeNull();
    expect(slots!.start.textContent).toBe('Start');
    expect(slots!.end.textContent).toBe('End');
  });

  it('finds them by order when the labels are translated', () => {
    // "Start" and "End" are UI text; the order and the swap between them are
    // not. Position is what survives a French or Japanese Flow.
    mountComposer();
    document.querySelectorAll('[aria-haspopup="dialog"]').forEach((el, i) => {
      el.textContent = i === 0 ? 'Début' : 'Fin';
    });
    const slots = findFrameSlots();
    expect(slots!.start.textContent).toBe('Début');
    expect(slots!.end.textContent).toBe('Fin');
  });

  it('is not fooled by the swap button between them', () => {
    // A real <button> sits between the two slots; the slots are DIVs with
    // type="button", which is why a querySelector for 'button' finds neither.
    mountComposer();
    expect(document.querySelectorAll('button')).toHaveLength(1);
    expect(findFrameSlots()).not.toBeNull();
  });

  it('reports nothing when the composer is in image mode', () => {
    // No slots to fill, and pretending otherwise would attach an ingredient.
    document.body.innerHTML = '<div>no dialogs here</div>';
    expect(findFrameSlots()).toBeNull();
  });

  it('knows an empty slot from a filled one', () => {
    mountComposer();
    const slot = findFrameSlots()!.start;
    expect(frameSlotFilled(slot)).toBe(false);

    const img = document.createElement('img');
    Object.defineProperty(img, 'complete', { value: true });
    Object.defineProperty(img, 'naturalWidth', { value: 512 });
    slot.append(img);
    expect(frameSlotFilled(slot)).toBe(true);
  });

  it('treats an image that has not loaded as empty', () => {
    // The <img> appears when the upload starts, so presence alone races it.
    mountComposer();
    const slot = findFrameSlots()!.start;
    const img = document.createElement('img');
    Object.defineProperty(img, 'complete', { value: false });
    Object.defineProperty(img, 'naturalWidth', { value: 0 });
    slot.append(img);
    expect(frameSlotFilled(slot)).toBe(false);
  });
});

/* A thumbnail can be drawn two ways, and looking for only one of them meant
   the slot filled on screen while the wait loop ran its full 45 seconds and
   then called it a failure — presenting as "the images are uploading" with
   nothing ever finishing. */
describe('detecting a filled slot', () => {
  function slot(): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('aria-haspopup', 'dialog');
    el.textContent = 'Start';
    document.body.append(el);
    return el;
  }

  beforeEach(() => { document.body.innerHTML = ''; });

  it('sees a thumbnail rendered as an <img>', () => {
    const s = slot();
    const img = document.createElement('img');
    Object.defineProperty(img, 'complete', { value: true });
    Object.defineProperty(img, 'naturalWidth', { value: 400 });
    s.append(img);
    expect(frameSlotFilled(s)).toBe(true);
  });

  it('sees one rendered as a CSS background', () => {
    // No <img> exists in this case at all.
    const s = slot();
    const inner = document.createElement('div');
    inner.style.backgroundImage = 'url("blob:https://labs.google/abc")';
    s.append(inner);
    expect(frameSlotFilled(s)).toBe(true);
  });

  it('does not count an empty slot as filled', () => {
    expect(frameSlotFilled(slot())).toBe(false);
  });

  it('does not count background-image: none', () => {
    const s = slot();
    const inner = document.createElement('div');
    inner.style.backgroundImage = 'none';
    s.append(inner);
    expect(frameSlotFilled(s)).toBe(false);
  });

  it('does not count an image still loading', () => {
    /* Reporting filled early is worse than reporting late: the next paste
       would race into a slot that is still settling, and order is the whole
       meaning of the mode. */
    const s = slot();
    const img = document.createElement('img');
    Object.defineProperty(img, 'complete', { value: false });
    Object.defineProperty(img, 'naturalWidth', { value: 0 });
    s.append(img);
    expect(frameSlotFilled(s)).toBe(false);
  });

  it('describes a slot that will not fill', () => {
    // What gets logged when the wait gives up, so the next report says which.
    expect(describeFrameSlot(slot())).toMatch(/text="Start".*imgs=0.*bg=none/);
  });
});

/* ============================================================
   The live composer, read off a running Flow rather than guessed.

   Everything below is verbatim from labs.google on 6 Aug 2026. Two facts
   found there are the reason frames mode never worked, and neither was
   visible from the outside:

   1. A filled slot is not a dialog trigger. It becomes a thumbnail with a
      cancel button and loses aria-haspopup entirely — so counting triggers
      found two slots before the first image and one after, and attaching the
      End frame failed with "not showing Start/End frame slots" while both
      slots sat plainly on screen.

   2. Flow renames every upload. A file pasted as af_b4611d71.png comes back
      named b4611d71-d2c8-4e0f-b4e2-870d70092335.jpg. Searching the picker
      for the name we chose matched 0 of 2 rows that were both ours.
   ============================================================ */
describe('the live composer', () => {
  const seeAll = () => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      (el as any).getBoundingClientRect = () =>
        ({ width: 50, height: 50, top: 0, left: 0, bottom: 50, right: 50, x: 0, y: 0, toJSON() {} });
    }
  };

  beforeEach(() => { document.body.innerHTML = ''; });

  /** Both slots empty: two triggers either side of the swap button. */
  const EMPTY_ROW = `
    <div class="sc-273a6a40-0 hpgSgT">
      <div type="button" aria-haspopup="dialog" aria-expanded="false"
           aria-controls="radix-:r29:" data-state="closed"
           class="sc-2f954d7d-0 cBWhrr">Start</div>
      <button class="sc-e8425ea6-0 hOBPaw"><i class="google-symbols">swap_horiz</i><span>Swap first and last frames</span></button>
      <div type="button" aria-haspopup="dialog" aria-expanded="false"
           aria-controls="radix-:r2a:" data-state="closed"
           class="sc-2f954d7d-0 cBWhrr">End</div>
    </div>`;

  /** Start filled, End empty — the state the old finder could not read. */
  const HALF_FILLED_ROW = `
    <div class="sc-273a6a40-0 hpgSgT">
      <div class="sc-784d6f75-0 bEnOCH">
        <img src="/fx/api/trpc/media.getMediaUrlRedirect?name=933755cf" alt="A piece of media generated by Flow">
        <button><i class="google-symbols">cancel</i></button>
      </div>
      <button class="sc-e8425ea6-0 hOBPaw"><i class="google-symbols">swap_horiz</i><span>Swap first and last frames</span></button>
      <div type="button" aria-haspopup="dialog" aria-expanded="false"
           aria-controls="radix-:r2a:" data-state="closed"
           class="sc-2f954d7d-0 cBWhrr">End</div>
    </div>`;

  it('finds both slots before anything is attached', () => {
    document.body.innerHTML = EMPTY_ROW;
    seeAll();
    const slots = findFrameSlots()!;
    expect([slots.start.textContent, slots.end.textContent]).toEqual(['Start', 'End']);
  });

  it('still finds both once Start is holding an image', () => {
    /* The regression that made the mode fail on its second image. The filled
       slot has no aria-haspopup, so a trigger count returns one. */
    document.body.innerHTML = HALF_FILLED_ROW;
    seeAll();
    expect(document.querySelectorAll('[aria-haspopup="dialog"]')).toHaveLength(1);

    const slots = findFrameSlots();
    expect(slots).not.toBeNull();
    expect(slots!.start.querySelector('img')).not.toBeNull();
    expect(slots!.end.textContent).toBe('End');
  });

  it('navigates from the swap button, which exists in both states', () => {
    document.body.innerHTML = HALF_FILLED_ROW;
    seeAll();
    const swap = findFrameSwapButton();
    expect(swap).not.toBeNull();
    expect(swap!.textContent).toContain('swap_horiz');
  });

  it('reads a filled slot as filled and an empty one as empty', () => {
    document.body.innerHTML = HALF_FILLED_ROW;
    seeAll();
    const img = document.querySelector('img')!;
    Object.defineProperty(img, 'complete', { value: true });
    Object.defineProperty(img, 'naturalWidth', { value: 424 });

    const slots = findFrameSlots()!;
    expect(frameSlotFilled(slots.start)).toBe(true);
    expect(frameSlotFilled(slots.end)).toBe(false);
  });

  it('finds the remove control on a filled slot', () => {
    // Without it a run inherits the previous prompt's frames.
    document.body.innerHTML = HALF_FILLED_ROW;
    seeAll();
    const slots = findFrameSlots()!;
    expect(findFrameSlotClearButton(slots.start)!.textContent).toContain('cancel');
  });
});

/* The picker a slot opens. Verbatim, including the colons in the Radix id —
   getElementById copes with them; querySelector needs CSS.escape, which jsdom
   does not implement. */
describe('the asset picker', () => {
  const seeAll = () => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      (el as any).getBoundingClientRect = () =>
        ({ width: 200, height: 40, top: 0, left: 0, bottom: 40, right: 200, x: 0, y: 0, toJSON() {} });
    }
  };

  /* Two rows, same visible name, different media ids — exactly what uploading
     the same picture twice produces, and the case that makes name matching
     useless. */
  const PICKER = `
    <div type="button" aria-haspopup="dialog" aria-controls="radix-:r29:" data-state="open">Start</div>
    <div role="dialog" id="radix-:r29:" data-state="open" class="sc-50ca6f58-0 dfZpCX">
      <button role="tab" aria-selected="true">imageImages</button>
      <button role="tab" aria-selected="false">drive_folder_uploadUploads</button>
      <input id="add-menu-input" type="text" placeholder="Search assets" aria-label="Search assets">
      <button id="radix-:r3n:" aria-haspopup="menu">Recentarrow_drop_down</button>
      <div data-testid="virtuoso-item-list">
        <div data-item-index="0">
          <div role="option" aria-selected="true" class="sc-b0e5-4 eoGrGJ">
            <img src="/fx/api/trpc/media.getMediaUrlRedirect?name=933755cf-a595-4f61-888e-0c71d2094613"
                 alt="b4611d71-d2c8-4e0f-b4e2-870d70092335.jpg">
          </div>
        </div>
        <div data-item-index="1">
          <div role="option" aria-selected="false" class="sc-b0e5-4 eoGrGJ">
            <img src="/fx/api/trpc/media.getMediaUrlRedirect?name=1d4e2870-d700-9233-5cf7-77411ce0610c"
                 alt="b4611d71-d2c8-4e0f-b4e2-870d70092335.jpg">
          </div>
        </div>
      </div>
      <button>uploadUpload media</button>
      <button class="sc-16c4830a-1">Add to Prompt</button>
    </div>`;

  beforeEach(() => { document.body.innerHTML = PICKER; seeAll(); });

  it('resolves the dialog through the slot it belongs to', () => {
    // Not "the open dialog" — with two slots there are two, and filling Start
    // from End's picker would reverse the clip.
    const slot = document.querySelector<HTMLElement>('[aria-haspopup="dialog"]')!;
    expect(findFrameSlotDialog(slot)!.id).toBe('radix-:r29:');
  });

  it('finds both rows', () => {
    expect(findAssetOptions(document.getElementById('radix-:r29:')!)).toHaveLength(2);
  });

  it('tells identical-looking rows apart by media id', () => {
    /* The whole selection strategy. Both rows carry the same alt because they
       are the same picture uploaded twice; only the URL differs. */
    const rows = findAssetOptions(document.getElementById('radix-:r29:')!);
    const alts = rows.map((r) => r.querySelector('img')!.getAttribute('alt'));
    expect(alts[0]).toBe(alts[1]);
    expect(assetOptionId(rows[0])).toBe('933755cf-a595-4f61-888e-0c71d2094613');
    expect(assetOptionId(rows[1])).not.toBe(assetOptionId(rows[0]));
  });

  it('reports which row the picker has selected', () => {
    const rows = findAssetOptions(document.getElementById('radix-:r29:')!);
    expect(rows.map(assetOptionSelected)).toEqual([true, false]);
  });

  it('finds the commit button', () => {
    // Clicking a row only previews it; this is what fills the slot.
    expect(findAddToPromptButton(document.getElementById('radix-:r29:')!)!.textContent)
      .toBe('Add to Prompt');
  });

  it('does not mistake the sort trigger or Upload media for it', () => {
    const dialog = document.getElementById('radix-:r29:')!;
    dialog.querySelector('.sc-16c4830a-1')!.remove();   // force the fallback
    const found = findAddToPromptButton(dialog);
    expect((found?.textContent || '')).not.toMatch(/upload|arrow_drop_down/i);
  });

  it('finds the Uploads tab', () => {
    expect(findUploadsTab(document.getElementById('radix-:r29:')!)!.getAttribute('aria-selected'))
      .toBe('false');
  });

  it('describes what it saw, for when the expected row is missing', () => {
    expect(describeAssetDialog(document.getElementById('radix-:r29:')!))
      .toMatch(/rows=2 .*tabs=\[imageImages\*,.*\] commit=yes/);
  });

  it('says so plainly when there is no dialog at all', () => {
    expect(describeAssetDialog(null)).toBe('no dialog');
  });
});
