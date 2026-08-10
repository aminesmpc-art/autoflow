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

  it('reports a failing tool to the model rather than aborting', async () => {
    const asked: string[] = [];
    let call = 0;
    const r = await runAgent({
      goal: 'g', tools: TOOLS, maxIterations: 5,
      ask: async (m) => {
        asked.push(m);
        return ++call === 1 ? 'TOOL: generate_image\n{"prompt": "x"}' : 'DONE\nrecovered';
      },
      runTool: async () => { throw new Error('Flow tab was closed'); },
    });
    expect(r.stopReason).toBe('done');
    expect(asked[1]).toContain('Flow tab was closed');
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
