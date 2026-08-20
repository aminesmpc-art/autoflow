/**
 * The film language, decided once.
 *
 * Colour temperature and lighting setup are properties of the PIECE, not of a
 * shot. Left to each prompt they drift: two shots can both say "warm" and mean
 * different things, and sixteen separate descriptions of lighting produce
 * sixteen looks. A story whose shots each settle their own white balance reads
 * as footage from several days cut together.
 *
 * So they are asked for in the settings turn, stored on the node, and stated
 * ONCE in the brief. The failure this suite mostly guards against is the one
 * this codebase keeps repeating: a settings field that is asked for, answered,
 * stored — and never read by the runner, so it changes nothing at all.
 */

import {
  settingsAsk, readSettingsReply, readStorySettings, storyBrief,
  COLOR_TEMPS, LIGHTING_GRAMMARS, DEFAULT_STORY,
} from '../studio/ask/storyPlan';
import type { ShotTarget } from '../studio/ask/storyboard';

const TARGETS: ShotTarget[] = [
  { id: 'a', label: 'Clip A', media: 'video', platform: 'flow', duration: '10s' },
  { id: 'b', label: 'Clip B', media: 'video', platform: 'flow', duration: '10s' },
];

describe('the settings turn asks for them', () => {
  const ask = settingsAsk('a skincare ad', TARGETS);

  it('offers every colour temperature by id', () => {
    for (const c of COLOR_TEMPS) expect(ask).toContain(c.id);
  });

  it('offers every lighting setup by id', () => {
    for (const l of LIGHTING_GRAMMARS) expect(ask).toContain(l.id);
  });

  it('puts both in the JSON shape it demands back', () => {
    /* Listing a setting in the prose and leaving it out of the envelope is how
       a field gets answered in a sentence nobody parses. */
    expect(ask).toMatch(/"colorTemp":/);
    expect(ask).toMatch(/"lighting":/);
  });

  it('says why one value for the whole piece', () => {
    expect(ask).toMatch(/several days cut together/);
  });
});

describe('the reply is read back', () => {
  it('takes known values', () => {
    const got = readSettingsReply({ colorTemp: 'tungsten', lighting: 'hero' });
    expect(got.colorTemp).toBe('tungsten');
    expect(got.lighting).toBe('hero');
  });

  it('ignores a value that is not on the list', () => {
    /* A model inventing "4400K" must not become a setting nothing can render. */
    const got = readSettingsReply({ colorTemp: '4400K', lighting: 'dramatic' });
    expect(got.colorTemp).toBeUndefined();
    expect(got.lighting).toBeUndefined();
  });
});

describe('the runner actually reads them off the node', () => {
  it('carries both out of node data', () => {
    /* THE bug this codebase repeats. readStorySettings once dropped five
       fields, so settings the user had chosen never reached the brief and
       changing them did nothing anyone could see. */
    const s = readStorySettings({ colorTemp: 'moon', lighting: 'tension' });
    expect(s.colorTemp).toBe('moon');
    expect(s.lighting).toBe('tension');
  });

  it('falls back to the documented default, not to undefined', () => {
    const s = readStorySettings({});
    expect(s.colorTemp).toBe(DEFAULT_STORY.colorTemp);
    expect(s.lighting).toBe(DEFAULT_STORY.lighting);
  });
});

describe('the brief states them once', () => {
  const brief = (over: Record<string, unknown>) =>
    storyBrief('a skincare ad', readStorySettings(over), TARGETS);

  it('names the temperature in Kelvin, where the writer will read it', () => {
    const out = brief({ colorTemp: 'tungsten' });
    expect(out).toMatch(/Colour temperature: Tungsten interior, 3200K/);
  });

  it('gives the lighting setup as text a prompt can carry', () => {
    /* Not a label. A hint the writer has to translate is a hint it translates
       differently in every shot, which is the drift being removed. */
    const out = brief({ lighting: 'tension' });
    expect(out).toMatch(/Lighting: Tension/);
    expect(out).toMatch(/chiaroscuro/);
  });

  it('says each of them exactly once', () => {
    /* Once is the whole point: repeated per shot, they are just more words to
       drift on. */
    const out = brief({ colorTemp: 'amber', lighting: 'intimate' });
    expect(out.match(/Colour temperature:/g)).toHaveLength(1);
    expect(out.match(/Lighting:/g)).toHaveLength(1);
  });

  it('stays silent when neither was chosen', () => {
    const out = brief({});
    expect(out).not.toMatch(/Colour temperature:/);
    expect(out).not.toMatch(/^\s*Lighting:/m);
  });

  it('states them whether or not a look was set', () => {
    /* Two branches print the LOOK block. A setting that only survives one of
       them is a setting that works until somebody fills in a field. */
    for (const look of ['', 'washed-out handheld video']) {
      const out = brief({ colorTemp: 'moon', lighting: 'hero', look });
      expect(out).toMatch(/Colour temperature: Cold moonlight, 6800K/);
      expect(out).toMatch(/Lighting: Hero/);
    }
  });
});
