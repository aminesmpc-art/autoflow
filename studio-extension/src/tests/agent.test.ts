/* ============================================================
   The agent protocol, which is the whole risk.

   n8n gets tool calls as structured API output. We get them as text typed into
   a chat box, so every reply is a chat model's best effort at a format it was
   asked to follow once. The recoverable failures are wrappers — fences,
   "Sure!", a trailing explanation. The unrecoverable one is ambiguity, and the
   tests that matter most here are the ones asserting we DON'T guess: a tool
   call invented from a vague reply spends a real generation and puts a picture
   on the canvas nobody asked for.

   Every case below is a shape a chat model actually produces.
   ============================================================ */

import {
  parseAgentReply, runAgent, buildOpeningMessage, buildRepairMessage,
  buildObservationMessage,
  type AgentTool, type AgentStep,
} from '../studio/engine/agent';

const TOOLS: AgentTool[] = [
  {
    name: 'generate_image',
    description: 'Render an image on Google Flow.',
    params: [{ name: 'prompt', description: 'What to draw.' }],
  },
  {
    name: 'read_frame',
    description: 'Read the last frame of a clip.',
    params: [{ name: 'node', description: 'Which node.' }],
  },
];
const NAMES = TOOLS.map((t) => t.name);

describe('reading a reply', () => {
  it('takes the clean case', () => {
    const d = parseAgentReply('TOOL: generate_image\n{"prompt": "a red sneaker"}', NAMES);
    expect(d.kind).toBe('tool');
    if (d.kind !== 'tool') return;
    expect(d.name).toBe('generate_image');
    expect(d.args).toEqual({ prompt: 'a red sneaker' });
  });

  it('survives a code fence', () => {
    const d = parseAgentReply('```json\nTOOL: generate_image\n{"prompt": "x"}\n```', NAMES);
    expect(d.kind).toBe('tool');
  });

  it('survives a pleasantry before the marker', () => {
    const d = parseAgentReply('Sure! Here you go:\nTOOL: generate_image\n{"prompt": "x"}', NAMES);
    expect(d.kind).toBe('tool');
  });

  it('survives an explanation after the block', () => {
    const d = parseAgentReply(
      'TOOL: generate_image\n{"prompt": "a cat"}\n\nI chose this because cats are nice.',
      NAMES
    );
    expect(d.kind).toBe('tool');
    if (d.kind !== 'tool') return;
    expect(d.args.prompt).toBe('a cat');
  });

  it('keeps braces and quotes inside a prompt intact', () => {
    /* Tool arguments ARE prompts, and prompts contain punctuation. A lazy
       regex truncates at the first closing brace and silently sends half a
       prompt to the generator. */
    const prompt = 'a sign reading {OPEN}, "neon", lit from below';
    const d = parseAgentReply(
      `TOOL: generate_image\n${JSON.stringify({ prompt })}`,
      NAMES
    );
    expect(d.kind).toBe('tool');
    if (d.kind !== 'tool') return;
    expect(d.args.prompt).toBe(prompt);
  });

  it('reads DONE and its answer', () => {
    const d = parseAgentReply('DONE\nThe three shots are rendered.', NAMES);
    expect(d.kind).toBe('done');
    if (d.kind !== 'done') return;
    expect(d.answer).toBe('The three shots are rendered.');
  });

  it('accepts DONE: with a colon', () => {
    const d = parseAgentReply('DONE: all finished', NAMES);
    expect(d.kind).toBe('done');
    if (d.kind !== 'done') return;
    expect(d.answer).toBe('all finished');
  });

  it('does not let the word DONE inside an argument end the run', () => {
    // "DONE" appears, but the reply is plainly a tool call.
    const d = parseAgentReply(
      'TOOL: generate_image\n{"prompt": "a poster that says DONE in big letters"}',
      NAMES
    );
    expect(d.kind).toBe('tool');
  });
});

