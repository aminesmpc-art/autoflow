/**
 * Surveying a video into a workflow.
 *
 * Two claims are worth more than the rest of this file.
 *
 * The first is the campaign rule. A brief that forbids "content that is not
 * affiliated with this campaign" forbids generated footage, and getting that
 * wrong costs the user their account rather than a re-render. It used to be
 * enforced by skipping a stage; it is now enforced twice, in both places a
 * decision is made — the question does not offer B-roll, and the plan drops
 * any that arrives anyway. Both are tested here, because defence in depth is
 * only defence if both layers are actually checked.
 *
 * The second is that no second in a cut node ever came from a model. The
 * survey ranks candidates the loudness envelope proposed; `nearSec` is copied
 * off the candidate. This is the property the whole design rests on, measured
 * rather than assumed: asked to timestamp a long recording directly, the model
 * emitted a fabricated arithmetic sequence.
 */

import { emitPlan, labelFor } from '../studio/clip/emitPlan';
import { readSurvey, surveyAsk, type MomentCandidate, type SurveyMoment } from '../studio/ask/clipperBrain';
import { compilePlan } from '../studio/builder/plan';

const candidate = (n: number, start: number): MomentCandidate => ({
  n, start, end: start + 50, why: 'much louder than the rest of the recording', text: `words for ${n}`,
});

const moment = (over: Partial<SurveyMoment> = {}): SurveyMoment => ({
  moment: 1,
  rank: 1,
  hookLine: 'Look at these straw bales right here.',
  closingLine: 'Darius has already been arrested.',
  why: 'a complete arrest, no setup needed',
  broll: [],
  ...over,
});

const CANDIDATES = [candidate(1, 14), candidate(2, 148), candidate(3, 75)];

/* ------------------------------------------------------------------ */

describe('turning ranked moments into a plan', () => {
  it('makes one cut per moment, carrying both quoted lines', () => {
    const plan = emitPlan(
      [moment({ moment: 3, rank: 1 }), moment({ moment: 1, rank: 2, hookLine: 'Start the timer!' })],
      CANDIDATES,
      { sourceKey: 'src', mode: 'campaign' },
    );
    const cuts = plan.steps.filter((s) => s.type === 'cut');
    expect(cuts).toHaveLength(2);
    expect(cuts[0].hookLine).toBe('Look at these straw bales right here.');
    expect(cuts[0].closingLine).toBe('Darius has already been arrested.');
    expect(cuts[0].sourceKey).toBe('src');
  });

  it('takes nearSec from the candidate the audio proposed, not from the reply', () => {
    /* THE claim. A cut node searches a two-minute window around this number;
       if it could come from a model, a fabricated one would send the search
       to the wrong part of the recording and the line would simply not be
       found. Moment 2's candidate starts at 148s. */
    const plan = emitPlan([moment({ moment: 2 })], CANDIDATES, { sourceKey: 's', mode: 'campaign' });
    expect(plan.steps[0].nearSec).toBe(148);
  });

  it('falls back to searching from the start when no candidate matches', () => {
    const plan = emitPlan([moment({ moment: 9 })], CANDIDATES, { sourceKey: 's', mode: 'campaign' });
    expect(plan.steps[0].nearSec).toBe(0);
  });

  it('names each cut after its opening words, so ten of them can be told apart', () => {
    expect(labelFor(1, 'Look at these straw bales right here.')).toBe('1. Look at these straw bales…');
    expect(labelFor(4, 'Start the timer')).toBe('4. Start the timer');
    expect(labelFor(2, '   ')).toBe('Clip 2');
  });

  it('gives every cut a vertical aspect', () => {
    const plan = emitPlan([moment()], CANDIDATES, { sourceKey: 's', mode: 'campaign' });
    expect(plan.steps[0].aspectRatio).toBe('9:16');
  });
});

/* ------------------------------------------------------------------ */

