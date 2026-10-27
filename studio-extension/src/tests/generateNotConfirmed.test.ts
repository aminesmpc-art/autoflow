/**
 * An empty project, a prompt still sitting in the composer, and a feed that
 * said everything was fine.
 *
 *   15:46:19  Flow  Fallback 1: dispatched Enter on prompt
 *   15:46:22  Flow  Fallback 2: simulateClick
 *   15:46:24  Flow  Fallback 3: native .click()
 *   15:46:26  Flow  WARN: All click strategies attempted — none confirmed
 *   15:46:29  Flow  [Lite] Generation started. Waiting 3s before next prompt...
 *
 * Read those last two lines together. The adapter says it could not confirm a
 * single click, and three seconds later says a generation started. Both were
 * printed by design: clickGenerate logged the warning and RETURNED, and a
 * normal return is the only way the caller has of learning that a prompt was
 * submitted. So the queue moved on, and kept moving, to the end of the board.
 *
 * The third time this shape has cost a run in this codebase — a step that
 * could not verify its own success reporting success anyway. The Gemini
 * adapter timed out holding a finished reply; the worker reported a reference
 * it had put in the wrong lane; this one reports a generation it never made.
 *
 * ── Why the clicks failed, measured on the live page ──
 *
 * The composer was read off a real Flow project rather than reasoned about:
 *
 *   button   aria-label="Start generation", type="submit",
 *            class="mdc-icon-button mat-mdc-icon-button … generate-icon-button"
 *   owner    __ngContext__ on the button, on flow-generate-icon-button and on
 *            flow-base-prompt-box. anyReactKeyOnPage: null.
 *   forms    document.querySelectorAll('form').length === 0
 *   editor   div.ProseMirror[contenteditable=true] — one on the page
 *
 * Three things follow, and all three are load-bearing:
 *
 * 1. There is no React on this build, so click strategies 1–3 — which reach
 *    for React's MAIN-world handlers — can never fire. Only the synthetic
 *    fallbacks run, which is exactly what the log shows.
 *
 * 2. `type="submit"` is decorative. With no form on the page there is no
 *    form-submit route to fall back to; Angular binds the click directly.
 *
 * 3. Disabled, the button computes `pointer-events: none` — elementFromPoint
 *    at its centre returns the WRAPPER, not the button. Enabled, the same hit
 *    test lands inside it. So a pointer-based strategy aimed at a disabled
 *    Generate button lands on nothing, which is why all three fallbacks can
 *    fail in silence and in order.
 *
 * The adapter waits 60s for the button to enable and then clicks anyway. That
 * attempt is kept — the disabled read could be wrong on a build nobody has
 * seen — but it is no longer allowed to end in a shrug.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const FLOW = readFileSync(
  join(__dirname, '..', 'content', 'flow', 'automation.ts'), 'utf8',
).replace(/\r\n/g, '\n');

/** clickGenerate's body, so a match cannot drift in from a sibling method. */
const clickGenerate = (): string => {
  const at = FLOW.indexOf('private async clickGenerate(');
  expect(at).toBeGreaterThan(-1);
  const end = FLOW.indexOf('\n  // -- Control methods --', at);
  expect(end).toBeGreaterThan(at);
  return FLOW.slice(at, end);
};

