/* ============================================================
   Node Documentation — Build with AI Master Prompt
   Comprehensive, AI-readable documentation for every Studio
   node type, port, setting, connection rule, workflow pattern,
   anti-pattern, and model. Used as LLM context so an AI agent
   can generate accurate, runnable workflows.
   ============================================================ */

// ── Types ──

interface PortDoc {
  handleId: string;
  dataType: 'text' | 'image' | 'result';
  description: string;
  required: boolean;
}

interface SettingDoc {
  field: string;
  type: 'select' | 'string' | 'boolean';
  values?: readonly string[];
  default: string;
  description: string;
}

interface NodeDoc {
  name: string;
  typeKey: string;
  icon: string;
  description: string;
  inputs: PortDoc[];
  outputs: PortDoc[];
  settings: SettingDoc[];
  executionBehavior: string;
  tips: string[];
  constraints: string[];
}

interface ConnectionRule {
  sourceType: string;
  sourceHandle: string;
  targetType: string;
  targetHandle: string;
  description: string;
}

interface WorkflowPattern {
  name: string;
  description: string;
  nodeChain: string;
  whenToUse: string;
}

interface AntiPattern {
  mistake: string;
  why: string;
  fix: string;
}

interface ModelDoc {
  name: string;
  mediaType: 'image' | 'video';
  ratios: string[];
  durations?: string[];
  notes: string;
}

// ── NODE DOCS ──