describe('refusing to guess', () => {
  it('rejects prose with no marker rather than inventing a call', () => {
    const d = parseAgentReply(
      "I think we should generate an image of a sneaker next. Shall I?",
      NAMES
    );
    expect(d.kind).toBe('malformed');
  });

  it('rejects a tool that does not exist', () => {
    const d = parseAgentReply('TOOL: make_video\n{"prompt": "x"}', NAMES);
    expect(d.kind).toBe('malformed');
    if (d.kind !== 'malformed') return;
    expect(d.reason).toContain('make_video');
  });

  it('rejects a tool call with no arguments object', () => {
    const d = parseAgentReply('TOOL: generate_image\njust draw a sneaker', NAMES);
    expect(d.kind).toBe('malformed');
    if (d.kind !== 'malformed') return;
    expect(d.reason).toMatch(/JSON object/);
  });

  it('rejects broken JSON instead of half-reading it', () => {
    const d = parseAgentReply('TOOL: generate_image\n{"prompt": "x",}', NAMES);
    expect(d.kind).toBe('malformed');
    if (d.kind !== 'malformed') return;
    expect(d.reason).toMatch(/valid JSON/);
  });

  it('rejects an empty reply', () => {
    expect(parseAgentReply('', NAMES).kind).toBe('malformed');
    expect(parseAgentReply('   \n  ', NAMES).kind).toBe('malformed');
  });

  it('does not mistake a filler-only reply for a directive', () => {
    const d = parseAgentReply('Sure!', NAMES);
    expect(d.kind).toBe('malformed');
  });
});

describe('the opening message', () => {
  it('names every tool and its arguments', () => {
    const msg = buildOpeningMessage({ goal: 'make a poster', tools: TOOLS });
    expect(msg).toContain('generate_image');
    expect(msg).toContain('read_frame');
    expect(msg).toContain('What to draw.');
    expect(msg).toContain('make a poster');
  });

  it('carries the system message when given one', () => {
    const msg = buildOpeningMessage({ goal: 'g', system: 'You are terse.', tools: TOOLS });
    expect(msg.indexOf('You are terse.')).toBeLessThan(msg.indexOf('TASK:'));
  });

  it('tells a repair turn which names are valid', () => {
    expect(buildRepairMessage('bad json', TOOLS)).toContain('generate_image, read_frame');
  });
});

/** Drive the loop with scripted replies. */
function scripted(replies: string[]) {
  const asked: string[] = [];
  const ran: Array<{ name: string; args: any }> = [];
  const steps: AgentStep[] = [];
  let i = 0;
  return {
    asked, ran, steps,
    ask: async (message: string) => { asked.push(message); return replies[i++] ?? 'DONE\nfallback'; },
    runTool: async (name: string, args: any) => { ran.push({ name, args }); return `ok: ${name}`; },
    onStep: (s: AgentStep) => { steps.push(s); },
  };
}

