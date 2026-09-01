/**
 * Letting a campaign clip carry generated footage, when the brief allows it.
 *
 * The ban was blanket: campaign mode dropped broll, intro and outro outright,
 * because briefs routinely forbid "content not affiliated with this campaign"
 * and a generated cutaway is exactly that. That default is right and stays —
 * the cost of getting it wrong is an account, not a re-render.
 *
 * But it is the BRIEF that decides, not the mode, and some briefs allow it. So
 * there is now a per-node opt-in, off unless somebody read the brief and said
 * otherwise.
 *
 * The interesting part is that the rule is applied in THREE places, and a
 * partial lift is worse than none:
 *
 *   editSheetAsk     what the model is told it may plan
 *   readEditSheet    what is kept when the reply comes back
 *   layOutBroll      whether the cutaways are actually built
 *
 * Lift it in the first two and the sheet plans a cutaway, shows it on the node,
 * and never builds it. Lift it in the last two only and the model is still told
 * not to plan one. All three are checked here.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

import { editSheetAsk, readEditSheet, type SheetContext } from '../studio/clip/editSheet';

const RUNNER = fs.readFileSync(
  path.resolve(__dirname, '../studio/engine/WorkflowRunner.ts'), 'utf8',
).replace(/\r\n/g, '\n');

const NODE = fs.readFileSync(
  path.resolve(__dirname, '../studio/nodes/ClippingNode.tsx'), 'utf8',
).replace(/\r\n/g, '\n');

/* phrases is required — the prompt prints what is said with its seconds, and
   editSheetAsk iterates it directly. */
const ctx = (over: Partial<SheetContext> = {}): SheetContext => ({
  clipSeconds: 18.28,
  mode: 'campaign',
  phrases: [
    { startSec: 0.4, text: 'It got 62 scans to the QR code.' },
    { startSec: 6.1, text: 'And that was only $5,000.' },
  ],
  ...(over as any),
}) as SheetContext;

/** A reply carrying one of each restricted kind, plus one that is always fine. */
const REPLY = {
  tone: 'upbeat',
  ops: [
    { at: 2.0, seconds: 2.0, kind: 'broll', what: 'a phone filling with short videos', why: 'he says 64M views' },
    { at: 6.0, seconds: 1.0, kind: 'punch', what: 'push in', why: 'the number lands' },
  ],
};

const kinds = (r: { ops: Array<{ kind: string }> }) => r.ops.map((o) => o.kind).sort();

describe('what the model is told it may plan', () => {
  it('campaign, by default, is told not to plan generated footage', () => {
    const ask = editSheetAsk(ctx());
    expect(ask).toMatch(/do NOT plan broll, intro or outro/);
    expect(ask).not.toMatch(/broll {2}a generated cutaway/);
  });

  it('campaign with the brief allowing it gets the full set', () => {
    const ask = editSheetAsk(ctx({ allowGenerated: true }));
    expect(ask).toMatch(/broll {2}a generated cutaway/);
    expect(ask).not.toMatch(/do NOT plan broll/);
  });

  it('explainer is unchanged either way', () => {
    for (const allow of [undefined, true]) {
      const ask = editSheetAsk(ctx({ mode: 'explainer', allowGenerated: allow }));
      expect(ask).toMatch(/broll {2}a generated cutaway/);
    }
  });
});

describe('what survives when the reply comes back', () => {
  it('campaign drops the cutaway and says why', () => {
    const out = readEditSheet(REPLY, ctx());
    expect(kinds(out as any)).toEqual(['punch']);
    expect((out as any).dropped.join(' ')).toMatch(/not allowed on campaign work/);
  });

  it('campaign with the brief allowing it keeps it', () => {
    const out = readEditSheet(REPLY, ctx({ allowGenerated: true }));
    expect(kinds(out as any)).toEqual(['broll', 'punch']);
    expect((out as any).dropped.join(' ')).not.toMatch(/campaign work/);
  });

  it('the flag does not become a licence for everything else', () => {
    /* Lifting the campaign ban must not lift the checks that are about the
       edit being good — a kind that does not exist is still not a kind. */
    const bad = { tone: 'upbeat', ops: [{ at: 1, seconds: 1, kind: 'explode', what: 'x', why: 'y' }] };
    const out = readEditSheet(bad, ctx({ allowGenerated: true }));
    expect((out as any).ops).toHaveLength(0);
    expect((out as any).dropped.join(' ')).toMatch(/is not a kind of edit/);
  });

  it('an op outside the clip is still refused', () => {
    const late = { tone: 'upbeat', ops: [{ at: 999, seconds: 2, kind: 'broll', what: 'x', why: 'y' }] };
    const out = readEditSheet(late, ctx({ allowGenerated: true }));
    expect((out as any).ops).toHaveLength(0);
  });
});

describe('whether the cutaways actually get built', () => {
  it('layOutBroll honours the flag, not just the mode', () => {
    /* The gate that would have been missed. Without it the sheet plans a
       cutaway on campaign work, shows it on the node, and builds nothing. */
    const fn = /private layOutBroll\([\s\S]*?\n {4}\}/.exec(RUNNER) as RegExpExecArray;
    expect(fn).not.toBeNull();
    expect(fn[0]).toMatch(/if \(mode !== 'explainer' && !allowGenerated\) return 0;/);
  });

  it('the runner passes the node\'s answer to it', () => {
    expect(RUNNER).toMatch(/nodeData\.allowGenerated === true,/);
  });

  it('it reaches the whole-video config and the per-cut one', () => {
    /* Two call sites: the clipping run that lays out the cuts, and the cut
       that plans its own sheet. A flag on one only is a half-lift again. */
    expect((RUNNER.match(/allowGenerated: nodeData\.allowGenerated === true,/g) || []).length)
      .toBeGreaterThanOrEqual(2);
  });
});

describe('the control on the node', () => {
  it('is shown only on campaign, where it means something', () => {
    /* Explainer already allows generated footage, so the checkbox would be a
       switch that does nothing — the worst kind of control. */
    expect(NODE).toMatch(/\{isCampaign && \(/);
    expect(NODE).toMatch(/const isCampaign: boolean = d\.clipMode !== 'explainer';/);
  });

  it('asks about the brief, not about the feature', () => {
    /* "Do you want cutaways" is a preference. "Does this brief permit them" is
       the question that actually decides, and the one whose wrong answer
       costs an account. */
    expect(NODE).toMatch(/Brief allows generated/);
    expect(NODE).toMatch(/Only if the brief allows it/);
  });

  it('re-runs the layout when it changes', () => {
    /* It changes which kinds may be planned AND whether they are built, so a
       finished run no longer matches its own controls. */
    const m = /const STAGE_FOR_SETTING: Record<string, StageId> = \{[\s\S]*?\n\};/
      .exec(NODE) as RegExpExecArray;
    expect(m[0]).toMatch(/allowGenerated: 'layout'/);
  });

  it('is off unless somebody said otherwise', () => {
    expect(NODE).toMatch(/d\.allowGenerated === true/);
  });
});