describe('the campaign rule, enforced where the decision is made', () => {
  const withBroll = [moment({ broll: [{ prompt: 'a wide shot of the field', seconds: 6 }] })];

  it('drops B-roll in campaign mode even when the reply offered some', () => {
    const plan = emitPlan(withBroll, CANDIDATES, { sourceKey: 's', mode: 'campaign' });
    expect(plan.steps.every((s) => s.type === 'cut')).toBe(true);
  });

  it('keeps B-roll in explainer mode', () => {
    const plan = emitPlan(withBroll, CANDIDATES, { sourceKey: 's', mode: 'explainer' });
    const gen = plan.steps.filter((s) => s.type === 'generate');
    expect(gen).toHaveLength(1);
    expect(gen[0].prompt).toBe('a wide shot of the field');
    expect(gen[0].media).toBe('video');
    expect(gen[0].duration).toBe('6s');
    expect(gen[0].aspectRatio).toBe('9:16');
  });

  it('does not even offer B-roll in the campaign question', () => {
    const ask = surveyAsk(CANDIDATES, { broll: false });
    expect(ask).toMatch(/Do not suggest any added footage/);
    expect(ask).not.toMatch(/"broll"/);
  });

  it('offers it in the explainer question', () => {
    expect(surveyAsk(CANDIDATES, { broll: true })).toMatch(/"broll"/);
  });

  it('puts the brief’s own words in front of the model', () => {
    const ask = surveyAsk(CANDIDATES, { rules: 'No logos, hashtags or watermarks.' });
    expect(ask).toMatch(/No logos, hashtags or watermarks\./);
  });
});

/* ------------------------------------------------------------------ */