export const NODE_DOCS: Record<string, NodeDoc> = {
  prompt: {
    name: 'Prompt Node',
    typeKey: 'prompt',
    icon: '✏️',
    description:
      'A text input node. You write a description, scene direction, character spec, ' +
      'or continuity instruction here. It does NOT execute anything — it just holds ' +
      'text and passes it downstream through its T (text) output port.',
    inputs: [],
    outputs: [
      {
        handleId: 'text',
        dataType: 'text',
        description:
          'Sends the text content to any connected node\'s T input. ' +
          'Can fan out to multiple Generate or Ask AI nodes simultaneously.',
        required: false,
      },
    ],
    settings: [],
    executionBehavior:
      'Does NOT run on any platform. During workflow execution the runner reads ' +
      'its .text field and stores it as a result so downstream nodes can pull it.',
    tips: [
      'One Prompt per Generate — each generation needs its own scene-specific text.',
      'For multi-shot consistency, paste the CONTINUITY block ("Same character as ' +
      'the reference: identical face, hairstyle, outfit…") into every downstream prompt.',
      'A single Prompt can fan out to multiple Generate nodes (e.g. A/B model comparison).',
      'Max 20,000 characters. Use all of them if needed — longer, more specific ' +
      'prompts produce more accurate results.',
      'Structure prompts with markdown headings (# SUBJECT, # CONSTANTS) for clarity.',
    ],
    constraints: [
      'Max 20,000 characters.',
      'Must not be empty when a downstream Generate node runs, or the run fails.',
      'Has no input ports — it is always a leaf/root node.',
    ],
  },

  image: {
    name: 'Image Node',
    typeKey: 'image',
    icon: '🖼',
    description:
      'Upload or select a reference image (face photo, product shot, outfit flat-lay, ' +
      'scene/location). The image is stored as a base64 data URL and passed downstream ' +
      'through its 🖼 output port as a visual reference for Generate nodes.',
    inputs: [],
    outputs: [
      {
        handleId: 'image',
        dataType: 'image',
        description:
          'Sends the uploaded image data to any connected node\'s 🖼 (image_ref) input. ' +
          'Can fan out to multiple Generate nodes to reuse the same reference.',
        required: false,
      },
    ],
    settings: [
      {
        field: 'imageName',
        type: 'string',
        default: '',
        description:
          'A human-readable label (e.g. "Hero Face", "Product Photo"). Helps the user ' +
          'and the AI know WHICH reference this is when a workflow has multiple images.',
      },
    ],
    executionBehavior:
      'Does NOT run on any platform. The runner reads its .imageData field (base64 ' +
      'data URL) and stores it so downstream Generate nodes can attach it as a reference.',
    tips: [
      'Name every Image node clearly — "face", "outfit", "product", "scene" — so ' +
      'the prompt can say IMAGE 01 = FACE, IMAGE 02 = OUTFIT.',
      'Multiple Image nodes can feed one Generate node for multi-reference composites ' +
      '(e.g. face + outfit + location = one still).',
      'Ship templates with empty Image nodes and a descriptive name hint, so users ' +
      'know what to upload.',
      'The result of a Generate node can also serve as a reference (via its → output ' +
      'port), so you don\'t always need a separate Image node.',
    ],
    constraints: [
      'Has no input ports — always a leaf/root node.',
      'Accepts image/* files only.',
      'Large images are stored as base64; too many can fill chrome.storage quota.',
    ],
  },

  generate: {
    name: 'Generate Node',
    typeKey: 'generate',
    icon: '🎬',
    description:
      'The core execution node. Sends a prompt (and optional reference images) to ' +
      'Google Flow or ChatGPT to produce an image or video. This is the only node ' +
      'type that actually costs a generation and talks to an external platform.',
    inputs: [
      {
        handleId: 'text',
        dataType: 'text',
        description:
          'Receives prompt text from a Prompt node or an Ask AI node\'s text output. ' +
          'REQUIRED — a Generate node with no text connection fails immediately.',
        required: true,
      },
      {
        handleId: 'image_ref',
        dataType: 'image',
        description:
          'Receives one or more reference images from Image nodes or upstream Generate ' +
          'results. Optional. Multiple edges allowed — Flow accepts several ingredients. ' +
          'Hidden when mediaType is "text" (Ask AI mode).',
        required: false,
      },
    ],
    outputs: [
      {
        handleId: 'result',
        dataType: 'result',
        description:
          'After completion, carries the generated image/video as a reference that ' +
          'downstream Generate nodes can use via their 🖼 input. This is how you ' +
          'chain shots — Gen₁ result becomes Gen₂ reference.',
        required: false,
      },
    ],
    settings: [
      {
        field: 'platform',
        type: 'select',
        values: ['flow', 'chatgpt'],
        default: 'flow',
        description: 'Which service runs this generation. Flow = Google Flow (images + videos). ChatGPT = OpenAI (images or text).',
      },
      {
        field: 'mediaType',
        type: 'select',
        values: ['image', 'video'],
        default: 'image',
        description: 'What to produce. "video" only available on Flow platform.',
      },
      {
        field: 'model',
        type: 'select',
        values: [
          'Nano Banana Pro', 'Nano Banana 2', 'Imagen 4',
          'Omni 1.1 Flash', 'Veo 3.1 - Lite', 'Veo 3.1 - Fast',
          'Veo 3.1 - Quality', 'Veo 3.1 - Lite [Lower Priority]',
        ],
        default: 'Nano Banana Pro',
        description:
          'Image models: Nano Banana Pro, Nano Banana 2, Imagen 4. ' +
          'Video models: Omni 1.1 Flash, Veo 3.1 variants. Model must match mediaType.',
      },
      {
        field: 'aspectRatio',
        type: 'select',
        values: ['9:16', '16:9', '1:1', '4:3', '3:4'],
        default: '9:16',
        description: 'Output aspect ratio. Video only supports 9:16, 16:9, 1:1. Images support all five.',
      },
      {
        field: 'duration',
        type: 'select',
        values: ['4s', '6s', '8s', '10s'],
        default: '6s',
        description: 'Video clip length. Only applies when mediaType is "video". 10s requires Omni 1.1 Flash.',
      },
      {
        field: 'enabled',
        type: 'boolean',
        default: 'true',
        description: 'Toggle to skip this node during a run without deleting it.',
      },
    ],
    executionBehavior:
      'Sends prompt + references to Google Flow (or ChatGPT) via the bridge. ' +
      'The content script fills the prompt, attaches images, clicks Generate, ' +
      'and polls for completion. Timeout: 8 min for images, 22 min for videos, ' +
      '2 min for text. One auto-retry on transient failures (network, 5xx). ' +
      'If upstream nodes failed, this node is skipped automatically.',
    tips: [
      'Always connect a Prompt node to the T input before running.',
      'For character consistency across shots: generate a character sheet first, ' +
      'then wire its → output to every downstream clip\'s 🖼 input.',
      'Use the enable/disable toggle to skip expensive nodes while iterating on prompts.',
      'Video nodes take 2–10 minutes. Image nodes take 30–90 seconds.',
      'The → output port carries the result as a reference — chain it to the next ' +
      'node\'s 🖼 input for sequential scenes.',
    ],
    constraints: [
      'MUST have a non-empty text connection or the run fails.',
      'Video models cannot use image ratios 4:3 and 3:4.',
      '10s duration only works with Omni 1.1 Flash.',
      'ChatGPT platform cannot produce videos — only images or text.',
      'Each execution costs one generation on the target platform.',
      'If any upstream node failed, this node is automatically skipped.',
    ],
  },

  ask_ai: {
    name: 'Ask AI Node',
    typeKey: 'generate (variant)',
    icon: '💬',
    description:
      'A Generate node preconfigured for ChatGPT text mode. Instead of producing ' +
      'media, it sends a prompt to ChatGPT and captures the WRITTEN REPLY. That ' +
      'reply then flows out of its T (text) output port — feeding it as the prompt ' +
      'for a downstream Generate node. Think of it as "let ChatGPT write the prompt ' +
      'for the next step". Requires a signed-in ChatGPT tab.',
    inputs: [
      {
        handleId: 'text',
        dataType: 'text',
        description:
          'Receives the instruction/brief from a Prompt node. This is what you\'re ' +
          'ASKING ChatGPT to do (e.g. "Write a 10-second video prompt about…").',
        required: true,
      },
    ],
    outputs: [
      {
        handleId: 'text',
        dataType: 'text',
        description:
          'ChatGPT\'s written reply. Connects to a downstream Generate node\'s T input. ' +
          'The reply IS the prompt for the next generation.',
        required: false,
      },
    ],
    settings: [
      {
        field: 'platform',
        type: 'select',
        values: ['chatgpt'],
        default: 'chatgpt',
        description: 'Always ChatGPT — this node type only works with ChatGPT.',
      },
      {
        field: 'mediaType',
        type: 'select',
        values: ['text'],
        default: 'text',
        description: 'Always "text" — the node captures a written answer, not media.',
      },
    ],
    executionBehavior:
      'Sends the input text to the ChatGPT composer, waits for a reply, captures ' +
      'the response text. Timeout: 2 minutes. The reply is stored as a result and ' +
      'passed downstream through the T output port. No image_ref input — text mode ' +
      'has no visual reference concept.',
    tips: [
      'Tell ChatGPT to output ONLY the prompt — no titles, markdown, or explanations. ' +
      'Anything conversational gets rendered as part of the video prompt downstream.',
      'Multiple Ask AI nodes in one workflow run as consecutive ChatGPT turns, so each ' +
      'can say "differ from the previous answers" for variety.',
      'Great for batch content: one brief fans out to 4 Ask AI nodes, each writes a ' +
      'unique prompt, each feeds its own Generate node.',
      'The output is pure text — it connects to T inputs, not 🖼 inputs.',
    ],
    constraints: [
      'Requires a signed-in ChatGPT tab open in the browser.',
      'No image_ref input port — text mode ignores visual references.',
      'Output is text only — connects to T ports, never to 🖼 ports.',
      'Timeout is 2 minutes (much shorter than image/video nodes).',
    ],
  },
};

