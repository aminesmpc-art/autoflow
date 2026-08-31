/* ============================================================
   Ask AI presets.

   The problem they solve: a user types "BMW 525d" and the workflow needs a
   150-word brief naming the angles, the lighting and the trim details, or the
   reference sheet comes back flat. The car template solved that once by hand;
   a preset is that wrapper made reusable.

   Two properties are worth pinning. Presets must stay DATA — the moment one
   can carry logic, cloud delivery stops being a config fetch and becomes a
   policy violation. And the image variant must actually differ, because
   "character sheet from a photo" and "from a sentence" are different jobs.
   ============================================================ */

import {
  BUILTIN_ASK_PRESETS as ASK_PRESETS, composeAskPrompt, findPreset,
  DEFAULT_PRESET_ID, setAskPresets, getAskPresets, validatePreset,
} from '../studio/presets';

// Each test starts from the bundled set, since these swap it around.
afterEach(() => setAskPresets(BUILTIN_ASK_PRESETS_SNAPSHOT));
const BUILTIN_ASK_PRESETS_SNAPSHOT = ASK_PRESETS;

describe('the preset set', () => {
  it('has unique ids and a default that resolves', () => {
    const ids = ASK_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findPreset(DEFAULT_PRESET_ID).id).toBe(DEFAULT_PRESET_ID);
  });

  it('gives every preset a name and a hint', () => {
    // The dropdown shows names; the hint is what says which to pick.
    for (const p of ASK_PRESETS) {
      expect({ id: p.id, named: !!p.name, hinted: !!p.hint })
        .toEqual({ id: p.id, named: true, hinted: true });
    }
  });

  it('carries no executable field', () => {
    /* The rule cloud delivery depends on. A preset is text with a
       {{subject}} placeholder — nothing evaluated, ever. */
    for (const p of ASK_PRESETS) {
      for (const [key, value] of Object.entries(p)) {
        expect({ id: p.id, key, type: typeof value })
          .toEqual({ id: p.id, key, type: 'string' });
      }
    }
  });

/* Presets whose answer is NOT wired into another node.

   Every other preset returns one prompt, which a downstream node renders
   verbatim — so "Sure! Here's a prompt:" would end up in the shot. A director
   brief is the opposite: it runs a session with a person, answers with five
   ideas and code blocks, and its output is read rather than rendered.
   Exempting it is the honest option; appending "output only the prompt" would
   contradict the brief it is attached to. */
const SESSION_BRIEFS = new Set(['none', 'room_transform_director']);

describe('presets that hold a session rather than write one prompt', () => {
  it('are the only ones exempt from the output rule', () => {
    // A list that grows silently is how a real prompt-writer slips the check.
    expect([...SESSION_BRIEFS].sort()).toEqual(['none', 'room_transform_director']);
  });

  it('still say not to answer with a bare acknowledgement', () => {
    const director = ASK_PRESETS.find((p) => p.id === 'room_transform_director');
    if (!director) return;   // published set may not carry it yet
    expect(director.brief).toMatch(/code blocks/i);
    expect(director.brief).toMatch(/exactly 5/i);
  });
});

describe('the preset set, continued', () => {
  it('tells the model to answer with only the prompt', () => {
    /* An answer is fed straight to another node as its prompt, so "Sure!
       Here's a prompt:" gets rendered as if it were part of the shot. */
    for (const p of ASK_PRESETS.filter((p) => !SESSION_BRIEFS.has(p.id))) {
      const both = p.brief + (p.withImage || '');
      expect({ id: p.id, constrained: /output only|no preamble/i.test(both) })
        .toEqual({ id: p.id, constrained: true });
    }
  });
});

describe('the preset set, resumed', () => {
  it('falls back to the first preset for an unknown id', () => {
    // A workflow saved with a preset later removed must still open.
    expect(findPreset('tpl_does_not_exist').id).toBe(ASK_PRESETS[0].id);
    expect(findPreset(undefined).id).toBe(ASK_PRESETS[0].id);
  });
});

describe('composeAskPrompt', () => {
  it('leaves plain text alone under the default preset', () => {
    expect(composeAskPrompt('none', 'a calico cat', false)).toBe('a calico cat');
  });

  it('wraps a bare subject in the brief', () => {
    const out = composeAskPrompt('car_sheet', 'BMW 525d', false);
    // The whole point: four characters in, a real brief out.
    expect(out).toContain('BMW 525d');
    expect(out.length).toBeGreaterThan(400);
    expect(out).toMatch(/three-quarter front/i);
  });

  it('substitutes every occurrence', () => {
    for (const p of ASK_PRESETS) {
      const out = composeAskPrompt(p.id, 'SUBJECT-X', false);
      expect({ id: p.id, leftover: out.includes('{{subject}}') })
        .toEqual({ id: p.id, leftover: false });
    }
  });

  it('uses a different brief when a reference image is wired in', () => {
    /* Inventing a character and matching one are different jobs. A single
       brief doing both hedges, and hedged briefs produce hedged sheets. */
    const fromText = composeAskPrompt('character_sheet', 'a tired detective', false);
    const fromPhoto = composeAskPrompt('character_sheet', 'a tired detective', true);
    expect(fromPhoto).not.toBe(fromText);
    expect(fromPhoto).toMatch(/attached reference|do not improve|restyle/i);
  });

  it('keeps the text brief when a preset has no image variant', () => {
    const preset = ASK_PRESETS.find((p) => !p.withImage)!;
    expect(composeAskPrompt(preset.id, 'thing', true))
      .toBe(composeAskPrompt(preset.id, 'thing', false));
  });

  it('drops the subject line entirely when nothing was typed', () => {
    /* Normal for the image-led presets — "continue this shot" needs only the
       frame. Substituting empty would leave a dangling "Notes on the
       subject:" with nothing after it. */
    const out = composeAskPrompt('continue_shot', '', true);
    expect(out).not.toContain('{{subject}}');
    expect(out).not.toMatch(/:\s*$/m);
    expect(out).toMatch(/LAST FRAME/);
  });

  it('never returns an empty prompt for a real preset', () => {
    // An empty prompt submits and burns a generation on the far side.
    for (const p of ASK_PRESETS.filter((p) => p.id !== 'none')) {
      expect({ id: p.id, empty: composeAskPrompt(p.id, '', false).length === 0 })
        .toEqual({ id: p.id, empty: false });
    }
  });
});

/* Presets ride the same pipeline as templates, so a brief producing weak
   sheets is a publish rather than a store review. What must not come with
   that is a bad publish emptying the dropdown. */
describe('published presets', () => {
  it('replaces the bundled set when the payload has one', () => {
    setAskPresets([{ id: 'x', name: 'X', hint: 'h', brief: 'do {{subject}}' }]);
    expect(getAskPresets()).toHaveLength(1);
    expect(composeAskPrompt('x', 'a cat', false)).toBe('do a cat');
  });

  it('keeps the bundled set when the payload has none', () => {
    // An empty list would silently remove the feature rather than update it.
    setAskPresets([]);
    expect(getAskPresets().length).toBe(ASK_PRESETS.length);
    setAskPresets(undefined);
    expect(getAskPresets().length).toBe(ASK_PRESETS.length);
  });

  it('rejects a preset carrying anything but strings', () => {
    /* The rule cloud delivery rests on: MV3 permits fetching configuration
       and forbids fetching code. A function here would make this a policy
       violation, not just a bug. */
    expect(validatePreset({ id: 'x', name: 'X', hint: 'h', brief: '{{subject}}', run: () => 1 }))
      .not.toEqual([]);
    expect(validatePreset({ id: 'x', name: 'X', hint: 'h', brief: '{{subject}}', count: 3 }))
      .not.toEqual([]);
  });

  it('rejects a brief that ignores what the user typed', () => {
    expect(validatePreset({ id: 'x', name: 'X', hint: 'h', brief: 'draw a horse' }).join(' '))
      .toMatch(/\{\{subject\}\}/);
  });

  it('accepts every preset we ship', () => {
    for (const p of ASK_PRESETS) {
      expect({ id: p.id, problems: validatePreset(p) }).toEqual({ id: p.id, problems: [] });
    }
  });
});

/* ============================================================
   Two ways an empty subject used to change the brief's meaning.

   Both were found in review, and both were the same mistake: a rule that
   held for the bundled set was treated as a property of every set.
   ============================================================ */
describe('an empty subject', () => {
  it('keeps the instruction the placeholder was attached to', () => {
    /* The stated invariant — "{{subject}} always owns its line" — was simply
       untrue. Three briefs end an instruction with it, so dropping the line
       deleted the instruction and sent the model bare section headings. */
    const out = composeAskPrompt('car_sheet', '', false);
    expect(out).toMatch(/reference sheet/i);
    expect(out).not.toContain('{{subject}}');
  });

  it('leaves no dangling label where the subject would have been', () => {
    // "…of this exact car:" with nothing after it reads as a truncated prompt.
    const out = composeAskPrompt('car_sheet', '', false);
    expect(out).not.toMatch(/:\s*$/m);
  });

  it('still substitutes normally when a subject is given', () => {
    const out = composeAskPrompt('car_sheet', 'BMW 525d', false);
    expect(out).toContain('BMW 525d');
    expect(out).toMatch(/reference sheet/i);
  });

  it('does not collapse a brief to nothing', () => {
    for (const p of ASK_PRESETS.filter((p) => p.id !== 'none')) {
      expect({ id: p.id, len: composeAskPrompt(p.id, '', false).length > 40 })
        .toEqual({ id: p.id, len: true });
    }
  });
});

describe('an unknown preset id', () => {
  afterEach(() => setAskPresets(null));

  it('passes the text through instead of using whatever is first', () => {
    /* findPreset fell back to activePresets[0]. That is `none` in the bundled
       set, which is why it looked correct — but presets are published from the
       cloud and nothing requires `none` to be present or first. A list
       starting with a car brief would have wrapped every plain Ask AI prompt
       in it and returned a confident answer about the wrong subject. */
    setAskPresets([
      { id: 'car_sheet', name: 'Car', hint: 'h', brief: 'CAR BRIEF: {{subject}}' },
    ]);
    expect(composeAskPrompt(undefined, 'a calico cat', false)).toBe('a calico cat');
    expect(composeAskPrompt('does_not_exist', 'a calico cat', false)).toBe('a calico cat');
  });

  it('still resolves a preset that is present', () => {
    setAskPresets([
      { id: 'car_sheet', name: 'Car', hint: 'h', brief: 'CAR BRIEF: {{subject}}' },
    ]);
    expect(composeAskPrompt('car_sheet', 'BMW', false)).toBe('CAR BRIEF: BMW');
  });
});
});
