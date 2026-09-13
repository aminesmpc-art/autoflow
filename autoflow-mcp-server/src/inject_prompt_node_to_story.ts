import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

async function fixAndRun() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, 'index.js')],
  });

  const client = new Client({ name: 'direct-fixer', version: '1.1.0' }, { capabilities: {} });
  await client.connect(transport);

  // 1. Get canvas state
  const canvasRes = await client.callTool({ name: 'studio_get_canvas', arguments: {} });
  const canvas = JSON.parse(((canvasRes as any).content[0] as any)?.text);
  const storyNode = canvas.nodes?.find((n: any) => n.type === 'story' || n.data?.type === 'story');

  if (storyNode) {
    console.log(`🎯 Found Story Director node: ${storyNode.id}`);

    // Add a Story Brief prompt node to the left of the Story Director
    console.log('➕ Adding Story Brief Idea Prompt Node...');
    const addRes = await client.callTool({
      name: 'studio_add_node',
      arguments: {
        type: 'prompt',
        label: 'Story Brief (Idea)',
        position: { x: (storyNode.position?.x || 100) - 380, y: storyNode.position?.y || 150 },
        data: {
          type: 'prompt',
          label: 'Story Brief (Idea)',
          text: 'An adorable thumb-sized baby cinder drake named Emberlyn with shimmering ruby scales trying to toast a tiny marshmallow, getting cute hiccups, and giggling with sparkling embers.',
          status: 'idle',
        },
      },
    });
    const addText = ((addRes as any).content[0] as any)?.text || '';
    const newPromptId = addText.match(/node "([^"]+)"/)?.[1] || '';
    console.log(`   Created Prompt Node: ${newPromptId}`);

    // Connect Prompt text -> Story Director text
    console.log('🔗 Wiring Cable: Prompt.text ➔ Story Director.text...');
    await client.callTool({
      name: 'studio_connect_nodes',
      arguments: {
        source: newPromptId,
        target: storyNode.id,
        sourceHandle: 'text',
        targetHandle: 'text',
      },
    });

    // Reset all nodes from error back to idle
    console.log('🩹 Resetting all node error statuses to idle...');
    for (const n of canvas.nodes) {
      await client.callTool({
        name: 'studio_modify_prompt',
        arguments: {
          nodeId: n.id,
          prompt: n.data?.prompt || 'Shot visual sequence.',
        },
      });
      // Clear error on node
      const currentData = n.data || {};
      delete currentData.errorMessage;
      delete currentData.statusNote;
      currentData.status = 'idle';
    }
  }

  // Auto-Fix
  await client.callTool({ name: 'studio_auto_fix_canvas', arguments: {} });

  console.log('\n🚀 Starting Pipeline Execution...');
  const runRes = await client.callTool({ name: 'studio_run_pipeline', arguments: {} });
  console.log(((runRes as any).content[0] as any)?.text);

  console.log('\n====================================================');
  console.log('🎉 STORY BRIEF ATTACHED & RUN TRIGGERED!');
  console.log('====================================================\n');

  process.exit(0);
}

fixAndRun().catch(console.error);
