/**
 * Letting the Story decide the voices.
 *
 * Two things already existed and had never met: the Story's cast, where each
 * character is described once, and each shot's `cast` list, naming who appears
 * in it. Flow's model is the same shape — a voice attaches to a CHARACTER
 * ingredient, not to a prompt — so joining them is the whole feature. Set a
 * voice once per character and a sixteen-shot story needs nothing set per shot.
 *
 * The hard part is not the join, it is everything that should NOT get a voice.
 * Every one of those is silent: Flow generates happily either way, so a wrong
 * voice sounds exactly as finished as a right one, and nothing reports it.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { voiceForShot, type CastMember } from '../studio/ask/storyPlan';

const CAST: CastMember[] = [
  { name: 'Maya', look: 'red coat', voice: 'Kore' },
  { name: 'the barista', look: 'green apron', voice: 'Charon' },
  { name: 'the dog', look: 'small terrier' },      // deliberately no voice
];

describe('which voice a shot gets', () => {
  it('gives a lone character their own voice', () => {
    expect(voiceForShot(['Maya'], undefined, CAST)).toBe('Kore');
    expect(voiceForShot(['the barista'], undefined, CAST)).toBe('Charon');
  });

  it('matches names case- and space-insensitively', () => {
    /* The writer echoes names back in its own casing, and "The Barista" is the
       same character as "the barista". An exact-match join would drop the
       voice and look like the feature simply did not work. */
    expect(voiceForShot(['  MAYA '], undefined, CAST)).toBe('Kore');
  });

  it('uses the named speaker when two characters are present', () => {
    /* Flow allows one voice per clip. This is the case the speaker field
       exists for, and getting it wrong is invisible — the clip has a voice,
       it is just the wrong person's. */
    expect(voiceForShot(['Maya', 'the barista'], 'the barista', CAST)).toBe('Charon');
    expect(voiceForShot(['Maya', 'the barista'], 'Maya', CAST)).toBe('Kore');
  });

  it('gives no voice to a two-hander with no speaker named', () => {
    /* Taking the first listed would be a coin toss on who is heard. A wrong
       voice is harder to notice than no voice, because the clip sounds
       finished either way. */
    expect(voiceForShot(['Maya', 'the barista'], undefined, CAST)).toBe('');
  });

  it('still resolves when only one of the two can speak', () => {
    /* The dog has no voice, so there is no ambiguity to protect against. */
    expect(voiceForShot(['Maya', 'the dog'], undefined, CAST)).toBe('Kore');
  });

  it('gives no voice to a shot with nobody in it', () => {
    /* An establishing shot, a product on a table. Flow would drop the voice
       anyway — "an audio ingredient requires other ingredients to function" */
    expect(voiceForShot([], undefined, CAST)).toBe('');
    expect(voiceForShot(undefined, undefined, CAST)).toBe('');
  });

  it('gives no voice to a character who has none set', () => {
    expect(voiceForShot(['the dog'], undefined, CAST)).toBe('');
    expect(voiceForShot(['the dog'], 'the dog', CAST)).toBe('');
  });

  it('gives no voice at all when the story has no spoken lines', () => {
    /* audioMode 'none' is the user saying the piece is silent. Attaching a
       voice to every clip would contradict the one setting that says not to. */
    expect(voiceForShot(['Maya'], 'Maya', CAST, 'none')).toBe('');
    expect(voiceForShot(['Maya'], 'Maya', CAST, 'cinematic')).toBe('Kore');
  });

  it('trusts a named speaker the shot cast forgot to list', () => {
    /* A writer that says "Maya speaks" but lists only the barista has told us
       something true about the audio and something sloppy about the blocking.
       The audio is the question being asked. */
    expect(voiceForShot(['the barista'], 'Maya', CAST)).toBe('Kore');
  });

  it('ignores an unknown speaker rather than inventing one', () => {
    expect(voiceForShot(['Maya'], 'Nobody', CAST)).toBe('Kore');
  });
});

describe('the wiring around it', () => {
  const ROOT = join(__dirname, '..', '..');
  const runner = readFileSync(
    join(ROOT, 'src', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');
  const contract = readFileSync(
    join(ROOT, 'src', 'studio', 'ask', 'storyboard.ts'), 'utf8');
  const node = readFileSync(
    join(ROOT, 'src', 'studio', 'nodes', 'StoryNode.tsx'), 'utf8');

  it('the cast editor offers a voice per character', () => {
    expect(node).toMatch(/setCast\(i, \{ voice: e\.target\.value \}\)/);
  });

  it('the writer is only asked for a speaker when a voice needs one', () => {
    /* A field the writer must fill for no reason is a field it gets wrong for
       no reason, and every extra key is another chance to break the JSON. */
    expect(contract).toMatch(/wantsSpeaker \? ', "speaker"/);
    expect(runner).toMatch(/const wantsSpeaker = isStory &&/);
    expect(runner).toMatch(/shotContract\(targets, isStory \? STORY_FIELDS : '', wantsSpeaker\)/);
  });

  it('a voice set by hand on a node outranks the story', () => {
    /* Same rule the cast/world/look write-back already follows: a field the
       user typed beats anything derived. Without the marker, re-running the
       Story would quietly overwrite a deliberate choice. */
    expect(runner).toMatch(/!d\.voiceFromStory/);
    expect(runner).toMatch(/voiceFromStory: !!voice/);
  });
});
