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
export function shotContract(targets: ShotTarget[]): string {
  const lines = targets.map((t, i) => {
    const kind = t.media === 'video' ? 'a moving clip' : t.media === 'image' ? 'a still image' : 'text';
    return `  ${i + 1}. ${t.label || `Shot ${i + 1}`} — ${kind}, generated by ${t.platform}`;
  });

  return [
    '',
    '───────────────────────────────',
    `WRITE ALL ${targets.length} PROMPTS IN THIS ONE REPLY.`,
    '',
    'They are shots in one piece of work, so write them together and let each',
    'one see the others. Anything that must stay the same across shots — the',
    'character, their clothing, the room, the light, the lens — must be',
    'described in full in EVERY prompt. A generator reads one prompt at a time',
    'and remembers nothing, so "the same woman as before" produces a stranger.',
    '',
    'The shots, in order:',
    ...lines,
    '',
    'Reply with ONE JSON object and nothing else — no preamble, no code fence:',
    '',
    '{',
    '  "story": "one sentence on what carries through all of them",',
    '  "anchor": "the details that must be identical in every prompt",',
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
export function parseShots(reply: string): { shots: Shot[]; story?: string; anchor?: string; problem?: string } {
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
    return {
      shots,
      story: typeof parsed?.story === 'string' ? parsed.story : undefined,
      anchor: typeof parsed?.anchor === 'string' ? parsed.anchor : undefined,
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

/** Distinctive words from the anchor line, minus the ones that carry no signal. */
function anchorKeys(anchor: string): string[] {
  const STOP = new Set([
    'the', 'and', 'with', 'that', 'this', 'must', 'same', 'every', 'their', 'them', 'from',
    'into', 'over', 'across', 'stay', 'stays', 'remain', 'remains', 'identical', 'shot',
    'shots', 'prompt', 'prompts', 'scene', 'throughout', 'consistent', 'always', 'each',
  ]);
  return Array.from(
    new Set(
      anchor
        .toLowerCase()
        .split(/[^a-z0-9-]+/)
        .filter((w) => w.length >= 5 && !STOP.has(w)),
    ),
  ).slice(0, 6);
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
