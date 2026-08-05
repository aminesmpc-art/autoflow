/**
 * @jest-environment jsdom
 */

/* ============================================================
   Recognising "not enough Google Flow credits".

   Missing it is expensive in a way that is easy to underestimate. Flow takes
   the click, raises the notice, and never creates a tile — so the poller waits
   out its whole budget (22 minutes for a video) for something refused in the
   first second, and then the runner moves to the next node and repeats it.

   Two things have to hold, and they pull against each other:
   - It must fire on the real notice, in any language Flow ships.
   - It must NOT fire on the ordinary page, where the word "credits" and an
     upgrade button both appear on their own all the time. A false positive
     here kills a run that was working.
   ============================================================ */

import {
  findCreditsExhaustedNotice,
  findFlowAlertIndicator,
  readFlowAlertMessage,
  readsAsCreditsExhausted,
} from '../content/flow/selectors';
import { isRunFatal, isTransientFailure } from '../studio/engine/WorkflowRunner';

/** Give an element a real box; jsdom measures everything as zero. */
function sized(el: HTMLElement, width: number, height: number): HTMLElement {
  (el as any).getBoundingClientRect = () => ({
    width, height, top: 0, left: 0, bottom: height, right: width, x: 0, y: 0, toJSON() {},
  });
  return el;
}

function notice(html: string, width = 220, height = 160): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'alert');
  el.innerHTML = html;
  sized(el, width, height);
  document.body.append(el);
  // innerText is not implemented in jsdom; the detector reads it first.
  // Applied to every node, since the detector walks up from the button.
  for (const n of [el, ...Array.from(el.querySelectorAll<HTMLElement>('*'))]) {
    Object.defineProperty(n, 'innerText', { get: () => n.textContent || '' });
    if (n !== el) sized(n, Math.min(width, 120), 24);
  }
  return el;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('findCreditsExhaustedNotice', () => {
  it('finds the notice from the report', () => {
    notice(`
      <p>Not enough Google Flow credits to perform this action.
         Try other settings or upgrade for more Google Flow credits.</p>
      <button>Settings</button><button>Upgrade</button>
    `);
    expect(findCreditsExhaustedNotice()).not.toBeNull();
  });

  it.each([
    ['French', 'Pas assez de crédits Google Flow pour cette action.', 'Mettre à niveau'],
    ['Spanish', 'No tienes suficientes créditos de Google Flow.', 'Mejorar'],
    ['German', 'Nicht genügend Google Flow Guthaben.', 'Upgraden'],
    ['Japanese', 'Google Flow のクレジットが不足しています。', 'アップグレード'],
  ])('finds it in %s', (_lang, body, cta) => {
    notice(`<p>${body}</p><button>${cta}</button>`);
    expect(findCreditsExhaustedNotice()).not.toBeNull();
  });

  it('finds a short notice by its error glyph', () => {
    // A CJK refusal can be under the length threshold; the Material glyph is
    // what carries it, and it does not translate.
    notice('<span>error</span><p>クレジット不足</p><button>アップグレード</button>');
    expect(findCreditsExhaustedNotice()).not.toBeNull();
  });

  it('ignores a persistent credits chip in the header', () => {
    // Both signals, permanently on screen. Firing here would abort every run
    // at the first node, forever.
    notice('<span>1,240 credits</span><button>Upgrade</button>', 200, 32);
    expect(findCreditsExhaustedNotice()).toBeNull();
  });

  it('ignores a credits chip in a dense script too', () => {
    // The CJK length threshold has to clear a balance chip as well, or
    // lowering it for Japanese notices just moves the false positive.
    notice('<span>1,240 クレジット</span><button>アップグレード</button>', 200, 32);
    expect(findCreditsExhaustedNotice()).toBeNull();
  });

  it('ignores an empty page', () => {
    expect(findCreditsExhaustedNotice()).toBeNull();
  });

  it('ignores a credits balance that is merely displayed', () => {
    // The header shows a balance permanently; that is not a refusal.
    notice('<p>1,240 credits remaining</p>');
    expect(findCreditsExhaustedNotice()).toBeNull();
  });

  it('ignores an upgrade prompt that says nothing about credits', () => {
    notice('<p>Get Flow Pro for higher resolution.</p><button>Upgrade</button>');
    expect(findCreditsExhaustedNotice()).toBeNull();
  });

  it('ignores a full-page pricing panel that mentions both', () => {
    // Both signals present, but this is a page, not a notice — matching it
    // would abort a healthy run the moment the user opened pricing.
    notice(
      '<p>Compare plans and credits</p><button>Upgrade</button>',
      900, 700
    );
    expect(findCreditsExhaustedNotice()).toBeNull();
  });

  it('ignores a notice that is present but hidden', () => {
    const el = notice('<p>Not enough credits</p><button>Upgrade</button>');
    el.style.display = 'none';
    expect(findCreditsExhaustedNotice()).toBeNull();
  });
});