describe('reading a survey reply', () => {
  const reply = (clips: unknown[]) => JSON.stringify({ clips });

  it('takes the clips it can use', () => {
    const out = readSurvey(reply([
      { moment: 2, hook_line: 'a', closing_line: 'b', why: 'c' },
    ]), 3);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ moment: 2, rank: 1, hookLine: 'a', closingLine: 'b', why: 'c' });
  });

  it('refuses a moment that was never on the shortlist', () => {
    /* A moment the audio did not propose has no seconds behind it, so the
       node built from it would search the recording for a line that is not
       in the part it was pointed at. */
    expect(readSurvey(reply([{ moment: 9, hook_line: 'a', closing_line: 'b' }]), 3)).toEqual([]);
    expect(readSurvey(reply([{ moment: 0, hook_line: 'a', closing_line: 'b' }]), 3)).toEqual([]);
  });

  it('keeps the first of two clips on the same moment', () => {
    const out = readSurvey(reply([
      { moment: 1, hook_line: 'first', closing_line: 'b' },
      { moment: 1, hook_line: 'second', closing_line: 'b' },
    ]), 3);
    expect(out).toHaveLength(1);
    expect(out[0].hookLine).toBe('first');
  });

  it('drops a clip missing either end', () => {
    expect(readSurvey(reply([{ moment: 1, hook_line: 'a' }]), 3)).toEqual([]);
    expect(readSurvey(reply([{ moment: 1, closing_line: 'b' }]), 3)).toEqual([]);
    expect(readSurvey(reply([{ moment: 1, hook_line: '  ', closing_line: 'b' }]), 3)).toEqual([]);
  });

  it('ranks by the order it kept them, so rank survives the dropping', () => {
    const out = readSurvey(reply([
      { moment: 9, hook_line: 'dropped', closing_line: 'b' },
      { moment: 1, hook_line: 'a', closing_line: 'b' },
      { moment: 2, hook_line: 'c', closing_line: 'd' },
    ]), 3);
    expect(out.map((m) => m.rank)).toEqual([1, 2]);
  });

  it('clamps B-roll length to what the video platforms actually offer', () => {
    const out = readSurvey(reply([{
      moment: 1, hook_line: 'a', closing_line: 'b',
      broll: [{ prompt: 'x', seconds: 30 }, { prompt: 'y', seconds: 1 }, { prompt: '', seconds: 6 }],
    }]), 3);
    expect(out[0].broll).toEqual([{ prompt: 'x', seconds: 10 }, { prompt: 'y', seconds: 4 }]);
  });

  it('says why it threw an entry away', () => {
    /* A run asked for ten clips and laid out eight. Whether the model
       declined to pad the list or two of its answers were unusable are
       opposite problems, and unsaid they look identical. */
    const drops: string[] = [];
    readSurvey(reply([
      { moment: 99, hook_line: 'a', closing_line: 'b' },
      { moment: 1, hook_line: 'a', closing_line: 'b' },
      { moment: 1, hook_line: 'again', closing_line: 'b' },
      { moment: 2, hook_line: 'only an opening' },
    ]), 3, (r) => drops.push(r));

    expect(drops).toHaveLength(3);
    expect(drops[0]).toMatch(/moment 99, which was not on the shortlist of 3/);
    expect(drops[1]).toMatch(/two clips both chose moment 1/);
    expect(drops[2]).toMatch(/moment 2 quoted no closing line/);
  });

  it('reports nothing when every clip was usable', () => {
    const drops: string[] = [];
    const out = readSurvey(reply([{ moment: 1, hook_line: 'a', closing_line: 'b' }]), 3, (r) => drops.push(r));
    expect(out).toHaveLength(1);
    expect(drops).toEqual([]);
  });

  it('shrugs at rubbish rather than throwing', () => {
    for (const v of [undefined, null, '', 'not json', '{}', '{"clips":"nope"}', 42]) {
      expect(readSurvey(v, 3)).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------ */

describe('compiling a cut into a node', () => {
  const cutStep = (over: Record<string, unknown> = {}) => ({
    id: 'c1', type: 'cut' as const, label: 'Clip 1',
    hookLine: 'open here', closingLine: 'end here', sourceKey: 'src', nearSec: 83,
    ...over,
  });

  it('carries every field the node needs to run', () => {
    const { template, problems } = compilePlan({ steps: [cutStep()] });
    expect(problems).toEqual([]);
    const node = template!.nodes[0];
    expect(node.type).toBe('cut');
    expect(node.data).toMatchObject({
      type: 'cut', hookLine: 'open here', closingLine: 'end here',
      sourceKey: 'src', nearSec: 83, aspectRatio: '9:16',
    });
  });

  it('refuses a cut with nothing to search for', () => {
    /* Caught at build time rather than at run time, where it would present as
       a node that simply fails the moment someone presses Run. */
    const a = compilePlan({ steps: [cutStep({ hookLine: '' })] });
    expect(a.template).toBeNull();
    expect(a.problems.join(' ')).toMatch(/no hookLine/);

    const b = compilePlan({ steps: [cutStep({ closingLine: '   ' })] });
    expect(b.template).toBeNull();
    expect(b.problems.join(' ')).toMatch(/no closingLine/);
  });

  it('refuses a cut a chat invented, with no video behind it', () => {
    /* The Builder writes workflows from an idea and has never seen a video.
       A cut it invented would compile to a node that looks finished and dies
       on Run with a message about bytes the user never provided. */
    const { template, problems } = compilePlan({ steps: [cutStep({ sourceKey: '' })] });
    expect(template).toBeNull();
    expect(problems.join(' ')).toMatch(/no video behind it/);
  });

  it('lets a Last Frame take its still from a cut', () => {
    /* A cut has no `media` field to say it is video, so the frame check used
       to reject it as "an image" — which broke exactly the plan that mixes
       real footage with a generated shot continuing from it. */
    const { template, problems } = compilePlan({
      steps: [cutStep(), { id: 'f1', type: 'frame', inputs: ['c1'] }],
    });
    expect(problems).toEqual([]);
    expect(template!.nodes.map((n: any) => n.type)).toEqual(expect.arrayContaining(['cut', 'frame']));
  });

  it('leaves room for the player a cut grows when it runs', () => {
    /* Found by rendering the shipped stylesheet, not by reading it. An unrun
       cut is about 300px and a finished one about 560, so at the standard
       300px row height a column of them overlapped the moment the first one
       finished — every clip hidden behind the next. */
    const { template } = compilePlan({
      steps: [cutStep({ id: 'a' }), cutStep({ id: 'b' }), cutStep({ id: 'c' })],
    });
    const ys = template!.nodes.map((n: any) => n.position.y);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(560);
    }
  });

  it('still lays every other type out on the standard row', () => {
    /* The accumulating layout must be identical to the old row counting for
       everything that has not asked for more room. */
    const { template } = compilePlan({
      steps: [
        { id: 'p1', type: 'image', label: 'a' },
        { id: 'p2', type: 'image', label: 'b' },
        { id: 'p3', type: 'image', label: 'c' },
      ],
    });
    expect(template!.nodes.map((n: any) => n.position.y)).toEqual([40, 340, 640]);
  });

  it('defaults nearSec rather than emitting a node with a broken one', () => {
    const { template } = compilePlan({ steps: [cutStep({ nearSec: -5 })] });
    expect((template!.nodes[0].data as any).nearSec).toBe(0);
  });
});
