/**
 * Flow renamed Omni, and Studio could not find it.
 *
 * ── What happened ─────────────────────────────────────────────────────────
 *
 * Flow's model menu started rendering "Omni 1.1 Flash". Every template,
 * default and saved workflow in this codebase said "Omni Flash". setModel
 * matched candidates two ways — exact, then substring — and the version number
 * lands in the MIDDLE of the name, so neither could see it:
 *
 *     "omni 1.1 flash" !== "omni flash"            (not exact)
 *     "omni 1.1 flash".includes("omni flash")      (false — "1.1" is between)
 *
 * Both tiers returned nothing. `loose.length` was 0, so even the "matches more
 * than one model, refusing to guess" warning stayed quiet. The model was never
 * selected, the run went ahead on whatever Flow had last, and what the user saw
 * was "Generation failed" with nothing in the log pointing at the model.
 *
 * ── The fix, and why it is a third tier rather than a rename ───────────────
 *
 * Renaming the literals fixes today and breaks again at Omni 1.2. So matching
 * also got a last tier that ignores version numbers — used only after exact and
 * substring have both failed, and only when it identifies exactly one model.
 * That ordering is the whole safety argument, and the ambiguity test below is
 * what holds it: stripping versions turns "Nano Banana 2" into "nano banana",
 * which is a prefix of two other image models.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

import {
  AVAILABLE_MODELS, LEGACY_MODEL_NAMES, MODEL_RENAMES,
  modelHasDuration, modelHasResolution,
} from '../types';

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

const AUTOMATION = read('../content/flow/automation.ts');
const NODE = read('../studio/nodes/GenerateNode.tsx');
const RUNNER = read('../studio/engine/WorkflowRunner.ts');
const FLOW_INDEX = read('../content/flow/index.ts');

/* setModel's three tiers, mirrored so they can be exercised directly. The
   source checks at the bottom are what keep this copy honest. */
const norm = (t: string) => t.toLowerCase()
  .replace(/arrow_drop_down/g, '').replace(/[^a-z0-9.\s]/g, ' ')
  .replace(/\s+/g, ' ').trim();
const stripVersion = (s: string) =>
  s.replace(/\b\d+(\.\d+)*\b/g, ' ').replace(/\s+/g, ' ').trim();

/** Returns the chosen label, or null when setModel would refuse. */
function choose(target: string, onPage: readonly string[]): string | null {
  const t = norm(target);
  const cands = onPage.map((c) => ({ text: c, norm: norm(c) }));
  const exact = cands.filter((c) => c.norm === t);
  const loose = cands.filter((c) => c.norm.includes(t));
  const bare0 = stripVersion(t);
  const bare = bare0 ? cands.filter((c) => stripVersion(c.norm) === bare0) : [];
  const hit = exact[0]
    || (loose.length === 1 ? loose[0] : null)
    || (bare.length === 1 ? bare[0] : null);
  return hit ? hit.text : null;
}

describe('the failure that was reported', () => {
  const MENU = ['Omni 1.1 Flash', 'Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality'];

  it('finds the renamed model when asked for the old name', () => {
    /* This returned null before the fix, which is what "Generation failed" was. */
    expect(choose('Omni Flash', MENU)).toBe('Omni 1.1 Flash');
  });

  it('finds it when asked for the new name too', () => {
    expect(choose('Omni 1.1 Flash', MENU)).toBe('Omni 1.1 Flash');
  });

  it('will find the NEXT rename without another release', () => {
    /* The point of the third tier. Omni 1.2, 2.0, whatever comes. */
    expect(choose('Omni Flash', ['Omni 1.2 Flash', 'Veo 3.1 - Fast'])).toBe('Omni 1.2 Flash');
    expect(choose('Omni 1.1 Flash', ['Omni 2 Flash'])).toBe('Omni 2 Flash');
  });
});

describe('the tier that ignores versions cannot pick the wrong model', () => {
  const IMAGE = ['Nano Banana Pro', 'Nano Banana 2', 'Nano Banana 2 Lite'];

  it('still picks the exact image model, version-stripping never consulted', () => {
    /* "Nano Banana 2" stripped is "nano banana", a prefix of both others. An
       exact match exists, so tier 3 never runs — this is the ordering working. */
    expect(choose('Nano Banana 2', IMAGE)).toBe('Nano Banana 2');
    expect(choose('Nano Banana 2 Lite', IMAGE)).toBe('Nano Banana 2 Lite');
    expect(choose('Nano Banana Pro', IMAGE)).toBe('Nano Banana Pro');
  });

  it('refuses rather than guessing when a stripped name fits two models', () => {
    /* Equality on the stripped form, not substring: "nano banana" must not
       claim "nano banana pro". Two candidates strip to the same thing here, so
       the answer has to be null — a wrong model is a whole run wasted, and
       nothing downstream can tell. */
    expect(choose('Nano Banana 9', ['Nano Banana 2', 'Nano Banana 3'])).toBeNull();
  });

  it('does not let a Veo variant answer for another', () => {
    const VEO = ['Veo 3.1 - Lite', 'Veo 3.1 - Lite [Lower Priority]'];
    expect(choose('Veo 3.1 - Lite', VEO)).toBe('Veo 3.1 - Lite');
  });
});

