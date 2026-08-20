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
  /** Characters in this shot, by name. Absent on replies that predate it. */
  cast?: string[];
  /* Who actually speaks in this shot, when anyone does. Flow allows exactly
     one voice per clip, so a shot listing two characters has to name which of
     them the voice belongs to. The writer already decides this when it writes
     the dialogue into the Audio section — it was simply never asked to say
     so out loud. */
  speaker?: string;
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

  /* This node is the storyboard board rather than a shot in the story: one
     image holding every scene as a labelled panel. It is checked against the
     opposite rules to a clip, so it has to be stated on the target rather
     than guessed from what came back. */
  isSheet?: boolean;

  /* What this node is FOR, read off the wiring rather than its media type.
     An image node feeding a video node is not a shot in the story — it is the
     character being built so the clip has something to look like. Told only
     that it is "a still image", a writer describes a moment from the story
     and produces a reference nobody can use. */
  role?: 'reference' | 'continuation' | 'shot';
  /** For a reference: the shot it is being made for. */
  referenceFor?: string;
  /** For a continuation: the shot it picks up from. */
  continues?: string;
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
/** What a target is FOR, which decides which rules apply to it.
 *
 *  clip   Anything a generator will animate or render as a scene.
 *  sheet  A storyboard board: one image holding every scene as a labelled
 *         panel, with the spoken line written under each.
 *
 *  The two want opposite things from the same words. "Panel 1", "grid
 *  layout" and "text overlay" are how you ask for a board and how you ruin
 *  a clip. */
export type ShotScope = 'clip' | 'sheet';

const BANNED: Array<{ code: string; re: RegExp; detail: string; scope?: ShotScope[] }> = [
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
    /* A CLIP that mentions panels animates the poster instead of the room.
       A SHEET is a storyboard, so the same words are its specification.
       Unscoped, this banned the board outright: the storyboard prompt matches
       here on "grid layout", "Panel 1", "Panel 2", and a blocking problem
       stops the workflow before a generation is spent. */
    scope: ['clip'],
    code: 'storyboard',
    re: /\b(comic\s*panel|storyboard\s*panel|panel\s*\d+|grid\s*layout|numbered\s*sequence|text\s*overlay)\b/i,
    detail: 'mentions the storyboard itself (panels, captions, overlays). The generator will animate the poster instead of the scene. Describe the real space.',
  },
  {
    /* The inverted rule, and why scope is not merely an exemption list. For
       a board, failing to lay out its panels IS the defect: an unstructured
       prompt returns one illustration instead of the sequence every clip
       below it is meant to be shot from. */
    code: 'sheetShape',
    scope: ['sheet'],
    re: /^(?![\s\S]*\bpanel\s*\d+\b)|^(?![\s\S]*(?:\b\d+\s*x\s*\d+\b|\bgrid\b))/i,
    detail: 'is a storyboard sheet but does not lay one out. Number each panel '
      + '("Panel 1: ...", "Panel 2: ...") and say the grid ("a 4x2 grid"), so the '
      + 'board comes back as the sequence the clips are shot from rather than as '
      + 'a single illustration.',
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
  {
    /* The brief's own vocabulary, typed into the generator.
       From a live run: "...raw and unedited UGC style. Setup: She holds the
       jar up to the camera... Escalation: She dabs the cream... Climax: She
       gently rubs it in." Those three words are how the brief TALKS ABOUT
       shape — they are not in the scene, and a generator handed them either
       renders them as text or spends attention on them.

       The brief invited it by saying "write a 3-stage progression
       (Setup ➜ Escalation ➜ Payoff)", which has since been reworded. This is
       the net under that: a model asked for three stages will sometimes label
       them however it is asked.

       Matched only as a LABEL — capitalised and followed by a colon — so a
       sentence that happens to say "the setup of the room" is untouched. */
    code: 'stageLabels',
    re: /(^|[\s.,;—-])(setup|escalation|climax|payoff|stage\s*\d+|beat\s*\d+|part\s*\d+)\s*:/i,
    detail: 'labels its parts ("Setup:", "Escalation:", "Climax:"). Those words are how '
      + 'the brief describes shape, not things in the scene — the generator types them in '
      + 'literally. Write the whole shot as one continuous description.',
  },
  {
    /* Same fault, in the audio section. Our own older guidance asked for
       "1. [Ambience/Environment]: ..." and models copied the brackets in
       verbatim. Google's documented prefixes — "Ambient noise:" and "SFX:" —
       ARE meant to appear, so only the bracketed layer names are banned. */
    code: 'audioLabels',
    re: /\[\s*(ambience|ambient|foley|sfx|dialogue|vocalization|vocalisation|environment)[^\]]*\]/i,
    detail: 'contains a bracketed audio layer label like "[Foley/SFX]". Those brackets are '
      + 'from the instructions, not from the scene. Write the sound as plain sentences — '
      + '"Ambient noise: ...", "SFX: ...", and the spoken line in quotation marks.',
  },
  {
    /* An attachment's filename, typed into the prompt.
       From a live run, after the reference stills started being attached:
       "...lands on a clean aesthetic composition of the product from
       reference-1.png resting on the marble counter." The generator has no
       file called that. It receives the characters r-e-f-e-r-e-n-c-e-hyphen-1
       and does something with them, and none of it is the product.

       The contract asks for "the woman from the reference image" instead —
       this is the net under that, because an instruction is not a guarantee. */
    code: 'fileName',
    re: /\b[\w-]+\.(?:png|jpe?g|webp|gif|mp4|mov|heic)\b|\breference-\d+\b/i,
    detail: 'names an attached file ("reference-1.png"). The generator has no files — it '
      + 'gets those characters as text. Say "the woman from the reference image" instead.',
  },
  {
    code: 'editingJargon',
    re: /\b(cut to|camera cuts to|fade in|fade out|scene transition|dissolve to|split screen|wipes to)\b/i,
    detail: 'uses video-editing jargon like "cut to" or "fade in". Single-take diffusion models glitch on these — describe one continuous uninterrupted shot.',
  },
];

