/**
 * The edit sheet — what to add to a finished cut, and when.
 *
 * It is not a compositor and does not render anything: the finishing happens in
 * CapCut, where the clipper already works. So the whole value is in whether an
 * instruction can be FOLLOWED — a cutaway at 0:52 of a 0:19 clip is worse than
 * no plan at all, because it looks like work has been done.
 *
 * Which makes the refusals the interesting part.
 */

import {
  FIRST_BEAT_BY_SEC,
  RESET_EVERY_SEC,
  editSheetAsk,
  readEditSheet,
  sheetAsText,
  sheetGaps,
  type SheetContext,
} from '../studio/clip/editSheet';

const context = (over: Partial<SheetContext> = {}): SheetContext => ({
  clipSeconds: 19.3,
  title: 'How one client posts over 400k videos every single month',
  why: 'Reveals an astonishing output volume to explain the maths behind short form.',
  phrases: [
    { startSec: 0, endSec: 3.2, text: 'We actually have like one client alone' },
    { startSec: 3.2, endSec: 6.0, text: 'that puts out over 400,000 videos a month.' },
    { startSec: 6.0, endSec: 12.0, text: 'You have to make it hard for people not to see you.' },
  ],
  ...over,
});

const reply = (ops: unknown[]) => JSON.stringify({ ops });

describe('the brief it puts to the model', () => {
  it('includes the words with the seconds they are said at', () => {
    /* Without them the model invents a moment, and an instruction pointing at
       a moment that does not exist reads exactly like one that does — until
       somebody opens CapCut. */
    const ask = editSheetAsk(context());
    expect(ask).toContain('400,000 videos a month');
    expect(ask).toMatch(/0:03/);
  });

  it('states how long the clip actually runs', () => {
    expect(editSheetAsk(context())).toContain('19.3');
  });

  it('forbids generated footage on campaign work', () => {
    const ask = editSheetAsk(context({ mode: 'campaign' }));
    expect(ask).toMatch(/do NOT plan broll/);
    expect(ask).not.toMatch(/a generated cutaway/);
  });

  it('offers generated footage on an explainer', () => {
    expect(editSheetAsk(context({ mode: 'explainer' }))).toMatch(/a generated cutaway/);
  });

  it('does not repeat the cut-every-10-to-15-seconds claim', () => {
    /* The sources that carry it describe it as a marketing line rather than
       platform data, and a rule with no measurement behind it has no business
       setting the pace of somebody's clip. */
    expect(editSheetAsk(context())).not.toMatch(/10 to 15 seconds|every 10-15/);
  });
});

describe('refusing what cannot be followed', () => {
  it('drops an instruction past the end of the clip', () => {
    const { ops, dropped } = readEditSheet(
      reply([{ at: 52, kind: 'punch', what: 'push in' }]), context(),
    );
    expect(ops).toHaveLength(0);
    expect(dropped[0]).toMatch(/outside a 19.3s clip/);
  });

  it('drops a cutaway that holds too long for the voice to keep up', () => {
    const { ops, dropped } = readEditSheet(
      reply([{ at: 2, seconds: 9, kind: 'broll', what: 'a phone screen' }]),
      context({ mode: 'explainer' }),
    );
    expect(ops).toHaveLength(0);
    expect(dropped[0]).toMatch(/past the 4s/);
  });

  it('drops a cutaway too brief to register', () => {
    const { ops } = readEditSheet(
      reply([{ at: 2, seconds: 0.3, kind: 'broll', what: 'a phone screen' }]),
      context({ mode: 'explainer' }),
    );
    expect(ops).toHaveLength(0);
  });

  it('drops an instruction that says nothing', () => {
    const { ops, dropped } = readEditSheet(
      reply([{ at: 2, kind: 'text', what: '   ' }]), context(),
    );
    expect(ops).toHaveLength(0);
    expect(dropped[0]).toMatch(/says nothing/);
  });

  it('drops a kind it does not have', () => {
    const { ops, dropped } = readEditSheet(
      reply([{ at: 2, kind: 'lens flare', what: 'sparkle' }]), context(),
    );
    expect(ops).toHaveLength(0);
    expect(dropped[0]).toMatch(/not a kind of edit/);
  });

  it('refuses generated footage on campaign work even when asked for it', () => {
    /* The brief says so, and the brief is not enough — a campaign clip
       carrying generated footage breaks the rule the account earns from. */
    const { ops, dropped } = readEditSheet(
      reply([
        { at: 2, seconds: 2, kind: 'broll', what: 'a phone screen' },
        { at: 5, kind: 'punch', what: 'push in on him' },
      ]),
      context({ mode: 'campaign' }),
    );
    expect(ops.map((o) => o.kind)).toEqual(['punch']);
    expect(dropped[0]).toMatch(/off the brief/);
  });

  it('shortens a cutaway that would run past the end rather than dropping it', () => {
    const { ops } = readEditSheet(
      reply([{ at: 18, seconds: 3, kind: 'broll', what: 'a phone screen' }]),
      context({ mode: 'explainer' }),
    );
    expect(ops[0].seconds).toBeCloseTo(1.3, 1);
  });
});

