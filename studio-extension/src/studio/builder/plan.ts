/* ============================================================
   The workflow plan — what a chat model is actually asked for.

   A model could be asked for a finished template: nodes with pixel positions,
   edges with generated ids, handle names that must match portsFor() exactly,
   style objects, and a dozen data fields whose defaults matter. It would
   sometimes work. The failure mode when it does not is the bad one — an edge
   naming a handle that does not exist is dropped silently by React Flow, so
   the canvas looks right and the node downstream generates from nothing.
   validateTemplate exists because that has bitten this project twice.

   So the model is asked for the small part only: what the steps are, what
   each one says, and what feeds what. Everything mechanical — ids, handles,
   positions, ports, styles, defaults — is computed here, where it is correct
   by construction and covered by tests. The surface a model can get wrong
   shrinks to decisions only a model can make, which is the whole reason five
   different ones can drive this.

   The compiler's output is then put through validateTemplate anyway. A plan
   that compiles to something invalid is a bug in this file, and the caller
   sees it before a canvas does.
   ============================================================ */

import { validateTemplate, isRunnableType } from '../templates/validate';
import type { Template } from '../templates';

/** What a plan may ask for. One name per node type the canvas can draw. */
export type PlanStepType = 'image' | 'generate' | 'extend' | 'frame' | 'agent';

export interface PlanStep {
  id: string;
  type: PlanStepType;
  label?: string;
  /** generate only. 'text' writes a prompt for a later step to use. */
  media?: 'image' | 'video' | 'text';
  platform?: 'flow' | 'chatgpt' | 'gemini' | 'grok';
  /** Literal prompt text. The compiler turns it into a prompt node. */
  prompt?: string;
  /** Step ids feeding this one — a still, a clip, or written text. */
  inputs?: string[];
  aspectRatio?: string;
  duration?: string;
  /** Grok extend only. */
  extendSeconds?: string;
  /* Flow's Start/End frames. Given both, Flow moves between them — the match
     cut. Kept separate from `inputs` because two entries there means two
     reference pictures, which is a different instruction with a different
     result, and a model that meant the move would get the references. */
  startFrame?: string;
  endFrame?: string;
}

export interface Plan {
  name?: string;
  description?: string;
  steps: PlanStep[];
}

const PLATFORMS = ['flow', 'chatgpt', 'gemini', 'grok'] as const;
const MEDIA = ['image', 'video', 'text'] as const;

/* ── Reading a plan out of a chat reply ──────────────────────
   Models wrap JSON in prose, in ```json fences, in ``` fences, or announce it
   first. Every one of those is normal and none is worth failing over, so the
   extraction ladder tries the tidy cases and then falls back to the widest
   brace-balanced span in the text. */

/** The first JSON object in a chat reply, or null. */
export function extractJson(reply: string): any | null {
  const text = String(reply || '');

  const candidates: string[] = [];
  // ```json … ``` and plain ``` … ```
  for (const m of text.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) {
    if (m[1]?.trim()) candidates.push(m[1].trim());
  }
  // The whole reply, for a model that answered with nothing else.
  candidates.push(text.trim());
  // Widest brace-balanced span — prose on both sides.
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* next candidate */ }
  }
  return null;
}

/** Whatever the model returned, read as a plan. Never throws. */
export function readPlan(reply: string): { plan: Plan | null; problem?: string } {
  const raw = extractJson(reply);
  if (!raw) return { plan: null, problem: 'No JSON object found in the reply.' };

  /* Some models wrap it — {"workflow": {...}} or {"plan": {...}} — which is a
     reasonable reading of the instruction and not worth a failure. */
  const body = raw.steps ? raw : (raw.workflow || raw.plan || raw.result || raw);
  if (!Array.isArray(body?.steps)) {
    return { plan: null, problem: 'The JSON has no "steps" array.' };
  }
  return { plan: body as Plan };
}

/* ── Compiling ───────────────────────────────────────────── */

/** Longest path back to a step with no inputs — the column to draw it in. */
function depthOf(id: string, byId: Map<string, PlanStep>, seen = new Set<string>()): number {
  if (seen.has(id)) return 0;          // a cycle; the validator will say so
  seen.add(id);
  const step = byId.get(id);
  const inputs = (step?.inputs || []).filter((i) => byId.has(i));
  if (!inputs.length) return 0;
  return 1 + Math.max(...inputs.map((i) => depthOf(i, byId, new Set(seen))));
}

const COL_W = 480;
const ROW_H = 300;

export interface CompileResult {
  template: Template | null;
  /** Everything wrong, in the words the user should see. */
  problems: string[];
}

/**
 * Turn a plan into a template the canvas can load.
 *
 * Positions, ids, handles and styles are generated, so the parts that used to
 * be a model's job to get right are now this function's job — and it is tested.
 */
