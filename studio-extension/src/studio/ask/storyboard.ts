/**
 * Writing every shot in one pass, and checking it before it costs anything.
 *
 * An Ask AI node used to answer one question and hand one blob of text to
 * whatever came next. When a workflow has five generate nodes, that meant five
 * separate conversations, each blind to the others — so the character's jacket
 * changed colour between shots, the room was rebuilt from scratch in shot 3,
 * and nothing tied them together except the user noticing and retyping.
 *
 * Asking once for all of them fixes that, because the model can see shot 2
 * while it writes shot 3. But it introduces the failure this module actually
 * exists for: a single malformed reply now breaks five generations instead of
 * one, and you find out one clip at a time, after paying for each.
 *
 * So three things happen here, in order:
 *
 *   1. CONTRACT   The brief demands a specific JSON envelope, and says what
 *                 each field is for. Models comply with a shape far more
 *                 reliably than with prose instructions about formatting.
 *   2. CHECK      Every returned prompt is inspected for the things that are
 *                 known to break generation — fences, numbering, meta-talk,
 *                 storyboard references, missing motion, over-length. These
 *                 are not style opinions; each one has a failure behind it.
 *   3. REPAIR     Problems go back to the same conversation as a numbered
 *                 list, and the model is asked to return the whole envelope
 *                 again. This is the agentic part: it is a loop with an exit
 *                 condition, not a single hopeful request.
 *
 * Nothing here talks to a tab. It is all pure so the checker can be tested
 * against the replies that actually broke things, which is the only way to
 * know a rule earns its place.
 */

export interface Shot {
  n: number;
  title: string;
  prompt: string;
}

export interface ShotTarget {
  /** Node id the shot is destined for. */
  id: string;
  /** What that node will do with it. */
  media: 'image' | 'video' | 'text';
  platform: string;
  label?: string;

  /* What the node is actually configured to do. Without these the writer was
     working blind: it would open a clip on an empty room when the node had a
     start frame wired in, or write a landscape establishing shot for a 9:16
     node. The settings are right there on the node — not telling the model
     about them was the whole problem. */
  aspectRatio?: string;
  duration?: string;
  /** Frames mode pins the first and last frame; ingredients does not. */
  mode?: 'frames' | 'ingredients';
  hasStartFrame?: boolean;
  hasEndFrame?: boolean;
  /** How many reference images are wired in. */
  references?: number;
}

export interface Problem {
  /** 1-based shot number, or 0 for a problem with the envelope itself. */
  shot: number;
  code: string;
  /** Written to be read by the model, not only by us. */
  detail: string;
}

/* Composer limits. Flow shows a 20000 character counter; the others are
   generous but not unlimited. Kept well under so a repair has room to grow a
   prompt slightly rather than being forced to cut. */
const MAX_CHARS: Record<string, number> = {
  flow: 20000,
  grok: 8000,
  chatgpt: 12000,
  gemini: 12000,
  claude: 12000,
};
const DEFAULT_MAX = 8000;

/* Each of these has cost a generation.

   Fences and numbering get typed into the composer literally, so the clip
   opens with the characters "```" or "Shot 3:" rendered as if they were part
   of the scene. Meta-talk does the same with "Certainly! Here is". The
   storyboard words are the specific failure this repo already documents in
   the room-transformation brief: hand a generator a prompt that mentions
   panels and captions and it animates the poster instead of the room. */
const BANNED: Array<{ code: string; re: RegExp; detail: string }> = [
  { code: 'fence', re: /```/, detail: 'contains a code fence (```). Send the prompt text only.' },
  {
    code: 'numbered',
    re: /^\s*(shot\s*\d+|scene\s*\d+|prompt\s*\d+|part\s*\d+|\d+[.)])\s*[:\-–]?\s/i,
    detail: 'starts with a label like "Shot 2:" or "1.". The generator types this in literally — begin with the scene itself.',
  },
  {
    code: 'meta',
    re: /\b(certainly|sure[,!]|here(?:'s| is) (?:the|your|a)\b|i(?:'ve| have) (?:written|created)|as an ai|let me know)\b/i,
    detail: 'contains conversational filler addressed to the reader. A prompt is not a reply.',
  },
  {
    code: 'storyboard',
    re: /\b(panel|storyboard|caption|grid layout|numbered sequence|text overlay|title card)\b/i,
    detail: 'mentions the storyboard itself (panels, captions, overlays). The generator will animate the poster instead of the scene. Describe the real space.',
  },
  {
    code: 'markdown',
    re: /(^|\n)\s{0,3}(#{1,6}\s|\*\s|-\s{1,}\w|\|\s*-{2,})/,
    detail: 'uses markdown headings, bullets or a table. Write continuous prose.',
  },
  {
    code: 'placeholder',
    re: /\[(?:insert|describe|your|character|subject|scene)[^\]]*\]|\{\{[^}]+\}\}|<[A-Z_]{3,}>/,
    detail: 'still contains a placeholder to fill in. Replace it with the real detail.',
  },
];

