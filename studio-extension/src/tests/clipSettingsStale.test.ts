/**
 * A setting changed after the run has to un-finish what it made wrong.
 *
 * The clipping run is deliberately permanent — "just 1 time a life", because a
 * twenty-minute read cost 193 seconds and nobody should pay it twice for
 * re-opening a workflow. `advance` enforces that by skipping any stage already
 * settled.
 *
 * The settings that SHAPED those stages stayed editable, and nothing connected
 * the two. Ticking "Edit plan" on a finished run left the checkbox ticked, the
 * rail at 100%, and Run with no pending stage to work on — so the plan kept
 * planEdit: false, every cut kept it, no edit sheet was ever built, and
 * layOutBroll filtered an empty list and laid out no Flow cutaways. Nothing in
 * the product said why. That is what this file is about.
 *
 * The map lives in ClippingNode.tsx next to the controls it describes; what is
 * tested here is the RULE, which is the part that has to stay true:
 *
 *   · a setting read at layout time invalidates from layout, and no earlier —
 *     a caption preset must not throw away the transcript
 *   · a setting read during the survey invalidates from the survey
 *   · a patch touching two stages goes back to the earlier of them
 *   · stages before the invalidated one keep their results
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

import { emptyRun, invalidateFrom, STAGE_ORDER, type ClipRun, type StageId } from '../studio/clip/stages';

/** A run where everything finished, as it stands after a completed clipping. */
function finishedRun(): ClipRun {
  const run = emptyRun('src-1');
  for (const id of STAGE_ORDER) {
    run.stages[id] = { status: 'done', result: `${id}-result` };
  }
  return run;
}

/* The same table ClippingNode applies. Duplicated deliberately and asserted
   against the real file below, so this test cannot quietly describe a mapping
   the product no longer has. */
const EXPECTED: Record<string, StageId> = {
  readOnServer: 'transcribe',
  clipMode: 'survey',
  campaignRules: 'survey',
  wantedClips: 'survey',
  surveyCandidates: 'survey',
  minClipScore: 'survey',
  platform: 'survey',
  captions: 'layout',
  captionPreset: 'layout',
  planEdit: 'layout',
  omniParts: 'layout',
  aspect: 'layout',
  longestSeconds: 'layout',
};

const statuses = (run: ClipRun) =>
  Object.fromEntries(STAGE_ORDER.map((id) => [id, run.stages[id].status]));

describe('invalidating from the stage a setting shapes', () => {
  it('a layout setting keeps the expensive stages that came before it', () => {
    /* The whole point. Transcribing took 193 seconds and ranking took 29; a
       checkbox that costs one extra ask per cut must not spend them again. */
    const after = invalidateFrom(finishedRun(), 'layout');
    expect(statuses(after)).toEqual({
      ingest: 'done',
      transcribe: 'done',
      survey: 'done',
      layout: 'pending',
    });
  });

  it('and it keeps their results, not just their status', () => {
    const after = invalidateFrom(finishedRun(), 'layout');
    expect(after.stages.transcribe.result).toBe('transcribe-result');
    expect(after.stages.survey.result).toBe('survey-result');
    expect(after.stages.layout.result).toBeUndefined();
  });

  it('a survey setting goes back far enough to choose different moments', () => {
    const after = invalidateFrom(finishedRun(), 'survey');
    expect(statuses(after)).toEqual({
      ingest: 'done',
      transcribe: 'done',
      survey: 'pending',
      layout: 'pending',
    });
  });

  it('changing how the video is read goes back to the reading', () => {
    const after = invalidateFrom(finishedRun(), 'transcribe');
    expect(after.stages.ingest.status).toBe('done');
    expect(after.stages.transcribe.status).toBe('pending');
  });
});

describe('the rule the node applies', () => {
  /** The earliest stage a patch touches — what changeSetting computes. */
  const earliestFor = (keys: string[]): StageId | null => {
    const stages = keys.map((k) => EXPECTED[k]).filter(Boolean) as StageId[];
    if (!stages.length) return null;
    return stages.reduce((a, b) =>
      (STAGE_ORDER.indexOf(a) <= STAGE_ORDER.indexOf(b) ? a : b));
  };

  it('takes the EARLIER stage when a patch touches two', () => {
    /* Otherwise the layout re-runs against moments chosen under the old
       shortlist, which is a worse answer than not re-running at all. */
    expect(earliestFor(['aspect', 'surveyCandidates'])).toBe('survey');
    expect(earliestFor(['captions', 'readOnServer'])).toBe('transcribe');
  });

  it('leaves the run alone for something that shapes nothing', () => {
    /* A label, or which tab is open. Invalidating on those would make the run
       impossible to keep. */
    expect(earliestFor(['label'])).toBeNull();
    expect(earliestFor([])).toBeNull();
  });

  it('the two switches that started this go back to layout, and no further', () => {
    expect(earliestFor(['planEdit'])).toBe('layout');
    expect(earliestFor(['omniParts'])).toBe('layout');
  });
});

describe('the node still says what this file says', () => {
  /* A test carrying its own copy of a mapping will happily describe one the
     product dropped. Read back from the source so it cannot. */
  const source = fs.readFileSync(
    path.resolve(__dirname, '../studio/nodes/ClippingNode.tsx'),
    'utf8',
  );

  const table = /const STAGE_FOR_SETTING[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source);

  it('has the table at all', () => {
    expect(table).not.toBeNull();
  });

  it('maps every setting to the stage asserted above', () => {
    const found: Record<string, string> = {};
    for (const m of (table as RegExpExecArray)[1].matchAll(/^\s*(\w+):\s*'(\w+)',/gm)) {
      found[m[1]] = m[2];
    }
    expect(found).toEqual(EXPECTED);
  });

  it('routes every setting control through changeSetting, not updateNodeData', () => {
    /* One control left on the old path is one setting that silently does
       nothing on a finished run — the original bug, in miniature. */
    const stale: string[] = [];
    for (const key of Object.keys(EXPECTED)) {
      /* campaignRules is a textarea and settles on blur, so it legitimately
         calls updateNodeData on change as well. */
      if (key === 'campaignRules') continue;
      const onOldPath = new RegExp(`updateNodeData\\(id,\\s*\\{[^}]*\\b${key}:`).test(source);
      if (onOldPath) stale.push(key);
    }
    expect(stale).toEqual([]);
  });

  it('campaignRules invalidates on blur', () => {
    expect(source).toMatch(/onBlur=\{\(e\) => changeSetting\(\{ campaignRules/);
  });
});