export function compilePlan(plan: Plan, opts: { id?: string } = {}): CompileResult {
  const problems: string[] = [];
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  if (!steps.length) return { template: null, problems: ['The plan has no steps.'] };

  const byId = new Map<string, PlanStep>();
  for (const s of steps) {
    if (!s?.id) { problems.push('A step has no id.'); continue; }
    if (byId.has(s.id)) { problems.push(`Two steps share the id "${s.id}".`); continue; }
    byId.set(s.id, s);
  }
  if (problems.length) return { template: null, problems };

  const TYPES: PlanStepType[] = ['image', 'generate', 'extend', 'frame', 'agent'];
  for (const s of byId.values()) {
    if (!TYPES.includes(s.type)) {
      problems.push(`Step "${s.id}" has type "${s.type}"; use one of ${TYPES.join(', ')}.`);
    }
    /* A frame is the last still of one clip. Two clips into it is not a
       richer frame, it is an unanswerable question about which clip. */
    if (s.type === 'frame') {
      const from = (s.inputs || []).map((i) => byId.get(i)).filter(Boolean);
      if (from.length !== 1) {
        problems.push(`Step "${s.id}" is a frame and takes ${from.length} inputs; it needs exactly one.`);
      } else if (from[0]!.media !== 'video') {
        problems.push(
          `Step "${s.id}" takes its frame from "${from[0]!.id}", which makes `
          + `${from[0]!.media || 'an image'} rather than video.`
        );
      }
    }
    const pair = [s.startFrame, s.endFrame].filter(Boolean) as string[];
    if (pair.length === 1) {
      problems.push(`Step "${s.id}" gives only one of startFrame and endFrame; Flow needs both.`);
    }
    if (pair.length === 2) {
      if (s.media !== 'video') {
        problems.push(`Step "${s.id}" has start and end frames but is not video.`);
      }
      if ((s.platform || 'flow') !== 'flow') {
        problems.push(`Step "${s.id}" uses start and end frames, which only flow can do.`);
      }
      for (const f of pair) {
        if (!byId.has(f)) problems.push(`Step "${s.id}" names frame "${f}", which is not a step.`);
      }
      if ((s.inputs || []).length) {
        problems.push(
          `Step "${s.id}" has start and end frames AND inputs. Use one: the move between `
          + 'two stills, or reference pictures.'
        );
      }
    }
    if (s.platform && !PLATFORMS.includes(s.platform)) {
      problems.push(`Step "${s.id}" names platform "${s.platform}"; use one of ${PLATFORMS.join(', ')}.`);
    }
    if (s.media && !MEDIA.includes(s.media)) {
      problems.push(`Step "${s.id}" names media "${s.media}"; use image, video or text.`);
    }
    for (const input of s.inputs || []) {
      if (!byId.has(input)) problems.push(`Step "${s.id}" takes input "${input}", which is not a step.`);
    }
  }
  if (problems.length) return { template: null, problems };

  const nodes: any[] = [];
  const edges: any[] = [];
  const rowInCol = new Map<number, number>();
  const nextY = (col: number) => {
    const row = rowInCol.get(col) || 0;
    rowInCol.set(col, row + 1);
    return 40 + row * ROW_H;
  };
  const edge = (source: string, target: string, sourceHandle: string, targetHandle: string, colour: string) => {
    edges.push({
      id: `e_${source}_${target}_${targetHandle}`,
      source, target, sourceHandle, targetHandle,
      type: 'default', animated: true,
      style: { stroke: colour, strokeWidth: 2.5 },
    });
  };

  for (const step of byId.values()) {
    const col = depthOf(step.id, byId);
    const x = 40 + col * COL_W;

    if (step.type === 'image') {
      nodes.push({
        id: step.id, type: 'image', position: { x, y: nextY(col) },
        data: { type: 'image', label: step.label || 'Reference image', imageName: '', imageData: '', assetPath: '' },
      });
      continue;
    }

    /* Last frame of a clip, as a still. The continuity tool: shot two starts
       exactly where shot one stopped, which no amount of prompt wording can
       promise on its own. */
    if (step.type === 'frame') {
      nodes.push({
        id: step.id, type: 'frame', position: { x, y: nextY(col) },
        data: { type: 'frame', label: step.label || 'Last frame', frameUrl: '' },
      });
      for (const m of step.inputs || []) edge(m, step.id, 'result', 'image_ref', '#3b82f6');
      continue;
    }

    const media = step.type === 'agent' ? 'text' : (step.media || 'image');
    const platform = step.platform || 'flow';

    /* Where the node's text comes from. An upstream step that writes text
       supplies it; otherwise the plan's literal prompt becomes a prompt node.
       Both at once would give the node two text edges, and the runner reads
       one — so the wire wins and the literal is dropped, with a note. */
    const mediaOf = (s?: PlanStep) => (s?.type === 'agent' ? 'text' : s?.media);
    const textInputs = (step.inputs || []).filter((i) => mediaOf(byId.get(i)) === 'text');
    const mediaInputs = (step.inputs || []).filter((i) => mediaOf(byId.get(i)) !== 'text');

    if (textInputs.length > 1) {
      problems.push(`Step "${step.id}" takes written text from ${textInputs.length} steps; it can use one.`);
    }
    if (textInputs.length && step.prompt) {
      problems.push(
        `Step "${step.id}" has both a written-text input ("${textInputs[0]}") and its own prompt. `
        + 'Use one: the wire, or the text.'
      );
    }
    if (!textInputs.length && !String(step.prompt || '').trim()) {
      problems.push(`Step "${step.id}" has no prompt and nothing feeding it text.`);
    }

    const y = nextY(col);
    nodes.push({
      id: step.id,
      type: step.type,
      position: { x, y },
      data: {
        type: step.type,
        label: step.label || (media === 'video' ? 'Generate Video' : media === 'text' ? 'Ask AI' : 'Generate Image'),
        platform,
        mediaType: media,
        model: media === 'video' ? 'Omni Flash' : 'Nano Banana Pro',
        aspectRatio: step.aspectRatio || (media === 'video' ? '9:16' : '1:1'),
        duration: step.duration || '6s',
        creationType: step.startFrame && step.endFrame ? 'frames' : 'ingredients',
        ...(step.type === 'extend' ? { extendSeconds: step.extendSeconds || '+10s' } : {}),
        enabled: true, status: 'idle', resultUrl: null, previewUrl: '',
        resultTileId: null, progress: 0, errorMessage: null,
      },
    });

    if (!textInputs.length && String(step.prompt || '').trim()) {
      const pid = `${step.id}_p`;
      nodes.push({
        id: pid, type: 'prompt',
        // Its own column, so a long prompt never lands under its generate node.
        position: { x: x - COL_W + 60, y: y + 40 },
        data: { type: 'prompt', label: `${step.label || step.id} prompt`, text: String(step.prompt).trim() },
      });
      edge(pid, step.id, 'text', 'text', '#8b5cf6');
    }
    for (const t of textInputs.slice(0, 1)) edge(t, step.id, 'text', 'text', '#8b5cf6');

    if (step.startFrame && step.endFrame) {
      /* Frames mode swaps the one reference port for two named ones — which
         image is first cannot be answered by edge order. */
      const handleOf = (id: string) => (byId.get(id)!.type === 'generate' ? 'result' : 'image');
      edge(step.startFrame, step.id, handleOf(step.startFrame), 'frame_start', '#22c55e');
      edge(step.endFrame, step.id, handleOf(step.endFrame), 'frame_end', '#f97316');
    }

    for (const m of mediaInputs) {
      const from = byId.get(m)!;
      const sourceHandle = from.type === 'image' || from.type === 'frame' ? 'image' : 'result';
      const targetHandle = step.type === 'extend' ? 'video' : 'image_ref';
      edge(m, step.id, sourceHandle, targetHandle, '#3b82f6');
    }
  }

  if (problems.length) return { template: null, problems };

  /* Two nodes at one point read as one node the user cannot separate, and the
     validator rejects it. Prompt nodes are placed relative to their generate
     node, so two short chains can collide; nudge rather than fail. */
  const taken = new Set<string>();
  for (const n of nodes) {
    while (taken.has(`${n.position.x},${n.position.y}`)) n.position.y += 40;
    taken.add(`${n.position.x},${n.position.y}`);
  }

  const runnable = nodes.filter((n) => isRunnableType(n.type)).length;
  const template: Template = {
    id: opts.id || `built_${Date.now().toString(36)}`,
    name: String(plan.name || 'Built workflow').slice(0, 80),
    description: String(plan.description || 'Built from a description.').slice(0, 200),
    useCase: String(plan.description || 'Built from a description.').slice(0, 200),
    category: 'Built',
    difficulty: runnable > 6 ? 'Advanced' : runnable > 3 ? 'Medium' : 'Easy',
    nodeCount: nodes.length,
    thumbnail: '🧩',
    nodes,
    edges,
    requiresNodeTypes: Array.from(new Set(nodes.map((n) => n.type))).sort(),
    requiresPlatforms: Array.from(new Set(
      nodes.filter((n) => n.data?.platform).map((n) => n.data.platform)
    )).sort(),
    tier: 'free',
  } as unknown as Template;

  /* The same gate every bundled and every downloaded template passes. A plan
     that gets here and still fails is this compiler's fault, not the model's,
     and saying so is the difference between a fixable report and "it broke". */
  const invalid = validateTemplate(template);
  if (invalid.length) {
    return {
      template: null,
      problems: invalid.map((p) => `The built workflow was rejected: ${p}`),
    };
  }

  return { template, problems: [] };
}

/** Reply text → a loadable workflow, or the reasons it is not one. */
export function buildFromReply(reply: string, opts: { id?: string } = {}): CompileResult {
  const { plan, problem } = readPlan(reply);
  if (!plan) return { template: null, problems: [problem || 'Could not read a plan.'] };
  return compilePlan(plan, opts);
}
