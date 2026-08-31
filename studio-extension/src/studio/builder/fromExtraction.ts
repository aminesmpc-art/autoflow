/**
 * An extraction, as a workflow.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 *
 * The Extractor already produces everything a workflow needs. It watches a
 * video and returns character sheets and a shot list, each shot carrying an
 * image_prompt and a video_prompt:
 *
 *   { video_concept, voiceover_text, characters_description,
 *     character_sheets: [{ character_name, prompt }],
 *     shots: [{ shot_id, time_range, image_prompt, video_prompt }] }
 *
 * And then it handed all of that to a person to copy, prompt by prompt, into
 * nodes they built by hand. On a twelve shot video that is twenty-four
 * copy-pastes and twenty-four chances to paste the wrong one — for a structure
 * that is completely determined by the analysis.
 *
 * This turns it into the workflow it always was.
 *
 * ── The shape, and why ────────────────────────────────────────────────────
 *
 *   character sheets ──┐
 *                      ├──► shot still ──► shot clip
 *   character sheets ──┘
 *
 * Every character sheet feeds every still. That is what keeps a face the same
 * face across twelve shots, and it is the single thing a hand-built version of
 * this gets wrong most often — the wiring is tedious, so it gets skipped, and
 * the character drifts.
 *
 * Each still feeds its own clip and nothing else. A clip generated from a
 * still it did not come from is a continuity break with no explanation.
 *
 * ── What it refuses ───────────────────────────────────────────────────────
 *
 * A shot with no prompt is not a shot. An analysis with no shots is not a
 * video. Both come back as problems rather than as an empty canvas, because a
 * canvas that opens with nothing on it looks like the feature is broken rather
 * than like the analysis was thin.
 */

import type { Plan, PlanStep } from './plan';

/** The Extractor's own output, as it comes off the API. */
export interface Extraction {
  video_concept?: string;
  voiceover_text?: string;
  characters_description?: string;
  character_sheets?: Array<{ character_name?: string; prompt?: string }>;
  shots?: Array<{
    shot_id?: number | string;
    time_range?: string;
    image_prompt?: string;
    video_prompt?: string;
  }>;
}

export type BuildMode = 'stills' | 'clips' | 'both';

export interface BuildOptions {
  /* What to lay out.
     'stills' is the cheap pass — one image per shot, to see whether the look
     is right before spending video credits on twelve of them. */
  mode?: BuildMode;
  /** Build the character sheets and wire them into every still. */
  characters?: boolean;
  /* A ceiling on nodes, not on ambition. A thirty shot analysis in 'both'
     mode is sixty generations, which is a bill rather than a workflow. */
  maxShots?: number;
  /** Where the clips are generated. Flow is the only one that makes video. */
  platform?: PlanStep['platform'];
  aspectRatio?: string;
  /* Which models run the nodes, by the name the picker shows. Passed through
     rather than interpreted: the caller offering these already showed the
     person a list, and a build that quietly substitutes the house default
     produces nodes running on a model nobody chose. */
  imageModel?: string;
  videoModel?: string;
  /** How long each clip is, as Flow names it — '4s' | '6s' | '8s' | '10s'. */
  duration?: string;
  /** Named after the video it came from. */
  sourceName?: string;
}

const DEFAULT_MAX_SHOTS = 20;

/* The ratios Flow will actually shoot video in. A 4:3 chosen for the stills is
   a perfectly good choice for stills and not an option for the clips, so the
   clips take the nearest thing Flow offers rather than a setting it will
   reject at run time. */
const FLOW_VIDEO_RATIOS = ['9:16', '16:9', '1:1'];

/* Long enough to be a prompt rather than a label. An "image_prompt" of "a man"
   produces a picture of nobody in particular, and wiring it into a workflow
   dresses that up as work. */
const MIN_PROMPT_CHARS = 12;

export interface BuildResult {
  plan: Plan | null;
  /** Anything refused or trimmed, in words a person can act on. */
  problems: string[];
}

const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/** A short label for a node, from a prompt that may be a paragraph. */
function labelFrom(prompt: string, fallback: string): string {
  const words = prompt.split(' ').slice(0, 6).join(' ');
  return words.length > 4 ? words : fallback;
}

/**
 * Turn an extraction into a plan the compiler can lay out.
 *
 * Deterministic on purpose. The analysis already made every creative decision
 * — this only decides structure, and structure that varies run to run for the
 * same input is a bug rather than a feature.
 */