describe('the name Studio offers and stores', () => {
  it('offers the name Flow actually renders', () => {
    expect(AVAILABLE_MODELS[0]).toBe('Omni 1.1 Flash');
  });

  it('does not offer the retired name in the dropdown', () => {
    expect(AVAILABLE_MODELS).not.toContain('Omni Flash');
  });

  it('rewrites saved work forwards, not backwards', () => {
    /* store.ts used to map 'Omni 1.1 Flash' -> 'Omni Flash' on every load,
       which undid the rename for anyone who had already saved the new name. */
    expect(MODEL_RENAMES['Omni Flash']).toBe('Omni 1.1 Flash');
    expect(MODEL_RENAMES['Omni 1.1 Flash']).toBeUndefined();
  });

  it('keeps the old name recognised so a saved workflow still runs', () => {
    expect(LEGACY_MODEL_NAMES).toContain('Omni Flash');
    for (const name of ['Omni 1.1 Flash', 'Omni Flash']) {
      expect({ name, duration: modelHasDuration(name) }).toEqual({ name, duration: true });
    }
  });

  it('no source file still defaults to the retired name', () => {
    const files: Array<[string, string]> = [
      ['automation.ts', AUTOMATION],
      ['WorkflowRunner.ts', RUNNER],
      ['flow/index.ts', FLOW_INDEX],
    ];
    for (const [file, src] of files) {
      expect({ file, stale: /'Omni Flash'/.test(src) }).toEqual({ file, stale: false });
    }
  });
});

describe('the resolution control Flow added', () => {
  it('is offered by Omni and not by Veo', () => {
    expect(modelHasResolution('Omni 1.1 Flash')).toBe(true);
    expect(modelHasResolution('Veo 3.1 - Fast')).toBe(false);
  });

  it('is Flow-only, so it cannot appear beside the Grok control', () => {
    /* The block it sits in is guarded by `!isChatGPT`, which also covers Grok
       and Gemini. Without the isFlow gate this control would render next to
       GrokSettings' resolution radio — two controls, different value sets. */
    expect(NODE).toMatch(/const isFlow = platform === 'flow';/);
    expect(NODE).toMatch(/\{isFlow && isVideo && modelHasResolution\(/);
  });

  it('writes its own field, never the Grok one', () => {
    /* Grok's `resolution` is 480p/720p/1080p. A node moved between platforms
       must not carry 1080p into Flow, which cannot select it. */
    expect(NODE).toMatch(/set\('renderResolution', r\)/);
    const block = /\{isFlow && isVideo && modelHasResolution\([\s\S]*?\n {14}\)\}/.exec(NODE);
    expect(block).not.toBeNull();
    expect((block as RegExpExecArray)[0]).not.toMatch(/set\('resolution'/);
  });

  it('reaches Flow: node -> runner -> adapter -> panel', () => {
    expect(RUNNER).toMatch(/renderResolution: nodeData\.renderResolution \|\| '720p'/);
    expect(FLOW_INDEX).toMatch(/renderResolution: \(config\.renderResolution \|\| '720p'\)/);
    expect(AUTOMATION).toMatch(/applyMenuItem\(\s*settings\.renderResolution/);
  });

  it('is skipped on models with no such row, and says so instead of warning', () => {
    /* Same lesson duration learned: asking a Veo panel for a control it does
       not have logged a warning that read like a failed click. */
    const blk = /if \(settings\.mediaType !== 'image' && settings\.renderResolution\)[\s\S]*?\n {4}\}/
      .exec(AUTOMATION);
    expect(blk).not.toBeNull();
    expect((blk as RegExpExecArray)[0]).toContain('modelHasResolution(settings.model)');
  });
});

describe('the mirrored logic above is the logic that ships', () => {
  it('automation.ts really has the three tiers, in order', () => {
    const i = AUTOMATION.indexOf('const exact = candidates.filter');
    const j = AUTOMATION.indexOf('const loose = candidates.filter');
    const k = AUTOMATION.indexOf('stripModelVersion(c.norm) === targetBare');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(k).toBeGreaterThan(j);
  });

  it('strips versions with a real regex, not a stray control character', () => {
    /* Written once with a literal backspace instead of \b, which compiles,
       runs, and silently matches nothing at all. */
    expect(AUTOMATION).toMatch(/norm\.replace\(\/\\b\\d\+\(\\\.\\d\+\)\*\\b\/g/);
    // eslint-disable-next-line no-control-regex
    expect(AUTOMATION).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  });

  it('only reaches the version tier when the first two find nothing', () => {
    const m = /const chosen = exact\[0\][\s\S]*?;/.exec(AUTOMATION) as RegExpExecArray;
    expect(m[0]).toMatch(/exact\[0\][\s\S]*loose\.length === 1[\s\S]*bare\.length === 1/);
  });
});
