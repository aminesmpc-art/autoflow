/* ============================================================
   Story Director Deep Inspector
   Reads the full Story Director configuration, written shot plans,
   cast details, and generation prompts from the active canvas.
   ============================================================ */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function inspectStory() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client(
    { name: 'story-inspector', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);

  // 1. Get full canvas
  const canvasRes = await client.callTool({
    name: 'studio_get_canvas',
    arguments: {},
  });

  const canvasData = JSON.parse(((canvasRes as any).content[0] as any)?.text || '{}');
  const nodes = canvasData.nodes || [];
  const edges = canvasData.edges || [];

  console.log('====================================================');
  console.log(`🎬 WORKFLOW: "${canvasData.workflow?.name || 'Untitled'}"`);
  console.log(`📊 TOTAL NODES: ${nodes.length} | EDGES: ${edges.length}`);
  console.log('====================================================\n');

  // Find Story Director Node
  const storyNode = nodes.find((n: any) => n.type === 'story' || n.data?.type === 'story');
  if (storyNode) {
    console.log('🎭 STORY DIRECTOR CONFIGURATION:');
    console.log('----------------------------------------------------');
    console.log(`• Label: ${storyNode.data?.label || storyNode.id}`);
    console.log(`• Brief / Concept: "${storyNode.data?.brief || storyNode.data?.story || 'None'}"`);
    console.log(`• Structure: ${storyNode.data?.structure || 'hook'}`);
    console.log(`• Camera Progression: ${storyNode.data?.cameraProgression || storyNode.data?.camera || 'dynamic'}`);
    console.log(`• Audio Mode: ${storyNode.data?.audioMode || 'ambient'}`);
    console.log(`• Visual Preset: ${storyNode.data?.visualPreset || 'none'}`);
    console.log(`• Avoid / Negative Guardrails: "${storyNode.data?.avoid || 'None'}"`);

    if (storyNode.data?.cast && Array.isArray(storyNode.data.cast)) {
      console.log('\n👥 CAST & IDENTITY LOCK:');
      storyNode.data.cast.forEach((c: any, idx: number) => {
        console.log(`  [Character ${idx + 1}] ${c.name || 'Unnamed'}:`);
        console.log(`    - Invariant Look: "${c.look || ''}"`);
        console.log(`    - Voice: ${c.voice || 'None'}`);
        console.log(`    - Blocking/Role: ${c.role || 'lead'}`);
      });
    }

    if (storyNode.data?.shotTitles || storyNode.data?.shotPrompts) {
      console.log('\n📜 WRITTEN SHOT SEQUENCE PLANS:');
      const titles = storyNode.data?.shotTitles || [];
      const prompts = storyNode.data?.shotPrompts || [];
      titles.forEach((title: string, i: number) => {
        console.log(`  🎬 Shot ${i + 1}: ${title}`);
        console.log(`     Prompt: "${prompts[i] || 'Pending generation...'}"`);
      });
    }
  } else {
    console.log('⚠️ No Story Director node found on canvas.');
  }

  // List all Generate and Frame Nodes
  console.log('\n⚡ GENERATE & SHOT NODES ON CANVAS:');
  console.log('----------------------------------------------------');
  const genNodes = nodes.filter((n: any) => n.type === 'generate' || n.data?.type === 'generate');
  genNodes.forEach((gn: any, idx: number) => {
    console.log(`\n[Shot Node ${idx + 1}] ID: ${gn.id} | Label: "${gn.data?.label || 'Unnamed'}"`);
    console.log(`  • Platform: ${gn.data?.platform || 'flow'} | Media: ${gn.data?.media || gn.data?.mediaType || 'video'} | Model: ${gn.data?.model || 'Omni Flash'}`);
    console.log(`  • Status: ${gn.data?.status || 'idle'} ${gn.data?.statusNote ? `(${gn.data.statusNote})` : ''}`);
    console.log(`  • Aspect Ratio: ${gn.data?.aspectRatio || '9:16'} | Length: ${gn.data?.duration || gn.data?.length || '4s'}`);
    console.log(`  • Prompt: "${gn.data?.prompt || gn.data?.resultText || 'Empty'}"`);
    if (gn.data?.errorMessage) console.log(`  ❌ Error: ${gn.data.errorMessage}`);
    if (gn.data?.resultUrl) console.log(`  🔗 Output URL: ${gn.data.resultUrl}`);
  });

  process.exit(0);
}

inspectStory().catch((err) => {
  console.error('Inspection error:', err);
  process.exit(1);
});
