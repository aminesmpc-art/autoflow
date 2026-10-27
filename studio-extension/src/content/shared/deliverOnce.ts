/**
 * Hand files to a chat composer by exactly ONE route.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Gemini's adapter fired a paste and then a drop, back to back, carrying the
 * same DataTransfer, with nothing between them. Written as belt and braces —
 * "works across modes without menu clicks" — it assumed at most one would
 * take. Gemini started accepting both, and every reference arrived twice:
 * two identical character images on the Director's brief, two identical
 * 0:07 clips on every piece.
 *
 * Nothing noticed, because the check afterwards was `arrived >= files.length`
 * and two is at least one.
 *
 * The routes are still worth having in order — a site that ignores synthetic
 * paste may take a drop, and one that takes neither still has a file input.
 * What they must not be is SIMULTANEOUS. Each is tried only once the one
 * before it has had time to show up and did not.
 *
 * ── The budget, and the late arrival ──────────────────────────────────────
 *
 * "Had time to show up" is measured, not assumed: Gemini's chip mounts about
 * 400ms after the file is handed over, and the old fallback looked after a
 * flat 300ms — a paste that had worked could still read as a failure and let
 * the file input fire a third copy.
 *
 * And a route given up on can still land after its budget ran out. So before
 * every route after the first, the probe is read again: if the previous one
 * turned up late, it gets the credit and nothing else fires.
 */

export interface DeliveryRoute {
  /** For the log, so a run can say which route the site took. */
  name: string;
  /**
   * Fire it. Return false when the route could not even be attempted — no
   * composer, no file input — so the next is tried without waiting out a
   * budget for something that never happened.
   *
   * `alreadyArrived` is for a route that has to PREPARE before it can hand
   * anything over. Revealing a file input means opening the site's menu, and
   * a route given up on can land while that happens; filling the input
   * afterwards would deliver the file a second time. Such a route checks this
   * last thing before it commits, and backs out if it is true.
   */
  fire: (alreadyArrived: () => boolean) => boolean | Promise<boolean>;
}

export interface DeliveryOutcome {
  /** The route the page visibly took, or null. */
  took: string | null;
  /**
   * The last route actually fired, or null when none could be. Distinguishes
   * "nothing to try" — a real failure, say so now — from "tried, not seen
   * yet", which a longer wait downstream may still confirm.
   */
  fired: string | null;
}

export interface DeliveryDeps {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const POLL_MS = 100;

export async function deliverOnce(
  routes: DeliveryRoute[],
  arrived: () => boolean,
  budgetMs: number,
  deps: DeliveryDeps = {},
): Promise<DeliveryOutcome> {
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now || Date.now;
  let fired: string | null = null;

  for (const route of routes) {
    /* A late arrival from the route before. Firing this one now is exactly
       how a file ends up in the composer twice. */
    if (fired && arrived()) return { took: fired, fired };

    let attempted = false;
    try {
      attempted = (await route.fire(arrived)) === true;
    } catch {
      attempted = false;
    }
    if (!attempted) continue;
    fired = route.name;

    const until = now() + budgetMs;
    do {
      if (arrived()) return { took: route.name, fired };
      await sleep(POLL_MS);
    } while (now() < until);
    if (arrived()) return { took: route.name, fired };
  }

  return { took: null, fired };
}
