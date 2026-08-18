/**
 * @jest-environment jsdom
 */

/* ============================================================
   The builder, as somebody using it experiences it.

   Three faults, all in the same direction — it knew more than it was willing
   to say or hand over.

   IT THREW AWAY WORK THAT RAN. checkPlan's problems all compile, open on the
   canvas and run; the file says so in its opening paragraph. But the success
   test was `if (template && !total)`, with quality problems folded in beside
   structural ones. So a plan whose only fault was, say, one clip that would
   come back silent got discarded after three rounds, and the user was handed
   raw JSON in a textarea with "fix it and build again". A workflow that was
   90% right became no workflow at all.

   IT SPOKE IN CODES. The panel showed `2x noContinuity, 1x voiceWithoutImage`
   — summarisePlan's output, which exists for logs and repair counting — to
   somebody trying to make a video.

   IT SPENT THE MONEY FIRST. openBuilt parked the template and opened the
   canvas in the same breath, so what got built and what it would cost were
   both things you found out afterwards.
   ============================================================ */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { explainPlan, checkPlan, summarisePlan, type PlanProblem } from '../studio/builder/check';

const DIST = join(__dirname, '../../dist');
const SRC = readFileSync(join(__dirname, '..', 'sidepanel', 'index.ts'), 'utf8');
const CSS = () => readFileSync(join(DIST, 'sidepanel.css'), 'utf8');

function mountPanel(): void {
  document.head.innerHTML = '';
  const doc = new DOMParser().parseFromString(
    readFileSync(join(DIST, 'sidepanel.html'), 'utf8'), 'text/html');
  doc.querySelectorAll('script').forEach((s) => s.remove());
  document.body.innerHTML = doc.body.innerHTML;
  const style = document.createElement('style');
  style.textContent = CSS();
  document.head.append(style);
}

const CODES: Array<PlanProblem['code']> = [
  'noContinuity', 'voiceOnFrames', 'voiceWithoutImage', 'unknownVoice',
  'voiceButSilent', 'castVoiceUnused', 'storyUnused', 'uploadUnused', 'lonelyStory',
];

const problem = (code: PlanProblem['code']): PlanProblem =>
  ({ step: 's1', code, detail: 'model-facing text' });

describe('saying what is wrong in a language people speak', () => {
  it.each(CODES)('has a sentence for %s', (code) => {
    const [line] = explainPlan([problem(code)]);
    expect(line).toBeTruthy();
    expect(line.length).toBeGreaterThan(30);
    expect(line).toMatch(/[.!]$/);
    expect(line).not.toContain(code);
  });

  it('never leaks a code or a field name into what is shown', () => {
    const lines = explainPlan(CODES.map(problem)).join(' ');
    for (const code of CODES) expect(lines).not.toContain(code);
    for (const field of ['audioMode', 'inputs"', 'startFrame', 'endFrame']) {
      expect(lines).not.toContain(field);
    }
  });

  it('says the same fault once however many steps have it', () => {
    /* Four clips missing a still is one thing to understand and one thing to
       fix. Four identical sentences reads as four problems. */
    const four = ['a', 'b', 'c', 'd'].map((step) => ({ ...problem('voiceWithoutImage'), step }));
    expect(explainPlan(four)).toHaveLength(1);
  });

  it('keeps distinct faults distinct', () => {
    expect(explainPlan([problem('noContinuity'), problem('uploadUnused')])).toHaveLength(2);
  });

  it('says nothing when there is nothing wrong', () => {
    expect(explainPlan([])).toEqual([]);
  });

  it('leaves the model-facing text alone', () => {
    /* summarisePlan and `detail` still speak in codes and fields — right for
       a repair message, and swapping the two is the mistake this fixes. */
    expect(summarisePlan([problem('noContinuity')])).toContain('noContinuity');
  });
});

describe('a plan that runs is offered, not thrown away', () => {
  it('treats quality problems as things to know, not reasons to refuse', () => {
    expect(SRC).not.toMatch(/if \(template && !total\)/);
    expect(SRC).toMatch(/if \(template && !quality\.length && !problems\.length\) break;/);
  });

  it('keeps the best round rather than the last', () => {
    /* A model asked to fix three things sometimes returns two fixed and a
       fourth broken, so the final round is not reliably the best one. */
    expect(SRC).toMatch(/quality\.length < best\.quality\.length/);
  });

  it('only falls back to the raw-JSON box when nothing compiled at all', () => {
    expect(SRC.indexOf('if (best) {')).toBeLessThan(SRC.indexOf('Nothing compiled at all'));
    expect(SRC.slice(SRC.indexOf('Nothing compiled at all'))).toContain('build-reply');
  });
});

