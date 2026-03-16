/**
 * ═══════════════════════════════════════════════════════
 *  BLOG CONTENT — Add new articles here!
 * ═══════════════════════════════════════════════════════
 *
 *  To add a new blog post:
 *  1. Add an entry to the `posts` array below
 *  2. Create the folder: src/app/blog/[your-slug]/page.js
 *  3. Import getPostBySlug and use the data
 *
 *  That's it! The index, sitemap, and schemas are auto-generated.
 */

export const posts = [
  {
    slug: "how-to-batch-generate-ai-videos-google-flow",
    title: "How to Batch Generate AI Videos with Google Flow in 2026",
    description:
      "Stop generating videos one by one. Learn how to batch process 50+ prompts in Google Flow using AutoFlow — with step-by-step instructions.",
    date: "2026-03-16",
    updated: "2026-03-16",
    category: "Tutorial",
    tags: ["google-flow", "batch-processing", "tutorial", "automation"],
    image: "/screenshots/create-prompts.png",
    readTime: "5 min read",
    featured: true,
  },
  {
    slug: "best-prompts-ai-video-generation",
    title: "25 Best Prompts for AI Video Generation (Copy & Paste Ready)",
    description:
      "Curated list of the most effective prompts for creating stunning AI videos with Google Flow. From cinematic shots to product demos.",
    date: "2026-03-16",
    updated: "2026-03-16",
    category: "Prompts",
    tags: ["prompts", "ai-video", "google-flow", "creative"],
    image: "/screenshots/create-prompts.png",
    readTime: "7 min read",
    featured: true,
  },
  {
    slug: "google-flow-tips-avoid-failed-generations",
    title: "5 Google Flow Tips to Avoid Failed Generations",
    description:
      "Generation failures are frustrating. Here are 5 proven tips to reduce failures and get better results from Google Flow every time.",
    date: "2026-03-16",
    updated: "2026-03-16",
    category: "Tips",
    tags: ["google-flow", "tips", "troubleshooting"],
    image: "/screenshots/run-monitor.png",
    readTime: "4 min read",
    featured: false,
  },
  {
    slug: "construction-asmr-ai-video-complete-guide",
    title: "Construction ASMR with AI: Complete Video Creation Guide",
    description:
      "Learn how to create viral construction ASMR videos using ChatGPT for prompts, Google Flow for image generation, and AutoFlow for automated frame-to-video animation. Full step-by-step tutorial.",
    date: "2026-03-16",
    updated: "2026-03-16",
    category: "Tutorial",
    tags: ["construction-asmr", "frame-to-video", "tutorial", "google-flow", "chatgpt"],
    image: "/screenshots/blog/08-library-images-scan.png",
    readTime: "10 min read",
    featured: true,
  },
];

/** Get all posts, newest first */
export function getAllPosts() {
  return [...posts].sort((a, b) => new Date(b.date) - new Date(a.date));
}

/** Get a single post by slug */
export function getPostBySlug(slug) {
  return posts.find((p) => p.slug === slug) || null;
}

/** Get all slugs (for static generation) */
export function getAllSlugs() {
  return posts.map((p) => p.slug);
}

/** Get related posts (same category, excluding current) */
export function getRelatedPosts(slug, limit = 3) {
  const current = getPostBySlug(slug);
  if (!current) return [];
  return posts
    .filter((p) => p.slug !== slug && p.category === current.category)
    .slice(0, limit);
}

/** Get posts by category */
export function getPostsByCategory(category) {
  return posts.filter((p) => p.category === category);
}

/** Get all unique categories */
export function getCategories() {
  return [...new Set(posts.map((p) => p.category))];
}

/** Base URL */
export const SITE_URL = "https://auto-flow.studio";
