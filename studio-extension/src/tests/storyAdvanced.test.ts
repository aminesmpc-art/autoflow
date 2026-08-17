/**
 * The Story node, taught what the Veo guide actually says.
 *
 * Three changes, each from reading Google's own documentation rather than
 * from taste:
 *
 *  1. The director now SEES the reference stills. It was told "1 reference
 *     image attached" — a count — and wrote from the `look` paragraph, which
 *     is a paraphrase of a picture it had never seen. Google's guidance is to
 *     do both: supply the images AND describe them, naming them in the prompt.
 *
 *  2. Timestamp prompting — "[00:00-00:02] ..." — which the guide gives for
 *     clips up to eight seconds. Optional, because it fights a held mood.
 *
 *  3. Exclusions written as a presence. "no buildings" tends to summon
 *     buildings; "a desolate landscape with no buildings or roads" does not.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { storyBrief, DEFAULT_STORY, AUDIO_MODES, type StorySettings } from '../studio/ask/storyPlan';
import { shotContract, type ShotTarget } from '../studio/ask/storyboard';

const clip = (id: string, label: string): ShotTarget =>
  ({ id, label, media: 'video', platform: 'flow', duration: '8s' });

const TARGETS = [clip('a', 'One'), clip('b', 'Two')];
const settings = (patch: Partial<StorySettings> = {}): StorySettings =>
  ({ ...DEFAULT_STORY, ...patch } as StorySettings);

describe('showing the director the reference stills', () => {
  it('says they are attached, and how many', () => {
    const withImages = shotContract(TARGETS, '', false, 2);
    expect(withImages).toMatch(/2 images attached to this message/);
    expect(withImages).toMatch(/Look at them before you write/);
  });

  it('says nothing when none are attached', () => {
    /* A model told to look at images that are not there writes confidently
       about pictures nobody sent — worse than not mentioning them. */
    const none = shotContract(TARGETS, '', false, 0);
    expect(none).not.toMatch(/attached to this message/);
    expect(none).not.toMatch(/Look at them before you write/);
  });

  it('gets the singular right', () => {
    const one = shotContract(TARGETS, '', false, 1);
    expect(one).toMatch(/1 image attached to this message is the reference still/);
  });

  it('asks it to describe what it sees, not to replace the description', () => {
    /* Both, per the guide and per Flow's own troubleshooting: an image alone
       does not hold a character together and neither does a description. */
    const c = shotContract(TARGETS, '', false, 1);
    expect(c).toMatch(/Describe what you can SEE in them/);
    expect(c).toMatch(/from the reference image/);
  });
});

describe('timestamp prompting', () => {
  it('is off unless asked for', () => {
    expect(storyBrief('an idea', settings(), TARGETS)).not.toMatch(/\[00:00-00:02\]/);
  });

  it('gives Veo its own notation when switched on', () => {
    const brief = storyBrief('an idea', settings({ timedBeats: true }), TARGETS);
    expect(brief).toMatch(/TIME INSIDE EACH CLIP/);
    expect(brief).toMatch(/\[00:00-00:02\] what happens first/);
    /* A segment past the clip's end is an instruction the generator cannot
       obey, and four segments in eight seconds is a trailer. */
    expect(brief).toMatch(/whole length and no more/);
    expect(brief).toMatch(/Two to four segments/);
  });

  it('says nothing about time when nothing moves', () => {
    /* A still has no seconds to divide. */
    const stills: ShotTarget[] = [{ id: 'a', label: 'One', media: 'image', platform: 'flow' }];
    expect(storyBrief('an idea', settings({ timedBeats: true }), stills))
      .not.toMatch(/TIME INSIDE EACH CLIP/);
  });
});

describe('what must not appear', () => {
  it('is absent until something is typed', () => {
    expect(storyBrief('x', settings(), TARGETS)).not.toMatch(/MUST NOT APPEAR/);
    expect(storyBrief('x', settings({ avoid: '   ' }), TARGETS)).not.toMatch(/MUST NOT APPEAR/);
  });

  it('carries the rephrasing rule with it', () => {
    /* The user types "no cars". Passed through verbatim that often produces
       cars, so the brief asks for it as an absence inside the scene. */
    const brief = storyBrief('x', settings({ avoid: 'cars, people' }), TARGETS);
    expect(brief).toMatch(/MUST NOT APPEAR/);
    expect(brief).toMatch(/cars, people/);
    expect(brief).toMatch(/never as a bare "no cars"/);
    expect(brief).toMatch(/A bare negation tends to summon the thing it names/);
  });
});

describe('the audio guidance matches what Veo documents', () => {
  const guide = (id: string) => (AUDIO_MODES.find((a) => a.id === id)?.guide || []).join('\n');

  it('uses the prefixes Google names', () => {
    /* We had invented a single "Audio:" heading with three numbered layers
       under it. The documented form is separate sentences prefixed "SFX:" and
       "Ambient noise:", with dialogue in quotation marks. */
    expect(guide('cinematic')).toMatch(/Ambient noise: /);
    expect(guide('cinematic')).toMatch(/SFX: /);
    expect(guide('ambient')).toMatch(/SFX: /);
  });

  it('writes dialogue the way the guide writes it', () => {
    expect(guide('dialogue')).toMatch(/She says urgently, "We have to leave now\."/);
  });

  it('keeps the silent mode silent', () => {
    expect(guide('none')).toBe('');
    expect(guide('ambient')).toMatch(/no dialogue/i);
  });
});

describe('the runner shows and stores what it wrote', () => {
  const runner = readFileSync(
    join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');

  it('gathers the stills from the shots wired below it', () => {
    expect(runner).toMatch(/private storyReferences\(/);
    expect(runner).toMatch(/\['image_ref', 'image', 'frame_start', 'frame_end'\]/);
  });

  it('sends only data URLs, and only distinct ones', () => {
    /* A tile id means nothing to a chat window, and one character still wired
       into sixteen shots is one picture — uploading it sixteen times would add
       minutes to every story. */
    expect(runner).toMatch(/u\.startsWith\('data:'\)/);
    expect(runner).toMatch(/seen\.has\(url\)/);
    expect(runner).toMatch(/max = 4/);
  });

  it('attaches them on the first turn only', () => {
    /* A repair is the next message in the same conversation; the pictures are
       already above it. */
    expect(runner).toMatch(/round === 0 \? refs : undefined/);
  });

  it('records which prompt each target received', () => {
    expect(runner).toMatch(/shotPrompts: best\.shots\.map/);
  });
});