export function extractionToPlan(
  extraction: Extraction | null | undefined,
  options: BuildOptions = {},
): BuildResult {
  const problems: string[] = [];
  if (!extraction || typeof extraction !== 'object') {
    return { plan: null, problems: ['That is not an extraction.'] };
  }

  const mode: BuildMode = options.mode || 'both';
  const wantStills = mode !== 'clips';
  const wantClips = mode !== 'stills';
  const platform = options.platform || 'flow';
  const aspectRatio = options.aspectRatio || '9:16';
  const clipRatio = FLOW_VIDEO_RATIOS.includes(aspectRatio) ? aspectRatio : '9:16';
  const maxShots = Math.max(1, options.maxShots ?? DEFAULT_MAX_SHOTS);

  const steps: PlanStep[] = [];

  /* ── The cast ── */
  const characterIds: string[] = [];
  if (options.characters !== false) {
    const sheets = Array.isArray(extraction.character_sheets) ? extraction.character_sheets : [];
    sheets.forEach((sheet, i) => {
      const prompt = clean(sheet?.prompt);
      if (prompt.length < MIN_PROMPT_CHARS) {
        problems.push(`Character ${i + 1} had no usable sheet prompt — skipped.`);
        return;
      }
      const id = `cast${i + 1}`;
      characterIds.push(id);
      steps.push({
        id,
        type: 'generate',
        media: 'image',
        platform,
        /* The sheet is a turnaround, not a shot — square keeps every view in
           frame, where a 9:16 crop of a turnaround loses the outer poses. */
        aspectRatio: '1:1',
        model: options.imageModel,
        label: clean(sheet?.character_name) || `Character ${i + 1}`,
        prompt,
      });
    });
  }

  /* ── The shots ── */
  const allShots = Array.isArray(extraction.shots) ? extraction.shots : [];
  if (!allShots.length) {
    return {
      plan: null,
      problems: [...problems, 'The extraction has no shots in it, so there is nothing to build.'],
    };
  }

  const shots = allShots.slice(0, maxShots);
  if (allShots.length > shots.length) {
    problems.push(
      `${allShots.length} shots found; the first ${shots.length} were laid out. `
      + 'Raise the limit if you want the rest.',
    );
  }

  let built = 0;
  shots.forEach((shot, i) => {
    const n = Number(shot?.shot_id) || i + 1;
    const still = clean(shot?.image_prompt);
    const clip = clean(shot?.video_prompt);
    const when = clean(shot?.time_range);

    /* A clip prompt with no still to start from still works — Flow will
       generate from text — so a shot is only useless when it has neither. */
    if (still.length < MIN_PROMPT_CHARS && clip.length < MIN_PROMPT_CHARS) {
      problems.push(`Shot ${n} had no usable prompt — skipped.`);
      return;
    }

    const stillId = `shot${n}_still`;
    const clipId = `shot${n}_clip`;
    const suffix = when ? ` (${when})` : '';

    if (wantStills && still.length >= MIN_PROMPT_CHARS) {
      steps.push({
        id: stillId,
        type: 'generate',
        media: 'image',
        platform,
        aspectRatio,
        model: options.imageModel,
        label: `${n}. ${labelFrom(still, 'Still')}${suffix}`,
        prompt: still,
        /* Every character, into every still. This is what keeps a face the
           same face across a dozen shots, and it is exactly the wiring a
           hand-built version skips because it is tedious. */
        inputs: characterIds.length ? [...characterIds] : undefined,
      });
      built++;
    }

    if (wantClips && clip.length >= MIN_PROMPT_CHARS) {
      const hasStill = wantStills && still.length >= MIN_PROMPT_CHARS;
      steps.push({
        id: clipId,
        type: 'generate',
        media: 'video',
        /* Only Flow makes video. A chat platform here would produce a node
           that cannot run, which is worse than not offering the choice. */
        platform: 'flow',
        aspectRatio: clipRatio,
        model: options.videoModel,
        duration: options.duration,
        label: `${n}. ${labelFrom(clip, 'Clip')}${suffix}`,
        prompt: clip,
        /* Its OWN still and nothing else. A clip generated from a still it did
           not come from is a continuity break with no explanation. */
        inputs: hasStill ? [stillId] : (characterIds.length ? [...characterIds] : undefined),
      });
      built++;
    }
  });

  if (!built) {
    return {
      plan: null,
      problems: [...problems, 'None of the shots had a prompt worth building from.'],
    };
  }

  const name = options.sourceName
    ? `${options.sourceName} — rebuilt`
    : 'Rebuilt from a video';

  const cast = characterIds.length;
  const description = [
    clean(extraction.video_concept).slice(0, 180),
    `${shots.length} shot${shots.length === 1 ? '' : 's'}`,
    cast ? `${cast} character${cast === 1 ? '' : 's'} wired into every still` : '',
  ].filter(Boolean).join(' · ');

  return { plan: { name, description, steps }, problems };
}

/**
 * What building this will cost, before anyone presses the button.
 *
 * Shown because 'both' on a twenty shot analysis is forty generations, and
 * finding that out from a credit balance afterwards is the wrong order.
 */
export function buildCost(
  extraction: Extraction | null | undefined,
  options: BuildOptions = {},
): { stills: number; clips: number; characters: number; total: number } {
  const { plan } = extractionToPlan(extraction, options);
  const steps = plan?.steps || [];
  const characters = steps.filter((s) => s.id.startsWith('cast')).length;
  const stills = steps.filter((s) => s.media === 'image' && !s.id.startsWith('cast')).length;
  const clips = steps.filter((s) => s.media === 'video').length;
  return { stills, clips, characters, total: characters + stills + clips };
}