describe('a generation that was never made is not reported as one', () => {
  it('throws when no strategy confirmed, instead of returning', () => {
    const body = clickGenerate();
    const warn = body.indexOf("'All click strategies attempted — none confirmed'");
    expect(warn).toBeGreaterThan(-1);
    const after = body.slice(warn);
    expect(after).toMatch(/throw new Error\(/);
    /* And the throw must be the END of the method, not one branch of it —
       a `return` reachable after the warning is the bug coming back. */
    expect(after).not.toMatch(/\n    return;/);
  });

  it('tells the two causes apart', () => {
    /* They need different answers. A button that never enabled is Flow
       refusing the prompt, and no click route would have helped; a button
       that was enabled and did not respond is the route failing. */
    const body = clickGenerate();
    expect(body).toMatch(/!everEnabled && disabledNow/);
    expect(body).toMatch(/never enabled its Generate button/);
    expect(body).toMatch(/did not accept the Generate click/);
  });

  it('says plainly that nothing was submitted', () => {
    /* The message is read in a feed, next to a project the user can see is
       empty. It has to answer "did I pay for that?" without being asked. */
    const body = clickGenerate();
    expect(body).toMatch(/[Nn]othing was submitted/);
    expect(body).toMatch(/still in the composer/);
  });

  it('records whether Flow ever enabled the button', () => {
    const body = clickGenerate();
    expect(body).toMatch(/let everEnabled = false;/);
    expect(body).toMatch(/\{ everEnabled = true; break; \}/);
  });

  it('still checks credits before blaming the click', () => {
    /* Out of credits makes every strategy failing expected rather than a
       bug, and it throws its own, better message. It must stay ahead of the
       generic one. */
    const body = clickGenerate();
    const credits = body.lastIndexOf('await throwIfOutOfCredits();');
    const thrown = body.indexOf('did not accept the Generate click');
    expect(credits).toBeGreaterThan(-1);
    expect(credits).toBeLessThan(thrown);
  });
});

describe('the failure reaches the prompt it belongs to', () => {
  it('is raised inside the per-prompt retry loop', () => {
    /* So the submit is retried once — clicking a moment too early is the
       ordinary cause — and then THIS prompt is marked failed, rather than the
       queue marching on or the whole run dying. */
    const call = FLOW.indexOf('await this.clickGenerate();');
    const loop = FLOW.indexOf('while (attempts <= MAX_RETRIES)');
    const katch = FLOW.indexOf('} catch (err: any) {', call);
    expect(loop).toBeGreaterThan(-1);
    expect(loop).toBeLessThan(call);
    expect(katch).toBeGreaterThan(call);
  });
});

describe('Lite mode claims only what it watched', () => {
  it('does not announce a start it never checked for', () => {
    /* Lite does not poll, by design. That is a reason to say less, not a
       licence to assert more — and this exact line is what the user was
       reading while the project stayed empty. */
    const at = FLOW.indexOf("if (this.mode === 'lite')");
    expect(at).toBeGreaterThan(-1);
    const body = FLOW.slice(at, at + 1400);
    expect(body).toMatch(/newTileIds\.length > 0/);
    expect(body).toMatch(/no tile on screen yet/);
    expect(body).not.toMatch(/`\[Lite\] Generation started\. Waiting/);
  });

  it('does not treat a missing tile as a failure either', () => {
    /* Two seconds is not long enough for a tile to be proof of anything. The
       line reports what was seen; it does not decide the run on it. */
    const at = FLOW.indexOf("if (this.mode === 'lite')");
    const body = FLOW.slice(at, at + 1400);
    expect(body).not.toMatch(/throw new Error/);
    expect(body).toMatch(/await sleep\(liteWaitMs\)/);
  });
});

describe('what the live page says about this build', () => {
  /* Recorded so the next person does not re-derive it from the code. Every
     line here was read off a real Flow project, not inferred. */
  it('is written down where the strategies are', () => {
    const body = clickGenerate();
    expect(body).toMatch(/pointer-events/);
    expect(body).toMatch(/elementFromPoint/);
  });

  it('keeps the React strategies, which cost nothing when absent', () => {
    /* They are still right for the old Next.js Flow, and reactTrigger simply
       reports not-found here. Removing them would trade one site working for
       another, which is not a trade worth making on one measurement. */
    const body = clickGenerate();
    expect(body).toMatch(/reactTrigger\(btn, 'onPointerDown'\)/);
    expect(body).toMatch(/let reactSeen = false;/);
    expect(body).toMatch(/No React handlers on the Generate button/);
  });
});
