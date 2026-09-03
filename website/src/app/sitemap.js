export default async function sitemap() {
  const baseUrl = 'https://www.auto-flow.studio';
  const locales = ['ar', 'fr', 'es', 'de', 'it'];
  
  /* Static routes — English served at root, localized at /{locale}/path.
     Use realistic last-modified dates (update these when you actually change
     a page).

     `englishOnly` marks the pages that live outside app/[locale] and therefore
     have no translations. Without it they were given all five alternates like
     everything else, and the sitemap advertised fifteen URLs that 404 —
     /fr/studio, /es/clipping, /de/changelog and the rest. hreflang is a
     cluster and a cluster with dead members is thrown away whole, so this was
     also costing the pages that ARE translated.

     Do not derive this from middleware's `unlocalizedPaths`: that list answers
     a different question and disagrees — /pricing is in it and /fr/pricing
     serves 200. Verified route by route against production 2026-09-03. */
  const routes = [
    { path: '', lastmod: '2026-08-22' },
    { path: '/studio', lastmod: '2026-08-22', englishOnly: true },
    { path: '/pricing', lastmod: '2026-08-22' },
    { path: '/faq', lastmod: '2026-06-19' },
    { path: '/blog', lastmod: '2026-06-19' },
    { path: '/privacy', lastmod: '2026-04-01' },
    { path: '/terms', lastmod: '2026-04-01' },
    { path: '/prompts', lastmod: '2026-07-04' },
    { path: '/extractor', lastmod: '2026-07-04' },
    { path: '/clipping', lastmod: '2026-09-03', englishOnly: true },
    { path: '/changelog', lastmod: '2026-06-16', englishOnly: true },
  ];
  
  const staticSitemaps = routes.map(({ path: route, lastmod, englishOnly }) => {
    const entry = {
      url: `${baseUrl}${route}`,
      lastModified: new Date(lastmod),
      changeFrequency: 'weekly',
      priority: route === '' ? 1.0
        : route === '/extractor' || route === '/clipping' ? 0.9
        : 0.8,
    };

    /* An English-only page names no alternates at all. Claiming `en` alone
       would be truthful but pointless — a one-member cluster says nothing
       that the URL does not already say. */
    if (!englishOnly) {
      const alternateLanguages = { en: `${baseUrl}${route}` };
      locales.forEach(locale => {
        alternateLanguages[locale] = `${baseUrl}/${locale}${route}`;
      });
      entry.alternates = { languages: alternateLanguages };
    }

    return entry;
  });

  // English-only blog posts
  const blogPosts = [
    { slug: '/blog/how-to-batch-generate-ai-videos-google-flow', lastmod: '2026-05-10' },
    { slug: '/blog/best-prompts-ai-video-generation', lastmod: '2026-05-12' },
    { slug: '/blog/google-flow-tips-avoid-failed-generations', lastmod: '2026-05-14' },
    { slug: '/blog/construction-asmr-ai-video-complete-guide', lastmod: '2026-05-15' },
    { slug: '/blog/how-to-recreate-ai-videos-with-extractor-and-autoflow', lastmod: '2026-05-18' },
    { slug: '/blog/how-to-make-tiktok-videos-with-ai', lastmod: '2026-05-20' },
    { slug: '/blog/how-to-make-youtube-shorts-with-ai', lastmod: '2026-05-22' },
    { slug: '/blog/best-ai-video-generators-2026', lastmod: '2026-05-25' },
    { slug: '/blog/how-to-make-money-with-ai-videos', lastmod: '2026-05-28' },
  ];

  const blogSitemaps = blogPosts.map(({ slug, lastmod }) => ({
    url: `${baseUrl}${slug}`,
    lastModified: new Date(lastmod),
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  // Dynamic prompts
  let promptSitemaps = [];
  try {
    const res = await fetch('https://api.auto-flow.studio/api/extractions/public/', { 
      next: { revalidate: 3600 } 
    });
    if (res.ok) {
      const prompts = await res.json();
      promptSitemaps = prompts.map((prompt) => {
        const alternateLanguages = { en: `${baseUrl}/prompts/${prompt.id}` };
        locales.forEach(locale => {
          alternateLanguages[locale] = `${baseUrl}/${locale}/prompts/${prompt.id}`;
        });

        return {
          url: `${baseUrl}/prompts/${prompt.id}`,
          lastModified: new Date(prompt.created_at || '2026-05-01'),
          changeFrequency: 'monthly',
          priority: 0.9,
          alternates: {
            languages: alternateLanguages,
          },
        };
      });
    }
  } catch (error) {
    console.error('Failed to fetch prompts for sitemap:', error);
  }

  return [...staticSitemaps, ...blogSitemaps, ...promptSitemaps];
}