/** Words that mean something moves. A video prompt without one is a still. */
const MOTION = /\b(camera|pan|tilt|dolly|zoom|track(?:ing)?|orbit|push(?:es|ing)? in|pull(?:s|ing)? back|handheld|walk|walks|walking|run|runs|turn|turns|move|moves|moving|rise|rises|lift|lifts|pour|pours|spray|sprays|reach|reaches|hyperlapse|time-?lapse|slow motion|motion|steadicam|crane)\b/i;

/**
 * The envelope, appended to whatever brief the preset already supplies.
 *
 * Deliberately explicit about the count and about what NOT to include: the
 * checker below rejects all of it, and it is cheaper to say so once here than
 * to spend a repair round on it.
 */
export function shotContract(targets: ShotTarget[], extraFields = ''): string {
  /* Each target described by what it is configured to do, not just what kind
     of thing it is. A writer that knows the node is 9:16, ten seconds long and
     pinned to a start frame writes a different — correct — prompt. */
  const lines = targets.flatMap((t, i) => {
    const kind = t.media === 'video' ? 'a moving clip' : t.media === 'image' ? 'a still image' : 'text';
    const spec = [
      t.aspectRatio,
      t.duration,
      t.platform,
    ].filter(Boolean).join(', ');
    const head = `  ${i + 1}. ${t.label || `Shot ${i + 1}`} — ${kind}${spec ? ` (${spec})` : ''}`;

    const notes: string[] = [];
    if (t.mode === 'frames' && t.hasStartFrame) {
      notes.push(
        '     Its FIRST frame is already fixed by an image wired into this node.'
        + ' Begin in that picture — do not open somewhere else and travel to it.',
      );
    }
    if (t.mode === 'frames' && t.hasEndFrame) {
      notes.push('     Its LAST frame is fixed too. Arrive there; do not overshoot it.');
    }
    if (t.references && t.mode !== 'frames') {
      notes.push(
        `     ${t.references} reference image${t.references === 1 ? '' : 's'} attached — describe`
        + ' the subject in words anyway, because the reference guides look, not action.',
      );
    }
    if (t.duration) {
      notes.push(`     ${t.duration} is the whole clip. Do not write more beats than fit in it.`);
    }
    return [head, ...notes];
  });

  const many = targets.length > 1;
  return [
    '',
    '───────────────────────────────',
    many
      ? `WRITE ALL ${targets.length} PROMPTS IN THIS ONE REPLY.`
      : 'WRITE THE PROMPT AND RETURN IT AS JSON.',
    '',
    ...(many
      ? [
        'They are shots in one piece of work, so write them together and let each',
        'one see the others. Anything that must stay the same across shots — the',
        'character, their clothing, the room, the light, the lens — must be',
        'described in full in EVERY prompt. A generator reads one prompt at a time',
        'and remembers nothing, so "the same woman as before" produces a stranger.',
        '',
        'The shots, in order:',
      ]
      : [
        'It goes straight into a generator exactly as written, so it has to stand',
        'alone: everything it needs described, nothing addressed to me.',
        '',
        'What it is for:',
      ]),
    ...lines,
    '',
    'Reply with ONE JSON object and nothing else — no preamble, no code fence:',
    '',
    '{',
    ...(extraFields ? extraFields.split('\n') : []),
    ...(many
      ? [
        '  "story": "one sentence on what carries through all of them",',
        '  "anchor": "the details that must be identical in every prompt",',
      ]
      : ['  "story": "one sentence on what this shows",']),
    '  "shots": [',
    '    { "n": 1, "title": "short name", "prompt": "the full prompt" }',
    '  ]',
    '}',
    '',
    'Each "prompt" is what gets typed into the generator verbatim. So:',
    '  · no numbering, no "Shot 2:", no titles inside the prompt',
    '  · no markdown, no bullets, no code fences',
    '  · no talking to me — no "Certainly", no "Here is"',
    '  · never mention panels, captions, storyboards or overlays',
    '  · describe the real scene as if it exists',
    ...(targets.some((t) => t.media === 'video')
      ? ['  · every clip prompt must say what MOVES — the camera, the subject, or both']
      : []),
    '───────────────────────────────',
  ].join('\n');
}

