/* ============================================================
   The Ask AI agent loop.

   n8n's Agent node gets structured tool calls from the model's API. We cannot:
   there is no API key anywhere in this extension, and there is not going to be
   one — every platform is driven through its own chat UI. So the tool call has
   to survive a round trip through a chat box as plain text, which means the
   hard part of this file is not the loop. It is refusing to guess.

   A chat model asked for a strict format will, sooner or later, wrap it in a
   code fence, preface it with "Sure!", or explain itself afterwards. Those are
   recoverable and are recovered here. What is NOT recovered is an answer whose
   intent is unclear — inventing a tool call from a vague reply spends a real
   generation on a guess, and the user sees a picture nobody asked for.

   So: parse strictly, repair explicitly, and stop loudly.

   Side effects are injected. `ask` puts a message in a chat and returns the
   reply; `runTool` performs an action and returns what happened. Neither lives
   here, which is what makes the protocol testable without a browser — and the
   protocol is the part that decides whether any of this works.
   ============================================================ */

/** A tool the agent may call. Data, never code — same rule as presets, so a
    tool list can ride the cloud pipeline instead of a store review. */
export interface AgentTool {
  name: string;
  description: string;
  params: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

export type AgentDirective =
  | { kind: 'tool'; name: string; args: Record<string, unknown>; raw: string }
  | { kind: 'done'; answer: string; raw: string }
  | { kind: 'malformed'; reason: string; raw: string };

export type AgentStepKind = 'tool' | 'observation' | 'done' | 'repair' | 'error';

export interface AgentStep {
  /** 1-based iteration this happened in. */
  iteration: number;
  kind: AgentStepKind;
  /** Short line for the node face. */
  summary: string;
  detail?: string;
}

export type AgentStopReason =
  | 'done'
  /**
   * It said it finished, but no tool ever ran.
   *
   * Live ChatGPT replied "DONE / Two images produced" on its first turn,
   * having called nothing. That is well formed, non-empty, and false — the
   * parser cannot catch it, because only the loop knows whether any work
   * happened. Reported separately so a caller never shows a fabricated
   * completion as a success.
   */
  | 'done-without-tools'
  | 'max-iterations'
  | 'aborted'
  | 'format'
  | 'tool-error';

export interface AgentRunResult {
  answer: string;
  steps: AgentStep[];
  stopReason: AgentStopReason;
  /** Generations actually spent, so the caller can report the real cost. */
  iterationsUsed: number;
}

export interface AgentRunOptions {
  goal: string;
  /** Extra instructions placed above the protocol. */
  system?: string;
  tools: AgentTool[];
  maxIterations: number;
  /** Reformat attempts allowed across the whole run. Default 2. */
  maxRepairs?: number;
  /** Put a message in the chat, return the reply. */
  ask: (message: string, ctx: { firstTurn: boolean; iteration: number }) => Promise<string>;
  /** Perform a tool call, return a short description of what happened. */
  runTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  onStep?: (step: AgentStep) => void;
  shouldAbort?: () => boolean;
}

/* ── The protocol ─────────────────────────────────────────── */

const PROTOCOL = [
  'Reply with EXACTLY ONE of the following, and nothing else.',
  '',
  'To use a tool:',
  'TOOL: <tool_name>',
  '{"arg": "value"}',
  '',
  'To finish:',
  'DONE',
  '<your final answer>',
  '',
  'Rules:',
  '- The marker (TOOL: or DONE) must be the first thing in your reply.',
  '- Tool arguments must be one JSON object on the lines after TOOL.',
  '- Call one tool at a time and wait for its result before the next.',
  '- Do not explain what you are about to do. Just emit the block.',
  /* Both of these are here because ChatGPT replied with a bare "DONE" on the
     first turn, having called nothing. It reads the task, cannot render an
     image itself, and closes the conversation — so it has to be told that the
     tools genuinely execute, and that DONE is a report of finished work
     rather than a way to decline it. */
  '- The tools are real: they execute, and their results are sent back to you.',
  '- Do not reply DONE until the work is actually finished. DONE must be',
  '  followed by your final answer — DONE on its own is not an answer.',
  '- If the task needs a tool and none has run yet, call the tool.',
].join('\n');

function describeTools(tools: AgentTool[]): string {
  if (!tools.length) return 'You have no tools. Answer with DONE.';
  return tools
    .map((t) => {
      const args = t.params
        .map((p) => `    ${p.name}${p.required === false ? ' (optional)' : ''} — ${p.description}`)
        .join('\n');
      return `- ${t.name}: ${t.description}\n  arguments:\n${args || '    (none)'}`;
    })
    .join('\n');
}

/** The opening message. Everything the model needs, before it has seen anything. */
export function buildOpeningMessage(opts: {
  goal: string;
  system?: string;
  tools: AgentTool[];
}): string {
  const parts = [];
  if (opts.system?.trim()) parts.push(opts.system.trim(), '');
  parts.push('You are completing a task by calling tools one at a time.', '');
  parts.push('TOOLS AVAILABLE:', describeTools(opts.tools), '');
  parts.push(PROTOCOL, '');
  parts.push('TASK:', opts.goal.trim());
  return parts.join('\n');
}

/** What we send back after a tool ran. */
export function buildObservationMessage(toolName: string, observation: string): string {
  return [
    `Result of ${toolName}:`,
    observation,
    '',
    'Continue. Reply with the next TOOL block, or DONE if the task is complete.',
  ].join('\n');
}

/** What we send when the reply could not be understood. */
export function buildRepairMessage(reason: string, tools: AgentTool[]): string {
  return [
    `Your last reply could not be used: ${reason}`,
    '',
    PROTOCOL,
    '',
    tools.length ? `Valid tool names: ${tools.map((t) => t.name).join(', ')}` : '',
    'Reply again, in the required format only.',
  ].filter(Boolean).join('\n');
}

/* ── Parsing ──────────────────────────────────────────────── */

/**
 * Strip the wrappers a chat model adds around a block it was told to emit raw.
 *
 * Fences are the common one and are safe to remove. A leading "Sure!" line is
 * removed only when the marker follows it, so a genuine prose answer is never
 * silently reinterpreted as a directive.
 */
function unwrap(text: string): string {
  let s = (text || '').replace(/\r\n/g, '\n').trim();

  // ```json ... ``` or ``` ... ```
  const fenced = s.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  if (fenced && fenced[1].trim()) s = fenced[1].trim();

  // Drop pleasantries ONLY when a marker is what comes next.
  const lines = s.split('\n');
  while (lines.length > 1) {
    const first = lines[0].trim();
    const isMarker = /^(TOOL\b|DONE\b)/i.test(first);
    const isFiller = !first || /^(sure|certainly|okay|ok|got it|understood|here(?:'s| is))\b/i.test(first);
    if (isMarker || !isFiller) break;
    lines.shift();
  }
  return lines.join('\n').trim();
}

/**
 * Pull the first balanced {...} out of a string.
 *
 * Brace counting rather than a regex: tool arguments are prompts, prompts
 * contain braces and quotes, and a lazy regex truncates them mid-object. Quote
 * and escape aware for the same reason.
 */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Read one reply into a directive.
 *
 * `knownTools` is not decoration: a model that invents a plausible tool name
 * must be corrected, not dispatched. Without the check the run would call
 * nothing, observe nothing, and loop until the iteration cap.
 */
export function parseAgentReply(reply: string, knownTools: string[] = []): AgentDirective {
  const raw = reply || '';
  const s = unwrap(raw);

  if (!s.trim()) return { kind: 'malformed', reason: 'the reply was empty', raw };

  const toolAt = s.search(/^[ \t]*TOOL[ \t]*[:\-]/im);
  const doneAt = s.search(/^[ \t]*DONE\b[ \t]*[:\-]?/im);

  // Whichever marker comes first is the intent; a DONE mentioned inside a
  // tool argument must not end the run.
  const toolFirst = toolAt !== -1 && (doneAt === -1 || toolAt < doneAt);

  if (toolFirst) {
    const after = s.slice(toolAt);
    const nameMatch = after.match(/^[ \t]*TOOL[ \t]*[:\-][ \t]*([A-Za-z0-9_.-]+)/i);
    const name = nameMatch?.[1]?.trim() || '';
    if (!name) return { kind: 'malformed', reason: 'TOOL was given with no tool name', raw };
    if (knownTools.length && !knownTools.includes(name)) {
      return {
        kind: 'malformed',
        reason: `"${name}" is not a tool that exists`,
        raw,
      };
    }
    const json = firstJsonObject(after);
    if (!json) {
      return {
        kind: 'malformed',
        reason: `TOOL: ${name} was not followed by a JSON object of arguments`,
        raw,
      };
    }
    let args: Record<string, unknown>;
    try {
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { kind: 'malformed', reason: 'tool arguments were not a JSON object', raw };
      }
      args = parsed as Record<string, unknown>;
    } catch {
      return { kind: 'malformed', reason: 'the tool arguments were not valid JSON', raw };
    }
    return { kind: 'tool', name, args, raw };
  }

  if (doneAt !== -1) {
    const after = s.slice(doneAt).replace(/^[ \t]*DONE\b[ \t]*[:\-]?[ \t]*/i, '');
    const answer = after.trim();
    /* A bare DONE is not a finished task, it is a refusal that happens to be
       well formatted. ChatGPT sent exactly this — four characters, no tool
       call, on the first turn — and taking it at face value returned
       stopReason 'done' with an empty answer: a run that reported success
       having rendered nothing. Treated as malformed so the repair turn can
       tell it to either do the work or say why not. */
    if (!answer) {
      return {
        kind: 'malformed',
        reason: 'DONE was given with no final answer — if the task is not finished, call a tool instead',
        raw,
      };
    }
    return { kind: 'done', answer, raw };
  }

  return {
    kind: 'malformed',
    reason: 'the reply began with neither TOOL nor DONE',
    raw,
  };
}

/* ── The loop ─────────────────────────────────────────────── */

/**
 * Run the agent until it finishes, gives up, or runs out of iterations.
 *
 * Iterations and repairs are counted separately. An iteration is a real
 * generation with a real cost, so the cap is hard; a repair is the model being
 * asked to say the same thing properly, and gets its own small budget so a
 * model stuck in the wrong format cannot burn the whole allowance reformatting.
 */
export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const {
    goal, system, tools, maxIterations,
    maxRepairs = 2, ask, runTool, onStep, shouldAbort,
  } = opts;

  const steps: AgentStep[] = [];
  const names = tools.map((t) => t.name);
  const record = (step: AgentStep) => { steps.push(step); onStep?.(step); };

  const finish = (
    answer: string, stopReason: AgentStopReason, iterationsUsed: number
  ): AgentRunResult => ({ answer, steps, stopReason, iterationsUsed });

  let message = buildOpeningMessage({ goal, system, tools });
  let firstTurn = true;
  let repairsLeft = maxRepairs;
  let iteration = 0;
  let toolsRun = 0;
  let challengedEmptyCompletion = false;

  while (iteration < maxIterations) {
    if (shouldAbort?.()) return finish('', 'aborted', iteration);

    iteration++;
    const reply = await ask(message, { firstTurn, iteration });
    firstTurn = false;

    const directive = parseAgentReply(reply, names);

    if (directive.kind === 'done') {
      /* Challenge a completion that produced nothing.
         A model will describe work it did not do — "Two images produced",
         first turn, zero tool calls — and that claim is well formed, so the
         parser passes it through. Only here is it checkable. Challenged once
         rather than refused outright, because a task genuinely may not need a
         tool; if it insists, the answer is kept but reported as
         done-without-tools so nothing downstream mistakes it for work. */
      if (tools.length && toolsRun === 0) {
        if (!challengedEmptyCompletion) {
          challengedEmptyCompletion = true;
          record({
            iteration, kind: 'repair',
            summary: 'Claimed completion without running anything — challenging',
            detail: directive.answer,
          });
          message = [
            'You replied DONE, but no tool has run yet, so nothing has actually',
            'been produced. Do not describe work that has not happened.',
            '',
            `Call a tool now (${names.join(', ')}), or if the task genuinely`,
            'cannot be done, reply DONE with the reason it cannot.',
          ].join('\n');
          continue;
        }
        record({
          iteration, kind: 'error',
          summary: 'Finished without running any tool',
          detail: directive.answer,
        });
        return finish(directive.answer, 'done-without-tools', iteration);
      }
      record({ iteration, kind: 'done', summary: 'Finished', detail: directive.answer });
      return finish(directive.answer, 'done', iteration);
    }

    if (directive.kind === 'malformed') {
      if (repairsLeft <= 0) {
        record({
          iteration, kind: 'error',
          summary: 'Gave up — the model would not use the required format',
          detail: directive.reason,
        });
        /* The last reply is returned rather than thrown away. It is usually a
           perfectly good answer in the wrong shape, and discarding it would
           lose work the user already paid for. */
        return finish(directive.raw.trim(), 'format', iteration);
      }
      repairsLeft--;
      record({
        iteration, kind: 'repair',
        summary: `Reply not understood — asking again (${repairsLeft} left)`,
        detail: directive.reason,
      });
      message = buildRepairMessage(directive.reason, tools);
      continue;
    }

    // A tool call.
    record({
      iteration, kind: 'tool',
      summary: `${directive.name}`,
      detail: JSON.stringify(directive.args),
    });

    let observation: string;
    try {
      observation = await runTool(directive.name, directive.args);
      toolsRun++;
    } catch (e: any) {
      /* Told to the model rather than thrown. A tool that fails is information
         the agent can act on — pick different arguments, or give up and say
         why — and aborting the run would throw away everything before it. */
      observation = `The tool failed: ${e?.message || e}`;
      record({ iteration, kind: 'error', summary: `${directive.name} failed`, detail: observation });
    }

    record({
      iteration, kind: 'observation',
      summary: truncate(observation, 80),
      detail: observation,
    });
    message = buildObservationMessage(directive.name, observation);
  }

  record({
    iteration,
    kind: 'error',
    summary: `Stopped after ${maxIterations} iteration${maxIterations === 1 ? '' : 's'}`,
    detail: 'The agent did not reach DONE within its budget.',
  });
  return finish('', 'max-iterations', iteration);
}

function truncate(s: string, n: number): string {
  const one = (s || '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}
