/**
 * Making a character sound like a person.
 *
 * Reported as: the UGC videos are bad in the conversation, the talking is not
 * realistic. The research converges on two causes and both are measurable.
 *
 * LENGTH. Natural delivery is about two words a second — every Veo dialogue
 * guide lands on the same budget, roughly 8–10 words at 4s, 12–15 at 6s,
 * 15–20 at 8s. Past that the model does not lengthen the shot. It rushes the
 * line or cuts the end off. From a real run, in an eight-second clip that also
 * had to show a hand movement and a turn to the light:
 *
 *   "This is my little secret for that super-hydrated, plump-looking glow.
 *    It feels rich, but my skin still looks fresh, not greasy."
 *
 * Twenty-two words. It was never going to sound like someone talking.
 *
 * FRAMING. Lip sync is animated on the face. A wide or establishing frame
 * leaves too few pixels of mouth, and the sync drifts — which is why the guides
 * all say a speaking shot is chest-up or a medium close-up.
 *
 * Both are stated in the brief AND checked, because a rule in a prompt is a
 * suggestion and a rule in the checker is enforced.
 */

/// <reference types="node" />

import {
  checkShots, dialogueBudget, spokenWords, spokenLines,
  type Shot, type ShotTarget,
} from '../studio/ask/storyboard';

const clip = (duration: string): ShotTarget =>
  ({ id: 'a', label: 'One', media: 'video', platform: 'flow', duration });

const ANCHOR = 'a woman in a beige ribbed tank top, messy low bun, sunlit marble bathroom';
const MOVES = 'The camera pushes in slowly as she turns toward the window.';

const codes = (prompt: string, duration = '8s') =>
  checkShots([{ n: 1, title: 'One', prompt } as Shot], [clip(duration)], ANCHOR)
    .map((p) => p.code);

describe('how many words fit', () => {
  it('scales with the clip, and matches the published bands', () => {
    expect(dialogueBudget('4s')).toBeGreaterThanOrEqual(8);
    expect(dialogueBudget('4s')).toBeLessThanOrEqual(11);
    expect(dialogueBudget('6s')).toBeGreaterThanOrEqual(12);
    expect(dialogueBudget('6s')).toBeLessThanOrEqual(16);
    expect(dialogueBudget('8s')).toBeGreaterThanOrEqual(15);
    expect(dialogueBudget('8s')).toBeLessThanOrEqual(21);
  });

  it('assumes 8s when a clip does not say', () => {
    expect(dialogueBudget(undefined)).toBe(dialogueBudget('8s'));
  });

  it('counts only what is inside the quotes', () => {
    const p = `${ANCHOR}. ${MOVES} She says warmly, “Just the usual today.”`;
    expect(spokenWords(p)).toEqual(['Just', 'the', 'usual', 'today.']);
  });
});

describe('the line that was actually too long', () => {
  const REAL = `${ANCHOR}. ${MOVES} Ambient noise: quiet bathroom tone. `
    + 'She says, “This is my little secret for that super-hydrated, plump-looking glow. '
    + 'It feels rich, but my skin still looks fresh, not greasy.”';

  it('is caught in an 8s clip', () => {
    expect(codes(REAL, '8s')).toContain('dialogueLong');
  });

  it('says the numbers, so the fix is obvious', () => {
    const p = checkShots([{ n: 1, title: 'One', prompt: REAL } as Shot], [clip('8s')], ANCHOR)
      .find((x) => x.code === 'dialogueLong')!;
    expect(p.detail).toMatch(/21 spoken words in a 8s clip/);
    expect(p.detail).toMatch(/speeds the delivery up or cuts the end off/);
  });

  it('passes once it is cut to the budget', () => {
    const trimmed = `${ANCHOR}. ${MOVES} Ambient noise: quiet bathroom tone. `
      + 'She says, “This is my secret for that plump, hydrated glow.”';
    expect(codes(trimmed, '8s')).toEqual([]);
  });

  it('is still too long for a 4s clip when it would pass at 8s', () => {
    /* The budget is per clip, not global — the same line is comfortable in one
       shot and rushed in another, which is why it is stated per shot in the
       brief rather than once at the top. */
    const line = `${ANCHOR}. ${MOVES} She says, “This is honestly my secret for that `
      + 'plump, hydrated, glass-skin glow every morning.”';
    expect(codes(line, '8s')).toEqual([]);
    expect(codes(line, '4s')).toContain('dialogueLong');
  });
});

describe('one voice per clip', () => {
  it('catches two attributed lines', () => {
    /* A generator handed two decides for itself which face said what. */
    const p = `${ANCHOR}. ${MOVES} She says, “Ready?” He answers, “Almost.”`;
    expect(codes(p)).toContain('twoSpeakers');
    expect(spokenLines(p)).toBe(2);
  });

  it('leaves a single line alone', () => {
    const p = `${ANCHOR}. ${MOVES} She says warmly, “Just the usual today, please.”`;
    expect(codes(p)).not.toContain('twoSpeakers');
  });
});

describe('a mouth big enough to animate', () => {
  it('catches someone speaking in a wide frame', () => {
    const p = `A wide establishing shot of ${ANCHOR}. ${MOVES} `
      + 'She says warmly, “Just the usual today.”';
    expect(codes(p)).toContain('dialogueTooWide');
  });

  it('says nothing about a wide shot with no dialogue', () => {
    /* Establishing shots are not a mistake. Speaking in one is. */
    const p = `A wide establishing shot of ${ANCHOR}. ${MOVES}`;
    expect(codes(p)).not.toContain('dialogueTooWide');
  });

  it('says nothing about a close shot with dialogue', () => {
    const p = `A medium close-up of ${ANCHOR}. ${MOVES} She says, “Just the usual today.”`;
    expect(codes(p)).not.toContain('dialogueTooWide');
  });
});

describe('what it must not touch', () => {
  it('leaves stills alone entirely', () => {
    /* A reference still has no seconds and nobody speaks in it, but it may
       well quote a product name. */
    const still: ShotTarget =
      { id: 's', label: 'Ref', media: 'image', platform: 'flow', role: 'reference' } as any;
    const p = `${ANCHOR}, holding a jar labelled “Advanced Botanical Kinetics Plumping `
      + 'Creme” beside her face, evenly lit and nothing cropped.';
    const got = checkShots([{ n: 1, title: 'Ref', prompt: p } as Shot], [still], ANCHOR);
    expect(got.map((x) => x.code)).not.toContain('dialogueLong');
    expect(got.map((x) => x.code)).not.toContain('twoSpeakers');
  });

  it('finds nothing in any prompt that already ships', () => {
    /* The guard that caught the folded-shots rule flagging twelve working
       templates. These run on every clip of every story. */
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TEMPLATES } = require('../studio/templates/index');
    const hits: string[] = [];
    for (const t of TEMPLATES) {
      for (const n of t.nodes) {
        const text = (n.data || {}).text;
        if (typeof text !== 'string' || text.length < 40) continue;
        const tgt: ShotTarget =
          { id: n.id, label: n.id, media: 'video', platform: 'flow', duration: '8s' } as any;
        for (const p of checkShots([{ n: 1, title: 'x', prompt: text } as Shot], [tgt], '')) {
          if (/^dialogue|twoSpeakers/.test(p.code)) hits.push(`${t.id}/${n.id}: ${p.code}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