describe('the loop', () => {
  it('calls a tool, feeds the result back, then finishes', async () => {
    const h = scripted([
      'TOOL: generate_image\n{"prompt": "a sneaker"}',
      'DONE\nRendered one image.',
    ]);
    const r = await runAgent({
      goal: 'make one image', tools: TOOLS, maxIterations: 5,
      ask: h.ask, runTool: h.runTool, onStep: h.onStep,
    });

    expect(r.stopReason).toBe('done');
    expect(r.answer).toBe('Rendered one image.');
    expect(h.ran).toEqual([{ name: 'generate_image', args: { prompt: 'a sneaker' } }]);
    expect(r.iterationsUsed).toBe(2);
    // The observation must reach the model, or it is not a loop.
    expect(h.asked[1]).toContain('ok: generate_image');
  });

  it('only marks the first turn as first', async () => {
    const seen: boolean[] = [];
    await runAgent({
      goal: 'g', tools: TOOLS, maxIterations: 3,
      ask: async (_m, ctx) => { seen.push(ctx.firstTurn); return seen.length < 2 ? 'TOOL: read_frame\n{"node":"a"}' : 'DONE\nx'; },
      runTool: async () => 'ok',
    });
    /* The whole loop is one conversation. Only the opening turn may reset the
       thread; if every turn did, the agent would forget its own work. */
    expect(seen).toEqual([true, false]);
  });

  it('stops at the iteration cap instead of running forever', async () => {
    const h = scripted(Array(20).fill('TOOL: read_frame\n{"node":"a"}'));
    const r = await runAgent({
      goal: 'g', tools: TOOLS, maxIterations: 3,
      ask: h.ask, runTool: h.runTool, onStep: h.onStep,
    });
    expect(r.stopReason).toBe('max-iterations');
    expect(r.iterationsUsed).toBe(3);
    expect(h.ran).toHaveLength(3);   // every iteration is a real generation
  });

  it('asks for a reformat, and continues when it gets one', async () => {
    const h = scripted([
      'I will now make an image for you.',            // no marker
      'TOOL: generate_image\n{"prompt": "ok then"}',
      'DONE\nfinished',
    ]);
    const r = await runAgent({
      goal: 'g', tools: TOOLS, maxIterations: 6,
      ask: h.ask, runTool: h.runTool, onStep: h.onStep,
    });
    expect(r.stopReason).toBe('done');
    expect(h.asked[1]).toContain('could not be used');
    expect(h.ran).toHaveLength(1);
    expect(h.steps.some((s) => s.kind === 'repair')).toBe(true);
  });

  it('gives up on format after the repair budget, keeping the last reply', async () => {
    const prose = 'I really think a sneaker would be best here.';
    const h = scripted([prose, prose, prose, prose]);
    const r = await runAgent({
      goal: 'g', tools: TOOLS, maxIterations: 10, maxRepairs: 2,
      ask: h.ask, runTool: h.runTool, onStep: h.onStep,
    });
    expect(r.stopReason).toBe('format');
    // Not discarded: it is usually a good answer in the wrong shape, and the
    // generation that produced it has already been paid for.
    expect(r.answer).toBe(prose);
    expect(h.ran).toHaveLength(0);
  });

  it('reports a failing tool to the model, which can then retry', async () => {
    const asked: string[] = [];
    let call = 0;
    let attempts = 0;
    const r = await runAgent({
      goal: 'g', tools: TOOLS, maxIterations: 6,
      ask: async (m) => {
        asked.push(m);
        call++;
        if (call <= 2) return 'TOOL: generate_image\n{"prompt": "x"}';
        return 'DONE\nRendered on the second attempt.';
      },
      runTool: async () => {
        if (++attempts === 1) throw new Error('Flow tab was closed');
        return 'rendered';
      },
    });
    // The failure is information, not a reason to abort: it reaches the model,
    // which tries again and succeeds.
    expect(asked[1]).toContain('Flow tab was closed');
    expect(attempts).toBe(2);
    expect(r.stopReason).toBe('done');
  });

  it('does not call it done when every tool attempt failed', async () => {
    /* A tool that threw produced nothing, so a DONE after it is a claim about
       work that did not happen — the same case as never calling one. It is
       still not an abort: the run finishes and keeps what the model said. */
    let call = 0;
    const r = await runAgent({
      goal: 'g', tools: TOOLS, maxIterations: 6,
      ask: async () => (++call === 1 ? 'TOOL: generate_image\n{"prompt": "x"}' : 'DONE\nI could not render it.'),
      runTool: async () => { throw new Error('Flow tab was closed'); },
    });
    expect(r.stopReason).toBe('done-without-tools');
    expect(r.answer).toContain('could not render');
  });

  it('stops when asked to abort', async () => {
    const r = await runAgent({
      goal: 'g', tools: TOOLS, maxIterations: 5,
      ask: async () => 'TOOL: read_frame\n{"node":"a"}',
      runTool: async () => 'ok',
      shouldAbort: () => true,
    });
    expect(r.stopReason).toBe('aborted');
    expect(r.iterationsUsed).toBe(0);
  });

  it('records a step for everything it did', async () => {
    const h = scripted([
      'TOOL: generate_image\n{"prompt": "one"}',
      'DONE\ndone now',
    ]);
    await runAgent({
      goal: 'g', tools: TOOLS, maxIterations: 5,
      ask: h.ask, runTool: h.runTool, onStep: h.onStep,
    });
    expect(h.steps.map((s) => s.kind)).toEqual(['tool', 'observation', 'done']);
    expect(h.steps.every((s) => s.iteration >= 1)).toBe(true);
  });
});