/* Prompts must be English.
   GLM answered a live test entirely in Chinese — accurately, and unusably.
   Every rule below reads English, so a translated reply fails static, meta,
   storyboard and numbered at once regardless of quality, and the repair loop
   chases its tail. The generators are the real reason: Flow and Veo are
   trained on English prompts and degrade on anything else.

   Detected by script rather than by wordlist: any run of CJK, Cyrillic,
   Arabic or Hebrew is conclusive, where "does this contain English words" is
   not. */
const NON_LATIN = /[぀-ヿ㐀-䶿一-鿿가-힯Ѐ-ӿ֐-׿؀-ۿ]/;

/** Words that mean something moves. A video prompt without one is a still. */
const MOTION = /\b(camera|pan|tilt|dolly|zoom|track(?:ing)?|orbit|push(?:es|ing)? in|pull(?:s|ing)? back|handheld|walk|walks|walking|run|runs|turn|turns|move|moves|moving|rise|rises|lift|lifts|pour|pours|spray|sprays|reach|reaches|hyperlapse|time-?lapse|slow motion|motion|steadicam|crane)\b/i;

/**
 * The envelope, appended to whatever brief the preset already supplies.
 *
 * Deliberately explicit about the count and about what NOT to include: the
 * checker below rejects all of it, and it is cheaper to say so once here than
 * to spend a repair round on it.
 */
/**
 * How many spoken words fit in a clip.
 *
 * Natural delivery is about two words a second, and every guide on Veo
 * dialogue converges on the same budget: roughly 8–10 words at 4s, 12–15 at
 * 6s, 15–20 at 8s. Go over and the model does not slow the scene down — it
 * rushes the line or clips the end, which is precisely what "the talking is
 * not realistic" looks like from the outside.
 *
 * A real example from a run: "This is my little secret for that
 * super-hydrated, plump-looking glow. It feels rich, but my skin still looks
 * fresh, not greasy." Twenty-two words in an eight-second clip that also had
 * to show a hand movement and a turn to the light. It was always going to
 * sound hurried.
 *
 * Deliberately generous at the top of each band — this is used to reject a
 * line, and a checker that fires on a line a human would accept is worse than
 * no checker.
 */
export function dialogueBudget(duration?: string): number {
  const seconds = parseFloat(String(duration || '')) || 8;
  return Math.max(6, Math.round(seconds * 2.5));
}

/* What counts as dialogue: an ATTRIBUTED quote.

   Quotation marks alone are not enough, and a sweep over the shipped
   templates proved it — tpl_dental_macro writes its prompt as JSON, so every
   key ("model", "aspect_ratio", "duration") read as a spoken line and the
   whole template failed for talking too much. A product name on a label
   quotes the same way.

   The attribution is also what the generator itself keys on: the lead-in verb
   plus the quotes is what drives lip sync, and a line without one tends to be
   narrated rather than spoken. So the same signal decides both questions.

   Up to 40 characters between the verb and the quote leaves room for the
   delivery — says warmly, / says, almost laughing, — without reaching into
   the next sentence. */
/* A literal rather than a RegExp built from strings: a backslash has to
   survive twice through a constructor, and '\b' in a JS string is a backspace
   rather than a word boundary \u2014 which is exactly how this matched nothing on
   its first attempt.

   The middle group allows up to 40 characters for the delivery \u2014 says warmly,
   / says, almost laughing, \u2014 without reaching into the next sentence. Straight
   quotes are accepted as well as curly: a model that used them still said
   something, and the repair that fixes the envelope runs long after this. */
/**
 * Film vocabulary, in a piece that is meant to look like it was not filmed.
 *
 * Every entry names something a phone in a bathroom physically cannot do —
 * there is no crane, no colour grade, no anamorphic lens, and a face without
 * pores has been retouched. It is deliberately narrower than the brief's
 * realism section: "tracking shot" and "golden hour" are missing because a
 * person really does walk while holding their phone, and a window really is
 * gold at six o'clock. Only the tells that are always tells.
 */
const PRODUCED = new RegExp(
  '\\b('
  + 'cinematic|cinematography|'
  + 'shallow (?:depth of field|focus)|bokeh|anamorphic|\\d{2}mm (?:lens|film)|film grain|'
  + 'stud(?:io) light(?:ing)?|three[- ]point lighting|softbox|key light|rim light|'
  + 'volumetric light(?:ing)?|lens flare|'
  + 'colou?r[- ]grad(?:e|ed|ing)|'
  + 'dolly|crane shot|steadicam|gimbal|'
  + 'slow[- ]?mo(?:tion)?|'
  + 'flawless skin|poreless|porcelain skin|airbrushed|perfect skin'
  + ')\\b',
  'gi',
);