/** Pull the envelope out of a reply that may be wrapped in anything. */
export interface ParsedReply {
  shots: Shot[];
  story?: string;
  anchor?: string;
  /* The story behind the shots, so a Story node can lock it and stop
     asking. Optional: an ordinary Ask AI never sends these. */
  cast?: Array<{ name: string; look: string }>;
  world?: string;
  look?: string;
  problem?: string;
}

export function parseShots(reply: string): ParsedReply {
  const text = (reply || '').trim();
  if (!text) return { shots: [], problem: 'The reply was empty.' };

  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);
  // Widest brace span, for a reply with prose either side of the object.
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const c of candidates) {
    let parsed: any;
    try {
      parsed = JSON.parse(c.trim());
    } catch {
      continue;
    }
    const raw = Array.isArray(parsed) ? parsed : parsed?.shots;
    if (!Array.isArray(raw) || !raw.length) continue;

    const shots: Shot[] = raw.map((s: any, i: number) => ({
      n: Number(s?.n) || i + 1,
      title: String(s?.title || `Shot ${i + 1}`).trim(),
      prompt: String(s?.prompt ?? s?.text ?? '').trim(),
    }));
    const cast = Array.isArray(parsed?.cast)
      ? parsed.cast
        .map((c: any) => ({ name: String(c?.name || '').trim(), look: String(c?.look || '').trim() }))
        .filter((c: any) => c.name || c.look)
      : undefined;

    return {
      shots,
      story: typeof parsed?.story === 'string' ? parsed.story : undefined,
      anchor: typeof parsed?.anchor === 'string' ? parsed.anchor : undefined,
      cast: cast && cast.length ? cast : undefined,
      world: typeof parsed?.world === 'string' && parsed.world.trim() ? parsed.world.trim() : undefined,
      look: typeof parsed?.look === 'string' && parsed.look.trim() ? parsed.look.trim() : undefined,
    };
  }
  return { shots: [], problem: 'No JSON object with a "shots" array was found in the reply.' };
}

/**
 * Everything wrong with these prompts, in the words the model needs to fix it.
 *
 * Returns an empty array when the set is safe to run. Order matters only in
 * that envelope problems come first — a wrong shot count makes the per-shot
 * numbering misleading.
 */
