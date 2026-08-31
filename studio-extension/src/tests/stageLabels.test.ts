/**
 * The brief's own vocabulary, typed into the generator.
 *
 * From a live run, the prompt that reached Flow verbatim:
 *
 *   "...raw and unedited UGC style. Setup: She holds the Aveda jar up to the
 *    camera, unscrews the lid... Escalation: She dabs the cream onto her
 *    cheeks... Climax: She gently rubs it in... Audio: 1.
 *    [Ambience/Environment]: Quiet bathroom room tone. 2. [Foley/SFX]:
 *    Plastic jar lid unscrewing. 3. [Dialogue/Vocalization]: Elena whispers:
 *    'Okay, why does my skin look like this?'"
 *
 * Every one of those labels is how the BRIEF talks about shape and sound.
 * None of them is in the scene. A generator handed "Setup:" either renders it
 * as text or spends attention deciding what it means, and the shot is worse
 * for it in a way no reviewer would connect back to the instructions.
 *
 * The brief invited it — it asked for "a 3-stage progression (Setup ➜
 * Escalation ➜ Payoff)" and for audio as "1. [Ambience/Environment]". Both
 * have been reworded. This is the net underneath: a model asked for three
 * stages will sometimes label them however it was asked.
 */

/// <reference types="node" />

import { checkShots, type Shot, type ShotTarget } from '../studio/ask/storyboard';
import { storyBrief, DEFAULT_STORY, type StorySettings } from '../studio/ask/storyPlan';

const target: ShotTarget = { id: 'a', label: 'One', media: 'video', platform: 'flow', duration: '10s' };
const ANCHOR = 'a woman in a beige ribbed tank top, messy low bun, sunlit marble bathroom';

const shot = (prompt: string): Shot => ({ n: 1, title: 'One', prompt });
const codes = (prompt: string) =>
  checkShots([shot(prompt)], [target], ANCHOR).map((p) => p.code);

/** The real prompt, trimmed to the parts that matter. */
const LIVE = 'Continuous smartphone front-camera video. A woman in a beige ribbed tank top with '
  + 'a messy low bun stands in a sunlit marble bathroom with morning window light. '
  + 'Setup: She holds the jar up to the camera and unscrews the lid. '
  + 'Escalation: She dabs the cream onto her cheeks as the camera pushes in. '
  + 'Climax: She rubs it in and turns toward the window light. '
  + 'Audio: 1. [Ambience/Environment]: Quiet bathroom room tone. '
  + '2. [Foley/SFX]: Plastic jar lid unscrewing. '
  + "3. [Dialogue/Vocalization]: Elena whispers: 'Why does my skin look like this?'";

describe('the prompt that actually reached Flow', () => {
  it('is caught, on both counts', () => {
    expect(codes(LIVE)).toEqual(expect.arrayContaining(['stageLabels', 'audioLabels']));
  });

  it('passes once the same shot is written as one description', () => {
    /* Same content, same length, same anchor — only the labels are gone. If
       this failed, the rule would be rejecting the shot rather than the
       labels. */
    const clean = 'Continuous smartphone front-camera video. A woman in a beige ribbed tank top '
      + 'with a messy low bun stands in a sunlit marble bathroom with morning window light. '
      + 'She holds the jar up to the camera and unscrews the lid, then dabs the cream onto her '
      + 'cheeks as the camera pushes in, and finally rubs it in and turns toward the window '
      + 'light. Ambient noise: quiet bathroom room tone. SFX: a plastic jar lid unscrewing. '
      + 'She whispers, "Why does my skin look like this?"';
    expect(codes(clean)).toEqual([]);
  });
});

