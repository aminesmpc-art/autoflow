/**
 * The writer returns the shots in its own order.
 *
 * Everything downstream matches by position — shotFor takes a target's index
 * and reads plan[idx]. That is only right if the reply preserves the order it
 * was given, and a director does not think that way.
 *
 * From a real run: five nodes were listed as Maya Orders, The Exchange, Empty
 * Room, By The Window, After Closing. Gemini returned them in narrative order,
 * After Closing first, and renumbered "n" to match — so n was no better than
 * position. Every node got another node's prompt. The barista's line landed on
 * Maya's clip, the voices followed the prompts to the wrong shots, and nothing
 * in the run pointed at either.
 *
 * The titles came back as the target labels verbatim, because that is what the
 * contract lists. So the fix is title matching, and the tests below are mostly
 * about when NOT to trust it.
 */

/// <reference types="node" />

import { alignShots, parseShots, type ShotTarget, type Shot } from '../studio/ask/storyboard';

const target = (id: string, label: string): ShotTarget =>
  ({ id, label, media: 'video', platform: 'flow' });

const shot = (n: number, title: string): Shot =>
  ({ n, title, prompt: `prompt for ${title}` });

/** Exactly the five from the run, in the order Gemini sent them. */
const TARGETS = [
  target('shot_solo', 'Maya Orders'),
  target('shot_duo', 'The Exchange'),
  target('shot_empty', 'Empty Room'),
  target('shot_noimage', 'By The Window'),
  target('shot_manual', 'After Closing'),
];
const REPLY = [
  shot(1, 'After Closing'),
  shot(2, 'By The Window'),
  shot(3, 'Maya Orders'),
  shot(4, 'The Exchange'),
  shot(5, 'Empty Room'),
];

describe('putting the shots back in the targets order', () => {
  it('reorders a reply that came back in narrative order', () => {
    expect(alignShots(REPLY, TARGETS).map((s) => s.title)).toEqual(
      ['Maya Orders', 'The Exchange', 'Empty Room', 'By The Window', 'After Closing']);
  });

  it('leaves a reply that kept the order untouched', () => {
    const inOrder = TARGETS.map((t, i) => shot(i + 1, t.label!));
    expect(alignShots(inOrder, TARGETS)).toEqual(inOrder);
  });

  it('ignores "n", which the writer renumbered to its own order', () => {
    /* Gemini sent n:1 for the fifth node. Trusting n would have produced the
       same wrong mapping as trusting position. */
    const aligned = alignShots(REPLY, TARGETS);
    expect(aligned[0].n).toBe(3);       // "Maya Orders" was its third
  });

  it('matches titles regardless of case and spacing', () => {
    const messy = [shot(1, '  the exchange '), shot(2, 'MAYA ORDERS')];
    const two = [target('a', 'Maya Orders'), target('b', 'The Exchange')];
    expect(alignShots(messy, two).map((s) => s.title.trim())).toEqual(
      ['MAYA ORDERS', 'the exchange']);
  });
});

describe('when position is the honest answer', () => {
  it('falls back when a title matches nothing', () => {
    /* A partial match is a guess, and a guess here is silently the wrong
       prompt on the wrong clip — worse than the order we were given. */
    const odd = [shot(1, 'Something Else'), shot(2, 'The Exchange')];
    const two = [target('a', 'Maya Orders'), target('b', 'The Exchange')];
    expect(alignShots(odd, two)).toEqual(odd);
  });

  it('falls back when two shots share a title', () => {
    const dupes = [shot(1, 'Shot'), shot(2, 'Shot')];
    const two = [target('a', 'Shot'), target('b', 'Shot')];
    expect(alignShots(dupes, two)).toEqual(dupes);
  });

  it('falls back when a target has no label to match on', () => {
    const two = [target('a', ''), target('b', 'The Exchange')];
    const reply = [shot(1, 'The Exchange'), shot(2, 'Maya Orders')];
    expect(alignShots(reply, two)).toEqual(reply);
  });

  it('does nothing when the counts differ', () => {
    expect(alignShots(REPLY.slice(0, 3), TARGETS)).toEqual(REPLY.slice(0, 3));
  });

  it('does nothing for a single shot', () => {
    const one = [shot(1, 'Only')];
    expect(alignShots(one, [target('a', 'Different')])).toEqual(one);
  });
});