export function checkShots(shots: Shot[], targets: ShotTarget[], anchor?: string): Problem[] {
  const problems: Problem[] = [];

  if (shots.length !== targets.length) {
    problems.push({
      shot: 0,
      code: 'count',
      detail: `There are ${targets.length} shots to write but the reply had ${shots.length}. Return exactly ${targets.length}, in order.`,
    });
  }

  shots.forEach((shot, i) => {
    const target = targets[i];
    const n = shot.n || i + 1;
    const p = shot.prompt || '';

    if (!p.trim()) {
      problems.push({ shot: n, code: 'empty', detail: 'The prompt is empty.' });
      return;
    }
    if (p.trim().length < 40) {
      problems.push({
        shot: n, code: 'thin',
        detail: `Only ${p.trim().length} characters. A generator needs the scene described, not named.`,
      });
    }

    const limit = MAX_CHARS[target?.platform || ''] ?? DEFAULT_MAX;
    if (p.length > limit) {
      problems.push({
        shot: n, code: 'long',
        detail: `${p.length} characters, over the ${limit} the composer accepts. Cut it without dropping the details that must match the other shots.`,
      });
    }

    for (const rule of BANNED) {
      if (rule.re.test(p)) problems.push({ shot: n, code: rule.code, detail: `The prompt ${rule.detail}` });
    }

    if (target?.media === 'video' && !MOTION.test(p)) {
      problems.push({
        shot: n, code: 'static',
        detail: 'This one becomes a moving clip but nothing in it moves. Say what the camera or the subject does.',
      });
    }

    /* Continuity, checked rather than hoped for. If the model named an anchor,
       the distinctive words in it have to survive into every prompt — this is
       the exact failure that made asking for all the shots at once worth
       doing, so it would be strange not to verify it. */
    if (anchor && target?.media !== 'text') {
      const keys = anchorKeys(anchor);
      const missing = keys.filter((k) => !new RegExp(`\\b${escapeRe(k)}`, 'i').test(p));
      if (keys.length >= 2 && missing.length > keys.length / 2) {
        problems.push({
          shot: n, code: 'continuity',
          detail: `Missing the shared details that keep the shots consistent (${missing.slice(0, 4).join(', ')}). Describe them in full here too — the generator cannot see the other prompts.`,
        });
      }
    }
  });

  return problems;
}

/**
 * The words in an anchor that identify the subject, not the format.
 *
 * The first version took the first six words of five letters or more, which
 * a live reply immediately showed to be the wrong six. Claude's anchor opened
 * with the camera specification — "Vertical 9:16, ultra-realistic, one fixed
 * medium-wide camera inside the room…" — so the continuity check compared two
 * prompts on words that are in every prompt by construction, and passed
 * whatever it was given. The identity words it should have been checking
 * (tracksuit, ponytail, peppermint, lollipop) were 300 characters further in
 * and never looked at.
 *
 * Two changes, both from that reply. Format vocabulary is excluded, because a
 * word that appears in every prompt cannot distinguish between them. And keys
 * are sampled across the whole anchor rather than taken from the front, so a
 * long anchor's later half is represented at all.
 */
