/**
 * @jest-environment jsdom
 */

/**
 * The website handing a workflow to Studio.
 *
 * This is the whole path in one place: a page posts an extraction, the content
 * script builds it with the extension's own compiler, parks it, and asks for
 * the canvas. Every step of that is invisible from either side on its own —
 * the page sees a message go out, the extension sees one come in — so the
 * seam is exactly where a bug lives undetected until somebody presses the
 * button on the one site that has it.
 *
 * The refusals matter as much as the success. A content script is the
 * extension's hand inside a page, and the page is not the extension.
 */

const parked: Record<string, any> = {};
const sentToBackground: any[] = [];

(globalThis as any).chrome = {
  runtime: {
    getManifest: () => ({ version: '0.27.1' }),
    sendMessage: async (msg: any) => { sentToBackground.push(msg); },
  },
  storage: {
    local: {
      set: async (items: Record<string, any>) => { Object.assign(parked, items); },
    },
  },
};

/* require, not import: an import is hoisted above the stub above, and the
   bridge reads chrome.runtime.getManifest() the moment it loads. */
declare const require: (id: string) => unknown;
require('../content/web/index');

const FROM_PAGE = 'autoflow-web';
const FROM_EXTENSION = 'autoflow-extension';

const line = (s: string) => `${s}, cinematic lighting, shallow depth of field`;

const extraction = {
  video_concept: 'A serum that changes everything',
  character_sheets: [{ character_name: 'Maya', prompt: line('Character sheet, turnaround') }],
  shots: [
    { shot_id: 1, image_prompt: line('wide of a kitchen at dawn'), video_prompt: line('slow push in') },
    { shot_id: 2, image_prompt: line('close on hands'), video_prompt: line('hands tilt the bottle') },
  ],
};

/**
 * Deliver a message the way a real page's postMessage arrives.
 *
 * Not window.postMessage: jsdom's implementation leaves event.source null,
 * and the bridge's first check is `event.source !== window` — the check that
 * separates this page talking to itself from an iframe or another origin
 * talking to it. Posted through jsdom, EVERY message fails that check, and a
 * suite built on postMessage would go green by silence: eleven tests
 * asserting refusals that the code refuses for the wrong reason, and the one
 * assertion that matters — a foreign source is turned away — never made at
 * all. So the event is constructed with the source it would really carry.
 */
function deliver(data: any, source: any = window): void {
  window.dispatchEvent(new MessageEvent('message', {
    data,
    source,
    origin: window.location.origin,
  }));
}

/**
 * Ask as the page would and wait for the reply addressed to it.
 *
 * Matched by id, the same way the page's own helper matches: without that,
 * two exchanges started close together resolve each other's promises.
 */
function ask(message: any, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve) => {
    const id = `t${Math.floor(Math.random() * 1e9)}`;
    const onMessage = (event: MessageEvent) => {
      const d: any = event.data;
      if (!d || d.source !== FROM_EXTENSION || d.id !== id) return;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(d);
    };
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve(null);
    }, timeoutMs);
    window.addEventListener('message', onMessage);
    deliver({ source: FROM_PAGE, id, ...message });
  });
}

beforeEach(() => {
  for (const k of Object.keys(parked)) delete parked[k];
  sentToBackground.length = 0;
});

describe('answering the page', () => {
  it('says it is installed', () => {
    /* The question that turns a dead button into an install link. */
    return ask({ type: 'PING' }).then((reply) => {
      expect(reply).toMatchObject({ ok: true, installed: true });
      expect(reply.version).toBe('0.27.1');
    });
  });

  it('answers the exchange that asked, not another one', async () => {
    const [a, b] = await Promise.all([ask({ type: 'PING' }), ask({ type: 'PING' })]);
    expect(a.id).not.toBe(b.id);
  });
});

describe('building what the page sent', () => {
  it('parks a workflow and asks for the canvas', async () => {
    const reply = await ask({ type: 'BUILD_FROM_EXTRACTION', extraction, options: {} });
    expect(reply.ok).toBe(true);
    expect(reply.nodes).toBeGreaterThan(4);

    const template = parked.af_pending_workflow;
    expect(template).toBeTruthy();
    expect(sentToBackground).toEqual([{ type: 'OPEN_STUDIO' }]);
  });

  it('parks the workflow whole, not by id', async () => {
    /* The gallery looks an id up in the published list, and this workflow
       exists nowhere but here. */
    await ask({ type: 'BUILD_FROM_EXTRACTION', extraction, options: {} });
    const template = parked.af_pending_workflow;
    expect(Array.isArray(template.nodes)).toBe(true);
    expect(Array.isArray(template.edges)).toBe(true);
  });

  it('wires the character into every still and each still into its own clip', async () => {
    await ask({ type: 'BUILD_FROM_EXTRACTION', extraction, options: {} });
    const pairs = parked.af_pending_workflow.edges.map((e: any) => `${e.source}->${e.target}`);
    expect(pairs).toContain('cast1->shot1_still');
    expect(pairs).toContain('cast1->shot2_still');
    expect(pairs).toContain('shot1_still->shot1_clip');
    expect(pairs).not.toContain('shot2_still->shot1_clip');
  });

  it('honours the settings the page sent', async () => {
    await ask({
      type: 'BUILD_FROM_EXTRACTION',
      extraction,
      options: { videoModel: 'Veo 3.1 Fast', duration: '8s', aspectRatio: '16:9' },
    });
    const clip = parked.af_pending_workflow.nodes.find((n: any) => n.id === 'shot1_clip');
    expect(clip.data.model).toBe('Veo 3.1 Fast');
    expect(clip.data.duration).toBe('8s');
    expect(clip.data.aspectRatio).toBe('16:9');
  });

  it('builds stills only when that is what was asked for', async () => {
    const reply = await ask({ type: 'BUILD_FROM_EXTRACTION', extraction, options: { mode: 'stills' } });
    expect(reply.ok).toBe(true);
    const ids = parked.af_pending_workflow.nodes.map((n: any) => n.id);
    expect(ids).not.toContain('shot1_clip');
  });
});

