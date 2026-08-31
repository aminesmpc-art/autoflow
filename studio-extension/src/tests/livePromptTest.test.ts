import { buildSpec } from '../studio/builder/spec';
import { buildFromReply } from '../studio/builder/plan';

describe('Big Story Master Prompt & Compilation Test', () => {
  it('handles an epic multi-shot sci-fi story workflow with character locking, last-frame handoffs, and platform orchestration', () => {
    const bigStoryIdea = `An epic 5-shot sci-fi short film called "The Beacon of Europa":
1. Concept Still (Character Turnaround): Commander Maya in a white & copper pressurized suit with a cracked visor revealing intense dark eyes, braided black hair, and an orange emergency beacon on her shoulder.
2. Shot 1 (Wide Establishing): Maya standing on the frozen surface of Jupiter's moon Europa with giant Jupiter looming in the background, holding the glowing beacon.
3. Shot 2 (Medium Tracking): Maya trekking through a stormy crystalline ice canyon, icy wind blowing frost across her suit, beacon blinking rapidly.
4. Shot 3 (Close-up Action): Continuing from Shot 2's last frame, Maya kneels at an abyss edge and plugs the beacon into an ancient alien monolith.
5. Shot 4 (Epic Finale): Slow pull-back and crane up into space as the monolith fires a massive cyan beam through the ice sheet toward Jupiter.`;

    // 1. Generate the master prompt
    const masterPrompt = buildSpec(bigStoryIdea);

    // 2. Realistic AI Response adhering to all master prompt rules
    const bigStoryAiResponse = `
\`\`\`json
{
  "thinking": {
    "shots": [
      "1. Character Concept Sheet: Commander Maya in white & copper pressure suit (grok image, 16:9)",
      "2. Shot 1 (Wide): Maya on the icy plains of Europa with Jupiter rising (flow video, 6s, 16:9)",
      "3. Shot 2 (Medium): Maya trekking through the crystalline ice canyon (flow video, 6s, 16:9)",
      "4. Shot 3 (Close-up): Kneeling at the abyss, plugging the beacon into the monolith (flow video, 6s, 16:9, continuing from Shot 2 last frame)",
      "5. Shot 4 (Finale): Monumental crane-up reveal as cyan beam shoots toward Jupiter (flow video, 8s, 16:9, continuing from Shot 3 last frame)"
    ],
    "continuity": "The Grok character turnaround sheet anchors the visual identity (white & copper suit, cracked visor, orange beacon, dark eyes). It feeds Shot 1 and Shot 2 as a reference. Shot 3 chains directly off Shot 2 via a frame node so Maya's physical pose and canyon location remain perfectly seamless. Shot 4 chains off Shot 3's last frame so the beacon is already plugged into the monolith when the beam ignites.",
    "platforms": "Grok for the character turnaround still (ultra-sharp details on textures and visor). Google Flow for all 4 cinematic video shots (smooth atmospheric blizzard, camera tracking, and massive scale lighting effects).",
    "risks": "Character appearance and suit details drifting across the trek and abyss scenes. Solved by feeding the character turnaround still to Shot 1 & Shot 2, and using frame nodes for sequential continuity between Shots 2, 3, and 4."
  },
  "name": "The Beacon of Europa — 5-Shot Sci-Fi Story",
  "description": "An epic cinematic sci-fi sequence tracking Commander Maya activating an alien monolith on Jupiter's moon Europa.",
  "steps": [
    {
      "id": "maya_sheet",
      "type": "generate",
      "media": "image",
      "platform": "grok",
      "label": "Character Sheet",
      "prompt": "Character concept art turnaround of Commander Maya: white and weathered copper pressurized EVA suit, cracked gold-tinted helmet visor showing dark intense eyes, braided black hair, glowing orange emergency beacon mounted on her left shoulder. Neutral dark sci-fi background, sharp cinematic lighting, photorealistic 8K render.",
      "aspectRatio": "16:9"
    },
    {
      "id": "shot1_establishing",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Shot 1 — Europa Plains",
      "prompt": "Wide establishing shot: Commander Maya in her white and copper EVA suit stands alone on the cracked ice plains of Europa. In the dark sky above, the giant banded sphere of Jupiter rises majestically. Low camera slowly pans right, orange shoulder beacon pulsing in the cold alien atmosphere.",
      "inputs": ["maya_sheet"],
      "aspectRatio": "16:9",
      "duration": "6s"
    },
    {
      "id": "shot2_canyon_trek",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Shot 2 — Canyon Trek",
      "prompt": "Medium tracking shot: Commander Maya treks through a towering crystalline blue ice canyon during an intense blizzard. Frost whips across her white and copper suit and cracked visor. The camera tracks alongside her steady steps, orange beacon blinking rhythmically against the icy walls.",
      "inputs": ["maya_sheet"],
      "aspectRatio": "16:9",
      "duration": "6s"
    },
    {
      "id": "shot2_handoff",
      "type": "frame",
      "label": "Canyon End Frame",
      "inputs": ["shot2_canyon_trek"]
    },
    {
      "id": "shot3_monolith_action",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Shot 3 — Monolith Plug-in",
      "prompt": "Continuing seamlessly from this exact frame: Commander Maya drops to one knee at the edge of the dark ice abyss. In a deliberate motion, she unlatches the orange beacon and slots it into the socket of a towering obsidian alien monolith. The monolith instantly pulses with humming cyan light channels.",
      "inputs": ["shot2_handoff"],
      "aspectRatio": "16:9",
      "duration": "6s"
    },
    {
      "id": "shot3_handoff",
      "type": "frame",
      "label": "Activation End Frame",
      "inputs": ["shot3_monolith_action"]
    },
    {
      "id": "shot4_finale_beam",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Shot 4 — Cosmic Finale",
      "prompt": "Continuing from this activated monolith frame: extreme slow crane-up and pull-back into space. A monumental vertical pillar of blinding cyan energy erupts from the monolith, tearing through Europa's ice clouds and shooting up into the black cosmos toward giant Jupiter. Cinematic IMAX sci-fi finale.",
      "inputs": ["shot3_handoff"],
      "aspectRatio": "16:9",
      "duration": "8s"
    }
  ]
}
\`\`\`
`;

    // 3. Compile the plan into a Studio Workflow Template
    const { template, problems } = buildFromReply(bigStoryAiResponse);

    console.log('=== COMPILED BIG STORY WORKFLOW ===');
    console.log('Title:', template?.name);
    console.log('Description:', template?.description);
    console.log('Total Nodes:', template?.nodes.length);
    console.log('Total Edges:', template?.edges.length);
    console.log('Validation Problems:', problems);

    expect(problems).toEqual([]);
    expect(template).not.toBeNull();
    expect(template!.nodes.length).toBe(12); // 5 generate nodes + 5 prompt nodes + 2 frame nodes
    expect(template!.edges.length).toBe(11); // 5 text edges + 2 character sheet refs + 2 frame clip inputs + 2 frame still outputs
  });

  it('compiles a dynamic workflow driven by a Story Director node', () => {
    const storyDirectorResponse = `
\`\`\`json
{
  "thinking": {
    "shots": [
      "1. Story Director orchestrating a 3-act episodic series",
      "2. Act 1 (Hook), Act 2 (Transformation), Act 3 (Climax)"
    ],
    "continuity": "Story node controls cast identity (Commander Maya), setting (Europa), and visual rules. It dynamically writes prompts for all 3 shots at runtime.",
    "platforms": "ChatGPT for the Story director; Flow for rendering the 3 video clips.",
    "risks": "Prompt divergence across episodes. Story node rules enforce 'samePerson' and 'cumulative' constraints across all generated prompts."
  },
  "name": "Europa Chronicles — Dynamic Story Template",
  "description": "A dynamic 3-shot narrative template orchestrated by an AI Story Director.",
  "steps": [
    {
      "id": "director",
      "type": "story",
      "platform": "chatgpt",
      "label": "Series Director",
      "prompt": "An astronaut discovers an ancient alien signal beneath the ice of Europa.",
      "cast": [{ "name": "Commander Maya", "look": "White EVA suit, cracked gold visor, dark intense eyes" }],
      "world": "Frozen subterranean caverns of Europa beneath Jupiter",
      "look": "Cinematic sci-fi, moody volumetric lighting, anamorphic lens",
      "structure": "hook",
      "rules": ["samePerson", "cumulative"]
    },
    {
      "id": "act1",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Act 1 — Discovery",
      "inputs": ["director"],
      "aspectRatio": "16:9",
      "duration": "6s"
    },
    {
      "id": "act2",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Act 2 — Decryption",
      "inputs": ["director"],
      "aspectRatio": "16:9",
      "duration": "6s"
    },
    {
      "id": "act3",
      "type": "generate",
      "media": "video",
      "platform": "flow",
      "label": "Act 3 — Transmission",
      "inputs": ["director"],
      "aspectRatio": "16:9",
      "duration": "8s"
    }
  ]
}
\`\`\`
`;

    const { template, problems } = buildFromReply(storyDirectorResponse);
    console.log('=== COMPILED STORY DIRECTOR WORKFLOW ===');
    console.log('Template Name:', template?.name);
    console.log('Node Count:', template?.nodes.length);
    console.log('Edge Count:', template?.edges.length);
    console.log('Problems:', problems);

    expect(problems).toEqual([]);
    expect(template).not.toBeNull();
    // 1 story node + 1 brief prompt node + 3 generate video nodes = 5 nodes
    expect(template!.nodes.length).toBe(5);
    expect(template!.nodes.some((n: any) => n.type === 'story')).toBe(true);
    // 1 text edge into story + 3 text edges from story to act1, act2, act3 = 4 edges
    expect(template!.edges.length).toBe(4);
    const storyToActs = template!.edges.filter((e: any) => e.source === 'director');
    expect(storyToActs.length).toBe(3);
    for (const edge of storyToActs) {
      expect(edge.sourceHandle).toBe('text');
      expect(edge.targetHandle).toBe('text');
    }
  });
});