describe('two things cannot be on screen at once', () => {
  it('drops a cutaway that lands on one already there', () => {
    const { ops, dropped } = readEditSheet(
      reply([
        { at: 2, seconds: 2, kind: 'broll', what: 'first' },
        { at: 3, seconds: 2, kind: 'broll', what: 'lands on the first' },
      ]),
      context({ mode: 'explainer' }),
    );
    expect(ops).toHaveLength(1);
    expect(ops[0].what).toBe('first');
    expect(dropped[0]).toMatch(/lands on the broll already there/);
  });

  it('lets text and sound sit over a cutaway', () => {
    /* They do not take the picture, so they are not in competition for it. */
    const { ops } = readEditSheet(
      reply([
        { at: 2, seconds: 2, kind: 'broll', what: 'a phone screen' },
        { at: 2.5, kind: 'text', what: '400,000' },
        { at: 2.5, kind: 'sfx', what: 'whoosh' },
      ]),
      context({ mode: 'explainer' }),
    );
    expect(ops).toHaveLength(3);
  });

  it('puts the sheet in time order whatever order it arrived in', () => {
    const { ops } = readEditSheet(
      reply([
        { at: 9, kind: 'punch', what: 'third' },
        { at: 1, kind: 'punch', what: 'first' },
        { at: 5, kind: 'punch', what: 'second' },
      ]),
      context(),
    );
    expect(ops.map((o) => o.what)).toEqual(['first', 'second', 'third']);
  });
});

describe('keeping the sheet to a length anyone will follow', () => {
  it('caps a short clip at a handful of instructions', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      at: i * 0.5, kind: 'punch', what: `beat ${i}`,
    }));
    const { ops, dropped } = readEditSheet(reply(many), context());
    expect(ops.length).toBeLessThanOrEqual(8);
    expect(dropped.join(' ')).toMatch(/more than a 19.3s clip has room for/);
  });

  it('allows more on a longer clip', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      at: i * 2, kind: 'punch', what: `beat ${i}`,
    }));
    const short = readEditSheet(reply(many), context({ clipSeconds: 20 })).ops.length;
    const long = readEditSheet(reply(many), context({ clipSeconds: 60 })).ops.length;
    expect(long).toBeGreaterThan(short);
  });
});

