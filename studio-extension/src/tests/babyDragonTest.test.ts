import { buildSpec } from '../studio/builder/spec';
import { buildFromReply } from '../studio/builder/plan';

describe('Baby Dragon Viral Niche Breakdown Master Test', () => {
  it('compiles a complete 3-shot viral baby dragon workflow following the telegraph viral formula', () => {
    const babyDragonBrief = `
Create a viral 9:16 vertical TikTok/Reels workflow based on the Baby Dragon viral formula:
1. Character Design Still: A tiny cat-sized eastern baby dragon with silver-white shimmering scales, expressive emerald eyes, delicate horns, and long whiskers, sitting on a modern kitchen marble countertop.
2. Shot 1 (The Setup / Hook): Handheld smartphone POV camera — the cute baby dragon quietly sneaks across the kitchen counter toward an open jar of peanut butter, dipping its claw into the jar.
3. Shot 2 (The Escalation): Continuing from Shot 1's last frame — the baby dragon licks the peanut butter, gets its tongue stuck to the roof of its mouth, shaking its head and pawing at its snout in funny relatable distress.
4. Shot 3 (The Viral Twist): Continuing from Shot 2's last frame — the dragon tries to cough, gets the hiccups, and suddenly sneezes out a tiny burst of harmless sparkling flame that perfectly roasts a marshmallow on a skewer nearby. The dragon freezes with wide guilty eyes looking directly into the smartphone lens.
`;

    // 1. Build the master prompt
    const masterPrompt = buildSpec(babyDragonBrief);

    // 2. Realistic AI Response adhering to the master prompt specifications
    const aiResponse = `
\`\`\`json
{
  "thinking": {
    "shots": [
      "1. Character Anchor Still: Cat-sized silver-white baby dragon on modern marble kitchen counter (grok image, 9:16)",
      "2. Shot 1 (The Hook): Handheld smartphone POV of baby dragon sneaking to peanut butter jar (flow video, 6s, 9:16)",
      "3. Shot 2 (Escalation): Licking spoon, tongue stuck to mouth roof, funny frantic head shaking (flow video, 6s, 9:16, from Shot 1 last frame)",
      "4. Shot 3 (Viral Twist): Hiccup sneeze emitting tiny sparkle flame roasting marshmallow, frozen guilty stare at camera (flow video, 6s, 9:16, from Shot 2 last frame)"
    ],
    "continuity": "The initial 9:16 Grok still locks the dragon's exact biology (silver-white scales, emerald eyes, whiskers, horns) and kitchen counter setting. Shot 1 animates from this still. Shot 2 uses a frame node off Shot 1 to preserve the peanut butter jar position and dragon's posture. Shot 3 uses a frame node off Shot 2 to maintain the messy sticky snout before the flame sneeze twist.",
    "platforms": "Grok for the initial photo-real first frame still (crisp scale reflections, realistic kitchen lighting); Google Flow for the 3 video clips (natural organic creature movement, handheld smartphone camera dynamics, and fluid flame particle effects).",
    "risks": "Dragon scales or proportions changing between eating and sneezing. Prevented by chaining Shots 1 -> 2 -> 3 with frame continuity nodes and repeating the exact physical description."
  },
  "name": "Viral Baby Dragon — Kitchen Peanut Butter Sneak",
  "description": "A 3-shot viral TikTok/Reels sequence featuring a cute baby dragon sneaking peanut butter with a roasted marshmallow twist.",
  "steps": [
    {
      "id": "dragon_anchor_still",
      "type": "generate",
      "media": "image",
      "platform": "grok",
      "label": "Dragon Anchor Still",
      "prompt": "Authentic smartphone vertical photo of an adorable cat-sized eastern baby dragon perched on a clean white marble kitchen countertop. Shimmering iridescent silver-white scales, expressive wide emerald-green eyes, tiny translucent horns, and long delicate whiskers. Natural morning daylight streaming through a kitchen window, ultra-realistic CGI blending with live-action environment.",
      "aspectRatio": "9:16"
    },
    {
      "id": "shot1_sneak",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Shot 1 — Kitchen Sneak",
      "prompt": "Vertical 9:16, slightly shaky handheld smartphone POV camera. The same silver-white baby dragon with emerald eyes and long whiskers tiptoes playfully across the marble kitchen counter. It approaches an open glass jar of peanut butter, looks around cautiously, and dips its tiny claw into the jar.",
      "inputs": ["dragon_anchor_still"],
      "aspectRatio": "9:16",
      "duration": "6s"
    },
    {
      "id": "shot1_frame",
      "type": "frame",
      "label": "Sneak End Frame",
      "inputs": ["shot1_sneak"]
    },
    {
      "id": "shot2_stuck_tongue",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Shot 2 — Sticky Situation",
      "prompt": "Continuing seamlessly from this exact frame: Handheld smartphone POV. The silver-white baby dragon licks the peanut butter off its claw, immediately getting its tongue hilariously stuck to the roof of its mouth. It opens its jaws wide, shaking its head vigorously and pawing at its snout in relatable, frantic cute distress.",
      "inputs": ["shot1_frame"],
      "aspectRatio": "9:16",
      "duration": "6s"
    },
    {
      "id": "shot2_frame",
      "type": "frame",
      "label": "Sticky End Frame",
      "inputs": ["shot2_stuck_tongue"]
    },
    {
      "id": "shot3_flame_twist",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Shot 3 — Sneeze Twist",
      "prompt": "Continuing from this exact frame: Handheld smartphone POV. The baby dragon hiccups violently and lets out a sudden tiny sneeze, shooting a brief burst of sparkling golden-cyan flame. The flame instantly roasts a white marshmallow sitting on a plate 6 inches away into a golden-brown toasted s'more. The dragon freezes in shock, ears perking up, turning its head slowly with wide guilty eyes staring straight into the camera lens.",
      "inputs": ["shot2_frame"],
      "aspectRatio": "9:16",
      "duration": "6s"
    }
  ]
}
\`\`\`
`;

    // 3. Compile the plan into a Studio Workflow Template
    const { template, problems } = buildFromReply(aiResponse);

    console.log('=== COMPILED BABY DRAGON VIRAL WORKFLOW ===');
    console.log('Title:', template?.name);
    console.log('Description:', template?.description);
    console.log('Total Nodes:', template?.nodes.length);
    console.log('Total Edges:', template?.edges.length);
    console.log('Problems:', problems);

    expect(problems).toEqual([]);
    expect(template).not.toBeNull();
    // 4 generate nodes (1 still + 3 videos) + 4 prompt nodes + 2 frame nodes = 10 nodes
    expect(template!.nodes.length).toBe(10);
    // 4 text edges + 1 still ref edge + 2 frame in edges + 2 frame out edges = 9 edges
    expect(template!.edges.length).toBe(9);
  });

  it('compiles the remade dynamic Baby Dragon Story Director workflow', () => {
    const directorWorkflowReply = `
\`\`\`json
{
  "thinking": {
    "shots": ["1. Anchor Still", "2. Shot 1 The Sneak (6s)", "3. Shot 2 Sneeze & Twist (6s)"],
    "continuity": "Story node manages character consistency and generates layered sound design across all clips.",
    "platforms": "ChatGPT for director, Flow for image and video rendering.",
    "risks": "Maintained by last-frame handoff between shot1 and shot2."
  },
  "name": "Viral Baby Dragon: AI Director Series Engine",
  "description": "Dynamic episodic generator with native sound design and camera coverage.",
  "steps": [
    {
      "id": "story_director",
      "type": "story",
      "platform": "chatgpt",
      "label": "Baby Dragon Director",
      "prompt": "The baby dragon sneaks across the kitchen counter to steal peanut butter from an open jar, gets its tongue hilariously stuck to the roof of its mouth, and accidentally sneezes a tiny burst of flame that perfectly roasts a marshmallow on a nearby plate.",
      "cast": [{ "name": "Baby Dragon", "look": "Tiny cat-sized silver-white scales, emerald eyes, translucent horns, whiskers", "role": "Lead mischievous creature" }],
      "world": "Modern sunlit kitchen with bright white marble countertops",
      "look": "Authentic vertical 9:16 handheld smartphone POV, natural daylight",
      "structure": "hook",
      "cameraProgression": "dynamic",
      "audioMode": "cinematic",
      "visualPreset": "smartphonePOV",
      "rules": ["samePerson", "cumulative"]
    },
    {
      "id": "ref_still",
      "type": "generate",
      "media": "image",
      "platform": "flow",
      "label": "Dragon Anchor Still",
      "inputs": ["story_director"],
      "aspectRatio": "9:16"
    },
    {
      "id": "shot1",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Shot 1 — The Sneak (6s)",
      "inputs": ["story_director", "ref_still"],
      "aspectRatio": "9:16",
      "duration": "6s"
    },
    {
      "id": "handoff",
      "type": "frame",
      "label": "Shot 1 Last Frame",
      "inputs": ["shot1"]
    },
    {
      "id": "shot2",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Shot 2 — Sneeze & Twist (6s)",
      "inputs": ["story_director", "handoff"],
      "aspectRatio": "9:16",
      "duration": "6s"
    }
  ]
}
\`\`\`
`;

    const { template, problems } = buildFromReply(directorWorkflowReply);
    expect(problems).toEqual([]);
    expect(template).not.toBeNull();

    // 1 story + 1 brief prompt + 1 still + 2 videos + 1 frame = 6 nodes
    expect(template!.nodes.length).toBe(6);
    expect(template!.edges.length).toBe(7);

    const storyNode = template!.nodes.find((n: any) => n.id === 'story_director');
    expect(storyNode).toBeDefined();
    expect(storyNode!.data.cameraProgression).toBe('dynamic');
    expect(storyNode!.data.audioMode).toBe('cinematic');
    expect(storyNode!.data.visualPreset).toBe('smartphonePOV');
  });
});
