/**
 * @jest-environment jsdom
 *
 * Image mode's Generate takes only trusted events (measured by AutoFlow on
 * 2026-10-19): scripted clicks, pointer sequences and Enter all did nothing;
 * calling its own handler with the click reporting isTrusted submitted.
 * Studio pressed with React handlers Angular Flow does not have, then Enter,
 * then scripted clicks — so a Flow image node never submitted. pagePress
 * records button click handlers from document_start and calls them that way.
 * Ported from AutoFlow with its test.
 */
/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { installListenerRegistry, pressWithPageHandler } from '../content/flow/pagePress';

installListenerRegistry();

/** A handler shaped like Flow's: it ignores any click that is not trusted. */
function flowLikeButton() {
  const btn = document.createElement('button');
  document.body.append(btn);
  const seen: Array<{ trusted: boolean; target: unknown }> = [];
  btn.addEventListener('click', (e) => { if (e.isTrusted) seen.push({ trusted: true, target: e.target }); });
  return { btn, seen };
}

describe('pressing a handler that refuses scripted clicks', () => {
  it('a scripted click is refused, as on Flow', () => {
    const { btn, seen } = flowLikeButton();
    btn.click();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(seen).toHaveLength(0);
  });

  it('its own handler, called with the click reporting trusted, accepts it', () => {
    const { btn, seen } = flowLikeButton();
    expect(pressWithPageHandler(btn)).toEqual({ ok: true, handlers: 1 });
    expect(seen).toEqual([{ trusted: true, target: btn }]);
  });

  it('forgets a handler the page removed, and says so when there is none', () => {
    const btn = document.createElement('button');
    const handler = () => {};
    btn.addEventListener('click', handler);
    btn.removeEventListener('click', handler);
    expect(pressWithPageHandler(btn)).toEqual({ ok: false, reason: 'no-handler' });
    expect(pressWithPageHandler(null)).toEqual({ ok: false, reason: 'gone' });
  });

  it('keeps only button clicks, and never breaks the page\'s own listeners', () => {
    const div = document.createElement('div');
    let ran = 0;
    div.addEventListener('click', () => { ran++; });
    div.click();
    expect(ran).toBe(1);
    expect(pressWithPageHandler(div)).toEqual({ ok: false, reason: 'no-handler' });
  });
});

describe('who uses it', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');
  const SW = read('content', 'flow', 'sw-bypass.ts');
  const ENGINE = read('content', 'flow', 'automation.ts');
  const at = ENGINE.indexOf('private async clickGenerate');
  const click = ENGINE.slice(at, at + 20000);

  it('the interceptor installs the recorder before its install guard can return, and answers PRESS by token', () => {
    expect(SW.indexOf('installListenerRegistry();')).toBeLessThan(SW.indexOf('(() => {'));
    expect(SW).toMatch(/d\.type !== 'PRESS'\) return;/);
    expect(SW).toMatch(/relay\('PRESS_RESULT', \{ token, \.\.\.pressWithPageHandler\(el\) \}\)/);
  });

  it('image mode presses through the handler first; video mode keeps its presses', () => {
    const image = click.indexOf("if (this.queue?.settings.mediaType === 'image') {\n      beforeSubmit?.();\n      const pressed = await pressThroughPage(btn);");
    expect(image).toBeGreaterThan(-1);
    expect(image).toBeLessThan(click.indexOf("const trig1 = await reactTrigger(btn, 'onPointerDown');"));
  });

  it('says what to do when the tab predates the recorder', () => {
    expect(click).toMatch(/pressed\.reason === 'no-handler' \? 'reload the Flow tab/);
  });
});
