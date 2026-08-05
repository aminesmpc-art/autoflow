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

import { NODE_PORTS, portsFor, validateTemplate } from '../studio/templates/validate';
import { findFrameSlots, frameSlotFilled, describeFrameSlot } from '../content/flow/selectors';

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
  it('gives a generate node both frame ports', () => {
    expect(NODE_PORTS.generate.in).toEqual(
      expect.arrayContaining(['frame_start', 'frame_end'])
    );
  });

  it('keeps image_ref, because Ingredients mode still uses it', () => {
    // Frames is a mode, not a replacement — most templates are ingredients.
    expect(NODE_PORTS.generate.in).toContain('image_ref');
  });

  it('does not offer frame ports on a prompt writer', () => {
    // A text answer has no first or last frame.
    expect(portsFor({ type: 'generate', data: { mediaType: 'text' } })!.in)
      .not.toContain('frame_start');
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