describe('what the rules must not touch', () => {
  it('leaves the audio prefixes Google documents', () => {
    /* "Ambient noise:" and "SFX:" are meant to be in the prompt. Only the
       BRACKETED layer names came from our instructions. */
    const p = `${ANCHOR}. She turns toward the window and the camera pushes in slowly. `
      + 'Ambient noise: quiet bathroom room tone. SFX: a jar lid unscrewing. '
      + 'She says softly, "There it is."';
    expect(codes(p)).toEqual([]);
  });

  it('leaves ordinary prose that happens to use the words', () => {
    /* "the setup of the room" is a description. Only a capitalised label with
       a colon after it is the instruction leaking through. */
    const p = `${ANCHOR}. The camera drifts across the setup of the room, past the climax of `
      + 'the morning rush, and settles on her face as she leans into the light.';
    expect(codes(p)).not.toContain('stageLabels');
  });

  it('leaves a bracket that is not an audio label', () => {
    const p = `${ANCHOR}. The camera pushes in as she lifts the jar [held in her right hand] `
      + 'toward the lens and smiles at the window light.';
    expect(codes(p)).not.toContain('audioLabels');
  });
});

describe('the brief stopped asking for it', () => {
  const brief = (patch: Partial<StorySettings> = {}) =>
    storyBrief('an idea', { ...DEFAULT_STORY, ...patch } as StorySettings, [target]);

  it('describes the shape without naming the labels', () => {
    /* Whitespace-normalised: the brief wraps its lines, and asserting against
       the wrapping makes the test fail on a reflow rather than on a change of
       meaning. */
    const b = brief().replace(/\s+/g, ' ');
    expect(b).toMatch(/what begins, what it turns into, and where it lands/);
    expect(b).not.toMatch(/Setup ➜ Escalation ➜ Payoff/);
  });

  it('says outright that those words must not be written', () => {
    /* Naming the shape without naming the labels is half of it. A model that
       invents its own labels needs telling. */
    expect(brief()).toMatch(/they are not words that\s*\n?belong in a prompt/);
  });
});

describe('it does not fire on prompts that already ship', () => {
  /* The same guard that caught the folded-shots rule flagging twelve working
     templates. These two rules run on every prompt of every story, so one
     false positive costs a repair round on every run and teaches the model to
     rewrite something that was right. */
  it('finds nothing in any shipped template prompt', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TEMPLATES } = require('../studio/templates/index');
    const hits: string[] = [];
    for (const t of TEMPLATES) {
      for (const n of t.nodes) {
        const text = (n.data || {}).text;
        if (typeof text !== 'string' || text.length < 40) continue;
        const tgt: ShotTarget = {
          id: n.id, label: n.data.label || n.id, media: 'video', platform: 'flow',
        };
        for (const p of checkShots([shot(text)], [tgt], '')) {
          if (p.code === 'stageLabels' || p.code === 'audioLabels') {
            hits.push(`${t.id}/${n.id}: ${p.code}`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

/**
 * An attachment's filename, typed into the prompt.
 *
 * From a live run, after the reference stills started being attached:
 *
 *   "...the camera executes a dramatic pull-back and tilts down to land on a
 *    clean aesthetic composition of the product from reference-1.png resting
 *    on the marble counter beside the sink."
 *
 * The generator has no file called that. It receives the characters and does
 * something with them, and none of it is the product. Caused by the feature
 * that attaches the stills — before that there was no filename to leak.
 */
describe('the name of an attached file', () => {
  it('is caught', () => {
    const p = `${ANCHOR}. The camera tilts down to land on the product from reference-1.png `
      + 'resting on the marble counter as the light moves across it.';
    expect(codes(p)).toContain('fileName');
  });

  it('catches any image or clip extension, not just the one we generate', () => {
    for (const name of ['shot_02.jpg', 'char.jpeg', 'ref.webp', 'take1.mp4', 'IMG_4021.HEIC']) {
      const p = `${ANCHOR}. She lifts the jar toward ${name} and the camera pushes in slowly.`;
      expect(codes(p)).toContain('fileName');
    }
  });

  it('accepts the phrasing the contract asks for instead', () => {
    const p = `${ANCHOR}. The camera tilts down to land on the product from the reference `
      + 'image resting on the marble counter as the light moves across it.';
    expect(codes(p)).toEqual([]);
  });

  it('leaves ordinary prose alone', () => {
    /* No extension, no reference-N — a sentence about a period drama should
       not be rejected for containing a full stop. */
    const p = `${ANCHOR}. She sets the jar down. The camera holds on her face as the morning `
      + 'light moves across the marble and she smiles at the lens.';
    expect(codes(p)).not.toContain('fileName');
  });
});
