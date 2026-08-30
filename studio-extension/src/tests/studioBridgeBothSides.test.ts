/**
 * @jest-environment jsdom
 */

/// <reference types="node" />

/**
 * The website's half and the extension's half, talking to each other.
 *
 * studioBridge.test.ts drives the content script with a hand-written page. That
 * proves the extension answers correctly — and it proves nothing at all about
 * whether the REAL page asks correctly, because the test is the thing asking.
 *
 * The two halves live in different repositories' worth of build tooling and
 * share four constants by having each been typed out twice: the marker on a
 * message from the page, the marker on a reply, the message names, and the
 * shape of the options. Nothing links them. Rename one and both files still
 * compile, both test suites still pass, and the button silently does nothing.
 *
 * So this loads the website's actual source and runs it against the actual
 * content script in one window. It is the only place either side's assumptions
 * about the other are checked.
 */

import * as fs from 'fs';
import * as path from 'path';

const PAGE_BRIDGE = path.resolve(
  __dirname, '../../../website/src/app/[locale]/extractor/studioBridge.js',
);

const parked: Record<string, any> = {};
const sentToBackground: any[] = [];

(globalThis as any).chrome = {
  runtime: {
    getManifest: () => ({ version: '0.27.1' }),
    sendMessage: async (msg: any) => { sentToBackground.push(msg); },
  },
  storage: {
    local: { set: async (items: Record<string, any>) => { Object.assign(parked, items); } },
  },
};

declare const require: (id: string) => unknown;
require('../content/web/index');

/**
 * The website's module, loaded from its own source.
 *
 * Evaluated rather than imported: it is an ES module outside this project's
 * rootDir, in a package with different build settings. Stripping `export` and
 * returning the functions by name is enough to run the real code — and it is
 * the real code that matters, because the whole point is to catch the two
 * files drifting apart.
 */
function loadPageBridge(): any {
  const source = fs.readFileSync(PAGE_BRIDGE, 'utf8')
    .replace(/^export\s+/gm, '');
  const factory = new Function(`
    ${source}
    return { studioInstalled, sendToStudio, toBuildOptions, estimateInStudio };
  `);
  return factory();
}

const pageBridge = loadPageBridge();

/* jsdom's window.postMessage leaves event.source null, and the content script's
   first check is `event.source !== window`. Real Chrome sets it; jsdom does
   not, so every message the page sends would be turned away for a reason that
   does not exist in a browser. Patched to deliver the event the way a browser
   delivers it — the message itself is untouched. */
const realPostMessage = window.postMessage.bind(window);
(window as any).postMessage = (data: any) => {
  window.dispatchEvent(new MessageEvent('message', {
    data, source: window, origin: window.location.origin,
  }));
};

const line = (s: string) => `${s}, cinematic lighting, shallow depth of field`;

const extraction = {
  video_concept: 'A serum that changes everything',
  character_sheets: [{ character_name: 'Maya', prompt: line('Character sheet, turnaround') }],
  shots: [
    { shot_id: 1, image_prompt: line('wide of a kitchen at dawn'), video_prompt: line('slow push in') },
    { shot_id: 2, image_prompt: line('close on hands'), video_prompt: line('hands tilt the bottle') },
  ],
};

beforeEach(() => {
  for (const k of Object.keys(parked)) delete parked[k];
  sentToBackground.length = 0;
});

afterAll(() => { (window as any).postMessage = realPostMessage; });

describe('the page finds the extension', () => {
  it('studioInstalled comes back true with the content script loaded', async () => {
    /* If either side renamed a marker or a message type, this is where it
       shows up — as false, which on the real page is the install prompt
       appearing for somebody who has it installed. */
    await expect(pageBridge.studioInstalled()).resolves.toBe(true);
  });
});