describe('what it will not do', () => {
  it('parks nothing for an extraction with no shots', async () => {
    const reply = await ask({ type: 'BUILD_FROM_EXTRACTION', extraction: { shots: [] }, options: {} });
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/no shots/);
    expect(parked.af_pending_workflow).toBeUndefined();
    expect(sentToBackground).toEqual([]);
  });

  it('refuses something far too large to be an analysis', async () => {
    /* An analysis of a long video is a few hundred kilobytes of prompts. A
       megabyte is not one, and whatever it is should not be parsed here. */
    const huge = { shots: [{ shot_id: 1, image_prompt: 'x'.repeat(1024 * 1024 + 64), video_prompt: 'y' }] };
    const reply = await ask({ type: 'BUILD_FROM_EXTRACTION', extraction: huge, options: {} });
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/too large/);
    expect(parked.af_pending_workflow).toBeUndefined();
  });

  it('refuses an extraction it cannot even read', async () => {
    const circular: any = { shots: [] };
    circular.self = circular;
    const reply = await ask({ type: 'BUILD_FROM_EXTRACTION', extraction: circular, options: {} });
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/could not be read/);
  });

  /** Watch for any reply carrying `id` while `send` does whatever it does. */
  const silenceAfter = (id: string, send: () => void, ms = 300) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve('silence');
      }, ms);
      const onMessage = (e: MessageEvent) => {
        const d: any = e.data;
        if (d?.source === FROM_EXTENSION && d.id === id) {
          clearTimeout(timer);
          window.removeEventListener('message', onMessage);
          resolve(d);
        }
      };
      window.addEventListener('message', onMessage);
      send();
    });

  it('ignores a message without the marker', async () => {
    /* Analytics, a framework, an embed — the window is a busy place. */
    const reply = await silenceAfter('unmarked', () =>
      deliver({ id: 'unmarked', type: 'BUILD_FROM_EXTRACTION', extraction }));
    expect(reply).toBe('silence');
    expect(parked.af_pending_workflow).toBeUndefined();
  });

  it('ignores a perfectly formed message from somewhere that is not this page', async () => {
    /* An iframe, an embed, another origin. It carries the marker, the type and
       a real extraction — everything except being this page. That is the whole
       check, and it is the reason a content script on a site is not the same
       thing as an open door. */
    const notThisWindow = { name: 'an iframe' };
    const reply = await silenceAfter('foreign', () =>
      deliver({ source: FROM_PAGE, id: 'foreign', type: 'BUILD_FROM_EXTRACTION', extraction },
        notThisWindow));
    expect(reply).toBe('silence');
    expect(parked.af_pending_workflow).toBeUndefined();
    expect(sentToBackground).toEqual([]);
  });

  it('ignores a type it does not know', async () => {
    const reply = await ask({ type: 'DELETE_EVERYTHING' }, 300);
    expect(reply).toBeNull();
  });
});

describe('when the canvas will not open', () => {
  it('still reports success, because the workflow is parked and waiting', async () => {
    /* Opening a window is the service worker's job and it can fail — asleep,
       mid-update, no window to attach to. The build did happen, and the next
       time Studio opens it is there. Reporting a failure would send somebody
       to rebuild something that already exists. */
    const original = (globalThis as any).chrome.runtime.sendMessage;
    (globalThis as any).chrome.runtime.sendMessage = async () => { throw new Error('no receiver'); };
    try {
      const reply = await ask({ type: 'BUILD_FROM_EXTRACTION', extraction, options: {} });
      expect(reply.ok).toBe(true);
      expect(parked.af_pending_workflow).toBeTruthy();
    } finally {
      (globalThis as any).chrome.runtime.sendMessage = original;
    }
  });
});

describe('what it says a build would cost', () => {
  /* The number under the button, answered by the thing that will build it.
     A page that counts for itself keeps a second copy of the rules deciding
     what a shot is worth building, and the count drifts away from what
     pressing the button produces. */

  it('counts the characters, stills and clips it would make', async () => {
    const reply = await ask({ type: 'ESTIMATE', extraction, options: {} });
    expect(reply.ok).toBe(true);
    expect(reply.cost).toEqual({ characters: 1, stills: 2, clips: 2, total: 5 });
  });

  it('counts a cheaper mode as cheaper', async () => {
    const reply = await ask({ type: 'ESTIMATE', extraction, options: { mode: 'stills' } });
    expect(reply.cost).toMatchObject({ clips: 0, total: 3 });
  });

  it('agrees with what a build actually produces', async () => {
    /* The point of the whole exchange, asserted directly: quote and bill are
       the same number. */
    const quote = await ask({ type: 'ESTIMATE', extraction, options: {} });
    await ask({ type: 'BUILD_FROM_EXTRACTION', extraction, options: {} });
    const generates = parked.af_pending_workflow.nodes
      .filter((n: any) => n.data?.type === 'generate').length;
    expect(generates).toBe(quote.cost.total);
  });

  it('costs nothing and builds nothing', async () => {
    await ask({ type: 'ESTIMATE', extraction, options: {} });
    expect(parked.af_pending_workflow).toBeUndefined();
    expect(sentToBackground).toEqual([]);
  });
});