// ── CONNECTION RULES ──

export const CONNECTION_RULES: ConnectionRule[] = [
  {
    sourceType: 'prompt',
    sourceHandle: 'text',
    targetType: 'generate',
    targetHandle: 'text',
    description: 'Prompt text feeds a Generate node\'s prompt input. The most common connection.',
  },
  {
    sourceType: 'prompt',
    sourceHandle: 'text',
    targetType: 'ask_ai',
    targetHandle: 'text',
    description: 'Prompt text feeds an Ask AI node\'s instruction input.',
  },
  {
    sourceType: 'image',
    sourceHandle: 'image',
    targetType: 'generate',
    targetHandle: 'image_ref',
    description: 'Uploaded reference image feeds a Generate node as a visual ingredient.',
  },
  {
    sourceType: 'generate',
    sourceHandle: 'result',
    targetType: 'generate',
    targetHandle: 'image_ref',
    description:
      'A completed generation\'s result becomes a reference for the next node. ' +
      'This is how you chain shots — the character/scene from Gen₁ anchors Gen₂.',
  },
  {
    sourceType: 'ask_ai',
    sourceHandle: 'text',
    targetType: 'generate',
    targetHandle: 'text',
    description: 'ChatGPT\'s written reply becomes the prompt for a Generate node.',
  },
  {
    sourceType: 'prompt',
    sourceHandle: 'text',
    targetType: 'generate',
    targetHandle: 'text',
    description:
      'Fan-out: one Prompt can connect to multiple Generate nodes (e.g. A/B model ' +
      'comparison, or same prompt through different ratios).',
  },
  {
    sourceType: 'image',
    sourceHandle: 'image',
    targetType: 'generate',
    targetHandle: 'image_ref',
    description:
      'Multi-reference: multiple Image nodes can connect to the same Generate node\'s ' +
      '🖼 port. Flow accepts several ingredients — use IMAGE 01/02/03 in the prompt ' +
      'to assign roles.',
  },
];

