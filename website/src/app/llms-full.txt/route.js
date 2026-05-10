import { getDictionary, defaultLocale } from '../dictionaries';

export const dynamic = 'force-static';

export async function GET() {
  const t = getDictionary(defaultLocale);

  const content = `# AutoFlow - Full Documentation

> Automate Google Flow AI Video Generation | Batch Prompts & Queue Manager

## 1. What is AutoFlow?
AutoFlow Chrome extension automates Google Flow video generation. Paste your prompts, hit run, and walk away. AutoFlow handles the clicking, waiting, retrying, and downloading — so you can focus on creating.

## 2. Features
- **Batch Prompt Processing:** Stop copy-pasting prompts one by one. Paste your entire script — 5, 50, or 500 prompts — into the editor. AutoFlow instantly parses each block into a separate task, ready to queue. Supports text-to-video, image-to-video, frame-to-video, and ingredients mode.
- **Reference Image Mapping:** Attach reference images to your prompts for image-to-video generation. Use shared images, per-prompt images, or automatic character matching.
- **Smart Queue Management:** Create multiple queues with different configs (model, orientation, generations, timing, download quality).
- **Live Run Monitor:** Watch AutoFlow work in real time. Pause, resume, skip a prompt, or force retry whenever you want.
- **Library Scanner & Batch Download:** Scan your Flow project to see all videos and images grouped by prompt. Select favorites, batch download in 720p, 1080p, or 4K.
- **Fully Configurable:** Choose your video model (Veo 3.1 Fast, Veo 3, etc.), set auto-download, and enable typing mode for natural input pacing.

## 3. Pricing
${t.pricing.free.name}: ${t.pricing.free.price}
- Features: ${t.pricing.free.features.join(', ')}

${t.pricing.pro.name}: ${t.pricing.pro.price}
- Features: ${t.pricing.pro.features.join(', ')}

## 4. FAQ
${t.faq.items.map(q => `### ${q.q}\n${q.a}`).join('\n\n')}

## 5. Prompt Library (Best Prompts for Google Flow AI)
${t.promptsPage.subtitle}

${t.promptsPage.prompts.map(p => `### ${p.title} (Category: ${t.promptsPage.categories[p.category] || p.category})\n\`\`\`text\n${p.text}\n\`\`\``).join('\n\n')}
`;

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
