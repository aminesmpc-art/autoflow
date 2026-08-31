/**
 * The cutaways a Cut node lays out from its edit sheet.
 *
 * The point of the whole feature is the pairing: a folder of unlabelled clips
 * is a puzzle, and the same folder with "@0:03 for 1.8s" on each one is an
 * edit. So the tests care about two things — that the second survives onto the
 * asset, and that a campaign clip never grows generated footage.
 *
 * Exercised through the source rather than by booting the runner, which needs
 * chrome.*, the canvas and a live workflow. Line endings are normalised on the
 * way in: git checks this repository out with CRLF on Windows, and an assertion
 * about code should not depend on who last wrote the file.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const runner = readFileSync(
  join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8',
).replace(/\r\n/g, '\n');

/** The body of layOutBroll, so an assertion cannot pass on some other method. */
const layOut = (() => {
  const from = runner.indexOf('private layOutBroll(');
  const to = runner.indexOf('\n  private ', from + 10);
  return runner.slice(from, to > from ? to : undefined);
})();

describe('what ends up on the asset', () => {
  it('puts the second it belongs at in the label', () => {
    /* Without it the generated clips are a folder of unlabelled videos and the
       sheet on the Cut node is the only copy of where they go. */
    expect(layOut).toMatch(/label: `@\$\{at\(op\.atSec\)\}/);
  });

  it('puts the intended hold in the label too', () => {
    expect(layOut).toMatch(/for \$\{Number\(op\.seconds\)\.toFixed\(1\)\}s/);
  });

  it('keeps the seconds on the node as data as well as in the text', () => {
    /* The label is for a person; these are for anything that later wants to
       assemble or check the edit without parsing a string. */
    expect(layOut).toMatch(/brollAtSec: op\.atSec/);
    expect(layOut).toMatch(/brollHoldSec: op\.seconds/);
  });

  it('generates vertical, like the clip it belongs to', () => {
    expect(layOut).toMatch(/aspectRatio: '9:16'/);
  });
});

describe('what it refuses', () => {
  it('lays out nothing on campaign work', () => {
    /* The sheet already refuses a cutaway under a campaign brief. This refuses
       it again, because a node sitting on the canvas is an invitation to use
       it, and the account doing the earning is worth more than a cutaway. */
    expect(layOut).toMatch(/if \(mode !== 'explainer'\) return 0;/);
  });

  it('ignores an op that is not a cutaway, or has nothing to generate', () => {
    expect(layOut).toMatch(/o\?\.kind === 'broll' && String\(o\.what \|\| ''\)\.trim\(\)/);
  });

  it('is called with the cut’s own mode rather than a default', () => {
    expect(runner).toMatch(
      /this\.layOutBroll\([\s\S]{0,200}nodeData\.clipMode === 'explainer' \? 'explainer' : 'campaign'/,
    );
  });
});

describe('laying out twice', () => {
  it('replaces what this cut made before, rather than doubling it', () => {
    /* Same rule the Clipping node follows for its cuts: run it again and you
       expect the same number of nodes, not twice as many. */
    expect(layOut).toMatch(/brollOwner !== nodeId/);
    expect(layOut).toMatch(/brollOwner: nodeId/);
  });

  it('drops edges that pointed at the nodes it removed', () => {
    expect(layOut).toMatch(/keptIds\.has\(e\.source\) && keptIds\.has\(e\.target\)/);
  });
});

describe('joining the run already in progress', () => {
  it('hands the new nodes to the run so they generate now', () => {
    /* Without this the workflow finishes with every cutaway untouched and the
       only remedy is pressing Run a second time — the exact bug the Clipping
       node had when it first laid out cuts. */
    expect(layOut).toMatch(/this\.extendRun\?\.\(fresh as any\)/);
  });
});

describe('the duration Flow will actually give back', () => {
  /* A cutaway wants one to two seconds and the shortest clip Flow makes is
     four, so every asset arrives longer than the sheet asks for. Rounded UP to
     something Flow offers rather than passed through and silently ignored. */

  const brollDuration = (seconds?: number): string => {
    const want = Math.max(1, seconds ?? 2);
    for (const step of [4, 6, 8, 10]) if (want <= step) return `${step}s`;
    return '10s';
  };

  it('never asks for a length Flow does not offer', () => {
    const allowed = ['4s', '6s', '8s', '10s'];
    for (const s of [0.5, 1, 1.8, 2, 3.9, 4, 4.1, 6, 7, 9.5, 12, 100]) {
      expect(allowed).toContain(brollDuration(s));
    }
  });

  it('rounds a short cutaway up to the shortest Flow makes', () => {
    expect(brollDuration(1.8)).toBe('4s');
    expect(brollDuration(0.5)).toBe('4s');
  });

  it('rounds up rather than down, so nothing arrives too short to use', () => {
    expect(brollDuration(4.1)).toBe('6s');
    expect(brollDuration(6.5)).toBe('8s');
  });

  it('caps at the longest Flow offers', () => {
    expect(brollDuration(30)).toBe('10s');
  });

  it('has a sensible answer when the sheet gave no hold at all', () => {
    expect(brollDuration(undefined)).toBe('4s');
  });

  it('matches the implementation in the runner', () => {
    /* The copy above is only worth having if it agrees with the original. */
    expect(runner).toMatch(/for \(const step of \[4, 6, 8, 10\]\) if \(want <= step\) return `\$\{step\}s`;/);
  });
});

describe('which model a cutaway asks for', () => {
  it('names Omni Flash rather than relying on a default', () => {
    /* Omni is the only Flow model that takes a duration at all, and the only
       one that edits from a reference. A cutaway that quietly fell back to Veo
       would ignore both the length asked for and the style reference — and
       would do it silently, since the generation still succeeds. */
    expect(layOut).toMatch(/model: 'Omni Flash'/);
  });

  it('sends it to Flow, not to a chat', () => {
    expect(layOut).toMatch(/platform: 'flow'/);
    expect(layOut).toMatch(/mediaType: 'video'/);
  });
});

describe('when no cutaway is planned at all', () => {
  it('the Cut node says campaign mode is why', () => {
    /* The silent case. Under a campaign brief the director is never OFFERED
       broll, so nothing is refused and nothing is logged — a clipper wondering
       where the generated shots went has nothing at all to read. */
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const node = readFileSync(
      join(__dirname, '..', 'studio', 'nodes', 'CutNode.tsx'), 'utf8',
    ).replace(/\r\n/g, '\n');
    expect(node).toMatch(/Campaign mode — no generated footage/);
    expect(node).toMatch(/Switch the Clipping node to Explainer/);
  });
});