/* ============================================================
   Found by running the protocol against live ChatGPT rather than a script.

   Its entire first reply was "DONE" — four characters, no tool call, no
   answer. Well formatted and completely empty. The parser accepted it, so the
   loop returned stopReason 'done' with an empty answer and the run reported
   success having rendered nothing. Scripted models never do this; they only
   do what the script says.
   ============================================================ */
describe('a bare DONE is a refusal, not a result', () => {
  it('rejects DONE with nothing after it', () => {
    const d = parseAgentReply('DONE', NAMES);
    expect(d.kind).toBe('malformed');
    if (d.kind !== 'malformed') return;
    expect(d.reason).toMatch(/no final answer/);
  });

  it('rejects DONE: with only whitespace after it', () => {
    expect(parseAgentReply('DONE:   \n  ', NAMES).kind).toBe('malformed');
  });

  it('never reports success with an empty answer', async () => {
    /* The guarantee that matters: whatever the model does, a run that says
       'done' has something to hand downstream. */
    const r = await runAgent({
      goal: 'g', tools: TOOLS, maxIterations: 4, maxRepairs: 1,
      ask: async () => 'DONE',
      runTool: async () => 'ok',
    });
    expect(r.stopReason).not.toBe('done');
  });

  it('still accepts DONE when an answer follows', () => {
    expect(parseAgentReply('DONE\nBoth images are rendered.', NAMES).kind).toBe('done');
  });

  it('frames the other party as a program, and pins DONE to an answer', () => {
    /* The framing is load-bearing. Headed "TOOLS AVAILABLE", live ChatGPT read
       it as a claim about its own tool system and refused three times:
       "read_canvas is not available among the tools provided to me". */
    const msg = buildOpeningMessage({ goal: 'g', tools: TOOLS });
    expect(msg).toMatch(/talking to a program/i);
    expect(msg).toMatch(/ACTIONS THE PROGRAM CAN PERFORM/i);
    expect(msg).not.toMatch(/TOOLS AVAILABLE/);
    expect(msg).toMatch(/DONE on its own is not an answer/i);
  });
});

/* ============================================================
   Also found live, and worse than the bare DONE.

   Second attempt, with the prompt strengthened, ChatGPT replied:

       DONE
       Two images produced: a

   Zero tool calls. Well formed, non-empty, and describing work that never
   happened — so the parser passes it, because the text is fine. Only the loop
   knows nothing ran.
   ============================================================ */
