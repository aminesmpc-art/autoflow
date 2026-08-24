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
export type PlanStepType = 'image' | 'generate' | 'extend' | 'frame' | 'agent' | 'story' | 'cut';

export interface PlanStep {
  id: string;
  type: PlanStepType;
  label?: string;
  /** generate only. 'text' writes a prompt for a later step to use. */
  media?: 'image' | 'video' | 'text';
  platform?: 'flow' | 'chatgpt' | 'gemini' | 'grok' | 'claude' | 'zai';
  /** Literal prompt text. The compiler turns it into a prompt node. */
  prompt?: string;
  /* This image step is the storyboard board: one picture holding every shot
     as a numbered panel. A story director wired to it asks it for a board
     rather than for a scene, and it is checked against the opposite rules to
     a clip. Only meaningful on an image step. */
  storyboardSheet?: boolean;
  /* An Ask AI preset id. The presets carry the craft - the angles, the
     lighting, the trap to avoid - so a step that names one gets a written
     brief instead of the bare subject. There was no way to name one from a
     plan at all, so every preset in the product was unreachable from a built
     workflow. Only meaningful on a generate step with media "text". */
  preset?: string;
  /* Story director film language, decided once for the whole piece. */
  colorTemp?: string;
  lighting?: string;
  /* ── A cut, from a video the user already has ──────────────────────
     Named by the WORDS at each end rather than by a timestamp, because the
     whole clipping pipeline is built on the measurement that models cannot
     reliably timestamp a long recording but can quote it exactly. The node
     finds the seconds itself, from the audio, when it runs.

     `sourceKey` is filled in by whoever emits the plan, not by the model —
     it identifies bytes held in memory and is meaningless to a chat. */
  hookLine?: string;
  closingLine?: string;
  /** Why this moment is worth posting, in the words shown on the node. */
  why?: string;
  /** What to write when posting it. */
  title?: string;
  /** What it scored out of 100, when it was scored. */
  score?: number;
  sourceKey?: string;
  /* Roughly where in the recording to search, in seconds.
     This is NOT a model's answer and never becomes the clip's boundary — it
     comes from the loudness envelope, which is measurement. It exists so the
     node searches a two-minute window instead of attaching a twenty-minute
     WAV to a question, which is the exact size at which timestamp answers were
     measured to turn into invented arithmetic. */
  nearSec?: number;
  /* The clip's real boundaries, when a server reading supplied them.
     Present means the node can cut without asking anything: the seconds came
     from a reading of the audio, not from a model asked to guess at them. */
  startSec?: number;
  endSec?: number;
  /* Where the speaker stands during the clip, relative to its own start.
     Saves sampling stills out of the video and asking about each one. */
  faces?: Array<{ t: number; x: number }>;
  /* The reading looked and found nobody on camera. An answer, not a gap:
     without it the cut samples stills and asks a chat where the speaker is,
     is told there isn't one, and fits the frame — which is what the reading
     said before the clip existed. */
  noSpeaker?: boolean;
  /** Cap on the finished clip, in seconds. */
  maxSeconds?: number;
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
  /* Flow's voice, on a generate step. Only meaningful for a Flow video with
     a reference image — Flow attaches a voice to a character ingredient — but
     carried for any step, because dropping it silently is how a spec that
     asked for a voice produced clips with none and nothing said why. */
  voice?: string;
  /** Story director settings (story type only) */
  cast?: Array<{ name: string; look: string; role?: string; voice?: string }>;
  world?: string;
  look?: string;
  structure?: string;
  rules?: string[];
  beats?: number;
  cameraProgression?: string;
  audioMode?: string;
  visualPreset?: string;
  timedBeats?: boolean;
  avoid?: string;
}

export interface Plan {
  name?: string;
  description?: string;
  steps: PlanStep[];
}

const PLATFORMS = ['flow', 'chatgpt', 'gemini', 'grok', 'claude', 'zai'] as const;
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

