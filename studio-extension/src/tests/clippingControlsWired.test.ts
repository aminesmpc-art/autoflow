/**
 * Every control on the Clipping node reaches the pipeline.
 *
 * ── The one that did not ──────────────────────────────────────────────────
 *
 * "Worth posting, above" is a slider from 30 to 95. It wrote minClipScore to
 * the node, STAGE_FOR_SETTING invalidated the survey when it changed, and the
 * survey read cfg.minClipScore. Every piece was there except the one that
 * carried the value between them: WorkflowRunner never put minClipScore into
 * the config it built, so the threshold was always the built-in 60 wherever
 * the handle sat.
 *
 * It hid because the node's own default is 60 too. At rest the control agreed
 * with the pipeline; only moving it did nothing — and "I asked for 80 and got
 * clips scoring 62" is not a thing anyone notices, because the score is not
 * shown next to the request.
 *
 * ── Why this is a rule and not a test of one field ────────────────────────
 *
 * A dead control is invisible by construction: it saves, it re-renders, it
 * survives a reload, and it invalidates the right stage. Nothing about using
 * it says it does nothing. So the guard is over the whole class — every field
 * the config declares that a control writes must be passed on — rather than
 * over the single field that happened to be caught.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

const NODE = read('../studio/nodes/ClippingNode.tsx');
const RUNNER = read('../studio/engine/WorkflowRunner.ts');
const RUN_CLIP = read('../studio/clip/runClip.ts');

/** Keys the node's controls write, read off the source rather than listed. */
function controlKeys(): string[] {
  const keys = new Set<string>();
  for (const m of NODE.matchAll(/changeSetting\(\{\s*([a-zA-Z]+)\s*:/g)) keys.add(m[1]);
  /* Multi-line calls: changeSetting({\n  key: … */
  for (const m of NODE.matchAll(/changeSetting\(\{\s*\n\s*([a-zA-Z]+)\s*:/g)) keys.add(m[1]);
  return Array.from(keys).sort();
}

/** Strip comments, so prose about a field cannot stand in for the field. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/**
 * The clip config the runner hands to the stages, comments removed.
 *
 * Removing them is not tidiness. The first version of this guard matched the
 * raw block, and the comment explaining the minClipScore bug — written INSIDE
 * that block — satisfied the check for minClipScore. Reverting the fix left
 * the general rule green and only the named test red, which is precisely
 * backwards: the rule is the part meant to catch the NEXT one.
 */
function runnerConfigBody(): string {
  const m = /const cfg = \{[\s\S]*?\n {4}\};/.exec(RUNNER);
  if (!m) throw new Error('could not find the clip config in WorkflowRunner');
  return code(m[0]);
}

/** Fields ClipConfig declares. */
function configFields(): string[] {
  const m = /export interface ClipConfig \{[\s\S]*?\n\}/.exec(RUN_CLIP) as RegExpExecArray;
  return Array.from(m[0].matchAll(/^\s{2}([a-zA-Z]+)\??:/gm)).map((x) => x[1]);
}

describe('the controls the node offers', () => {
  it('finds them all, so this test cannot pass by finding none', () => {
    const keys = controlKeys();
    expect(keys.length).toBeGreaterThanOrEqual(12);
    /* A few by name, so a change to the scraping shows up here rather than
       silently shrinking the set it checks. */
    for (const k of ['platform', 'clipMode', 'captions', 'minClipScore', 'omniParts']) {
      expect({ key: k, found: keys.includes(k) }).toEqual({ key: k, found: true });
    }
  });

  it('every control reaches the config the runner builds', () => {
    /* The rule. A control whose key never appears in the config is a control
       that does nothing, however completely the rest of it is wired. */
    const cfg = runnerConfigBody();

    /* Keys the config carries under a different name, with the reason. */
    const RENAMED: Record<string, string> = {
      clipMode: 'mode',            // ClipMode is the pipeline's word
      wantedClips: 'clipCount',    // how many to come back with
      aspect: 'targetAspect',      // a ratio, not a label
    };

    const dead = controlKeys().filter((k) => {
      const inCfg = RENAMED[k]
        ? new RegExp(`\\b${RENAMED[k]}:`).test(cfg)
        : new RegExp(`\\b${k}\\b`).test(cfg);
      return !inCfg;
    });

    expect({ dead }).toEqual({ dead: [] });
  });

  it('minClipScore specifically, since that is the one that was dead', () => {
    expect(runnerConfigBody()).toMatch(/minClipScore: typeof nodeData\.minClipScore === 'number'/);
  });
});

describe('the settings that change what a re-run produces', () => {
  it('every control names the stage it invalidates', () => {
    /* A setting missing from STAGE_FOR_SETTING saves without re-running
       anything, so the node shows a finished run that no longer matches its
       own controls. */
    const m = /const STAGE_FOR_SETTING: Record<string, StageId> = \{[\s\S]*?\n\};/.exec(NODE);
    expect(m).not.toBeNull();
    const mapped = new Set(
      Array.from((m as RegExpExecArray)[0].matchAll(/^\s{2}([a-zA-Z]+):/gm)).map((x) => x[1]),
    );
    const unmapped = controlKeys().filter((k) => !mapped.has(k));
    expect({ unmapped }).toEqual({ unmapped: [] });
  });

  it('only names stages that exist', () => {
    const m = /const STAGE_FOR_SETTING: Record<string, StageId> = \{[\s\S]*?\n\};/
      .exec(NODE) as RegExpExecArray;
    const stages = new Set(
      Array.from(m[0].matchAll(/:\s*'([a-z]+)'/g)).map((x) => x[1]),
    );
    /* A typo here is silent: the lookup misses, no stage is invalidated, and
       the setting behaves exactly like an unmapped one. */
    const known = new Set(
      Array.from(read('../studio/clip/stages.ts').matchAll(/'([a-z]+)'/g)).map((x) => x[1]),
    );
    for (const s of stages) {
      expect({ stage: s, known: known.has(s) }).toEqual({ stage: s, known: true });
    }
  });
});

describe('nothing the config declares is left unfilled by accident', () => {
  it('reports which ClipConfig fields the runner never sets', () => {
    /* Not every field is the node's to fill — sourceKey and pastedTranscript
       come from the run, not a control. Those are named here so the list is a
       decision rather than an oversight, and anything NEW that goes unfilled
       fails until somebody says which it is. */
    const FROM_THE_RUN = new Set(['sourceKey', 'pastedTranscript']);
    const cfg = runnerConfigBody();
    const missing = configFields()
      .filter((f) => !FROM_THE_RUN.has(f))
      .filter((f) => !new RegExp(`\\b${f}\\b`).test(cfg));

    expect({ missing }).toEqual({ missing: [] });
  });
});
