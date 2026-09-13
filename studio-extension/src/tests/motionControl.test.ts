/**
 * Motion Control — a Director for motion.
 *
 * "the motion control mast be like the director and feed the video to gemini
 *  or chatgpt … make 3 prompts for the 3 videos we have so the new node make
 *  automaticly 3 nodes of omni"
 *
 * ── Why it is a director and not a template ───────────────────────────────
 *
 * Omni refuses more than ten seconds of video in one generation — Flow says so
 * itself: "Videos longer than 10s can't be edited." So thirty seconds is three
 * generations, and the obvious build is one node that splits the clip and
 * sends the same sentence three times.
 *
 * That produces three unrelated clips. The model never learns that piece two
 * opens on a hand already reaching, or that the turn to camera in piece three
 * is the point of the whole thing.
 *
 * So each piece is SHOWN to a model, one at a time, in a single conversation.
 * Piece two is written by a model that has just watched piece one and knows
 * what it asked for. That is what makes the joins survive, and it is the only
 * part of this feature that was not already built somewhere in this repo.
 */

/// <reference types="node" />

import {
  motionBriefAsk, motionPieceAsk, readMotionPrompt, plainMotionPrompt,
  MODE_INTENT, type MotionBrief, type MotionPiece,
} from '../studio/ask/motionControl';

const piece = (index: number, of: number, extra: Partial<MotionPiece> = {}): MotionPiece => ({
  index, of, startSec: (index - 1) * 9.6, endSec: index * 9.6, seconds: 9.6,
  cutsSpeech: false, ...extra,
});

const brief = (over: Partial<MotionBrief> = {}): MotionBrief => ({
  mode: 'move', wish: 'make the shoes dance', hasCharacter: true, ...over,
});

describe('the three jobs are kept apart', () => {
  it('carries Google\'s own wording for each, not a paraphrase', () => {
    /* These are the phrasings the model was demonstrated with. A rewrite of
       them is a guess dressed as a refinement. */
    expect(MODE_INTENT.move.googleWording)
      .toContain('Apply the pose and motion from input video to provided character from this image');
    expect(MODE_INTENT.swap.googleWording)
      .toContain('match your motion and dialogue seamlessly');
    expect(MODE_INTENT.restyle.googleWording)
      .toContain('Do not show the whale or water');
  });

  it('says what swap keeps that the others do not', () => {
    /* Dialogue. That is what makes it usable for a talking UGC ad rather than
       only for B-roll, and it is the reason swap is its own mode. */
    expect(MODE_INTENT.swap.keeps).toMatch(/dialogue/i);
  });

  it('makes restyle say what must NOT appear', () => {
    /* The mode's prompt shape is genuinely different — it names a suppression,
       which neither of the others does. */
    expect(motionPieceAsk(brief({ mode: 'restyle' }), piece(1, 3))).toMatch(/must NOT appear/);
    expect(motionPieceAsk(brief({ mode: 'move' }), piece(1, 3))).not.toMatch(/must NOT appear/);
  });
});

describe('the opening turn', () => {
  it('says how many pieces there will be, and why', () => {
    const ask = motionBriefAsk(brief(), 3);
    expect(ask).toContain('3 separate generations');
    expect(ask).toMatch(/10 seconds at a time/);
  });

  it('names the drift problem the director exists to solve', () => {
    /* Each piece is generated independently. Saying so up front is what makes
       the model hold the subject and the look steady across all three. */
    const ask = motionBriefAsk(brief(), 3);
    expect(ask).toMatch(/independently/);
    expect(ask).toMatch(/The same subject, described the same way every time/);
    expect(ask).toMatch(/Continuity at the joins/);
  });

  it('tells it there is a still, when there is one', () => {
    expect(motionBriefAsk(brief({ hasCharacter: true }), 2)).toMatch(/the provided image/);
  });

  it('forbids inventing one when there is not', () => {
    /* A prompt that refers to a character image that was never attached
       produces a generation built on something that does not exist. */
    const ask = motionBriefAsk(brief({ hasCharacter: false }), 2);
    expect(ask).toMatch(/NO character still was provided/);
    expect(ask).toMatch(/Do not write prompts that refer to one/);
  });
});