describe('saying what the plan leaves flat', () => {
  /* Not a validation failure. A sheet can be entirely legal and still leave
     the middle of a clip empty, and that is the difference between one that
     was followed and one that worked. */

  it('notices a clip with nothing planned at all', () => {
    expect(sheetGaps([], 19.3)[0]).toMatch(/runs flat/);
  });

  it('notices a first beat that lands too late to matter', () => {
    const gaps = sheetGaps([{ atSec: 7, kind: 'punch', what: 'x', why: '' }], 19.3);
    expect(gaps.join(' ')).toMatch(new RegExp(`decided by ${FIRST_BEAT_BY_SEC}s`));
  });

  it('notices a long stretch with nothing in it', () => {
    const gaps = sheetGaps(
      [
        { atSec: 1, kind: 'punch', what: 'x', why: '' },
        { atSec: 1 + RESET_EVERY_SEC + 4, kind: 'punch', what: 'y', why: '' },
      ],
      40,
    );
    expect(gaps.join(' ')).toMatch(/has nothing in it/);
  });

  it('notices an empty run to the end', () => {
    const gaps = sheetGaps([{ atSec: 1, kind: 'punch', what: 'x', why: '' }], 40);
    expect(gaps.join(' ')).toMatch(/to the end has nothing in it/);
  });

  it('says nothing about a well-paced clip', () => {
    const ops = [2, 8, 14].map((atSec) => ({ atSec, kind: 'punch' as const, what: 'x', why: '' }));
    expect(sheetGaps(ops, 19.3)).toEqual([]);
  });
});

describe('reading a reply that is not clean JSON', () => {
  it('takes JSON out of a fenced block', () => {
    const { ops } = readEditSheet(
      '```json\n{"ops":[{"at":1,"kind":"punch","what":"push in"}]}\n```', context(),
    );
    expect(ops).toHaveLength(1);
  });

  it('takes JSON out of a sentence wrapped around it', () => {
    const { ops } = readEditSheet(
      'Sure! {"ops":[{"at":1,"kind":"punch","what":"push in"}]} Hope that helps.',
      context(),
    );
    expect(ops).toHaveLength(1);
  });

  it('returns an empty sheet rather than throwing on nonsense', () => {
    for (const bad of ['', 'no', '{', null, undefined, 42]) {
      expect(readEditSheet(bad, context()).ops).toEqual([]);
    }
  });
});

describe('the sheet as something to read in CapCut', () => {
  it('lists each instruction with its timecode', () => {
    const text = sheetAsText(
      [{ atSec: 2.4, seconds: 1.8, kind: 'broll', what: 'a phone screen', why: 'he says 400k' }],
      'Clip 1',
    );
    expect(text).toContain('0:02');
    expect(text).toContain('BROLL');
    expect(text).toContain('a phone screen');
    expect(text).toContain('he says 400k');
  });
});

describe('a punch is its own instruction', () => {
  /* Found against the deployed model, not in a unit test. The model routinely
     leaves `what` empty on a punch because the kind already says push in on
     the speaker — and dropping those cost one clip three beats, including the
     ONLY one before the 3 second mark, which is the threshold that most
     decides whether a clip travels. Re-measured after the fix: 5 kept and 3
     dropped with the first beat at 3.4s became 7 kept, none dropped, first
     beat at 1.2s. */

  it('keeps a punch that came back with no description', () => {
    const { ops, dropped } = readEditSheet(
      reply([{ at: 1.2, kind: 'punch', why: 'early visual reset' }]), context(),
    );
    expect(ops).toHaveLength(1);
    expect(ops[0].what).toBe('punch in');
    expect(dropped).toEqual([]);
  });

  it('keeps the model’s own words when it did describe one', () => {
    const { ops } = readEditSheet(
      reply([{ at: 1.2, kind: 'punch', what: 'punch in tight on speaker' }]), context(),
    );
    expect(ops[0].what).toBe('punch in tight on speaker');
  });

  it('still refuses a cutaway with nothing to generate', () => {
    /* The kind does not say what to make, so there is nothing to hand a video
       model. Same for a sound with no name — nothing to go and find. */
    const { ops, dropped } = readEditSheet(
      reply([
        { at: 2, seconds: 2, kind: 'broll', what: '' },
        { at: 4, kind: 'sfx', what: '  ' },
        { at: 6, kind: 'text', what: '' },
      ]),
      context({ mode: 'explainer' }),
    );
    expect(ops).toHaveLength(0);
    expect(dropped).toHaveLength(3);
  });
});