describe('a completion that produced nothing', () => {
  it('challenges DONE when no tool has run', async () => {
    const asked: string[] = [];
    let turn = 0;
    const ran: string[] = [];
    const r = await runAgent({
      goal: 'make two images', tools: TOOLS, maxIterations: 6,
      ask: async (m) => {
        asked.push(m);
        turn++;
        if (turn === 1) return 'DONE\nTwo images produced.';
        if (turn === 2) return 'TOOL: generate_image\n{"prompt": "hero shot"}';
        return 'DONE\nOne image rendered.';
      },
      runTool: async (n) => { ran.push(n); return 'ok'; },
    });

    expect(asked[1]).toMatch(/no tool has run/);
    expect(ran).toEqual(['generate_image']);
    expect(r.stopReason).toBe('done');   // recovered into real work
  });

  it('never reports plain success for work that never happened', async () => {
    const r = await runAgent({
      goal: 'make two images', tools: TOOLS, maxIterations: 6,
      ask: async () => 'DONE\nTwo images produced: a',   // the live reply
      runTool: async () => 'ok',
    });
    expect(r.stopReason).toBe('done-without-tools');
    expect(r.stopReason).not.toBe('done');
    // The claim is kept so the caller can show what was said, not hide it.
    expect(r.answer).toContain('Two images produced');
  });

  it('challenges only once, so an honest refusal can still finish', async () => {
    /* A task may genuinely need no tool. After one challenge the answer is
       accepted, but flagged, rather than looping to the iteration cap. */
    const r = await runAgent({
      goal: 'just answer', tools: TOOLS, maxIterations: 8,
      ask: async () => 'DONE\nThis cannot be done: Flow is not reachable.',
      runTool: async () => 'ok',
    });
    expect(r.iterationsUsed).toBe(2);
    expect(r.stopReason).toBe('done-without-tools');
  });

  it('leaves a genuine tool-backed completion alone', async () => {
    let turn = 0;
    const r = await runAgent({
      goal: 'g', tools: TOOLS, maxIterations: 6,
      ask: async () => (++turn === 1 ? 'TOOL: generate_image\n{"prompt": "x"}' : 'DONE\nRendered.'),
      runTool: async () => 'ok',
    });
    expect(r.stopReason).toBe('done');
  });

  it('does not challenge when there are no tools to run', async () => {
    const r = await runAgent({
      goal: 'g', tools: [], maxIterations: 4,
      ask: async () => 'DONE\nNothing to do here.',
      runTool: async () => 'ok',
    });
    expect(r.stopReason).toBe('done');
  });
});

/* ============================================================
   The transcript that actually worked, kept verbatim.

   Live ChatGPT, reframed prompt, two turns: it asked for the action, read the
   result, and answered from it. These are the exact strings it produced — if
   the parser ever stops accepting them, the loop is broken on the one path
   proven to work.
   ============================================================ */
describe('the live ChatGPT transcript', () => {
  const CANVAS = ['read_canvas'];

  it('accepts the tool call it emitted', () => {
    const d = parseAgentReply('TOOL: read_canvas\n{}', CANVAS);
    expect(d.kind).toBe('tool');
    if (d.kind !== 'tool') return;
    expect(d.name).toBe('read_canvas');
    expect(d.args).toEqual({});          // no-arg actions send {}
  });

  it('accepts the answer it gave from the result', () => {
    const d = parseAgentReply(
      'DONE\n2 nodes: p_goal (prompt), agent (agent). The workflow appears to '
      + 'pass a goal prompt into a canvas agent.',
      CANVAS
    );
    expect(d.kind).toBe('done');
    if (d.kind !== 'done') return;
    expect(d.answer).toContain('2 nodes');
  });

  it('runs the whole exchange end to end', async () => {
    let turn = 0;
    const observed: string[] = [];
    const r = await runAgent({
      goal: 'Report what is on the canvas.',
      tools: [{ name: 'read_canvas', description: 'Read the canvas.', params: [] }],
      maxIterations: 4,
      ask: async (m) => {
        observed.push(m);
        return ++turn === 1
          ? 'TOOL: read_canvas\n{}'
          : 'DONE\n2 nodes: p_goal (prompt), agent (agent).';
      },
      runTool: async () => '- p_goal (prompt): Goal\n- agent (agent): Canvas Agent',
    });
    expect(r.stopReason).toBe('done');
    expect(r.answer).toContain('2 nodes');
    // The canvas listing must reach the model, or the answer is a guess.
    expect(observed[1]).toContain('p_goal (prompt): Goal');
  });
});