describe('each piece knows where it sits', () => {
  it('tells the first piece it carries the hook', () => {
    expect(motionPieceAsk(brief(), piece(1, 3))).toMatch(/OPENING piece/);
  });

  it('tells the last piece to land', () => {
    expect(motionPieceAsk(brief(), piece(3, 3))).toMatch(/FINAL piece/);
  });

  it('tells a middle piece what it continues from', () => {
    /* The information the footage cannot carry: what the model asked for in
       the piece before this one. */
    expect(motionPieceAsk(brief(), piece(2, 3)))
      .toMatch(/continues directly from the piece you just wrote for/);
  });

  it('does not tell the first piece it continues from anything', () => {
    expect(motionPieceAsk(brief(), piece(1, 3)))
      .not.toMatch(/continues directly from/);
  });

  it('warns when the split had to cut somebody off', () => {
    /* omniChunks nudges every boundary into a pause and reports when it could
       not find one. A piece that opens mid-sentence has to say so, or the
       model treats it as a fresh start. */
    expect(motionPieceAsk(brief(), piece(2, 3, { cutsSpeech: true })))
      .toMatch(/begins mid-sentence/);
    expect(motionPieceAsk(brief(), piece(2, 3, { cutsSpeech: false })))
      .not.toMatch(/begins mid-sentence/);
  });

  it('carries the piece\'s real timecodes', () => {
    expect(motionPieceAsk(brief(), piece(2, 3))).toMatch(/9\.6s to 19\.2s/);
  });

  it('repeats the look instruction on every piece', () => {
    /* The model generating the clip has no memory of the other pieces, so a
       look named once in piece one is a look absent from pieces two and three.
       For move and swap the look is POINTED AT rather than described — naming
       values makes the pieces agree with each other and disagree with the
       footage they came from. */
    for (const i of [1, 2, 3]) {
      expect(motionPieceAsk(brief(), piece(i, 3)))
        .toMatch(/match the lighting, grade and framing of the input video/);
      expect(motionPieceAsk(brief({ mode: 'restyle' }), piece(i, 3)))
        .toMatch(/the look, named again in full/);
    }
  });

  it('carries the words the user typed to every piece, not just the first', () => {
    /* Said once in the opening brief, a specific instruction is five turns and
       two watched videos behind by piece three, and free to be dropped with
       nothing in the output to show it existed. */
    for (const i of [1, 2, 3]) {
      expect(motionPieceAsk(brief({ wish: 'keep her facing the camera' }), piece(i, 3)))
        .toMatch(/STILL APPLIES TO THIS PIECE: keep her facing the camera/);
    }
    expect(motionPieceAsk(brief({ wish: '' }), piece(1, 3)))
      .not.toMatch(/STILL APPLIES/);
  });

  it('forbids narrating the movement for the modes that copy it', () => {
    /* The bug this whole change exists for. Asked for "what MOVES, precisely",
       the director wrote sixty words of choreography over a clip that already
       contained the choreography — and the model blended the two. */
    for (const mode of ['move', 'swap'] as const) {
      const ask = motionPieceAsk(brief({ mode }), piece(1, 2));
      expect(ask).toMatch(/NOT the movement/);
      expect(ask).not.toMatch(/what MOVES, precisely/);
      expect(motionBriefAsk(brief({ mode }), 2)).toMatch(/DO NOT DESCRIBE THE MOVEMENT/);
    }
  });

  it('still asks restyle to describe it, because that mode transforms it', () => {
    /* A material cannot be told to copy frames. The exception is real, not an
       oversight. */
    const ask = motionPieceAsk(brief({ mode: 'restyle' }), piece(1, 2));
    expect(ask).toMatch(/the movement as shape and rhythm/);
    expect(ask).not.toMatch(/NOT the movement/);
    expect(motionBriefAsk(brief({ mode: 'restyle' }), 2))
      .toMatch(/THIS MODE NEEDS THE MOVEMENT DESCRIBED/);
  });

  it('keeps the timecodes out of the prompt it asks for', () => {
    /* They are context for the director. They were being copied through —
       "Transfer the exact choreography from 0.0s to 6.0s" — to a model that is
       handed this clip alone and knows nothing of the source timeline. */
    expect(motionPieceAsk(brief(), piece(2, 3))).toMatch(/no timecodes and no "part 2 of 2"/);
  });

  it('never tells a copying mode to invent a camera', () => {
    /* "fixed eye-level camera framing" came out of a mode whose whole claim is
       that it keeps the camera from the video. */
    const ask = motionPieceAsk(brief(), piece(1, 2));
    expect(ask).toMatch(/do not invent lighting or a camera move/);
  });

  it('asks for the reply shape every time', () => {
    /* Repeated because the model drifts off it once it has written prose. */
    expect(motionPieceAsk(brief(), piece(2, 3))).toContain('{"prompt":"…","why":"…"}');
  });
});

