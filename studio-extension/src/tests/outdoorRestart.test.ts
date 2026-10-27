/**
 * "Still wrong: 2 Walking with the tribe (contRestart) on
 *  'cold wind rushing across empty highland plains'."
 *
 * ── The run ──────────────────────────────────────────────────────────────
 *
 * An eight-shot first-person survival episode. Seven prompts came back usable
 * and shot 2 failed three times. Each round the writer was handed the words to
 * change and changed them, and each round it failed again:
 *
 *   1  "left toward miles of empty , frost-bitten hills, then"
 *   2  "brief glance left across empty land while continuing forward"
 *   3  "cold wind rushing across empty highland plains"
 *
 * The third is in the Ambient noise line. The writer had rewritten the action
 * twice, correctly, while the trigger sat in a sentence about wind — which the
 * brief REQUIRES every clip prompt to end with. The loop could not be won.
 *
 * ── Two faults, one symptom ──────────────────────────────────────────────
 *
 * EMPTY_START's vocabulary was written for interiors and builds, where "empty"
 * means the work has not happened yet: an empty room, bare boards, nothing
 * installed. Outdoors it is the subject. A cold moor IS empty, and a
 * wilderness piece cannot describe its own world without saying so.
 *
 * And the rule read the whole prompt, audio included. A restart is a claim
 * about what the shot OPENS ON; sound is not the opening state.
 *
 * ── Not the first time ───────────────────────────────────────────────────
 *
 * PREPARED_GROUND was already lifted out of RESTART_EMPTY for exactly this
 * shape, twice — on `leveled` and then on `graded`, three attempts each. The
 * lesson has not changed: a word is not a restart, a word ABOUT SOMETHING is.
 */

/// <reference types="node" />

import { restartScope } from '../studio/ask/storyboard';

/* Shot 2, as the Director actually wrote it on the third attempt. */
const SHOT_2 = 'Body-mounted action-camera point of view at chest height on a wide 20mm '
  + 'lens, moving in flat grey overcast daylight at 5600K across cold rocky prehistoric '
  + 'grassland of pale dead grass, frost patches, and dark boulders. The camera follows '
  + 'directly behind them across the uneven ground with an unsteadily bouncing gait. The '
  + 'torso turns mid-stride to look left across the open grassland, then swings back to '
  + 'lock onto the group ahead. Ambient noise: steady cold wind rushing across empty '
  + 'highland plains. SFX: rhythmic crunching of dry grass and loose scree underfoot.';

describe('a restart is a claim about the picture', () => {
  it('blanks the audio sentences the brief requires', () => {
    const scoped = restartScope(SHOT_2);
    expect(scoped).not.toMatch(/empty\s+highland plains/);
    expect(scoped).not.toMatch(/Ambient noise/);
    expect(scoped).not.toMatch(/SFX/);
    /* The picture is untouched. */
    expect(scoped).toMatch(/torso turns mid-stride/);
  });

  it('keeps every index lined up, so the quoted trigger is still the real words', () => {
    /* Masked, not cut. A trigger pointing at text that has been spliced out
       sends the writer to change something innocent. */
    const scoped = restartScope(SHOT_2);
    expect(scoped).toHaveLength(SHOT_2.length);
    const at = SHOT_2.indexOf('bouncing gait');
    expect(scoped.slice(at, at + 13)).toBe('bouncing gait');
  });
});

describe('outdoors, empty is scenery', () => {
  const clear = (s: string) => expect(restartScope(s)).not.toMatch(
    /\b(?:empty|emptied|bare|barren|vacant|blank)\b/i);

  it('exempts the three phrasings this run was failed on', () => {
    clear('one brief glance left toward miles of empty, frost-bitten hills, then back');
    clear('a brief glance left across empty land while continuing forward');
    clear('Ambient noise: cold wind rushing across empty highland plains.');
  });

  it('exempts the rest of the outdoors', () => {
    for (const phrase of [
      'walking across the empty moor',
      'the bare ridge above them',
      'a barren valley opening ahead',
      'the empty road behind the tribe',
      'an empty, frost-bitten hillside',
    ]) clear(phrase);
  });
});

describe('indoors, empty still means the work has not happened', () => {
  const stillFlags = (s: string) => expect(restartScope(s)).toMatch(
    /\b(?:empty|bare|unfurnished|stripped|not yet)\b/i);

  it('keeps every build and renovation detection it had', () => {
    /* The rule exists because a continuation describing the room as it was
       BEFORE the work argues with the frame it was handed, and the clip
       restarts. None of that is relaxed. */
    for (const phrase of [
      'the empty room with the tools still on the floor',
      'a completely bare living room, walls unpainted',
      'the unfurnished bedroom before any of the work',
      'the space is stripped back to the brick',
      'the kitchen is not yet fitted',
    ]) stillFlags(phrase);
  });

  it('does not let an outdoor noun launder an indoor restart', () => {
    /* "empty room" and "open land" in one sentence: the room is still a
       restart. Only the landscape phrase is blanked. */
    const scoped = restartScope(
      'the empty room, its window looking out over open land beyond the ridge');
    expect(scoped).toMatch(/empty room/);
    expect(scoped).not.toMatch(/open land/);
  });

  it('only reaches across a short span, and never past a sentence', () => {
    /* A full stop ends the exemption: "The room is empty. Outside, the plains
       stretch away" is a restart with scenery after it, not scenery. */
    const scoped = restartScope('The room is empty. Outside, the plains stretch away.');
    expect(scoped).toMatch(/room is empty/);
  });
});