// ── WORKFLOW PATTERNS ──

export const WORKFLOW_PATTERNS: WorkflowPattern[] = [
  {
    name: 'Simple Generation',
    description: 'One prompt, one output. The smallest possible workflow.',
    nodeChain: 'Prompt → Generate',
    whenToUse: 'Quick one-off images or videos. Learning the canvas.',
  },
  {
    name: 'Reference-Based Generation',
    description: 'An uploaded image guides the generation alongside a text prompt.',
    nodeChain: 'Image + Prompt → Generate',
    whenToUse:
      'Product photos, face references, outfit try-ons — anywhere the AI needs a ' +
      'visual anchor to match.',
  },
  {
    name: 'Multi-Shot Consistency',
    description:
      'Generate a character sheet first, then fan it out as a reference to multiple ' +
      'downstream video/image nodes. Each downstream prompt includes continuity language.',
    nodeChain: 'Prompt → Generate(sheet) → [Prompt₁ + Gen₁, Prompt₂ + Gen₂, Prompt₃ + Gen₃]',
    whenToUse:
      'Any series where the same character must appear in multiple shots — story ' +
      'sequences, multi-angle coverage, episodic content.',
  },
  {
    name: 'Cross-Platform Pipeline',
    description:
      'Design a character on ChatGPT (better at some styles), then animate it on Flow.',
    nodeChain: 'Prompt → Generate(ChatGPT image) → Prompt₂ + Generate(Flow video)',
    whenToUse:
      'When one platform draws better than the other for your subject. The ChatGPT ' +
      'result becomes the Flow node\'s reference.',
  },
  {
    name: 'AI-Written Prompts',
    description:
      'A brief feeds an Ask AI node, which writes the actual generation prompt. ' +
      'The written text then feeds a Generate node.',
    nodeChain: 'Prompt(brief) → Ask AI → Generate',
    whenToUse:
      'Batch content where each clip should differ. The brief defines the format, ' +
      'ChatGPT varies the specifics. Fan one brief to 4 Ask AI nodes for 4 unique clips.',
  },
  {
    name: 'Sequential Chain',
    description:
      'Each clip\'s result becomes the next clip\'s reference, creating visual continuity ' +
      'across a sequence (e.g. a carving process, a journey).',
    nodeChain: 'Image → Gen₁ → Gen₂ → Gen₃ → … (each with its own Prompt)',
    whenToUse:
      'Process videos (ASMR crafting, cooking, assembly), where each step continues ' +
      'from the last frame of the previous step.',
  },
  {
    name: 'Multi-Reference Composite',
    description:
      'Three or more Image nodes feed one Generate node, each locking a different axis ' +
      '(face, outfit, location). The prompt assigns roles with IMAGE 01/02/03.',
    nodeChain: 'Image₁(face) + Image₂(outfit) + Image₃(scene) + Prompt → Generate',
    whenToUse:
      'Maximum control. Fashion try-ons, UGC ads with a specific model in a specific ' +
      'outfit at a specific location. Prevents the model from trading one reference off ' +
      'against another.',
  },
  {
    name: 'Storyboard → Animation',
    description:
      'Generate a static storyboard sheet from a reference, then animate it as a video.',
    nodeChain: 'Image(style) + Prompt → Generate(storyboard image) → Prompt₂ + Generate(video)',
    whenToUse:
      'Exercise demos, how-to content, any format where approving the poses before ' +
      'spending a video generation saves time and credits.',
  },
];

// ── ANTI-PATTERNS ──