describe('reading a piece back', () => {
  it('takes the prompt out of a clean reply', () => {
    const got = readMotionPrompt(
      '{"prompt":"The shoes rotate on the marble as the hand withdraws, warm window light.","why":"opens on the turn"}',
      1);
    expect(got.prompt).toMatch(/The shoes rotate/);
    expect(got.why).toBe('opens on the turn');
  });

  it('digs it out of a reply wrapped in chatter', () => {
    const got = readMotionPrompt(
      'Sure! Here is the prompt:\n```json\n{"prompt":"A long enough direction to be usable here.","why":"x"}\n```\nHope that helps.',
      2);
    expect(got.prompt).toBe('A long enough direction to be usable here.');
  });

  it('refuses an empty prompt rather than spending a generation on it', () => {
    expect(() => readMotionPrompt('{"prompt":"","why":"none"}', 1))
      .toThrow(/empty prompt/);
  });

  it('refuses an acknowledgement pretending to be a prompt', () => {
    /* "OK" parses perfectly and generates nothing. A prompt is what gets spent
       on a generation, so a half-answer is worse than a clear failure — the
       caller can retry in the same thread, which is what makes retrying
       cheap. */
    expect(() => readMotionPrompt('{"prompt":"OK, understood","why":""}', 3))
      .toThrow(/too short to be a prompt/);
  });

  it('says which piece failed', () => {
    expect(() => readMotionPrompt('no json here', 2)).toThrow(/Piece 2/);
  });
});

describe('when the director cannot be reached', () => {
  it('still produces something usable', () => {
    const p = plainMotionPrompt(brief(), piece(1, 3));
    expect(p).toContain(MODE_INTENT.move.googleWording);
    expect(p).toContain('make the shoes dance');
  });

  it('at least tells the model the pieces belong together', () => {
    expect(plainMotionPrompt(brief(), piece(2, 3)))
      .toMatch(/part 2 of 3 of one continuous shot/);
  });

  it('says nothing about parts when there is only one', () => {
    expect(plainMotionPrompt(brief(), piece(1, 1))).not.toMatch(/part 1 of 1/);
  });
});

/* ── How the node is wired ────────────────────────────────────────────────── */

import { readFileSync } from 'fs';
import { join } from 'path';

