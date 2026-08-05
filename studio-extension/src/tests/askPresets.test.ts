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

import { ASK_PRESETS, composeAskPrompt, findPreset, DEFAULT_PRESET_ID } from '../studio/presets';

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

  it('tells the model to answer with only the prompt', () => {
    /* An answer is fed straight to another node as its prompt, so "Sure!
       Here's a prompt:" gets rendered as if it were part of the shot. */
    for (const p of ASK_PRESETS.filter((p) => p.id !== 'none')) {
      const both = p.brief + (p.withImage || '');
      expect({ id: p.id, constrained: /output only|no preamble/i.test(both) })
        .toEqual({ id: p.id, constrained: true });
    }
  });

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