export const ANTI_PATTERNS: AntiPattern[] = [
  {
    mistake: 'Empty prompt on a Generate node',
    why: 'An empty prompt still submits to Flow and burns a generation credit, producing garbage.',
    fix: 'Always connect a non-empty Prompt node to the T input before running.',
  },
  {
    mistake: 'Cycles in the graph',
    why: 'The topological sort throws an error and the workflow refuses to run.',
    fix: 'Ensure the graph is a DAG — data flows left to right, never backwards.',
  },
  {
    mistake: 'Connecting a text port to an image_ref port (or vice versa)',
    why: 'The data types don\'t match. Text sent as an image reference is silently ignored.',
    fix: 'T ports connect to T ports. 🖼 ports connect to 🖼 ports. → (result) connects to 🖼.',
  },
  {
    mistake: 'Missing continuity language in multi-shot workflows',
    why: 'Without explicit "Same character as the reference: identical face, hairstyle, outfit…" the model will reinvent the character in every shot.',
    fix: 'Paste the continuity block into every downstream prompt that references a character sheet.',
  },
  {
    mistake: 'Using a video model for images (or vice versa)',
    why: 'Image models (Nano Banana, Imagen 4) cannot produce video. Video models (Omni 1.1 Flash, Veo) cannot produce stills.',
    fix: 'Match the model to the mediaType. The UI enforces this, but when building programmatically you must check.',
  },
  {
    mistake: 'Setting 10s duration on a non-Omni 1.1 Flash model',
    why: '10-second clips are an Omni 1.1 Flash exclusive. Other models cap at 8s.',
    fix: 'Use Omni 1.1 Flash when you need 10s duration.',
  },
  {
    mistake: 'Using ratios 4:3 or 3:4 for video',
    why: 'Flow video only supports 9:16, 16:9, and 1:1.',
    fix: 'Restrict video nodes to the three supported ratios.',
  },
  {
    mistake: 'Running Ask AI without a ChatGPT tab',
    why: 'The Ask AI node sends text to ChatGPT\'s composer. No tab = immediate failure.',
    fix: 'Ensure a signed-in ChatGPT tab is open before running workflows with Ask AI nodes.',
  },
  {
    mistake: 'Conversational phrasing in Ask AI instructions',
    why: 'ChatGPT\'s reply is used verbatim as the next prompt. If it includes "Sure! Here\'s a prompt:" that text gets sent to Flow as part of the scene.',
    fix: 'Tell ChatGPT: "Output ONLY the prompt — no title, no explanation, no preamble, no quotes, no markdown."',
  },
];

// ── MODEL REFERENCE ──

export const MODEL_REFERENCE: ModelDoc[] = [
  {
    name: 'Nano Banana Pro',
    mediaType: 'image',
    ratios: ['9:16', '16:9', '1:1', '4:3', '3:4'],
    notes: 'Default image model. Fast, good for character sheets and scenes. Supports all 5 ratios.',
  },
  {
    name: 'Nano Banana 2',
    mediaType: 'image',
    ratios: ['9:16', '16:9', '1:1', '4:3', '3:4'],
    notes: 'Alternate image model. Different aesthetic — try A/B comparison.',
  },
  {
    name: 'Imagen 4',
    mediaType: 'image',
    ratios: ['9:16', '16:9', '1:1', '4:3', '3:4'],
    notes: 'Google\'s Imagen 4. High quality photorealistic images.',
  },
  {
    name: 'Omni 1.1 Flash',
    mediaType: 'video',
    ratios: ['9:16', '16:9', '1:1'],
    durations: ['4s', '6s', '8s', '10s'],
    notes: 'Only model supporting 10s clips. Fast generation. Good for long-form sequences.',
  },
  {
    name: 'Veo 3.1 - Lite',
    mediaType: 'video',
    ratios: ['9:16', '16:9', '1:1'],
    durations: ['4s', '6s', '8s'],
    notes: 'Lightweight video. Fastest but lower quality.',
  },
  {
    name: 'Veo 3.1 - Fast',
    mediaType: 'video',
    ratios: ['9:16', '16:9', '1:1'],
    durations: ['4s', '6s', '8s'],
    notes: 'Balanced speed and quality. Good default for most video workflows.',
  },
  {
    name: 'Veo 3.1 - Quality',
    mediaType: 'video',
    ratios: ['9:16', '16:9', '1:1'],
    durations: ['4s', '6s', '8s'],
    notes: 'Highest quality video. Slower generation. Use for hero shots and final renders.',
  },
  {
    name: 'Veo 3.1 - Lite [Lower Priority]',
    mediaType: 'video',
    ratios: ['9:16', '16:9', '1:1'],
    durations: ['4s', '6s', '8s'],
    notes: 'Same as Lite but queued at lower priority. Use when you\'re not in a rush.',
  },
];

// ── MASTER PROMPT BUILDER ──

/**
 * Assemble all documentation into a single LLM-ready system prompt.
 *
 * Call this and inject the returned string into any AI context that needs to
 * understand, build, or modify Studio workflows.
 */
