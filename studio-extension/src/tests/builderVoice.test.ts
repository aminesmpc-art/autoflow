/**
 * A voice has to survive the builder.
 *
 * The spec the builder accepts is a list of "steps", compiled into nodes and
 * edges. PlanStep had no voice field and the manual never mentioned one, so a
 * spec that cast its characters would import cleanly, silently drop every
 * voice, and produce a workflow whose clips are mute for no stated reason.
 * Nothing would have failed — which is the whole problem.
 */

/// <reference types="node" />

import { buildFromReply } from '../studio/builder/plan';
import { buildSpec } from '../studio/builder/spec';

const SPEC = JSON.stringify({
  name: 'Two voices',
  steps: [
    { id: 'ref', type: 'generate', media: 'image', platform: 'flow', label: 'Still', prompt: 'a person' },
    {
      id: 'dir', type: 'story', platform: 'chatgpt', label: 'Director',
      audioMode: 'dialogue',
      cast: [
        { name: 'Maya', look: 'red coat', voice: 'Kore' },
        { name: 'the dog', look: 'terrier' },
      ],
    },
    {
      id: 'clip', type: 'generate', media: 'video', platform: 'flow', label: 'Clip',
      inputs: ['dir', 'ref'], voice: 'Fenrir',
    },
  ],
});

describe('compiling a spec that casts voices', () => {
  const built = buildFromReply(SPEC);

  it('imports without complaint', () => {
    expect(built.problems).toEqual([]);
  });

  it('keeps a cast voice, and keeps its absence', () => {
    const story: any = built.template!.nodes.find((n: any) => n.data.type === 'story');
    expect(story.data.cast[0].voice).toBe('Kore');
    /* A character with no voice must stay that way. Defaulting one would give
       the dog a speaking part. */
    expect(story.data.cast[1].voice).toBeUndefined();
  });

  it('keeps a voice named on a clip', () => {
    const clip: any = built.template!.nodes.find((n: any) => n.id === 'clip');
    expect(clip.data.voice).toBe('Fenrir');
  });

  it('does not mark a spec voice as story-derived', () => {
    /* voiceFromStory means "this was computed and may be recomputed". A voice
       the author wrote down is neither, so re-running the Story must leave it
       alone — the same rule as a voice picked by hand on the canvas. */
    const clip: any = built.template!.nodes.find((n: any) => n.id === 'clip');
    expect(clip.data.voiceFromStory).toBeUndefined();
  });

  it('adds no voice where none was asked for', () => {
    const still: any = built.template!.nodes.find((n: any) => n.id === 'ref');
    expect(still.data.voice).toBeUndefined();
  });
});

describe('the brief tells its author the rules', () => {
  /* The spec is written by a model reading this brief. A field the brief does
     not mention is a field nothing will ever emit, so the plumbing on its own
     would have been dead weight. Asserted against the whole brief because
     that is what the model is actually handed. */
  const brief = buildSpec('any idea');
  it('offers voice on the cast and on a step', () => {
    expect(brief).toMatch(/"voice": "optional Flow voice, e\.g\. Kore"/);
    expect(brief).toMatch(/"voice": "optional Flow voice for this one clip/);
  });

  it('says where a voice belongs and where it cannot work', () => {
    expect(brief).toMatch(/A voice belongs on the CAST, not on each clip/);
    expect(brief).toMatch(/needs a reference image/);
    expect(brief).toMatch(/impossible on a startFrame\/endFrame step/);
  });
});