/**
 * A prompt that says the place has not been built yet.
 *
 * Two ways of saying it and both count, because both work on a generator: an
 * adjective for the state ("bare concrete floor", "an empty room") or a named
 * absence inside the description ("with no furniture or lighting"). The second
 * form is the one Google's guide asks for and the one the brief teaches, but
 * failing a prompt that said "a stripped, unfurnished room" would be failing a
 * correct answer for using the other half of the same instruction.
 *
 * "Nothing" is missing on purpose — "nothing moves", "nothing in her hands"
 * are ordinary shot description and say nothing about the room.
 */
const EMPTY_START = new RegExp(
  '\\b(?:'
  + 'empty|emptied|bare|barren|unfurnished|undecorated|unpainted|unfinished|'
  + 'stripped|gutted|untouched|vacant|blank|derelict|raw concrete|bare boards|'
  + 'before (?:any|anything|the work|she|he|they)|not yet '
  + ')\\b'
  + '|\\bno (?:furniture|decoration|decor|lighting|lights|fittings|fixtures|'
  + 'rugs?|panels?|shelves|paint|colour|color)\\b'
  + '|\\bwith no \\w+',
  'i',
);

const ATTRIBUTED =
  /\b(?:says?|said|whispers?|shouts?|asks?|answers?|replies|replied|murmurs?|mutters?|exclaims?|adds|calls|yells?|sings?|tells|breathes)\b[^\u201c\u201d"]{0,40}["\u201c]([^"\u201d]{2,})["\u201d]/gi;

/** The spoken words in a prompt — what is inside an attributed quote. */
export function spokenWords(prompt: string): string[] {
  const said = Array.from(prompt.matchAll(ATTRIBUTED)).map((m) => m[1]);
  return said.join(' ').split(/\s+/).filter(Boolean);
}

/** How many separate attributed lines a prompt contains. */
export function spokenLines(prompt: string): number {
  return Array.from(prompt.matchAll(ATTRIBUTED)).length;
}

export function shotContract(
  targets: ShotTarget[], extraFields = '', wantsSpeaker = false,
  /** How many reference stills are attached to this message. */
  attached = 0,
): string {
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

    /* The job first, because it changes what the prompt should even be. A
       reference still described as a story moment is a reference nobody can
       use: the later shot needs a clear view of the subject, not a dramatic
       angle on it. */
    if (t.role === 'reference') {
      notes.push(
        `     NOT a moment in the story. This is the reference ${t.referenceFor} must`
        + ' match, so make it clear and complete rather than dramatic: everything those'
        + ' shots need to see, evenly lit, nothing important cropped or hidden.',
      );
      notes.push(
        '     Use the same words for the subject that the shots use, or the picture'
        + ' and the prompts will describe two different things.',
      );
    }
    if (t.role === 'continuation' && t.continues) {
      notes.push(
        `     Picks up exactly where "${t.continues}" ended. Do not restart, do not`
        + ' return to an earlier state, and describe everything already built as'
        + ' already present — the generator cannot see the previous clip.',
      );
    }

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
      const durSec = parseFloat(t.duration) || 6;
      if (durSec <= 4) {
        notes.push(`     ${t.duration} is a fast clip: write ONE single punchy action or reaction beat.`);
      } else if (durSec <= 8) {
        notes.push(`     ${t.duration} is a standard clip: one action and the reaction it causes, described as one continuous moment.`);
      } else {
        notes.push(`     ${t.duration} is an extended clip: it moves through three things — what begins, what it turns into, and where it lands — written as one continuous moment, not as labelled stages.`);
      }
      /* The word budget, said where the duration is known.
         Natural delivery is about two words a second. Over the budget the
         generator does not lengthen the shot — it rushes the line or clips
         the end, and the result is the "not realistic talking" this was
         reported as. */
      notes.push(
        `     If anyone speaks in this one, the whole spoken line fits in about `
        + `${dialogueBudget(t.duration)} words. Longer and the delivery is rushed to fit `
        + 'the clip.',
      );
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
    /* Precedence, stated once and plainly.

           A user's brief said "8 still-image nodes AND 8 video nodes" while the
           canvas held sixteen clips. The model followed the sentence, wrote eight
           motionless prompts, and the checker rejected half the reply — correctly,
           and unhelpfully, because nothing had told the model which of the two
           descriptions of the work was true.

           The node list is read off the canvas and cannot be wrong about what
           exists. The brief is written by hand and often describes an earlier
           version of the graph. So the list wins, explicitly, before the list is
           given. */
            'The list below is read from the canvas itself, so it is what exists.',
            'If anything above it says otherwise — a different number of shots, or a',
            'still where this says a clip — the list is right and that instruction is',
            'out of date. Write one prompt per entry, of the kind the entry names.',
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
    `    { "n": 1, "title": "short name", "cast": ["who is in this one"]${
      wantsSpeaker ? ', "speaker": "who talks, or omit"' : ''}, "prompt": "the full prompt" }`,
    '  ]',
    '}',
    '',
    /* The envelope is JSON and a spoken line is quoted, which is a collision
       nothing in either instruction mentioned. Asked for a line "in quotation
       marks", a model writes

           "prompt": "... Elena says, "Okay, my skin has been so flat.""

       and that is not JSON. Three replies in a row parsed as nothing, each
       one otherwise correct, and the panel could only say no shots array was
       found — a message about the symptom that names neither the cause nor
       the fix.

       Curly quotes end it: they are quotation marks to the generator, which
       is all Veo's guidance asks for, and they are ordinary characters to a
       JSON parser. Cheaper than teaching a model to escape, and it cannot be
       got half right. */
    'Dialogue goes in CURLY quotes — “like this” — never straight ones.',
    'A straight quote inside a prompt ends the JSON string early and the whole',
    'reply is unreadable, however good the writing is.',
    '',
    /* Google's own Veo guidance is to do BOTH: supply the reference images and
       describe what is in them, referring to them explicitly — "Using the
       provided images for the detective, the woman, and the office setting…".
       Flow's troubleshooting says the same from the other side: a reference
       image alone does not hold a character together, and neither does a
       description alone.

       So the pictures do not replace the look field, they anchor it. Said
       only when something really is attached: a model told to look at images
       that are not there writes confidently about pictures nobody sent. */
    ...(attached ? [
      `The ${attached} image${attached === 1 ? '' : 's'} attached to this message `
      + `${attached === 1 ? 'is' : 'are'} the reference still${attached === 1 ? '' : 's'} `
      + 'these shots are built from — the characters and places as they actually look.',
      'Look at them before you write. Describe what you can SEE in them, not what',
      'you would have imagined: the real hair, the real clothing, the real room.',
      'Where a shot uses one, say so in its prompt the way Flow expects — "the',
      'woman from the reference image" — so the generator ties the two together.',
      'Never write a file name. "the product from reference-1.png" reaches the',
      'generator as those words: it has no file, and it will try to draw the text.',
      '',
    ] : []),
    '"cast" lists only the characters who actually appear in that shot, by',
    'name. It is how the check knows the moon scene is not missing the',
    'delivery man — it knows he was never in it.',
    '',
    /* Only asked when a voice is actually waiting to be assigned. A field the
       writer must fill for no reason is a field it gets wrong for no reason,
       and every extra key is another chance to break the JSON. */
    ...(wantsSpeaker ? [
      '"speaker" is the ONE character whose voice is heard in that shot — the',
      'one whose lines you put in the audio. Only one voice can be used per',
      'clip, so name a single character or leave the field out. Omit it for a',
      'shot with no speech: an establishing shot, a product on a table, a',
      'reaction with no line.',
      '',
    ] : []),
    'Each "prompt" is what gets typed into the generator verbatim. So:',
    '  · write every prompt in ENGLISH, whatever language this brief is in',
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

/**
 * Rescue an envelope whose only fault is an unescaped quote.
 *
 * A spoken line is quoted and the envelope is JSON, and a model asked for
 * both writes:
 *
 *     "prompt": "... Elena says, "Okay, my skin has been so flat.""
 *
 * which is not JSON. Three consecutive replies were lost to exactly this —
 * every prompt correct, every field present, the whole thing discarded
 * because of two characters. The brief now asks for curly quotes, which
 * cannot collide; this is for the model that uses straight ones anyway.
 *
 * Deliberately narrow. It walks the text as a parser would and only ever
 * escapes a quote that is INSIDE a string and not the one closing it —
 * decided by what follows: a comma, a closing brace or bracket means the
 * string is ending, anything else means the quote is part of the sentence.
 * It rewrites nothing outside a string, so a reply that is malformed in some
 * other way still fails rather than being silently reshaped into something
 * that parses and is wrong.
 */
export function repairInnerQuotes(json: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];

    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\') { out += ch; escaped = true; continue; }

    if (ch !== '"') { out += ch; continue; }

    if (!inString) { inString = true; out += ch; continue; }

    /* Inside a string, at a quote. Whatever comes next says whether this is
       the end of the value or a quotation mark in the middle of it. */
    let j = i + 1;
    while (j < json.length && /\s/.test(json[j])) j++;
    const next = json[j];
    if (next === ',' || next === '}' || next === ']' || next === ':' || next === undefined) {
      inString = false;
      out += ch;
    } else {
      out += '\\"';
    }
  }
  return out;
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

/**
 * The strings in a reply that might be the JSON object.
 *
 * Three, in the order most likely to be right: what a fence contains, the
 * whole reply, and the widest brace span for a reply with prose either side.
 * Shared so the second thing that reads a JSON reply cannot end up with a
 * narrower idea of where JSON hides than the first.
 */
export function jsonCandidates(reply: string): string[] {
  const text = (reply || '').trim();
  if (!text) return [];
  const out: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) out.push(fenced[1]);
  out.push(text);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) out.push(text.slice(first, last + 1));
  return out;
}