export function buildMasterPrompt(): string {
  const sections: string[] = [];

  // ── Header ──
  sections.push(
    '# AutoFlow Studio — Workflow Node Reference\n\n' +
    'You are an AI agent that builds visual node-based workflows for AutoFlow Studio. ' +
    'Below is the complete reference for every node type, port, setting, connection rule, ' +
    'workflow pattern, and anti-pattern. Use this to generate accurate, runnable workflows.\n'
  );

  // ── Node Types ──
  sections.push('## Node Types\n');
  for (const [key, doc] of Object.entries(NODE_DOCS)) {
    sections.push(`### ${doc.icon} ${doc.name} (type: "${key}")\n`);
    sections.push(`${doc.description}\n`);

    if (doc.inputs.length) {
      sections.push('**Inputs:**');
      for (const p of doc.inputs) {
        sections.push(`- \`${p.handleId}\` (${p.dataType})${p.required ? ' [REQUIRED]' : ''}: ${p.description}`);
      }
      sections.push('');
    }

    if (doc.outputs.length) {
      sections.push('**Outputs:**');
      for (const p of doc.outputs) {
        sections.push(`- \`${p.handleId}\` (${p.dataType}): ${p.description}`);
      }
      sections.push('');
    }

    if (doc.settings.length) {
      sections.push('**Settings:**');
      for (const s of doc.settings) {
        const vals = s.values ? ` Options: ${s.values.join(', ')}.` : '';
        sections.push(`- \`${s.field}\` (default: "${s.default}"):${vals} ${s.description}`);
      }
      sections.push('');
    }

    sections.push(`**Execution:** ${doc.executionBehavior}\n`);

    sections.push('**Tips:**');
    for (const t of doc.tips) sections.push(`- ${t}`);
    sections.push('');

    sections.push('**Constraints:**');
    for (const c of doc.constraints) sections.push(`- ${c}`);
    sections.push('\n---\n');
  }

  // ── Connection Rules ──
  sections.push('## Connection Rules\n');
  sections.push('| Source | Port | → Target | Port | What flows |');
  sections.push('|--------|------|----------|------|------------|');
  for (const r of CONNECTION_RULES) {
    sections.push(`| ${r.sourceType} | ${r.sourceHandle} | ${r.targetType} | ${r.targetHandle} | ${r.description} |`);
  }
  sections.push('');

  // ── Workflow Patterns ──
  sections.push('## Workflow Patterns\n');
  for (const p of WORKFLOW_PATTERNS) {
    sections.push(`### ${p.name}`);
    sections.push(`**Chain:** ${p.nodeChain}`);
    sections.push(`**Description:** ${p.description}`);
    sections.push(`**When to use:** ${p.whenToUse}\n`);
  }

  // ── Anti-Patterns ──
  sections.push('## Anti-Patterns (Common Mistakes)\n');
  for (const a of ANTI_PATTERNS) {
    sections.push(`### ❌ ${a.mistake}`);
    sections.push(`**Why it fails:** ${a.why}`);
    sections.push(`**Fix:** ${a.fix}\n`);
  }

  // ── Model Reference ──
  sections.push('## Model Reference\n');
  sections.push('| Model | Type | Ratios | Durations | Notes |');
  sections.push('|-------|------|--------|-----------|-------|');
  for (const m of MODEL_REFERENCE) {
    sections.push(
      `| ${m.name} | ${m.mediaType} | ${m.ratios.join(', ')} | ${m.durations?.join(', ') || 'N/A'} | ${m.notes} |`
    );
  }
  sections.push('');

  // ── Execution Order ──
  sections.push(
    '## Execution Order\n\n' +
    'Nodes run in **topological order** (Kahn\'s algorithm). Dependencies first:\n' +
    '1. All Prompt and Image nodes are resolved first (they just hold data)\n' +
    '2. Generate/Ask AI nodes run sequentially in dependency order\n' +
    '3. If a node fails, all its downstream dependents are skipped automatically\n' +
    '4. Independent branches run in sequence (not parallel)\n' +
    '5. Disabled nodes (enabled=false) are skipped without failing dependents\n'
  );

  // ── Continuity Template ──
  sections.push(
    '## Continuity Language Template\n\n' +
    'For multi-shot character consistency, include this in every downstream prompt:\n\n' +
    '> Same character as the reference: identical face, hairstyle, outfit, body ' +
    'proportions, colour palette and art style. Do not restyle or reset the character.\n'
  );

  return sections.join('\n');
}