describe('the plan is shown before it is built', () => {
  beforeEach(mountPanel);

  it('has somewhere to show it, hidden until there is one', () => {
    const plan = document.getElementById('build-plan') as HTMLElement;
    expect(plan.hidden).toBe(true);
    expect(getComputedStyle(plan).display).toBe('none');
  });

  it('offers building and discarding as separate choices', () => {
    /* Discard is the reason a preview exists: a way to say no that does not
       involve undoing nodes on a canvas. */
    expect(document.getElementById('build-plan-go')!.tagName).toBe('BUTTON');
    expect(document.getElementById('build-plan-drop')!.tagName).toBe('BUTTON');
  });

  it('reaches the canvas only from the button', () => {
    /* openBuilt used to run the moment a plan checked out. Its only caller
       now is the click handler, which is what makes the preview real. */
    expect(SRC.match(/openBuilt\(/g) || []).toHaveLength(2);
    expect(SRC).toMatch(/planGo\.addEventListener\('click'[\s\S]{0,400}openBuilt\(at\.template\)/);
  });

  it('says what it will spend before it spends it', () => {
    expect(SRC).toMatch(/function generationCount[\s\S]{0,200}isRunnableType/);
    expect(SRC).toContain('generation${runs === 1 ? \'\' : \'s\'}');
  });

  it('lists what you will watch, and counts the rest', () => {
    /* The card used to be a row per node — "Story — writes all three", "Ends
       on → Shot 2". That is the graph, and it is what somebody deciding
       whether to spend four generations cannot read. A shot is a node that
       produces something you watch; everything else becomes one quiet line. */
    const fn = SRC.slice(SRC.indexOf('function splitPlan'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/media === 'video' \|\| media === 'image'/);
    expect(SRC).toMatch(/function helperName/);
    expect(SRC).toMatch(/Plus \$\{helpers\.length\} step/);
  });

  it('says how long the video is, not how many nodes it has', () => {
    const fn = SRC.slice(SRC.indexOf('function describeSize'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/seconds/);
    expect(body).toMatch(/clips\.length/);
  });

  it('numbers the shots, because the order is the story', () => {
    expect(CSS()).toMatch(/sp-plan__shot::before[\s\S]{0,120}counter-increment: shot/);
  });

  it('does not truncate the line that says what you are getting', () => {
    /* It did: "Cold Brew — 3-shot vertical comm…" at 320px, which is the
       width this panel docks at.
       Anchored on a selector that has to exist — .sp-plan__name was renamed
       and this went on passing against indexOf's -1, which is a test that
       guards nothing. */
    const css = CSS();
    const at = css.indexOf('.sp-plan__size');
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).not.toContain('text-overflow: ellipsis');
    expect(rule).not.toContain('white-space: nowrap');
  });
});

describe('it reads as built, not as a bare form', () => {
  beforeEach(mountPanel);

  it('holds the box, the engine and the button in one object', () => {
    /* They were three elements floating on the page background. Structure was
       right; it looked unfinished. */
    const composer = document.getElementById('build-composer')!;
    expect(composer.querySelector('#build-idea')).not.toBeNull();
    expect(composer.querySelector('#build-engine')).not.toBeNull();
    expect(composer.querySelector('#build-go-ai')).not.toBeNull();
  });

  it('answers focus as a whole, not just inside the textarea', () => {
    expect(CSS()).toMatch(/\.sp-composer:focus-within/);
  });

  it('gives the one action some weight', () => {
    const css = CSS();
    const at = css.indexOf('.sp-ask__go {');
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toMatch(/linear-gradient/);
    expect(rule).toMatch(/box-shadow/);
  });

  it('says what happens next, and stops saying it once you have typed', () => {
    /* The empty state was a large blank area, which is most of what "looks
       unfinished" was. Three lines, gone the moment they have been read. */
    expect(document.querySelectorAll('#build-how li')).toHaveLength(3);
    expect(SRC).toMatch(/if \(how\) how\.hidden = typed;/);
  });

  it('stays on the design system rather than near it', () => {
    /* Two raw values slipped in — a 12px radius and a 10px font — and the
       system's own guards caught both. Kept as a reminder that they are the
       reason it looks like one product. */
    const css = CSS();
    const build = css.slice(css.indexOf('.sp-composer {'));
    expect(build).not.toMatch(/border-radius: \d+px/);
  });
});

describe('changing it without starting over', () => {
  beforeEach(mountPanel);

  it('has a box for it, and Enter sends', () => {
    expect(document.getElementById('build-refine')!.tagName).toBe('INPUT');
    expect(SRC).toMatch(/refineBox\.addEventListener\('keydown'[\s\S]{0,200}e\.key === 'Enter'/);
  });

  it('continues the conversation for a live plan, and introduces a reopened one', () => {
    /* Two cases now. A plan the model just wrote is the next turn of that
       thread. One reopened from history is being shown to a model that has
       never seen it, and the thread it was written in is long gone. */
    const fn = SRC.slice(SRC.indexOf('async function refineBuild'));
    expect(fn.slice(0, fn.indexOf('sendMessage') + 700))
      .toContain("newChat: at.resumeFrom ? 'auto' : 'never'");
  });

  it('keeps the plan on screen when the change comes back unusable', () => {
    const fn = SRC.slice(SRC.indexOf('async function refineBuild'));
    expect(fn).toMatch(/keeping the plan you already have/);
  });

  it('hides the box when there is no conversation behind the plan', () => {
    /* A reply pasted by hand has no thread to continue, and offering the box
       anyway promises something that cannot work. */
    expect(SRC).toMatch(/refine\.hidden = !b\.platform/);
    expect(SRC).toMatch(/showPlan\(\{[\s\S]{0,120}platform: '', name: '', model: ''/);
  });
});

describe('what it is doing, while it does it', () => {
  beforeEach(mountPanel);

  it('has a row for every stage the code sets', () => {
    const inCode = (SRC.match(/const STAGE_ORDER: BuildStage\[\] = \[([^\]]+)\]/) || [])[1] || '';
    const stages = Array.from(inCode.matchAll(/'([a-z]+)'/g)).map((m) => m[1]);
    expect(stages.length).toBeGreaterThan(0);
    for (const id of stages) {
      expect(document.querySelector(`.sp-stages__row[data-stage="${id}"]`)).not.toBeNull();
    }
  });

  it('marks exactly one stage live and everything before it done', () => {
    expect(SRC).toMatch(/toggle\('sp-stages__row--done', i < at\)/);
    expect(SRC).toMatch(/toggle\('sp-stages__row--live', i === at\)/);
  });

  it('animates the live one, and stops for anyone who asked it to', () => {
    /* A static list looks the same whether the model is thinking or the tab
       has died. One moving dot is the difference — but motion is not free for
       everybody. */
    const css = CSS();
    expect(css).toMatch(/sp-stages__row--live[^}]*animation:/);
    expect(css.slice(css.indexOf('prefers-reduced-motion')))
      .toMatch(/sp-stages__row--live[^}]*animation: none/);
  });
});

describe('the examples are gone from the Build tab', () => {
  beforeEach(mountPanel);

  it('no longer spends most of the tab on six cards', () => {
    /* They took more room than the thing the tab is for, and the Library
       already holds twenty-six of them. */
    expect(document.querySelectorAll('#build-ideas .sp-idea')).toHaveLength(0);
    expect(document.getElementById('build-ideas')).toBeNull();
  });

  it('points at the Library instead, in one line', () => {
    const link = document.getElementById('build-open-library');
    expect(link).not.toBeNull();
    expect(link!.textContent).toMatch(/ready-made workflow/i);
    expect(SRC).toMatch(/build-open-library[\s\S]{0,200}showView\('templates'\)/);
  });
});

describe('one button, and the AI chosen for you', () => {
  beforeEach(mountPanel);

  it('offers a single action rather than five brands', () => {
    /* Five equal buttons is five decisions before anything can happen, and
       none of them said which engines were signed in. */
    expect(document.getElementById('build-go-ai')).not.toBeNull();
    expect(document.getElementById('build-ai')).toBeNull();
  });

  it('starts disabled, so the shape of what happens next is visible', () => {
    expect((document.getElementById('build-go-ai') as HTMLButtonElement).disabled).toBe(true);
  });

  it('picks from what is actually open', () => {
    expect(SRC).toMatch(/const ENGINE_ORDER = /);
    const fn = SRC.slice(SRC.indexOf('function chosenEngine'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/ENGINE_ORDER\.find\(\(k\) => engineOpen\[k\]\)/);
    expect(SRC).toMatch(/PANEL_PLATFORM_STATUS/);
  });

  it('says an engine is not open rather than hiding the choice', () => {
    /* Somebody who wants ChatGPT should be able to pick it and be told to
       open it, not find it greyed out with no explanation. */
    expect(SRC).toMatch(/\(not open\)/);
  });

  it('does not use the same words for asking and for committing', () => {
    /* Both read "Make it" at first: one asks the AI to write the plan, the
       other puts the result on the canvas. */
    const go = document.getElementById('build-go-ai')!.textContent!.trim();
    const commit = document.getElementById('build-plan-go')!.textContent!.trim();
    expect(go).not.toBe(commit);
    expect(commit).toMatch(/canvas/i);
  });
});

describe('the checker still behaves', () => {
  it('finds nothing to explain in a plan that is fine', () => {
    const plan: any = {
      steps: [
        { id: 'p', type: 'prompt', text: 'an idea' },
        { id: 'v1', type: 'generate', media: 'video', platform: 'flow', inputs: ['p'] },
      ],
    };
    expect(explainPlan(checkPlan(plan))).toEqual([]);
  });
});
