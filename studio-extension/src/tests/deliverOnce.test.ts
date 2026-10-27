/**
 * Every reference went to Gemini twice.
 *
 * The Director's brief showed two identical character images, and every piece
 * two identical 0:07 clips. The runner sent one — motionPieceAsk goes out with
 * [p.dataUrl], a single-element list — so the doubling was in the adapter:
 *
 *   composer.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }));
 *   composer.dispatchEvent(new DragEvent('drop', { dataTransfer: dt }));
 *
 * Two delivery routes, the same files, fired back to back with nothing between
 * them. Gemini took both. The check afterwards was `arrived >= files.length`,
 * so two-for-one passed, and nothing said anything.
 *
 * The routes stay, in the same order. What these tests hold is that they are
 * never simultaneous.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

import { deliverOnce, type DeliveryRoute } from '../content/shared/deliverOnce';

const BUDGET = 2000;

/** A clock that only moves when the code under test sleeps. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms; },
    at: () => t,
  };
}

/** A route that records being fired, and says whether it could be. */
function route(name: string, fired: string[], can = true): DeliveryRoute {
  return { name, fire: () => { fired.push(name); return can; } };
}

describe('one route at a time', () => {
  it('stops at the first route the page takes', () => {
    /* The bug, directly. Paste lands; the drop must never follow it. */
    const clock = fakeClock();
    const fired: string[] = [];
    let landed = false;
    const routes = [
      { name: 'paste', fire: () => { fired.push('paste'); landed = true; return true; } },
      route('drop', fired),
      route('file input', fired),
    ];
    return deliverOnce(routes, () => landed, BUDGET, clock).then((out) => {
      expect(fired).toEqual(['paste']);
      expect(out).toEqual({ took: 'paste', fired: 'paste' });
    });
  });

  it('moves on only when the route before it did not show up', async () => {
    const clock = fakeClock();
    const fired: string[] = [];
    let landed = false;
    const routes = [
      route('paste', fired),
      { name: 'drop', fire: () => { fired.push('drop'); landed = true; return true; } },
      route('file input', fired),
    ];
    const out = await deliverOnce(routes, () => landed, BUDGET, clock);
    expect(fired).toEqual(['paste', 'drop']);
    expect(out.took).toBe('drop');
    /* And paste really was given its whole budget first. */
    expect(clock.at()).toBeGreaterThanOrEqual(BUDGET);
  });

  it('spends no time on a route that could not even be attempted', async () => {
    /* No composer means no paste. Waiting 2s for a chip that nothing could
       produce would be pure delay. */
    const clock = fakeClock();
    const fired: string[] = [];
    let landed = false;
    const routes = [
      route('paste', fired, false),
      { name: 'drop', fire: () => { fired.push('drop'); landed = true; return true; } },
    ];
    const out = await deliverOnce(routes, () => landed, BUDGET, clock);
    expect(out.took).toBe('drop');
    expect(clock.at()).toBe(0);
  });

  it('credits a late arrival instead of firing the next route over it', async () => {
    /* The chip mounts ~400ms after hand-over and the old fallback looked at
       300ms, so a paste that had worked could read as a failure. Here it
       lands right at the edge of its budget — the drop must still not fire. */
    const clock = fakeClock();
    const fired: string[] = [];
    const routes = [route('paste', fired), route('drop', fired), route('file input', fired)];
    const out = await deliverOnce(routes, () => clock.at() >= BUDGET, BUDGET, clock);
    expect(fired).toEqual(['paste']);
    expect(out.took).toBe('paste');
  });

  it('lets a slow route back out when a file lands while it prepares', async () => {
    /* Revealing Gemini's file input opens a menu. A drop given up on can land
       during that, and filling the input afterwards would be a second copy. */
    const clock = fakeClock();
    const fired: string[] = [];
    let landed = false;
    const routes: DeliveryRoute[] = [
      route('paste', fired),
      route('drop', fired),
      {
        name: 'file input',
        fire: async (alreadyArrived) => {
          await clock.sleep(700);  // opening the menu
          landed = true;           // …and the drop turns up meanwhile
          if (alreadyArrived()) return false;
          fired.push('file input');
          return true;
        },
      },
    ];
    const out = await deliverOnce(routes, () => landed, BUDGET, clock);
    expect(fired).toEqual(['paste', 'drop']);
    /* Honest about not knowing which one it was: the wait downstream confirms
       it, rather than a guess being logged as fact. */
    expect(out).toEqual({ took: null, fired: 'drop' });
  });

  it('treats a route that throws as one that was not attempted', async () => {
    const clock = fakeClock();
    let landed = false;
    const routes: DeliveryRoute[] = [
      { name: 'paste', fire: () => { throw new Error('ClipboardEvent is not a constructor'); } },
      { name: 'drop', fire: () => { landed = true; return true; } },
    ];
    const out = await deliverOnce(routes, () => landed, BUDGET, clock);
    expect(out.took).toBe('drop');
    expect(clock.at()).toBe(0);
  });

  it('tells nothing-to-try apart from tried-and-not-seen', async () => {
    /* The first is a real failure, said at once. The second falls through to
       the 45s upload wait, which is what a slow site needs. */
    const clock = fakeClock();
    const none = await deliverOnce([route('paste', [], false)], () => false, BUDGET, clock);
    expect(none).toEqual({ took: null, fired: null });

    const unseen = await deliverOnce(
      [route('paste', []), route('file input', [])], () => false, BUDGET, fakeClock(),
    );
    expect(unseen).toEqual({ took: null, fired: 'file input' });
  });
});

describe('Gemini uses it', () => {
  const SRC = readFileSync(join(__dirname, '..', 'content', 'gemini', 'index.ts'), 'utf8');
  const start = SRC.indexOf('async function attachReferences');
  const fn = SRC.slice(start, SRC.indexOf('\n}\n', start));

  it('delivers through deliverOnce, with the three routes in order', () => {
    expect(fn).toMatch(/await deliverOnce\(/);
    const paste = fn.indexOf("name: 'paste'");
    const drop = fn.indexOf("name: 'drop'");
    const input = fn.indexOf("name: 'file input'");
    expect(paste).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(paste);
    expect(input).toBeGreaterThan(drop);
  });

  it('no longer fires the paste and the drop from the same place', () => {
    /* Each dispatch lives inside its own route's fire(). Two dispatches in one
       block is the exact shape that sent every file twice. */
    const pasteAt = fn.indexOf("new ClipboardEvent('paste'");
    const dropAt = fn.indexOf("new DragEvent('drop'");
    const between = fn.slice(pasteAt, dropAt);
    expect(between).toMatch(/name: 'drop'/);
  });

  it('decides a route took on the chip, not on the finished upload', () => {
    /* Deciding on settled media would mean deciding late, and firing the next
       route over a file already on its way. */
    expect(fn).toMatch(/const chipBaseline = attachmentCount\(\)/);
    expect(fn).toMatch(/return attachmentCount\(\) > chipBaseline;/);
  });

  it('says so when more arrived than was sent', () => {
    /* `>=` is right for "all arrived" and blind to "one arrived twice". */
    expect(fn).toMatch(/arrived > files\.length/);
    expect(fn).toMatch(/delivered twice/);
  });

  it('checks again before filling the file input', () => {
    const route = fn.slice(fn.indexOf("name: 'file input'"));
    const reveal = route.indexOf('await revealFileInput()');
    const check = route.indexOf('alreadyArrived()');
    const fill = route.indexOf('input.files = dt.files');
    expect(reveal).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(reveal);
    expect(fill).toBeGreaterThan(check);
  });
});
