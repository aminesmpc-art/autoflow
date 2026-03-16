/* ============================================================
   AutoFlow Website — Content Dictionary (English Only)
   ============================================================ */

export const locales = ['en'];
export const defaultLocale = 'en';

const dictionaries = {
  en: {
    meta: {
      title: 'AutoFlow — Automate Google Flow AI Video Generation',
      description: 'AutoFlow Chrome extension automates Google Flow video generation. Batch process hundreds of prompts, smart queue management, auto-retry failures, bulk download in 4K.',
    },
    nav: {
      features: 'Features',
      howItWorks: 'How It Works',
      pricing: 'Pricing',
      faq: 'FAQ',
      install: 'Install Free',
    },
    hero: {
      badge: 'Chrome Extension for Google Flow',
      titleLine1: 'AI Video Generation',
      titleLine2: 'on Autopilot',
      subtitle: "Paste your prompts, hit run, and walk away. AutoFlow handles the clicking, waiting, retrying, and downloading — so you can focus on creating.",
      installBtn: "Install Free — It's Fast",
      featuresBtn: 'See Features →',
    },
    features: {
      badge: 'Features',
      title: 'Everything You Need to',
      titleGradient: 'Generate at Scale',
      subtitle: 'AutoFlow supercharges Google Flow with powerful automation — from prompt to download.',
      items: [
        {
          tag: 'Create',
          title: 'Batch Prompt Processing',
          desc: 'Stop copy-pasting prompts one by one. Paste your entire script — 5, 50, or 500 prompts — into the editor. AutoFlow instantly parses each block into a separate task, ready to queue. Supports text-to-video, image-to-video, frame-to-video, and ingredients mode.',
          bullets: [
            'Paste all prompts at once — separated by blank lines',
            'Auto-detects scene numbers and formats',
            'Supports every Google Flow creation mode',
          ],
        },
        {
          tag: 'Images',
          title: 'Reference Image Mapping',
          desc: 'Attach reference images to your prompts for image-to-video generation. Use shared images (applied to every prompt), per-prompt images, or automatic character matching — upload a character sheet and AutoFlow maps the right face to each scene.',
          bullets: [
            'Shared references attached to every prompt',
            'Character image auto-matching by name',
            'Per-prompt image selection (up to 10 each)',
          ],
        },
        {
          tag: 'Queues',
          title: 'Smart Queue Management',
          desc: 'Every setting is visible at a glance — model, orientation, generations, timing, download quality, and more. Create multiple queues with different configs, reorder them, and run them sequentially.',
          bullets: [
            'Full settings grid — model, timing, downloads, behavior',
            'Run target: new project or current project',
            'Progress tracking with prompts/done/failed/pending',
          ],
        },
        {
          tag: 'Automation',
          title: 'Live Run Monitor',
          desc: 'Watch AutoFlow work in real time. The run monitor shows every action — opening settings, filling prompts, detecting tiles, waiting for generation. Pause, resume, skip a prompt, or force retry whenever you want.',
          bullets: [
            'Real-time log of every automation step',
            'Pause / Resume / Stop / Skip / Retry controls',
            'Auto-retry on failures with configurable behavior',
          ],
        },
        {
          tag: 'Library',
          title: 'Library Scanner & Batch Download',
          desc: 'After generation, scan your Flow project to see all videos and images grouped by prompt. Select favorites, batch download in 720p, 1080p, or 4K, or trigger upscaling — all from the side panel.',
          bullets: [
            'One-click scan of all generated assets',
            'Grouped by prompt with video/image counts',
            'Batch download or upscale selected assets',
          ],
        },
        {
          tag: 'Settings',
          title: 'Fully Configurable',
          desc: 'Choose your video model (Veo 3.1 Fast, Veo 3, etc.), aspect ratio, generation count, wait times, and download preferences. Enable typing mode for natural input pacing, set auto-download to save videos automatically.',
          bullets: [
            'Video model and resolution selection',
            'Auto-download with custom resolution (720p – 4K)',
            'Typing mode for human-like input pacing',
          ],
        },
      ],
    },
    howItWorks: {
      badge: 'How It Works',
      title: 'Three Steps to',
      titleGradient: 'Automated Generation',
      subtitle: 'Get started in under a minute. No complex setup required.',
      steps: [
        {
          num: '01',
          title: 'Paste Your Prompts',
          desc: "Open AutoFlow's side panel on any Google Flow page. Choose your mode (text-to-video, image-to-video, ingredients), then paste all your prompts. Each paragraph becomes a separate task.",
        },
        {
          num: '02',
          title: 'Configure & Run',
          desc: 'Add your prompts to a queue. Choose your video model, orientation, generation count, and download settings. Set your run target and hit Run. AutoFlow takes over from here.',
        },
        {
          num: '03',
          title: 'Sit Back & Collect',
          desc: "AutoFlow types each prompt, clicks generate, waits for results, downloads the videos, and moves to the next prompt automatically. When it's done, scan the library to review and batch download everything.",
        },
      ],
    },
    cta: {
      title: 'Ready to Automate Your Workflow?',
      subtitle: 'Join creators using AutoFlow to generate AI videos 10x faster. Free to start — no account required.',
      btn: 'Install AutoFlow — Free',
    },
    footer: {
      desc: 'Automate AI video generation with Google Flow. Batch process, queue, and download — all on autopilot.',
      product: 'Product',
      support: 'Support',
      contact: 'Contact',
      legal: 'Legal',
      privacy: 'Privacy Policy',
      terms: 'Terms of Service',
      copyright: 'AutoFlow. Not affiliated with Google. Third-party automation tool.',
    },
  },
};

export function getDictionary(locale) {
  return dictionaries[locale] || dictionaries.en;
}