/* ============================================================
   Seeing its own work.

   This is the loop a fixed canvas cannot do: render, LOOK at what came back,
   and re-prompt when it is wrong. It only works if the picture reaches the
   model — an observation that merely says "image rendered" leaves it
   reviewing a sentence, and it will happily approve something it never saw.
   ============================================================ */
describe('images from a tool reach the next turn', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const IMG_TOOL: AgentTool[] = [{
    name: 'generate_image',
    description: 'Render one image.',
    params: [{ name: 'prompt', description: 'What to draw.' }],
  }];

  it('attaches what the tool produced, and says it is there', async () => {
    const seen: Array<string[] | undefined> = [];
    let turn = 0;
    await runAgent({
      goal: 'render a sneaker', tools: IMG_TOOL, maxIterations: 4,
      ask: async (m, ctx) => {
        seen.push(ctx.images);
        if (++turn === 1) return 'TOOL: generate_image\n{"prompt": "a sneaker"}';
        // The model can only say this if the picture is in front of it.
        expect(m).toMatch(/attached to this message/i);
        return 'DONE\nLooks right.';
      },
      runTool: async () => ({ observation: 'Image rendered on Flow.', images: [PNG] }),
    });

    expect(seen[0]).toBeUndefined();   // nothing to show on the opening turn
    expect(seen[1]).toEqual([PNG]);
  });

  it('does not re-attach the same image on later turns', async () => {
    const seen: Array<string[] | undefined> = [];
    let turn = 0;
    await runAgent({
      goal: 'g', tools: IMG_TOOL, maxIterations: 6,
      ask: async (_m, ctx) => {
        seen.push(ctx.images);
        turn++;
        if (turn === 1) return 'TOOL: generate_image\n{"prompt": "one"}';
        if (turn === 2) return 'DONE\nfine';
        return 'DONE\nfine';
      },
      runTool: async () => ({ observation: 'rendered', images: [PNG] }),
    });
    // Attached once, on the turn straight after the tool ran.
    expect(seen.filter((s) => s?.length).length).toBe(1);
  });

  it('re-prompts when it judges the render wrong', async () => {
    /* The whole point. A DAG renders once and hands you whatever came out. */
    const prompts: string[] = [];
    let turn = 0;
    const r = await runAgent({
      goal: 'a red sneaker on concrete', tools: IMG_TOOL, maxIterations: 6,
      ask: async () => {
        turn++;
        if (turn === 1) return 'TOOL: generate_image\n{"prompt": "a sneaker"}';
        if (turn === 2) return 'TOOL: generate_image\n{"prompt": "a RED sneaker on wet concrete"}';
        return 'DONE\nSecond render is correct.';
      },
      runTool: async (_n, args) => {
        prompts.push(String(args.prompt));
        return { observation: 'rendered', images: [PNG] };
      },
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('RED');
    expect(r.stopReason).toBe('done');
  });

  it('a plain string tool result still works and attaches nothing', async () => {
    const seen: Array<string[] | undefined> = [];
    let turn = 0;
    await runAgent({
      goal: 'g', tools: IMG_TOOL, maxIterations: 4,
      ask: async (_m, ctx) => {
        seen.push(ctx.images);
        return ++turn === 1 ? 'TOOL: generate_image\n{"prompt": "x"}' : 'DONE\nok';
      },
      runTool: async () => 'rendered, nothing to look at',
    });
    expect(seen.every((s) => s === undefined)).toBe(true);
  });

  it('tells the model NOT to describe an image it could not be shown', async () => {
    // The runner sends this when no data: URL exists to attach.
    const msg = buildObservationMessage(
      'generate_image',
      'Image rendered on Flow, but it could not be attached for you to look at, '
      + 'so you cannot judge how it came out. Do not describe it.',
      0
    );
    expect(msg).not.toMatch(/attached to this message/i);
    expect(msg).toMatch(/Do not describe it/);
  });
});