/* The markup below is verbatim from a live Flow page during a run. It is the
   whole reason this detector changed: the popover is data-state="closed", so
   the message the first version looked for is not in the DOM at all until
   someone hovers the icon — and nobody hovers anything during automation. */
describe('the orange alert sphere', () => {
  const REAL_MARKUP = `
    <div data-state="closed" class="sc-5c3af813-15 FuwbR" bis_skin_checked="1">
      <img src="/fx/icons/flow_alert_sphere.svg" alt=""
           class="sc-f803b119-0 bhyZfD sc-5c3af813-16 kJLxql"
           crossorigin="anonymous" style="opacity: 1;">
      <i class="google-symbols" font-size="1rem" color="black">info</i>
    </div>`;

  function mountIndicator(): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = REAL_MARKUP;
    document.body.append(host);
    for (const n of Array.from(host.querySelectorAll<HTMLElement>('*'))) {
      sized(n, 24, 24);
      Object.defineProperty(n, 'innerText', { get: () => n.textContent || '' });
    }
    return host.firstElementChild as HTMLElement;
  }

  it('is found while its popover is still closed', () => {
    mountIndicator();
    // The first version of this detector needed the message, and returned
    // null here — which is every moment of a real run.
    expect(findCreditsExhaustedNotice()).toBeNull();
    expect(findFlowAlertIndicator()).not.toBeNull();
  });

  it('resolves to the element carrying the popover, not the img', () => {
    mountIndicator();
    expect(findFlowAlertIndicator()!.getAttribute('data-state')).toBe('closed');
  });

  it('reads the message once the popover opens', async () => {
    const trigger = mountIndicator();
    // Stand in for Radix: opening on hover, mounting the content elsewhere.
    trigger.addEventListener('pointerover', () => {
      trigger.setAttribute('data-state', 'open');
      const pop = document.createElement('div');
      pop.setAttribute('data-state', 'open');
      pop.textContent =
        'Not enough Google Flow credits to perform this action. ' +
        'Try other settings or upgrade for more Google Flow credits.';
      sized(pop, 220, 160);
      Object.defineProperty(pop, 'innerText', { get: () => pop.textContent || '' });
      document.body.append(pop);
    });

    const message = await readFlowAlertMessage();
    expect(message).toMatch(/not enough google flow credits/i);
    expect(readsAsCreditsExhausted(message)).toBe(true);
  });

  it('does not call an unrelated warning a credits problem', async () => {
    const trigger = mountIndicator();
    trigger.addEventListener('pointerover', () => {
      const pop = document.createElement('div');
      pop.setAttribute('data-state', 'open');
      pop.textContent = 'This aspect ratio is not supported by the selected model.';
      sized(pop, 260, 90);
      Object.defineProperty(pop, 'innerText', { get: () => pop.textContent || '' });
      document.body.append(pop);
    });

    // The sphere means "Flow is unhappy", not "out of credits". Aborting a
    // whole run on the icon alone would kill it over a settings warning.
    const message = await readFlowAlertMessage();
    expect(message).toBeTruthy();
    expect(readsAsCreditsExhausted(message)).toBe(false);
  });

  it('reports nothing when there is no alert at all', async () => {
    expect(findFlowAlertIndicator()).toBeNull();
    expect(await readFlowAlertMessage()).toBe('');
    expect(readsAsCreditsExhausted('')).toBe(false);
  });

  it('does not mistake a balance readout for a refusal', () => {
    expect(readsAsCreditsExhausted('1,240 credits')).toBe(false);
  });
});

describe('what the runner does with it', () => {
  const CREDITS =
    'Google Flow is out of credits — the generation was refused before it started. ' +
    'Top up or wait for your quota to reset, then run again.';

  it('stops the whole run', () => {
    expect(isRunFatal(CREDITS)).toBe(true);
  });

  it('does not retry it', () => {
    // A retry spends the same refusal again and delays the real message.
    expect(isTransientFailure(CREDITS)).toBe(false);
  });

  it('lets ordinary failures carry on to independent branches', () => {
    for (const msg of [
      'Generate button not found on the Flow page',
      'No result after 22 minutes. The generation may still be running',
      'Connected prompt node is empty — type a prompt before running',
      'Lost connection to the Flow tab',
    ]) {
      expect({ msg, fatal: isRunFatal(msg) }).toEqual({ msg, fatal: false });
    }
  });
});