function anchorKeys(anchor: string): string[] {
  const STOP = new Set([
    // Ordinary connective words.
    'the', 'and', 'with', 'that', 'this', 'must', 'same', 'every', 'their', 'them', 'from',
    'into', 'over', 'across', 'stay', 'stays', 'remain', 'remains', 'identical', 'shot',
    'shots', 'prompt', 'prompts', 'scene', 'throughout', 'consistent', 'always', 'each',
    'before', 'after', 'anything', 'everything', 'nothing', 'something', 'while', 'where',
    'there', 'these', 'those', 'other', 'another', 'still', 'currently', 'entire',
    // Camera and format. These are in every prompt by construction, so they
    // cannot tell one apart from another — including them is what made the
    // check pass on a reply it had not actually inspected.
    'vertical', 'horizontal', 'ultra-realistic', 'realistic', 'photorealistic',
    'camera', 'medium-wide', 'wide-angle', 'close-up', 'lens', 'angle', 'frame',
    'framing', 'fixed', 'locked', 'static', 'handheld', 'zooming', 'rotating',
    'dollying', 'orbiting', 'panning', 'tilting', 'cutting', 'cinematic', 'pacing',
    'hyperlapse', 'timelapse', 'time-lapse', 'motion', 'normal-speed', 'speed',
    'second', 'seconds', 'clip', 'video', 'footage', 'aspect', 'ratio', 'resolution',
    'standing', 'height', 'eye-height', 'never', 'moving',
  ]);

  const words = Array.from(
    new Set(
      anchor
        .toLowerCase()
        .split(/[^a-z0-9-]+/)
        .filter((w) => w.length >= 5 && !STOP.has(w)),
    ),
  );

  /* Spread across the anchor instead of taking the front. A 774-character
     anchor — which is what a model actually writes — puts the character and
     the palette well past whatever the first few words are. */
  const WANT = 8;
  if (words.length <= WANT) return words;
  const stride = words.length / WANT;
  const picked: string[] = [];
  for (let i = 0; i < WANT; i++) picked.push(words[Math.floor(i * stride)]);
  return Array.from(new Set(picked));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The follow-up turn: what was wrong, and what to send back. */
export function repairMessage(problems: Problem[], targets: ShotTarget[]): string {
  const envelope = problems.filter((p) => p.shot === 0);
  const perShot = problems.filter((p) => p.shot !== 0);

  const lines: string[] = [
    'That reply cannot be used as written. Fix these and send the whole JSON object again:',
    '',
  ];
  for (const p of envelope) lines.push(`· ${p.detail}`);
  const byShot = new Map<number, Problem[]>();
  for (const p of perShot) {
    if (!byShot.has(p.shot)) byShot.set(p.shot, []);
    (byShot.get(p.shot) as Problem[]).push(p);
  }
  for (const [n, list] of Array.from(byShot.entries()).sort((a, b) => a[0] - b[0])) {
    lines.push(`Shot ${n}:`);
    for (const p of list) lines.push(`  · ${p.detail}`);
  }
  lines.push(
    '',
    `Return the same JSON shape with all ${targets.length} shots — the complete object, not just the corrected ones,`,
    'and nothing outside it.',
  );
  return lines.join('\n');
}

/** A short line for the run log, so a repair round is visible while it happens. */
export function summarise(problems: Problem[]): string {
  if (!problems.length) return 'all shots passed the format check';
  const codes = new Map<string, number>();
  for (const p of problems) codes.set(p.code, (codes.get(p.code) || 0) + 1);
  return Array.from(codes.entries()).map(([c, n]) => (n > 1 ? `${c}×${n}` : c)).join(', ');
}


/**
 * The generate nodes an Ask AI writes for, in the order the contract lists.
 *
 * Order has to be stable and it has to match what the model was told, or shot
 * 3 lands on the node expecting shot 1. Sorted by canvas position rather than
 * edge order: edges are stored in creation order, so rewiring one connection
 * would silently renumber every shot after it — a failure that looks like the
 * model losing the plot rather than like a bug.
 *
 * Pure, and given the nodes rather than reaching for the store, so it can be
 * checked against a real template instead of only at runtime.
 */
export function orderShotTargets(
  askId: string,
  nodes: Array<{ id: string; type?: string; position?: { x: number; y: number }; data?: any }>,
  edges: Array<{ source: string; target: string; targetHandle?: string | null }>,
): ShotTarget[] {
  const seen = new Set<string>();
  const out: Array<ShotTarget & { x: number; y: number }> = [];

  for (const e of edges) {
    if (e.source !== askId) continue;
    if ((e.targetHandle || 'default') !== 'text') continue;
    if (seen.has(e.target)) continue;
    const node = nodes.find((n) => n.id === e.target);
    if (!node) continue;
    const d = (node.data || {}) as any;
    // Only nodes that will turn the words into something.
    if (node.type !== 'generate' && d.type !== 'generate') continue;
    /* An Ask AI node IS a generate node with mediaType 'text', so a chain of
       writers looked like a list of shots: the storyboard node in the room
       template feeds the poster AND the motion writer, and without this it
       would have been asked to write a "shot" for the writer. A shot is
       something that gets rendered; another writer is the next link. */
    if (d.mediaType === 'text') continue;
    seen.add(e.target);

    /* Read the node's own settings. What is wired into it matters as much as
       what it is set to: a frames-mode node with a start image has its first
       frame decided already, and a prompt that opens elsewhere is fighting it. */
    const incoming = edges.filter((x) => x.target === node.id);
    const handles = new Set(incoming.map((x) => x.targetHandle || 'default'));
    const mode = d.creationType === 'frames' ? 'frames' : 'ingredients';

    out.push({
      id: node.id,
      media: d.mediaType === 'video' ? 'video' : d.mediaType === 'text' ? 'text' : 'image',
      platform: String(d.platform || 'flow'),
      label: String(d.label || '').trim() || undefined,
      aspectRatio: d.aspectRatio || undefined,
      duration: d.mediaType === 'video' ? (d.duration || undefined) : undefined,
      mode,
      hasStartFrame: handles.has('frame_start'),
      hasEndFrame: handles.has('frame_end'),
      references: incoming.filter((x) => (x.targetHandle || '') === 'image').length,
      x: node.position?.x ?? 0,
      y: node.position?.y ?? 0,
    });
  }
  out.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  return out.map(({ x: _x, y: _y, ...t }) => t);
}