/* A cut node carries two quoted lines, a reason, and — once it has run — a
   9:16 player. Measured against the shipped stylesheet in the canvas harness,
   not guessed: an unrun cut is about 300px and a finished one about 560. */
const CUT_ROW_H = 620;

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

  const TYPES: PlanStepType[] = ['image', 'generate', 'extend', 'frame', 'agent', 'story', 'cut'];
  for (const s of byId.values()) {
    if (!TYPES.includes(s.type)) {
      problems.push(`Step "${s.id}" has type "${s.type}"; use one of ${TYPES.join(', ')}.`);
    }
    /* A cut with no quoted ends cannot be located, and a cut that cannot be
       located is a node that will fail the moment it is run. Refusing it here
       turns a run-time failure on someone's canvas into a build-time message
       naming the step. */
    if (s.type === 'cut') {
      if (!String(s.hookLine || '').trim()) {
        problems.push(`Step "${s.id}" is a cut with no hookLine; quote the line it opens on.`);
      }
      if (!String(s.closingLine || '').trim()) {
        problems.push(`Step "${s.id}" is a cut with no closingLine; quote the line it ends on.`);
      }
      /* A cut names bytes held in memory. The Clipping director fills this in
         from the video that was dropped on it; nothing else can. Without the
         check, a plan written by a chat — which has no video and no way to
         know what a sourceKey is — compiles to a node that looks finished and
         fails the moment anyone runs it. */
      if (!String(s.sourceKey || '').trim()) {
        problems.push(
          `Step "${s.id}" is a cut with no video behind it. Cuts are laid out by `
          + 'a Clipping node from a recording you dropped on it.',
        );
      }
    }
    /* A frame is the last still of one clip. Two clips into it is not a
       richer frame, it is an unanswerable question about which clip. */
    if (s.type === 'frame') {
      const from = (s.inputs || []).map((i) => byId.get(i)).filter(Boolean);
      if (from.length !== 1) {
        problems.push(`Step "${s.id}" is a frame and takes ${from.length} inputs; it needs exactly one.`);
      /* A cut is video by construction — it has no `media` field to say so,
         because nothing about it is chosen. Without this a plan that ends a
         cut and starts a generated shot on its last frame, which is the whole
         point of mixing real footage with B-roll, is rejected as "an image". */
      } else if (from[0]!.type !== 'cut' && from[0]!.media !== 'video') {
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
  /* Y is accumulated rather than counted, so a type that needs more room than
     a row can ask for it. Every existing type consumes exactly ROW_H, which
     makes this identical to `40 + row * ROW_H` for them — but a cut node grows
     a video player the moment it runs, and at one fixed row height a column of
     ten of them overlapped as soon as the first finished. */
  const yInCol = new Map<number, number>();
  const nextY = (col: number, height: number = ROW_H) => {
    const y = yInCol.get(col) ?? 40;
    yInCol.set(col, y + height);
    return y;
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

    /* One postable clip, cut from a video the user already has.
       No prompt, no platform, no generation: the material exists, and the
       node's whole job is to find the two ends in the audio and encode what
       is between them. The seconds are deliberately absent — see PlanStep. */
    if (step.type === 'cut') {
      nodes.push({
        id: step.id, type: 'cut', position: { x, y: nextY(col, CUT_ROW_H) },
        data: {
          type: 'cut', label: step.label || 'Cut',
          sourceKey: String(step.sourceKey || ''),
          hookLine: String(step.hookLine || '').trim(),
          closingLine: String(step.closingLine || '').trim(),
          why: String(step.why || '').trim(),
          title: String(step.title || '').trim(),
          score: typeof step.score === 'number' ? step.score : undefined,
          nearSec: typeof step.nearSec === 'number' && step.nearSec >= 0 ? step.nearSec : 0,
          startSec: typeof step.startSec === 'number' && step.startSec >= 0 ? step.startSec : undefined,
          endSec: typeof step.endSec === 'number' && step.endSec > 0 ? step.endSec : undefined,
          faces: Array.isArray(step.faces) ? step.faces : undefined,
          noSpeaker: step.noSpeaker === true ? true : undefined,
          maxSeconds: typeof step.maxSeconds === 'number' && step.maxSeconds > 0 ? step.maxSeconds : undefined,
          /* Inherited from the Clipping node that laid this out. A cut with no
             platform silently used ChatGPT while its director used Gemini. */
          platform: step.platform || '',
          aspectRatio: step.aspectRatio || '9:16',
          status: 'idle',
        },
      });
      for (const m of step.inputs || []) edge(m, step.id, 'text', 'text', '#8b5cf6');
      continue;
    }

    /* Story director node — writes all prompts across connected nodes at run time */
    if (step.type === 'story') {
      const y = nextY(col);
      nodes.push({
        id: step.id, type: 'story', position: { x, y },
        data: {
          type: 'story', label: step.label || 'Director',
          platform: step.platform || 'chatgpt',
          cast: Array.isArray(step.cast) ? step.cast : [],
          world: typeof step.world === 'string' ? step.world : '',
          look: typeof step.look === 'string' ? step.look : '',
          structure: step.structure || 'hook',
          rules: Array.isArray(step.rules) ? step.rules : ['samePerson'],
          beats: typeof step.beats === 'number' ? step.beats : 0,
          cameraProgression: step.cameraProgression || 'dynamic',
          audioMode: step.audioMode || 'cinematic',
          visualPreset: step.visualPreset || 'liveAction',
          colorTemp: step.colorTemp || 'none',
          lighting: step.lighting || 'none',
          /* Read because the spec documents them. A field the plan can name
             and the node never receives is a setting the builder appears to
             control and does not. */
          timedBeats: !!step.timedBeats,
          avoid: typeof step.avoid === 'string' ? step.avoid : '',
          status: 'idle',
        },
      });
      if (String(step.prompt || '').trim()) {
        const pid = `${step.id}_p`;
        nodes.push({
          id: pid, type: 'prompt',
          position: { x: x - COL_W + 60, y: y + 40 },
          data: { type: 'prompt', label: `${step.label || step.id} brief`, text: String(step.prompt).trim() },
        });
        edge(pid, step.id, 'text', 'text', '#8b5cf6');
      }
      continue;
    }

    const media = step.type === 'agent' ? 'text' : (step.media || 'image');
    const platform = step.platform || 'flow';

    /* Where the node's text comes from. An upstream step that writes text
       supplies it; otherwise the plan's literal prompt becomes a prompt node.
       Both at once would give the node two text edges, and the runner reads
       one — so the wire wins and the literal is dropped, with a note. */
    const mediaOf = (s?: PlanStep) => (s?.type === 'agent' || s?.type === 'story' ? 'text' : s?.media);
    const textInputs = (step.inputs || []).filter((i) => mediaOf(byId.get(i)) === 'text');
    const mediaInputs = (step.inputs || []).filter((i) => mediaOf(byId.get(i)) !== 'text');

    /* Story Director orchestration: if there is a single story node in the plan
       and this generate step has neither its own literal prompt nor a text input,
       the Story Director automatically feeds it text at runtime. */
    const storySteps = Array.from(byId.values()).filter((s) => s.type === 'story');
    if (!textInputs.length && !String(step.prompt || '').trim() && storySteps.length === 1) {
      textInputs.push(storySteps[0].id);
    }

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
        ...(step.storyboardSheet && media !== 'video' ? { storyboardSheet: true } : {}),
        ...(step.preset && media === 'text' ? { preset: step.preset } : {}),
        model: media === 'video' ? 'Omni Flash' : 'Nano Banana Pro',
        aspectRatio: step.aspectRatio || (media === 'video' ? '9:16' : '1:1'),
        duration: step.duration || '6s',
        creationType: step.startFrame && step.endFrame ? 'frames' : 'ingredients',
        /* A voice named on the step is the author's, not the Story's, so it
           carries no voiceFromStory marker and re-running a Story will leave
           it alone. */
        ...(step.voice ? { voice: step.voice } : {}),
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
