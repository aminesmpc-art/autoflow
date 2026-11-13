export default async function sitemap() {
  const baseUrl = 'https://www.auto-flow.studio';

  /* The pages Google should judge the site by: English, written by hand.

     Two kinds of page were taken out in November 2026, after AdSense
     refused the site for "low-value content":

     - /prompts/{id}. Fifty of the seventy-seven URLs here were extractions
       users chose to publish: raw model output, one near-identical page per
       video. They still work and are still linked from the gallery, but they
       carry noindex (app/[locale]/prompts/layout.js) and are not listed.
     - /ar, /fr, /es, /de and /it. The translations are partial — the French
       FAQ has half the English one's words — so those pages carry noindex
       (app/[locale]/layout.js) until they are translated in full. With them
       gone there is no hreflang cluster to describe, so no entry names
       alternates.

     Use realistic last-modified dates: update one when the page changes. */
  const routes = [
    { path: '', lastmod: '2026-08-22' },
    { path: '/studio', lastmod: '2026-08-22' },
    { path: '/extractor', lastmod: '2026-07-04' },
    { path: '/clipping', lastmod: '2026-09-03' },
    { path: '/pricing', lastmod: '2026-11-13' },
    { path: '/faq', lastmod: '2026-06-19' },
    { path: '/blog', lastmod: '2026-11-13' },
    { path: '/about', lastmod: '2026-11-13' },
    { path: '/contact', lastmod: '2026-11-13' },
    { path: '/changelog', lastmod: '2026-06-16' },
    { path: '/privacy', lastmod: '2026-08-23' },
    { path: '/terms', lastmod: '2026-04-01' },
  ];

  const staticSitemaps = routes.map(({ path: route, lastmod }) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(lastmod),
    changeFrequency: 'weekly',
    priority: route === '' ? 1.0
      : route === '/extractor' || route === '/clipping' || route === '/studio' ? 0.9
      : 0.8,
  }));

  const blogPosts = [
    { slug: '/blog/how-to-batch-generate-ai-videos-google-flow', lastmod: '2026-11-13' },
    { slug: '/blog/best-prompts-ai-video-generation', lastmod: '2026-11-13' },
    { slug: '/blog/google-flow-tips-avoid-failed-generations', lastmod: '2026-11-13' },
    { slug: '/blog/construction-asmr-ai-video-complete-guide', lastmod: '2026-11-13' },
    { slug: '/blog/how-to-recreate-ai-videos-with-extractor-and-autoflow', lastmod: '2026-11-13' },
    { slug: '/blog/how-to-make-tiktok-videos-with-ai', lastmod: '2026-11-13' },
    { slug: '/blog/how-to-make-youtube-shorts-with-ai', lastmod: '2026-11-13' },
    { slug: '/blog/best-ai-video-generators-2026', lastmod: '2026-11-13' },
    { slug: '/blog/how-to-make-money-with-ai-videos', lastmod: '2026-11-13' },
    // Published in July, never listed here until November.
    { slug: '/blog/how-to-download-google-flow-veo-videos-4k', lastmod: '2026-11-13' },
    { slug: '/blog/google-flow-omni-1-2-model-changes-december-2026', lastmod: '2026-11-13' },
    { slug: '/blog/consistent-characters-google-flow', lastmod: '2026-11-13' },
    { slug: '/blog/reverse-engineer-ai-video-shot-by-shot', lastmod: '2026-11-13' },
  ];

  const blogSitemaps = blogPosts.map(({ slug, lastmod }) => ({
    url: `${baseUrl}${slug}`,
    lastModified: new Date(lastmod),
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  return [...staticSitemaps, ...blogSitemaps];
}