/** The first candidate that parses as a JSON object. */
export function readJsonObject(reply: string): Record<string, unknown> | null {
  for (const c of jsonCandidates(reply)) {
    for (const attempt of [c.trim(), repairInnerQuotes(c.trim())]) {
      try {
        const parsed = JSON.parse(attempt);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch { /* next */ }
    }
  }
  return null;
}

export function parseShots(reply: string): ParsedReply {
  const text = (reply || '').trim();
  if (!text) return { shots: [], problem: 'The reply was empty.' };

  for (const c of jsonCandidates(text)) {
    let parsed: any;
    try {
      parsed = JSON.parse(c.trim());
    } catch {
      /* One more try, with the quotes inside the prompts escaped. A reply
         that is otherwise perfect is not worth a repair round, and the round
         it costs is spent asking a model to do by hand what this does
         exactly. */
      try {
        parsed = JSON.parse(repairInnerQuotes(c.trim()));
      } catch {
        continue;
      }
    }
    const raw = Array.isArray(parsed) ? parsed : parsed?.shots;
    if (!Array.isArray(raw) || !raw.length) continue;

    const shots: Shot[] = raw.map((s: any, i: number) => ({
      n: Number(s?.n) || i + 1,
      title: String(s?.title || `Shot ${i + 1}`).trim(),
      prompt: String(s?.prompt ?? s?.text ?? '').trim(),
      /* Who is in THIS shot. Absent on an older reply, which the checker
         treats as "unknown" rather than "nobody". */
      cast: Array.isArray(s?.cast)
        ? s.cast.map((c: any) => String(c || '').trim()).filter(Boolean)
        : undefined,
      /* Dropped here until now, which made the whole speaker field pointless:
         the contract asked for it, the writer filled it in correctly, and it
         was thrown away one line before anything could read it. */
      speaker: s?.speaker ? String(s.speaker).trim() : undefined,
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
  /* Say which kind of failure it is. "No shots array was found" was true of
     a reply containing a perfect shots array whose only fault was a quote —
     and the repair message built from it asked for the object again, which
     the model then sent again, identically broken, three times over. A model
     told what is actually wrong can fix it; told the symptom, it repeats
     itself. */
  const looksLikeJson = text.includes('"shots"') || text.trimStart().startsWith('{');
  return {
    shots: [],
    problem: looksLikeJson
      ? 'The reply looks like the right object but is not valid JSON — most often a '
        + 'straight quotation mark inside a prompt, which ends the string early. Put '
        + 'dialogue in curly quotes (“like this”) and send the whole object again.'
      : 'No JSON object with a "shots" array was found in the reply.',
  };
}

/**
 * Everything wrong with these prompts, in the words the model needs to fix it.
 *
 * Returns an empty array when the set is safe to run. Order matters only in
 * that envelope problems come first — a wrong shot count makes the per-shot
 * numbering misleading.
 */
export function checkShots(
  shots: Shot[],
  targets: ShotTarget[],
  anchor?: string,
  /* Who each named character is. With it, a shot is measured only against the
     people it says are in it — without it, the anchor named the whole cast and
     the moon scene was failed for not mentioning the delivery man. */
  cast?: Array<{ name: string; look: string }>,
  /* What kind of piece this is. Two facts the shots alone cannot tell you,
     both of which decide whether a well-formed prompt is the right prompt.

     ugc      The realism instructions are the only part of the brief asking a
              model to make something WORSE than it knows how to, which is the
              hardest kind of instruction to keep — a writer that has read them
              still reaches for "cinematic" because that is what a good prompt
              looks like everywhere else.
     build    Things arrive that were not there, so the opening shot has to be
              the state before any of them.

     In the brief both are suggestions; here they are not. */
  kind?: { ugc?: boolean; build?: boolean },
): Problem[] {
  const { ugc = false, build = false } = kind || {};
  /* The first shot that is a moment in the piece. A reference still is not
     one — it is a design for the others to match. */
  const opening = shots.length && targets.length
    ? targets.find((t) => t.role !== 'reference' && t.media !== 'text')
    : undefined;
  /* And the still wired into its first frame, when there is one. That still is
     the opening state — the clip begins inside it — so it is the shot that has
     to be empty. Checking only the clip would pass a perfect description of an
     empty room generated from a picture of a finished one, which is exactly
     what was happening. */
  const pin = opening && opening.mode === 'frames' && opening.hasStartFrame && opening.label
    ? targets.find((t) => t.role === 'reference'
        && !!t.referenceFor && t.referenceFor.includes(opening.label as string))
    : undefined;
  const startsPiece = new Set([opening?.id, pin?.id].filter(Boolean) as string[]);
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
    /* By position, not by shot.n. Everything downstream reads p.shot as an
       index into targets - repairMessage prints targets[n - 1].label, and the
       ledger banks by it. After alignShots a shot sitting at position 2 can
       still call itself 1, and a partial repair reply always numbers itself
       from 1 whatever it holds, so trusting the shot's own number reported
       every one of its problems against the wrong target. */
    const n = i + 1;
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

    /* Language first. When a prompt is not English every rule below reports a
       failure it cannot explain — "nothing moves" on a prompt that says the
       camera moves, in Chinese. One accurate problem beats four misleading
       ones, so the rest are skipped for this shot. */
    if (NON_LATIN.test(p)) {
      problems.push({
        shot: n, code: 'language',
        detail: 'is not written in English. The generators are trained on English prompts and '
          + 'degrade on anything else — rewrite this prompt in English, keeping every detail.',
      });
      return;
    }

    /* A board and a clip are checked against different rulebooks. Read off the
       target, never sniffed from the prompt: a clip that happens to mention a
       panel would otherwise talk its way into the permissive rulebook, and
       that mistake costs a render. */
    const scope: ShotScope = target?.isSheet ? 'sheet' : 'clip';
    for (const rule of BANNED) {
      if (rule.scope && !rule.scope.includes(scope)) continue;
      if (rule.re.test(p)) problems.push({ shot: n, code: rule.code, detail: `The prompt ${rule.detail}` });
    }

    /* ── Dialogue that a generator can actually speak ──
     *
     * Reported as "the talking is not realistic", and the research says the
     * same thing three different ways: natural delivery is about two words a
     * second, and past that the model does not slow the scene down — it
     * rushes the line or clips the end.
     *
     * From a real run, in an eight-second clip that also had to show a hand
     * movement and a turn to the light: "This is my little secret for that
     * super-hydrated, plump-looking glow. It feels rich, but my skin still
     * looks fresh, not greasy." Twenty-two words. It was never going to sound
     * like a person talking.
     *
     * Only for clips, and only where the duration is known — a still has no
     * seconds, and guessing a budget would reject lines for a limit nobody
     * set. */
    if (target?.media === 'video' && target?.role !== 'reference') {
      const words = spokenWords(p);
      const budget = dialogueBudget(target.duration);
      if (words.length > budget) {
        problems.push({
          shot: n, code: 'dialogueLong',
          detail: `has ${words.length} spoken words in a ${target.duration || '8s'} clip, `
            + `where about ${budget} fit at a natural pace. The generator will not slow the `
            + 'shot down to fit them — it speeds the delivery up or cuts the end off. Cut '
            + 'the line, or move the rest into the next shot.',
        });
      }

      /* One voice per clip. Two attributed lines inside eight seconds is a
         scene, and the model assigns them to whichever face it prefers. */
      if (spokenLines(p) > 1) {
        problems.push({
          shot: n, code: 'twoSpeakers',
          detail: 'has more than one spoken line. A clip this short can carry one, and a '
            + 'generator handed two decides for itself who says what. Keep one line and '
            + 'give the reply to the next shot.',
        });
      }

      /* A mouth too small to animate.
         Lip sync is driven by the face, and a wide or establishing frame
         leaves too few pixels of it — the guides are unanimous that dialogue
         wants a medium close-up or chest-up frame. This is the one rule here
         that reads the SHOT rather than the line, so it only fires when a
         prompt both speaks and says it is wide. */
      if (words.length && /\b(wide shot|wide establishing|establishing shot|extreme wide|aerial|drone shot|from across the room|full[- ]body shot)\b/i.test(p)) {
        problems.push({
          shot: n, code: 'dialogueTooWide',
          detail: 'has someone speaking in a wide or establishing frame. The face is then '
            + 'too small for the mouth to be animated and the lip sync drifts. Either frame '
            + 'this one chest-up or medium close, or drop the line and let it be a look.',
        });
      }
    }

    /* The vocabulary that undoes a UGC piece.
       Not a style disagreement: each of these names a specific thing a phone
       cannot do. A phone has no shallow-focus bokeh worth the word, no colour
       grade, no dolly and no slow motion, and a face without pores has been
       retouched. One of them in the prompt and the clip comes back looking
       like the advert the piece was written to not look like. */
    if (ugc) {
      const produced = p.match(PRODUCED) || [];
      if (produced.length) {
        problems.push({
          shot: n, code: 'ugcProduced',
          detail: `reads as a production, not a phone: ${[...new Set(produced.map((w) => w.toLowerCase()))].join(', ')}. `
            + 'This one is meant to look like someone filmed it themselves. Describe the '
            + 'available light, the phone-lens depth where the background stays legible, '
            + 'and skin with pores and shine — and drop the film vocabulary.',
        });
      }
    }

    /* A transformation that opens halfway through itself.
       Reported as "the room does not start empty", and the words were never
       the problem — the room preset has asked for "the empty room" all along.
       What was missing was anything that noticed when the prompt came back
       describing a room with furniture in it. This fires only on the shot
       that opens the piece, and only when the piece builds. */
    if (build && target && startsPiece.has(target.id) && !EMPTY_START.test(p)) {
      problems.push({
        shot: n, code: 'openNotFromNothing',
        detail: 'opens the piece, which BUILDS — so it has to start before any of it. '
          + 'Nothing in this prompt says the place is empty, so the generator will fill '
          + 'it with what it expects to be there. Name what is missing as part of the '
          + 'description — "bare boards and unpainted walls, no furniture, no lighting" '
          + '— not as a bare list of "no".',
      });
    }

    if (target?.media === 'video' && target?.role !== 'reference' && !MOTION.test(p)) {
      problems.push({
        shot: n, code: 'static',
        detail: 'This one becomes a moving clip but nothing in it moves. Say what the camera or the subject does.',
      });
    }

    /* Continuity, checked rather than hoped for. If the model named an anchor,
       the distinctive words in it have to survive into every prompt — this is
       the exact failure that made asking for all the shots at once worth
       doing, so it would be strange not to verify it. */
    /* Not applied to a reference. The continuity rule exists to catch a SHOT
       that dropped the shared identity, and a reference is the thing that
       identity is being defined by — the shots must match it, not it them.
       Checking it the other way failed a room design sheet for not containing
       a description of the person who walks into the room. */
    if (anchor && target?.media !== 'text' && target?.role !== 'reference') {
      /* Scope the identity to this shot. A story with five characters shares
         only its world and style globally; Dad is in one scene. Measuring
         every prompt against every character is what made the repair loop
         demand the moon shot describe the delivery man, and a model trying to
         comply appends all five to all sixteen. */
      const named = (shot.cast || []).map((n) => n.toLowerCase());
      const relevant = (cast || []).filter((c) => named.includes(c.name.toLowerCase()));
      const scoped = named.length && relevant.length
        ? relevant.map((c) => c.look).join(' ')
        : anchor;
      const keys = anchorKeys(scoped);
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
  /* Meta-vocabulary. A model often writes the anchor as an INSTRUCTION —
     "the character descriptions must be copy-pasted exactly into every
     prompt" — rather than as the details themselves. Those words then became
     the things every prompt was required to contain, so the repair asked for
     "copy-pasted" and "exactly" to appear in a scene description. GLM could
     not satisfy that sensibly and did the only thing available: it bolted a
     Consistency Reference block onto all sixteen prompts and prefixed every
     name with [Role/Position: ...]. The error handling made the output
     worse, which is the worst thing error handling can do. */
  const META = new Set([
    'copy-pasted', 'copied', 'copy', 'paste', 'pasted', 'exactly', 'identical',
    'identically', 'description', 'descriptions', 'described', 'reference',
    'references', 'consistency', 'consistent', 'appear', 'appears', 'appearing',
    'alongside', 'verbatim', 'above', 'below', 'listed', 'global', 'ensure',
    'must', 'into', 'their', 'full', 'same', 'every', 'each', 'prompt', 'prompts',
  ]);
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
        .filter((w) => w.length >= 5 && !STOP.has(w) && !META.has(w)),
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

/**
 * Which problems mean a prompt cannot be used, and which mean it is worse.
 *
 * The distinction the storyboard loop was missing. It counted every problem
 * the same and refused to run when any survived three attempts, so a set of
 * prompts that would have rendered perfectly well was thrown away because one
 * shot opened a beat wider than the dialogue rule likes — and because a Story
 * node feeds everything downstream, the whole workflow stopped there.
 *
 * Blocking means the text would carry something that is not part of the scene
 * into the generator: a code fence, a stage label, a file name, "Sure, here
 * are your prompts". Those get rendered literally, which is a wasted
 * generation every time, and the check is worth stopping for.
 *
 * Everything else is a judgement about the shot. A wide frame with a line in
 * it, a clip that reads as more produced than a phone would, an opening that
 * does not say the room is empty — each makes the video less good and none of
 * them makes it fail. Those are reported and run.
 */
export const BLOCKING: ReadonlySet<string> = new Set([
  'count', 'empty', 'thin',
  'fence', 'numbered', 'meta', 'storyboard', 'markdown', 'placeholder',
  'stageLabels', 'audioLabels', 'fileName', 'editingJargon', 'sheetShape',
]);

/** The problems worth refusing to spend a generation on. */
export const blockingProblems = (problems: Problem[]): Problem[] =>
  problems.filter((p) => BLOCKING.has(p.code));

/** One line per problem, in the order the shots run. */
export function describeProblems(problems: Problem[]): string[] {
  return [...problems]
    .sort((a, b) => a.shot - b.shot)
    .map((p) => (p.shot ? `Shot ${p.shot} ${p.detail}` : p.detail));
}

/** The follow-up turn: what was wrong, and what to send back. */
export function repairMessage(
  problems: Problem[],
  targets: ShotTarget[],
  /* The shots still wanted, 1-based. Absent means all of them, which is what a
     wholly-rejected reply needs.
   *
   * With it, the ask shrinks to the shots that actually failed. This message
   * used to end "send the whole object again", so one bad line in shot 7
   * re-asked for all sixteen: the most expensive possible reply to fix the
   * smallest possible problem, at the moment the reply is already at its
   * longest, and with every good shot free to come back worse. */
  only?: number[],
): string {
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
  if (only && only.length && only.length < targets.length) {
    const named = only.map((n: number) => `${n} ("${targets[n - 1]?.label || `Shot ${n}`}")`);
    lines.push(
      '',
      `Send back ONLY ${only.length === 1 ? 'shot' : 'shots'} ${named.join(', ')} - `
      + 'the others are accepted and must not be resent.',
      'Same JSON shape, "shots" array, and set the "n" field on each one to its shot number',
      'so it is clear which is which. Nothing outside the object.',
    );
  } else {
    lines.push(
      '',
      `Return the same JSON shape with all ${targets.length} shots — the complete object, not just the corrected ones,`,
      'and nothing outside it.',
    );
  }
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
/**
 * What a node is for, from what it is wired to.
 *
 * Three jobs, and the wiring says which without anyone configuring it:
 *
 *   reference    Its output feeds another node's image or frame port. It is
 *                not a moment in the story; it is the character, product or
 *                set being built so the shots have something to match. It
 *                should be a clean, unambiguous view — not a dramatic angle.
 *   continuation Its first frame comes from another shot, directly or through
 *                a Last Frame node. It must begin in that picture.
 *   shot         Everything else.
 *
 * A frame node is followed through rather than treated as a wall: "clip A →
 * Last Frame → clip B" is one relationship with a box drawn in the middle of
 * it, and stopping at the box would lose the only fact that matters.
 */
function roleOf(
  id: string,
  nodes: Array<{ id: string; type?: string; data?: any }>,
  edges: Array<{ source: string; target: string; targetHandle?: string | null }>,
): { role: 'reference' | 'continuation' | 'shot'; referenceFor?: string; continues?: string } {
  const nodeOf = (x: string) => nodes.find((n) => n.id === x);
  const labelOf = (x: string) => String(nodeOf(x)?.data?.label || x);
  const REF_PORTS = new Set(['image', 'image_ref', 'frame_start', 'frame_end']);

  /* Where does this node's output land? A frame node in between is passed
     through, since it forwards a still rather than being a destination. */
  const consumers: Array<{ id: string; handle: string }> = [];
  const walk = (from: string, depth = 0) => {
    if (depth > 3) return;
    for (const e of edges) {
      if (e.source !== from) continue;
      const handle = e.targetHandle || 'default';
      const t = nodeOf(e.target);
      if (t?.type === 'frame') { walk(e.target, depth + 1); continue; }
      consumers.push({ id: e.target, handle });
    }
  };
  walk(id);

  const feeds = consumers.filter((c) => REF_PORTS.has(c.handle));
  if (feeds.length && nodeOf(id)?.data?.mediaType !== 'video') {
    const names = Array.from(new Set(feeds.map((c) => labelOf(c.id))));
    const listed = names.length > 1
      ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      : names[0];
    return { role: 'reference', referenceFor: listed };
  }

  // Does something upstream pin this node's opening frame?
  const back = (to: string, depth = 0): string | null => {
    if (depth > 3) return null;
    for (const e of edges) {
      if (e.target !== to) continue;
      const handle = e.targetHandle || 'default';
      /* The same set the forward walk uses. Checking only 'image' and
         'frame_start' passed a synthetic test built from the handles I
         assumed, and found nothing in the real room template, which wires its
         Last Frame node through 'image_ref'. */
      if (depth === 0 && !REF_PORTS.has(handle)) continue;
      const src = nodeOf(e.source);
      if (src?.type === 'frame') {
        const deeper = back(e.source, depth + 1);
        if (deeper) return deeper;
        continue;
      }
      if (src?.data?.mediaType === 'video') return e.source;
    }
    return null;
  };
  const from = back(id);
  if (from) return { role: 'continuation', continues: labelOf(from) };

  return { role: 'shot' };
}

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
      ...roleOf(node.id, nodes, edges),
      platform: String(d.platform || 'flow'),
      label: String(d.label || '').trim() || undefined,
      aspectRatio: d.aspectRatio || undefined,
      duration: d.mediaType === 'video' ? (d.duration || undefined) : undefined,
      mode,
      hasStartFrame: handles.has('frame_start'),
      hasEndFrame: handles.has('frame_end'),
      references: incoming.filter((x) => (x.targetHandle || '') === 'image').length,
      isSheet: d.mediaType !== 'video' && d.storyboardSheet === true,
      x: node.position?.x ?? 0,
      y: node.position?.y ?? 0,
    });
  }
  out.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  return out.map(({ x: _x, y: _y, ...t }) => t);
}

/**
 * Put the shots in the targets' order.
 *
 * Everything downstream matches by position: shotFor takes the target's index
 * and reads plan[idx]. That is only correct if the writer returns the shots in
 * the order it was given them, and a director does not think that way. Asked
 * for five shots it returned them in narrative order — "After Closing" first,
 * which was the fifth node — so every node got another node's prompt, the
 * voices followed the prompts to the wrong clips, and the run looked broken in
 * a way that pointed at neither.
 *
 * It renumbered "n" to match its own order too, so n is no better than
 * position. The titles, though, came back as the target labels verbatim,
 * because that is what the contract lists. So: match on title, and only when
 * every target finds exactly one shot — a partial match is a guess, and a
 * guess here is silently the wrong prompt on the wrong clip.
 *
 * Left alone otherwise. A writer that keeps the order is the normal case and
 * must not be second-guessed.
 */
export function alignShots(shots: Shot[], targets: ShotTarget[]): Shot[] {
  if (shots.length !== targets.length || shots.length < 2) return shots;

  const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const byTitle = new Map<string, Shot[]>();
  for (const sh of shots) {
    const k = key(sh.title || '');
    if (!k) return shots;
    byTitle.set(k, [...(byTitle.get(k) || []), sh]);
  }
  /* Duplicate titles cannot be told apart, and a target with no label has
     nothing to match on. Either way, position is the honest answer. */
  if ([...byTitle.values()].some((v) => v.length > 1)) return shots;

  const out: Shot[] = [];
  for (const t of targets) {
    const found = byTitle.get(key(t.label || ''));
    if (!found) return shots;
    out.push(found[0]);
  }
  return out;
}

/**
 * Place a PARTIAL reply's shots onto the targets still waiting for one.
 *
 * A repair round asks for only the shots that failed, so the reply carries two
 * of sixteen and nothing about it says which two — except by title, by `n`, or
 * by the order they arrive in. All three are tried, in that order.
 *
 * Title first, and this is the important part: parseShots defaults a missing
 * `n` to the array index, so a two-shot reply always claims to be shots 1 and 2
 * whatever it actually contains. Trusting `n` first would silently overwrite
 * shot 1 with a repair meant for shot 7 — a wrong prompt on a good shot, which
 * is worse than the failure being repaired.
 */
export function placeShots(
  incoming: Shot[],
  pending: number[],
  targets: ShotTarget[],
): Map<number, Shot> {
  const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const out = new Map<number, Shot>();
  const left: Shot[] = [];

  // 1. By title, against the labels of the targets still waiting.
  for (const sh of incoming) {
    const k = key(sh.title || '');
    const hit = k
      ? pending.find((i) => !out.has(i) && key(targets[i].label || '') === k)
      : undefined;
    if (hit === undefined) left.push(sh);
    else out.set(hit, sh);
  }

  // 2. By `n`, but only where it lands on a slot that is actually waiting.
  const stillLeft: Shot[] = [];
  for (const sh of left) {
    const i = Number(sh.n) - 1;
    if (Number.isInteger(i) && pending.includes(i) && !out.has(i)) out.set(i, sh);
    else stillLeft.push(sh);
  }

  // 3. Whatever remains, onto whatever slots remain, in order.
  const free = pending.filter((i) => !out.has(i));
  stillLeft.forEach((sh, j) => {
    if (j < free.length) out.set(free[j], sh);
  });

  return out;
}
