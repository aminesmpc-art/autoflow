/**
 * The free STUDIO allowance — workflow runs — in the three places that state it.
 *
 * Not to be confused with the Flow extension's daily prompt allowance, which
 * is FREE_TEXT_DAILY_LIMIT and a different number for a different product.
 * Conflating the two is how these got raised to fifty by mistake: "the free
 * limit" is ambiguous until you say which extension.
 *
 * The panel shows "n/15 runs". The server stops a free account at
 * FREE_STUDIO_MONTHLY_LIMIT. Those were 15 and 10 — so a free user was cut off
 * five runs before the number in front of them said they would be, and the
 * only clue was a refusal that looked like a bug.
 *
 * Nothing connected the two. The server is the authority and the panel is a
 * display of it, which is exactly the shape that drifts silently: changing one
 * is a one-line edit that leaves the other lying.
 *
 * So the display is checked against the source of truth, by reading the Python
 * that defines it. Not elegant, and there is no shared build between a Django
 * app and a Chrome extension — a test is the only thing that spans them.
 */

/// <reference types="node" />

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PANEL = readFileSync(join(__dirname, '..', 'sidepanel', 'index.ts'), 'utf8');
const STORE = readFileSync(join(__dirname, '..', 'studio', 'store.ts'), 'utf8');

/* apps/ is what Railway deploys. backend/ is a stale copy that is not
   deployed, so reading it would check the display against a number nobody is
   served. */
const SERVICES = join(__dirname, '..', '..', '..', 'apps', 'plans', 'services.py');

const panelLimit = (): number => {
  const m = PANEL.match(/const FREE_RUNS_PER_MONTH = (\d+);/);
  return m ? Number(m[1]) : NaN;
};

/* The canvas keeps its own. Missed the first time this was raised, which is
   the whole argument for checking every copy rather than the two you happen
   to remember. */
const canvasLimit = (): number => {
  const m = STORE.match(/runsPerMonth: (\d+)/);
  return m ? Number(m[1]) : NaN;
};

const serverLimit = (): number => {
  const src = readFileSync(SERVICES, 'utf8');
  const m = src.match(/FREE_STUDIO_MONTHLY_LIMIT = getattr\(settings, "FREE_STUDIO_MONTHLY_LIMIT", (\d+)\)/);
  return m ? Number(m[1]) : NaN;
};

describe('what a free account is allowed', () => {
  it('is stated as a number in the panel', () => {
    expect(Number.isFinite(panelLimit())).toBe(true);
  });

  (existsSync(SERVICES) ? it : it.skip)('is the same number the server enforces', () => {
    /* The whole point. A client that promises more than the server allows
       produces a refusal the user cannot account for; one that promises less
       withholds runs they have paid nothing for and are owed. */
    expect(panelLimit()).toBe(serverLimit());
  });

  (existsSync(SERVICES) ? it : it.skip)('is that number on the canvas too', () => {
    /* The canvas is where a run is actually blocked, so this is the copy that
       decides. It was still ten when the other two went to fifty. */
    expect(canvasLimit()).toBe(serverLimit());
  });

  (existsSync(SERVICES) ? it : it.skip)('is ten workflow runs a month', () => {
    /* Ten is the Studio number. Fifty is the Flow extension's daily prompt
       allowance — a different product, a different counter, and the reason
       this test now says which one it is checking. */
    expect(serverLimit()).toBe(10);
    expect(panelLimit()).toBe(10);
    expect(canvasLimit()).toBe(10);
  });

  it('says where the authority lives, next to the copy of it', () => {
    /* The comment is the only thing that tells the next person editing this
       constant that there is a second one. */
    const at = PANEL.indexOf('const FREE_RUNS_PER_MONTH');
    expect(PANEL.slice(Math.max(0, at - 500), at))
      .toMatch(/apps\/plans\/services\.py/);
  });
});
