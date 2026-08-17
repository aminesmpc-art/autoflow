/**
 * A spoken line, and the envelope it travels in.
 *
 * Three consecutive replies were discarded for two characters. Each was
 * otherwise perfect — six prompts, right cast, right speaker, the anchor in
 * every one — and each contained:
 *
 *     "prompt": "... Elena says, "Okay, my skin has been so flat lately.""
 *
 * A straight quote inside a JSON string ends it early. The panel could only
 * report that no shots array was found, which names the symptom and neither
 * the cause nor the fix, and the story failed after three attempts.
 *
 * I caused it. The audio guidance used to ask for a line in 'single quotes',
 * which is JSON-safe; aligning the wording to Google's Veo guide changed that
 * to "double quotes" without noticing that the transport is JSON. Google is
 * describing what reaches the generator; the envelope in between was nobody's
 * concern until it collided.
 *
 * Two fixes, because either alone is not enough. The brief now asks for curly
 * quotes — genuinely quotation marks to a generator, ordinary characters to a
 * parser — and the parser repairs straight ones anyway, for the model that
 * uses them regardless.
 */

/// <reference types="node" />

import { parseShots, repairInnerQuotes } from '../studio/ask/storyboard';
import { AUDIO_MODES } from '../studio/ask/storyPlan';

/** The reply as it actually arrived, trimmed to two shots. */
const BROKEN = `{
  "cast": [{ "name": "Elena", "look": "beige ribbed tank top, messy low bun" }],
  "world": "a modern sunlit bathroom with white marble countertops",
  "look": "authentic smartphone 4K front-camera POV, natural morning daylight",
  "story": "Elena transforms her morning routine.",
  "anchor": "Elena in a beige ribbed tank top, sunlit marble bathroom",
  "shots": [
    { "n": 1, "title": "Hook & Intro", "cast": ["Elena"], "speaker": "Elena",
      "prompt": "Handheld front-camera POV as Elena steps forward holding the jar. Ambient noise: quiet bathroom room tone. SFX: a plastic lid unscrewing. Elena says, "Okay, my skin has been looking so flat lately."" },
    { "n": 2, "title": "Texture Demo", "cast": ["Elena"], "speaker": "Elena",
      "prompt": "The camera follows Elena as she works the cream in. Ambient noise: soft airy room tone. SFX: fingertips tapping on cheeks. Elena says, "It feels rich without feeling heavy."" }
  ]
}`;

describe('the reply that was thrown away three times', () => {
  it('is unparseable as it stands', () => {
    /* Not a hypothetical about what JSON.parse might do. */
    expect(() => JSON.parse(BROKEN)).toThrow();
  });

  it('now comes through, with both prompts intact', () => {
    const { shots, problem } = parseShots(BROKEN);
    expect(problem).toBeUndefined();
    expect(shots).toHaveLength(2);
    expect(shots[0].prompt).toContain('Okay, my skin has been looking so flat lately.');
    expect(shots[1].prompt).toContain('It feels rich without feeling heavy.');
  });

  it('keeps the fields around it', () => {
    const parsed = parseShots(BROKEN);
    expect(parsed.cast?.[0].name).toBe('Elena');
    expect(parsed.shots[0].speaker).toBe('Elena');
    expect(parsed.anchor).toContain('beige ribbed tank top');
  });
});

describe('the repair only touches what it must', () => {
  it('leaves valid JSON byte for byte', () => {
    const good = '{"shots":[{"n":1,"prompt":"she turns, and the light moves"}]}';
    expect(repairInnerQuotes(good)).toBe(good);
  });

  it('leaves an already-escaped quote alone', () => {
    const esc = '{"shots":[{"n":1,"prompt":"she says, \\"hello\\" softly"}]}';
    expect(repairInnerQuotes(esc)).toBe(esc);
    expect(() => JSON.parse(repairInnerQuotes(esc))).not.toThrow();
  });

  it('does not mistake a closing quote for an inner one', () => {
    /* The whole rule is what FOLLOWS the quote: a comma, a brace, a bracket
       or a colon closes the string; anything else means it is mid-sentence.
       Getting this backwards would escape every closing quote and destroy a
       reply that arrived correct. */
    const j = '{"a":"one","b":"two","c":["three"],"d":{"e":"four"}}';
    expect(JSON.parse(repairInnerQuotes(j))).toEqual(JSON.parse(j));
  });

  it('leaves a genuinely broken reply broken', () => {
    /* It must not reshape a truncated object into something that parses and
       is wrong — a plausible half-story is harder to notice than no story. */
    expect(() => JSON.parse(repairInnerQuotes('{"shots":[{"n":1,'))).toThrow();
  });

  it('handles a quote at the very end of a value', () => {
    const q = '{"shots":[{"n":1,"prompt":"he said "go" and left"}]}';
    expect(JSON.parse(repairInnerQuotes(q)).shots[0].prompt).toBe('he said "go" and left');
  });
});

describe('the brief stopped asking for the character that breaks it', () => {
  const guide = (id: string) => (AUDIO_MODES.find((a) => a.id === id)?.guide || []).join('\n');

  it('asks for curly quotes in the examples it gives', () => {
    /* An example is the strongest instruction in a brief — a model copies its
       shape before it reads the words around it. */
    expect(guide('dialogue')).toContain('\u201cWe have to leave now.\u201d');
    expect(guide('cinematic')).toContain('\u201cLook at that.\u201d');
  });

  it('shows no straight-quoted dialogue anywhere', () => {
    for (const id of ['cinematic', 'ambient', 'dialogue']) {
      expect(guide(id)).not.toMatch(/says[^\n]*"[A-Z]/);
      expect(guide(id)).not.toMatch(/whispers[^\n]*"[A-Z]/);
    }
  });
});

describe('when it still cannot be read, it says which kind of wrong', () => {
  it('names the quote problem for something that looks like the object', () => {
    /* The old message said "no shots array was found" about a reply holding a
       perfect shots array. The repair built from it asked for the object
       again, and the model sent the same thing three times — it had no way to
       know what to change. */
    const p = parseShots('{ "shots": [ { "n": 1, "prompt": "he said "go" then "stop" now" ');
    expect(p.problem).toMatch(/not valid JSON/);
    expect(p.problem).toMatch(/curly quotes/);
  });

  it('keeps the plain message for a reply that is not the object at all', () => {
    const p = parseShots('Sure! Here are your prompts, let me know what you think.');
    expect(p.problem).toMatch(/No JSON object with a "shots" array/);
  });
});
