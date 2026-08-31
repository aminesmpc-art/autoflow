/**
 * The On/Off toggles, in a Flow that is not in English.
 *
 * ── The bug this exists to keep out ───────────────────────────────────────
 *
 * matchesFlowText matches by substring, which is right for aria-labels because
 * sites decorate them. But for this one key pair the negation prefix hides the
 * positive word inside itself:
 *
 *     "désactivé"    contains  "activé"      FR
 *     "desactivado"  contains  "activado"    ES
 *     "desativado"   contains  "ativado"     PT
 *     "disattivato"  contains  "attivato"    IT
 *     "사용 안함"      contains  "사용"          KO
 *
 * So ensureToggleOn's test for the ON button answered true for the OFF button,
 * and Radix renders OFF first — it was the one found. An already-off toggle
 * reported "already ON" and was left off; an already-on toggle was clicked OFF.
 * Either way both toggles stayed off for the entire run.
 *
 * clearPromptOnSubmit is the one that hurts: without it Flow keeps the last
 * prompt in the box, so every later prompt in a batch lands on top of the one
 * before it. The run does not fail — it produces the wrong thing, quietly, and
 * only in five of the languages we ship.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

import { FLOW_STRINGS, matchesFlowText } from '../content/flow/flowStrings';

type Key = keyof typeof FLOW_STRINGS;

/** The test as automation.ts performs it. Kept in step by the source check below. */
const readsAsOn = (label: string) =>
  !matchesFlowText(label, 'toggleOff') && matchesFlowText(label, 'toggleOn');

describe('telling On from Off', () => {
  it('reads every shipped ON label as on', () => {
    for (const on of FLOW_STRINGS.toggleOn) {
      expect({ label: on, on: readsAsOn(on) }).toEqual({ label: on, on: true });
    }
  });

  it('reads no shipped OFF label as on', () => {
    /* Before the fix this failed on French, Spanish, Portuguese, Italian and
       Korean. Naming them individually is what makes a regression legible. */
    for (const off of FLOW_STRINGS.toggleOff) {
      expect({ label: off, on: readsAsOn(off) }).toEqual({ label: off, on: false });
    }
  });

  it('still reads the exact French pair the report came from', () => {
    expect(readsAsOn('activé')).toBe(true);
    expect(readsAsOn('désactivé')).toBe(false);
  });
});

describe('antonym keys in general', () => {
  /* The same shape of bug is available to any opposed pair, so the pairs are
     enumerated rather than waiting for the next one to be found in the field. */
  const PAIRS: [Key, Key][] = [
    ['toggleOn', 'toggleOff'],
    ['showHistory', 'hideHistory'],
  ];

  it.each(PAIRS)('%s and %s do not contain each other', (a, b) => {
    const collisions: string[] = [];
    for (const [from, to] of [[a, b], [b, a]] as [Key, Key][]) {
      for (const word of FLOW_STRINGS[from]) {
        const hit = FLOW_STRINGS[to].find((x) => word.toLowerCase().includes(x.toLowerCase()));
        /* One direction is allowed to collide as long as the code checks the
           containing key first — which is exactly what readsAsOn does. Record
           it either way so a new entry cannot quietly add a second direction. */
        if (hit) collisions.push(`${from} "${word}" contains ${to} "${hit}"`);
      }
    }
    const oneWay = collisions.every((c) => c.startsWith(`${a === 'toggleOn' ? 'toggleOff' : a}`));
    expect(collisions.length === 0 || oneWay).toBe(true);
  });
});

describe('the guard is actually in the adapter', () => {
  const SRC = fs.readFileSync(
    path.resolve(__dirname, '../content/flow/automation.ts'), 'utf8',
  ).replace(/\r\n/g, '\n');

  it('excludes toggleOff before accepting toggleOn', () => {
    /* A source check because the logic lives inside a private method on a class
       that needs a live Flow page to construct. This is the cheap half of the
       guarantee; the behavioural half is readsAsOn above. */
    const fn = /const isOnButton =[\s\S]*?;/.exec(SRC);
    expect(fn).not.toBeNull();
    const body = (fn as RegExpExecArray)[0];
    expect(body).toContain("!matchesFlowText(label, 'toggleOff')");
    expect(body.indexOf('toggleOff')).toBeLessThan(body.indexOf("'toggleOn'"));
  });

  it('has no hand-added language literals left beside it', () => {
    /* It used to carry `|| label === 'activé'` — a one-language patch of this
       same bug. Those belong in flowStrings, not at the call site. */
    const body = (/const isOnButton =[\s\S]*?;/.exec(SRC) as RegExpExecArray)[0];
    expect(body).not.toMatch(/label === '/);
  });
});