const RUNNER = readFileSync(
  join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('the node makes the clips itself', () => {
  it('leaves the generation machinery before it reaches it', () => {
    expect(RUNNER).toMatch(/if \(node\.type === 'motion' \|\| nodeData\.type === 'motion'\)/);
  });

  it('cuts with the chunker that already knows the cap', () => {
    /* OMNI_MAX_SEC comes from Flow's own error message, and the splitter
       already nudges boundaries into pauses. Re-deriving either here would be
       a second opinion about a settled fact. */
    expect(RUNNER).toMatch(/planOmniChunks\(probe\.durationSec, \[\], OMNI_MAX_SEC\)/);
  });

  it('shows each piece to the director rather than describing it', () => {
    /* The attachment is the whole idea. referenceImageData is named for images
       and carries any data: URL, which is what lets a model WATCH this. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/motionPieceAsk\(brief, p\.piece\), false, \[p\.dataUrl\]/);
  });

  it('keeps every piece in ONE conversation', () => {
    /* firstTurn true for the brief, false for every piece — so piece two is
       written by a model that has seen piece one. The thread machinery is the
       one added for the Directors. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/motionBriefAsk\(brief, cuts\.length\), true, character/);
  });

  it('generates every piece here, in one press', () => {
    /* The reason this stopped spawning nodes: the runner sorts its plan once,
       before the first step, so a node created during a run is never in it.
       Spawned Omni nodes could not run on the press that built them. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/await this\.awaitBridge\(nodeId, \{/);
    expect(body).toMatch(/model: 'Omni 1\.1 Flash'/);
    expect(body).toMatch(/creationType: 'ingredients'/);
    expect(body).not.toMatch(/addNode\(\{/);
  });

  it('sends each piece by the name it was uploaded under', () => {
    /* styleReference is what the Flow adapter feeds to attachFromLibrary —
       Videos tab, search, Add to prompt. The route already exists. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/styleReference: row\.filename/);
    expect(body).toMatch(/styleReferenceRequired: true/);
  });

  it('one at a time, because results are matched on the node id', () => {
    /* awaitBridge resolves on nodeId, so two in flight for the same node
       would answer each other's promises. A for..of is what makes it safe —
       a Promise.all here would be a race with a plausible-looking diff. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/for \(const row of rows\) \{/);
    expect(body).not.toMatch(/Promise\.all\(rows/);
  });

  it('does not make a piece that already came back', () => {
    /* What turns a retry into "finish the ones that failed". The row keeps its
       own status precisely so this question can be asked per piece. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/if \(row\.status === 'done' && \(row\.videoUrl \|\| row\.tileId\)\)/);
  });

  it('generates nothing when the upload failed', () => {
    /* Pieces pointing at library entries that do not exist would each fail
       later, one at a time, for a reason belonging to a step already over. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    const guard = body.indexOf('Nothing was generated, so nothing has to be cleaned up');
    const make = body.indexOf('await this.awaitBridge(nodeId, {');
    expect(guard).toBeGreaterThan(-1);
    expect(make).toBeGreaterThan(guard);
  });

  it('writes the pieces down before it spends anything on them', () => {
    /* Cut, direct and upload are unrepeatable without cost. Saved first, a
       generation that dies leaves the prompts and the library names on the
       node and a retry starts from there instead of the beginning. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    const saved = body.indexOf('motionPreparedFrom: sourceKey');
    const make = body.indexOf('await this.awaitBridge(nodeId, {');
    expect(saved).toBeGreaterThan(-1);
    expect(make).toBeGreaterThan(saved);
  });

  it('fails the node when a piece did not come back', () => {
    /* And keeps the ones that did. Reporting "done" over a missing clip is
       the failure mode this whole node has been fighting. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/if \(failures\.length\) \{/);
    expect(body).toMatch(/the pieces that `\s*\+ 'succeeded are kept/);
  });

  it('says out loud when it fell back to the plain instruction', () => {
    /* The plain template is exactly what the director exists to improve on.
       Substituting it quietly would make a worse run look like a good one. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/The director could not be reached/);
    expect(body).toMatch(/motionDirected: directed/);
  });

  it('reports the joins that landed mid-speech', () => {
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/join\(s\) land mid-speech/);
  });
});

describe('the node is a real node', () => {
  const CANVAS = readFileSync(
    join(__dirname, '..', 'studio', 'components', 'Canvas.tsx'), 'utf8');
  const VALIDATE = readFileSync(
    join(__dirname, '..', 'studio', 'templates', 'validate.ts'), 'utf8');
  const INFO = readFileSync(
    join(__dirname, '..', 'studio', 'nodes', 'nodeInfo.ts'), 'utf8');

  it('is registered so the canvas can draw it', () => {
    expect(CANVAS).toMatch(/motion: guarded\(MotionNode, 'Motion Control'\)/);
  });

  it('can be added from the toolbar', () => {
    expect(CANVAS).toMatch(/const addMotionNode = useCallback/);
    expect(CANVAS).toMatch(/Add Motion Control node/);
  });

  it('declares the three ports it actually reads', () => {
    expect(VALIDATE).toMatch(/motion: \{ in: \['text', 'video', 'image_ref'\], out: \['text'\] \}/);
  });

  it('explains itself in the info badge', () => {
    expect(INFO).toMatch(/title: 'Motion Control'/);
    expect(INFO).toMatch(/ten seconds at a time/);
  });
});

/* ── "how to add video ??" ────────────────────────────────────────────────
 *
 * A fair question, and the answer when it was asked was: you could not. The
 * node threw an error naming two ways in —
 *
 *   "Drop a file on it, or wire it to a Cut node"
 *
 * and neither existed. There was no file input on the node, and
 * executeMotionNode read nodeData.sourceKey only — it never looked at the V
 * edge it drew a port for. The message described a node that had not been
 * built.
 */
describe('getting a video into the node', () => {
  const NODE = readFileSync(
    join(__dirname, '..', 'studio', 'nodes', 'MotionNode.tsx'), 'utf8').replace(/\r\n/g, '\n');

  it('offers a file picker on the node itself', () => {
    expect(NODE).toMatch(/type="file"/);
    expect(NODE).toMatch(/accept="video\/\*"/);
  });

  it('puts the bytes in the store and the KEY in node data', () => {
    /* Node data is serialised — saved, exported, round-tripped through the
       template format — and a File cannot survive that. Forgetting this is the
       version of the node where the video is never loaded. */
    expect(NODE).toMatch(/const key = sourceKeyFor\(file\);/);
    expect(NODE).toMatch(/putSource\(key, file\);/);
    expect(NODE).toMatch(/sourceKey: key,/);
  });

  it('drops the pieces when the video changes', () => {
    /* Their prompts were written about footage this node no longer holds, and
       the clips sitting in Flow's library are of the old one. */
    const at = NODE.indexOf('const onFile =');
    const body = NODE.slice(at, at + 1200);
    expect(body).toMatch(/motionPieces: \[\]/);
    expect(body).toMatch(/motionPreparedFrom: ''/);
  });

  it('reads the V port too, not only its own picker', () => {
    /* The port was drawn and never read, which is worse than not drawing it:
       a wire that visibly connects and silently does nothing. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 4000);
    expect(body).toMatch(/getNodeInputs\(nodeId, edges\)\.get\('video'\)/);
    expect(body).toMatch(/\(upstream\?\.data as any\)\?\.sourceKey/);
  });

  it('lets the wire win over the picker', () => {
    /* Someone who picks a file and then wires a Cut node in has changed their
       mind, and the edge is the more deliberate of the two. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 4000);
    const wire = body.indexOf("get('video')");
    const own = body.indexOf('if (!sourceKey) sourceKey = String(nodeData.sourceKey');
    expect(own).toBeGreaterThan(wire);
  });

  it('only takes an upstream key whose bytes are actually there', () => {
    /* A Cut node that has been through a reload still carries its sourceKey in
       node data while the bytes are gone. Taking it on the name alone would
       fail later, somewhere less obvious. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 4000);
    expect(body).toMatch(/if \(key && getSource\(key\)\) \{ sourceKey = key; break; \}/);
  });

  it('tells a reload apart from an empty node', () => {
    /* Two different causes needing two different fixes. "No video" for both
       sends someone hunting the wrong one. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    /* Widened as the reuse rules grew above it; the two messages sit at the
       top of the method, just further down than they used to. */
    const body = RUNNER.slice(at, at + 7000);
    expect(body).toMatch(/not loaded any more — the bytes do not survive a/);
    expect(body).toMatch(/has no video\. Choose a file on the node, or wire V/);
  });

  it('says on the node which two ways there are', () => {
    expect(NODE).toMatch(/Choose source video/);
    expect(NODE).toMatch(/Or connect the <strong>V<\/strong> input to a Cut or Clipping node/);
  });
});

/* ── "not runing" ─────────────────────────────────────────────────────────
 *
 * The node was wired up correctly — a prompt in T, a character in I, a video
 * loaded — and the Run button said "Add a node to run". The canvas did not
 * think a Motion Control node was worth running.
 *
 * canRun asks isRunnableType, which reads RUNNABLE_NODE_TYPES, and 'motion' was
 * not in it. The type had been registered in five places — the canvas registry,
 * the toolbar, the port contract, the info badge, RENDERABLE_NODE_TYPES — and
 * missed the one that decides whether it executes at all.
 *
 * The comment above that list predicted this exactly: "it was four scattered
 * type === 'generate' checks and they drifted the moment a new runnable type
 * appeared". One list fixed the drift; nothing checked that the list agreed
 * with the runner. This does.
 */
describe('every node the runner executes can be run', () => {
  const VALIDATE = readFileSync(
    join(__dirname, '..', 'studio', 'templates', 'validate.ts'), 'utf8');

  /** The types the runner actually dispatches on. */
  const dispatched = Array.from(
    RUNNER.matchAll(/node\.type === '(\w+)' \|\| nodeData\.type === '\1'/g),
  ).map((m) => m[1]);

  const runnable = (
    /export const RUNNABLE_NODE_TYPES = \[([^\]]+)\]/.exec(VALIDATE)?.[1] || ''
  ).split(',').map((t) => t.trim().replace(/'/g, '')).filter(Boolean);

  it('finds the dispatch table at all', () => {
    /* If this stops matching, the check below silently passes on an empty
       list — which is the failure mode of every test that greps for its own
       input. */
    expect(dispatched.length).toBeGreaterThan(3);
    expect(runnable.length).toBeGreaterThan(3);
  });

  it('lists motion as runnable', () => {
    expect(runnable).toContain('motion');
  });

  it('leaves nothing the runner handles out of the list', () => {
    /* The exact bug: a node with an execute path that the Run button refuses
       to enable. Wired perfectly, and the canvas says "Add a node to run". */
    const executableButNotRunnable = dispatched.filter((t) => !runnable.includes(t));
    expect({ executableButNotRunnable }).toEqual({ executableButNotRunnable: [] });
  });

  it('and the canvas gate reads that one list rather than its own', () => {
    const CANVAS = readFileSync(
      join(__dirname, '..', 'studio', 'components', 'Canvas.tsx'), 'utf8');
    expect(CANVAS).toMatch(/const canRun = nodes\.some\(\(n\) => isRunnableType\(/);
  });
});

/* ── The run that directed perfectly and then died silently ───────────────
 *
 *   23:20:01  Motion  11.9s source -> 2 piece(s) (Omni takes 10s at a time).
 *   23:21:08  Motion  Piece 1: Transfers the opening dance turns, hip movements…
 *   23:21:22  Motion  Piece 2: Preserves seamless continuity from piece 1 by
 *                     matching the front-facing dance beats, fist pumps…
 *   (nothing further — the node failed and the feed stopped dead)
 *
 * The director pass did exactly what it was built for: piece 2 names piece 1
 * and writes against it. What it did not survive was the step after — putting
 * the pieces into Flow needs the CDP file chooser, which is opt-in because it
 * attaches Chrome's debugger, and it was off.
 *
 * Two faults, and the second is the one that made it hard to read: the check
 * happened LAST, so eighty seconds of directing and two video uploads to
 * Gemini were spent before a toggle refused; and the failing step said nothing
 * at all, so the feed simply ended.
 */
describe('the step that cannot be worked around is checked first', () => {
  it('asks whether uploading is even switched on', () => {
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/chrome\.storage\.local\.get\(\['af_debug_upload'\]\)/);
  });

  it('asks before the expensive part, not after it', () => {
    /* The whole point. Asked after, the answer costs a Gemini conversation and
       two video uploads to find out. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    const check = body.indexOf("af_debug_upload");
    const cut = body.indexOf('planOmniChunks(');
    const direct = body.indexOf('motionBriefAsk(');
    expect(check).toBeGreaterThan(-1);
    expect(cut).toBeGreaterThan(check);
    expect(direct).toBeGreaterThan(check);
  });

  it('treats unreachable storage as off rather than as consent', () => {
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/storage unreachable is not consent/);
  });

  it('says what to switch on, and that nothing was wasted', () => {
    /* Names the button and where it is. It used to name "Settings", which has
       never held this switch — the run stopped at a prerequisite and pointed
       somewhere it does not exist. */
    expect(RUNNER).toMatch(/uploads are off/);
    expect(RUNNER).toMatch(/the orange box on this node/);
    expect(RUNNER).toMatch(/Chrome shows a debugging banner while it runs/);
    /* Matched on a fragment that does not cross the source's line break —
       the sentence wraps mid-phrase in the concatenation. */
    expect(RUNNER).toMatch(/generated, so turning it on and running again costs nothing/);
  });
});

describe('the upload step is never silent', () => {
  it('says it is starting, and that a banner is coming', () => {
    /* It is the slowest step and the one that makes Chrome show a banner. A
       feed that stops dead here reads as a crash. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/Chrome will show a debugging banner/);
  });

  it('says why it failed, in the feed and not only on the node', () => {
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/studioLog\('Motion', `The upload failed: \$\{why\}`\)/);
  });

  it('says when it worked', () => {
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/piece\(s\) are in the Flow library/);
  });
});

/* ── "whay we dont make the node make everything on it" ──────────────────
 *
 * Spawning a Prompt node and an Omni node per piece worked, twice over, and
 * was still the wrong shape.
 *
 * First it produced two nodes that said "Connect a prompt, then Run": the
 * prompt had been written onto the node as data.prompt, and a generate node
 * reads the text EDGE and nothing else — hasPrompt in GenerateNode literally
 * asks "is there an edge into T". Wiring them fixed that. Then the character
 * edge named a source handle Image nodes do not have, so React Flow declined
 * to draw it and the still looked unconnected while it was in fact being read.
 *
 * Both were symptoms. The cause is that the runner sorts its plan ONCE, from a
 * snapshot taken before the first step, so a node created during a run cannot
 * be in it. Motion Control could never produce a clip on the press that built
 * its nodes — and the second press re-entered Motion Control from the top,
 * re-cutting, re-uploading, re-asking the director, and replacing the very
 * nodes whose prompts had just been edited.
 *
 * So the pieces are rows on the node. Everything spawning was for — a visible
 * prompt, an editable one, one piece redone on its own — is a row control now,
 * and the run finishes in one press.
 */
describe('the pieces live on the node, and stay editable there', () => {
  const NODE = readFileSync(
    join(__dirname, '..', 'studio', 'nodes', 'MotionNode.tsx'), 'utf8');

  it('shows every piece with its own prompt, in a textarea', () => {
    /* The half of spawning that was worth keeping. A piece that came back
       wrong is usually a wording problem, and re-asking the director costs a
       whole conversation. */
    expect(NODE).toMatch(/pieces\.map\(\(p\) => \(/);
    expect(NODE).toMatch(/<textarea/);
    expect(NODE).toMatch(/value=\{p\.prompt\}/);
    expect(NODE).toMatch(/patchPiece\(p\.index, \{ prompt: e\.target\.value \}\)/);
  });

  it('edits one row without disturbing the others', () => {
    /* The list is one field. Writing the whole array back from a stale copy is
       how a second row silently reverts while you type in the first. */
    expect(NODE).toMatch(/p\.index === index \? \{ \.\.\.p, \.\.\.patch \} : p/);
  });

  it('gives every row its own retry', () => {
    /* And implements it as "mark this row idle, retry the node" — so the rule
       about what gets reused lives once, in the runner. */
    const at = NODE.indexOf('const retryPiece =');
    const body = NODE.slice(at, at + 600);
    expect(body).toMatch(/status: 'idle'/);
    expect(body).toMatch(/studio:retry-node/);
  });

  it('plays the clip on the row that made it', () => {
    expect(NODE).toMatch(/videoUrl=\{p\.videoUrl\}/);
    const preview = readFileSync(join(__dirname, '../studio/components/MotionPreview.tsx'), 'utf8');
    expect(preview).toContain('src={videoUrl}');
  });

  it('does not build any node of its own any more', () => {
    /* The point of the change. A node created during a run is not in the
       runner's plan, so spawning could never finish in one press. */
    expect(RUNNER).not.toMatch(/motionSpawned/);
    const at = RUNNER.indexOf('private async executeMotionNode');
    expect(RUNNER.slice(at, at + 24000)).not.toMatch(/setEdges/);
  });

  it('counts the ones that are finished, not the ones that exist', () => {
    /* "2 clips" over two empty rows is the same lie as a green tick over a
       missing video. */
    expect(NODE).toMatch(/pieces\.filter\(\(p\) => p\.status === 'done'\)\.length/);
    expect(NODE).toMatch(/\$\{done\}\/\$\{pieces\.length\} clips/);
  });
});

describe('a failed upload does not cost the director pass', () => {
  it('tracks "uploaded" apart from "directed"', () => {
    /* 01:43:53 the upload failed; 01:44:12 the whole thing started again —
       cut, six Gemini turns, two video uploads to Gemini — because the
       prompts were only written down after the step that failed. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/const havePrompts = this\.targetedRun/);
    expect(body).toMatch(/const reusable = havePrompts && nodeData\.motionUploaded === true/);
  });

  it('writes the prompts down before it tries to upload', () => {
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    const saved = body.indexOf('motionUploaded: false');
    const upload = body.indexOf("type: 'DEBUG_UPLOAD_TO_FLOW'");
    expect(saved).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(saved);
  });

  it('only claims the upload landed once it has', () => {
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    const failed = body.indexOf('The pieces could not be put into Flow');
    const stamped = body.indexOf('motionUploaded: true');
    expect(failed).toBeGreaterThan(-1);
    expect(stamped).toBeGreaterThan(failed);
  });

  it('re-cuts without re-asking, and matches prompts by piece index', () => {
    /* Array position would put an edited row's prompt on the wrong piece the
       moment the cut plan changes by one. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/if \(havePrompts\) \{/);
    expect(body).toMatch(/existing\.find\(\(r\) => r\.index === p\.piece\.index\)/);
    expect(body).toMatch(/the director is not asked again/);
  });

  it('forgets it uploaded anything when the video changes', () => {
    const NODE = readFileSync(
      join(__dirname, '..', 'studio', 'nodes', 'MotionNode.tsx'), 'utf8');
    const at = NODE.indexOf('const onFile =');
    expect(NODE.slice(at, at + 1400)).toMatch(/motionUploaded: false/);
  });
});

describe('the one switch it cannot work around is asked for up front', () => {
  const NODE = readFileSync(
    join(__dirname, '..', 'studio', 'nodes', 'MotionNode.tsx'), 'utf8');
  const CUT = readFileSync(
    join(__dirname, '..', 'studio', 'nodes', 'CutNode.tsx'), 'utf8');

  it('offers the switch on this node, not only on a Cut node', () => {
    /* It lived on the Cut node alone, so a canvas built around Motion Control
       — a prompt, a still and this — had nowhere to turn it on. The run
       stopped before the first cut and the node showed nothing at all. */
    expect(CUT).toMatch(/af_debug_upload: true/);
    expect(NODE).toMatch(/chrome\.storage\.local\.set\(\{ af_debug_upload: true \}\)/);
    expect(NODE).toMatch(/chrome\.storage\.local\.get\(\['af_debug_upload'\]\)/);
  });

  it('does not flash the banner before the flag has been read', () => {
    /* null until the answer comes back, which is why the test is against
       `=== false` and not falsiness. */
    expect(NODE).toMatch(/useState<boolean \| null>\(null\)/);
    expect(NODE).toMatch(/uploadOn === false && \(/);
  });

  it('points at the button that exists, not at Settings', () => {
    /* The old message named a Settings screen that has never held this
       switch. A prerequisite whose message points somewhere it is not is
       worse than no message. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).not.toMatch(/turned on in Settings/);
    expect(body).toMatch(/on this node/);
  });

  it('shows the node its own failure, not only the pieces', () => {
    /* Everything before the first cut fails without producing a piece, so a
       node that only rendered per-piece errors showed nothing: the toolbar
       said "1 failed" and the node looked untouched. */
    expect(NODE).toMatch(/d\.status === 'error' && !!d\.errorMessage/);
    expect(NODE).toMatch(/Did not start/);
  });
});

describe('a retry does not pay for the expensive third twice', () => {
  it('reuses the cut, the prompts and the upload — but only on a retry', () => {
    /* A full Run is the user saying "make this again": the mode, the still or
       the wording may have changed since. A targeted retry is not. */
    expect(RUNNER).toMatch(/this\.targetedRun = !!only;/);
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/const havePrompts = this\.targetedRun/);
    expect(body).toMatch(/const reusable = havePrompts &&/);
    expect(body).toMatch(/nodeData\.motionPreparedFrom === sourceKey/);
  });

  it('does not demand the video back for a step it will not run', () => {
    /* The bytes do not survive a reload and are only needed to CUT. Asking for
       them before a retry that generates from names already in Flow's library
       would be a wall with nothing behind it. */
    const at = RUNNER.indexOf('private async executeMotionNode');
    const body = RUNNER.slice(at, at + 24000);
    expect(body).toMatch(/if \(!reusable && !file\) \{/);
    expect(body).toMatch(/if \(!reusable && !uploadReady\) \{/);
  });

  it('will not reuse pieces cut from a different video', () => {
    /* Keyed on the source, because pieces cut from another clip are pieces of
       something else whatever their prompts say. */
    const NODE = readFileSync(
      join(__dirname, '..', 'studio', 'nodes', 'MotionNode.tsx'), 'utf8');
    const at = NODE.indexOf('const onFile =');
    expect(NODE.slice(at, at + 1200)).toMatch(/motionPreparedFrom: ''/);
  });
});
