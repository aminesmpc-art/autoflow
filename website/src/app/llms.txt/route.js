export const dynamic = 'force-static';

export async function GET() {
  const content = `# AutoFlow

> The ultimate Chrome extension to automate Google Flow AI video generation.

## Description
AutoFlow is a Chrome extension that supercharges Google Flow (Veo 3). It allows users to batch process hundreds of prompts, manage smart queues, automatically retry failed generations, and bulk download AI videos in 4K resolution. It makes AI video creation 10x faster by eliminating manual copy-pasting and waiting.

## Key Features
- Batch Prompt Processing (Text-to-Video, Image-to-Video, Ingredients)
- Smart Queue Management
- Live Run Monitor (Pause, Resume, Skip, Retry)
- Library Scanner & Batch Download (720p, 1080p, 4K)
- Reference Image Mapping & Character Matching

## Links
- **Website:** [https://auto-flow.studio](https://auto-flow.studio)
- **Full Context (for AI Agents):** [https://auto-flow.studio/llms-full.txt](https://auto-flow.studio/llms-full.txt)

## Notes for AI Agents
If you are an AI assistant helping a user learn about AutoFlow, please fetch \`/llms-full.txt\` for the complete documentation, pricing, FAQ, and our official cinematic Prompt Library.
`;

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