describe('the page sends and the extension builds', () => {
  it('a workflow is parked and the canvas is asked for', async () => {
    const reply = await pageBridge.sendToStudio(extraction, {});
    expect(reply.ok).toBe(true);
    expect(reply.nodes).toBeGreaterThan(4);
    expect(parked.af_pending_workflow).toBeTruthy();
    expect(sentToBackground).toEqual([{ type: 'OPEN_STUDIO' }]);
  });

  it('the options the page translates are the options the extension acts on', async () => {
    /* toBuildOptions renames the page's vocabulary into the extension's. A
       mistranslation here is silent: the build succeeds, with settings nobody
       chose. */
    const opts = pageBridge.toBuildOptions({
      chain: 'images',
      platform: 'flow',
      aspectRatio: '16:9',
      imageModel: 'Imagen 4',
      videoModel: 'Veo 3.1 Fast',
      duration: '8s',
    }, 'glow-drop.mp4');

    expect(opts.mode).toBe('stills');

    const reply = await pageBridge.sendToStudio(extraction, opts);
    expect(reply.ok).toBe(true);

    const nodes = parked.af_pending_workflow.nodes;
    expect(nodes.find((n: any) => n.id === 'shot1_clip')).toBeUndefined();
    expect(nodes.find((n: any) => n.id === 'shot1_still').data.model).toBe('Imagen 4');
    expect(nodes.find((n: any) => n.id === 'shot1_still').data.aspectRatio).toBe('16:9');
    expect(parked.af_pending_workflow.name).toBe('glow-drop.mp4 — rebuilt');
  });

  it('each build mode the page offers means something to the extension', async () => {
    /* Three values in a <select>. A fourth name on either side, or a typo in
       one, produces a build that quietly falls back to "both" — more
       generations than were asked for, and paid for. */
    const seen: Record<string, string[]> = {};
    for (const chain of ['image_to_video', 'images', 'videos']) {
      const opts = pageBridge.toBuildOptions({ chain }, 'x.mp4');
      await pageBridge.sendToStudio(extraction, opts);
      seen[chain] = parked.af_pending_workflow.nodes
        .filter((n: any) => n.data?.type === 'generate')
        .map((n: any) => n.id);
    }
    expect(seen.image_to_video).toContain('shot1_still');
    expect(seen.image_to_video).toContain('shot1_clip');
    expect(seen.images).not.toContain('shot1_clip');
    expect(seen.videos).not.toContain('shot1_still');
  });
});

describe('the count under the button', () => {
  it('the page gets a real estimate back', async () => {
    const cost = await pageBridge.estimateInStudio(extraction, {});
    expect(cost).toEqual({ characters: 1, stills: 2, clips: 2, total: 5 });
  });

  it('and it is the number the build produces', async () => {
    const cost = await pageBridge.estimateInStudio(extraction, pageBridge.toBuildOptions({ chain: 'images' }, 'x'));
    await pageBridge.sendToStudio(extraction, pageBridge.toBuildOptions({ chain: 'images' }, 'x'));
    const generates = parked.af_pending_workflow.nodes
      .filter((n: any) => n.data?.type === 'generate').length;
    expect(generates).toBe(cost.total);
  });
});

describe('what the page does with a refusal', () => {
  it('passes the reason NOTHING was built, not a note about one shot', async () => {
    /* The converter pushes a per-shot note as it goes and appends why it gave
       up at the end. Reporting the first of those explains shot one while the
       other eleven go unaccounted for. */
    const reply = await pageBridge.sendToStudio({ shots: [{ image_prompt: 'x', video_prompt: 'y' }] }, {});
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/None of the shots/);
  });

  it('reports shots it skipped even when the build succeeded', async () => {
    /* Nine nodes from a twelve shot analysis, and the page said only "Opened
       in Studio". The three that vanished were something to notice on the
       canvas later, or never. */
    const thin = {
      character_sheets: extraction.character_sheets,
      shots: [...extraction.shots, { shot_id: 3, image_prompt: 'x', video_prompt: 'y' }],
    };
    const reply = await pageBridge.sendToStudio(thin, {});
    expect(reply.ok).toBe(true);
    expect((reply.notes || []).join(' ')).toMatch(/Shot 3 had no usable prompt/);
  });

  it('says nothing when there was nothing to say', async () => {
    const reply = await pageBridge.sendToStudio(extraction, {});
    expect(reply.ok).toBe(true);
    expect(reply.notes).toBeUndefined();
  });

  it('refuses an empty extraction without troubling the extension', async () => {
    const reply = await pageBridge.sendToStudio({ shots: [] }, {});
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/run an extraction first/);
    expect(sentToBackground).toEqual([]);
  });
});