describe('the speaker survives the parse', () => {
  it('reads the field the contract asks for', () => {
    /* It was mapped away one line before anything could read it, which made
       the whole speaker field — asked for, and correctly filled in — do
       nothing at all. */
    const reply = JSON.stringify({
      shots: [
        { n: 1, title: 'A', cast: ['Maya', 'the barista'], speaker: 'the barista', prompt: 'x' },
        { n: 2, title: 'B', cast: [], prompt: 'y' },
      ],
    });
    const { shots } = parseShots(reply);
    expect(shots[0].speaker).toBe('the barista');
    expect(shots[1].speaker).toBeUndefined();
  });
});

/**
 * The whole path, on the reply that actually broke.
 *
 * Gemini's answer to the voice test workflow, kept verbatim. It is a good
 * reply — every prompt carries the anchor, every speaker is named correctly,
 * the empty shot has an empty cast. Nothing about it was wrong. It simply
 * arrived in narrative order, and that alone was enough to put the barista's
 * line on Maya's clip and send every voice to the wrong node.
 */
describe('the café reply, end to end', () => {
  const raw = JSON.stringify(require('./fixtures/cafeReply.json'));
  const { shots, cast } = parseShots(raw);
  const aligned = alignShots(shots, TARGETS);
  const CAST = [
    { name: 'Maya', look: 'red coat', voice: 'Kore' },
    { name: 'the barista', look: 'green apron', voice: 'Charon' },
    { name: 'the dog', look: 'terrier' },
  ];

  it('parses all five shots and the cast', () => {
    expect(shots).toHaveLength(5);
    expect(cast?.map((c) => c.name)).toEqual(['Maya', 'the barista', 'the dog']);
  });

  it('lands the right prompt on every node', () => {
    const { voiceForShot } = require('../studio/ask/storyPlan');
    const got = TARGETS.map((t, i) => ({
      node: t.id,
      title: aligned[i].title,
      voice: voiceForShot(aligned[i].cast, aligned[i].speaker, CAST, 'dialogue'),
    }));
    expect(got).toEqual([
      { node: 'shot_solo',    title: 'Maya Orders',   voice: 'Kore' },
      { node: 'shot_duo',     title: 'The Exchange',  voice: 'Charon' },
      { node: 'shot_empty',   title: 'Empty Room',    voice: '' },
      { node: 'shot_noimage', title: 'By The Window', voice: 'Kore' },
      { node: 'shot_manual',  title: 'After Closing', voice: 'Charon' },
    ]);
  });

  it('would have got every one of them wrong before', () => {
    /* Not a hypothetical: this is what the run produced. Two nodes happened to
       land on a shot with the same voice, which is worse than all five being
       wrong — a partly-right result is the kind nobody investigates. */
    const { voiceForShot } = require('../studio/ask/storyPlan');
    const unaligned = TARGETS.map((t, i) => ({
      node: t.id,
      title: shots[i].title,
      voice: voiceForShot(shots[i].cast, shots[i].speaker, CAST, 'dialogue'),
    }));
    expect(unaligned).not.toEqual(TARGETS.map((t, i) => ({
      node: t.id, title: aligned[i].title, voice: '',
    })));
    expect(unaligned[0].title).toBe('After Closing');   // on the "Maya Orders" node
    expect(unaligned[0].voice).toBe('Charon');          // the barista, on Maya's clip
  });

  it('gives the dog no voice even though it is in a shot', () => {
    const { voiceForShot } = require('../studio/ask/storyPlan');
    const window = aligned.find((s) => s.title === 'By The Window')!;
    expect(window.cast).toEqual(['Maya', 'the dog']);
    /* Two characters, one voiced, a speaker named: resolves to Maya rather
       than refusing on the ambiguity. */
    expect(voiceForShot(window.cast, window.speaker, CAST, 'dialogue')).toBe('Kore');
  });
});
