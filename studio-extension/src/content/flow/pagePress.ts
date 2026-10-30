/**
 * Pressing a button whose handler refuses scripted events.
 *
 * Measured live 2026-10-19 on Flow's image mode (Nano Banana 2.1), with the
 * prompt typed and Generate enabled: element.click(), a full synthetic
 * pointer/mouse/click sequence and a dispatched Enter all did nothing, while
 * a real click submitted at once. Calling the button's own click handler with
 * the same event reporting isTrusted: true submitted too — so the handler
 * checks isTrusted, and nothing else. Video mode still takes the plain
 * scripted presses.
 *
 * Flow is Angular without zone.js, so its handlers sit on the element through
 * plain addEventListener, where nothing outside can read them back. This
 * records click handlers on buttons as they are registered — so it has to run
 * at document_start, in the MAIN world, before Angular renders — and calls
 * them itself. No debugger and no extra permission; the user chose this over
 * a chrome.debugger click.
 */

type Kept = { type: string; listener: EventListenerOrEventListenerObject; capture: boolean };
type Registry = WeakMap<EventTarget, Kept[]>;

export type PressResult = {
  ok: boolean;
  /** gone: no element; no-handler: none recorded (tab older than the recorder); threw: the handler threw. */
  reason?: 'gone' | 'no-handler' | 'threw';
  handlers?: number;
};

const registry = (): Registry | undefined => (window as any).__af_listeners;
const isCapture = (options: unknown) => (typeof options === 'boolean' ? options : !!(options as any)?.capture);

/** Record click handlers added to buttons from now on. Idempotent per page. */
export function installListenerRegistry(): void {
  const w = window as any;
  if (w.__af_listeners) return;
  const map: Registry = new WeakMap();
  w.__af_listeners = map;

  const proto = EventTarget.prototype;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;

  /* Buttons and click only: this wraps every addEventListener in the app, so
     anything it keeps has to be worth keeping. */
  const wrappedAdd = function (this: EventTarget, type: string, listener: any, options?: any) {
    try {
      if (listener && type === 'click' && this instanceof HTMLButtonElement) {
        const list = map.get(this) || [];
        list.push({ type, listener, capture: isCapture(options) });
        map.set(this, list);
      }
    } catch { /* never break the page's own registration */ }
    return add.call(this, type, listener, options);
  };
  const wrappedRemove = function (this: EventTarget, type: string, listener: any, options?: any) {
    try {
      const list = map.get(this);
      if (list) {
        const capture = isCapture(options);
        map.set(this, list.filter((l) => !(l.type === type && l.listener === listener && l.capture === capture)));
      }
    } catch { /* as above */ }
    return remove.call(this, type, listener, options);
  };
  /* Look like the originals, as the fetch patch does. */
  try {
    Object.defineProperty(wrappedAdd, 'name', { value: 'addEventListener' });
    Object.defineProperty(wrappedRemove, 'name', { value: 'removeEventListener' });
    wrappedAdd.toString = add.toString.bind(add);
    wrappedRemove.toString = remove.toString.bind(remove);
  } catch { /* cosmetic */ }
  proto.addEventListener = wrappedAdd as typeof add;
  proto.removeEventListener = wrappedRemove as typeof remove;
}

/** Call the element's recorded click handlers with a click that reports isTrusted. */
export function pressWithPageHandler(el: Element | null): PressResult {
  if (!el) return { ok: false, reason: 'gone' };
  const handlers = (registry()?.get(el) || []).filter((l) => l.type === 'click');
  if (!handlers.length) return { ok: false, reason: 'no-handler' };

  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const click = new MouseEvent('click', {
    bubbles: true, cancelable: true, composed: true, view: window,
    clientX: x, clientY: y, screenX: x, screenY: y, button: 0, detail: 1,
  });
  /* An event that was never dispatched has no target; a handler reading it
     gets the button, as it would from a real click. */
  const trusted = new Proxy(click, {
    get(target, prop) {
      if (prop === 'isTrusted') return true;
      if (prop === 'target' || prop === 'currentTarget' || prop === 'srcElement') return el;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  try {
    for (const { listener } of handlers) {
      if (typeof listener === 'function') listener.call(el, trusted);
      else listener.handleEvent(trusted);
    }
  } catch {
    return { ok: false, reason: 'threw', handlers: handlers.length };
  }
  return { ok: true, handlers: handlers.length };
}
