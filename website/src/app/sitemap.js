export default async function sitemap() {
  const baseUrl = 'https://auto-flow.studio';
  const locales = ['en', 'ar', 'fr'];
  
  // Static localized routes
  const routes = ['', '/pricing', '/faq', '/blog', '/privacy', '/terms', '/prompts', '/extractor'];
  
  const staticSitemaps = routes.map((route) => {
    return {
      url: `${baseUrl}${route}`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: route === '' ? 1.0 : 0.8,
      alternates: {
        languages: {
          en: `${baseUrl}${route}`,
          ar: `${baseUrl}/ar${route}`,
          fr: `${baseUrl}/fr${route}`,
        },
      },
    };
  });

  // English-only blog posts
  const blogPosts = [
    '/blog/how-to-batch-generate-ai-videos-google-flow',
    '/blog/best-prompts-ai-video-generation',
    '/blog/google-flow-tips-avoid-failed-generations',
    '/blog/construction-asmr-ai-video-complete-guide',
    '/blog/how-to-recreate-ai-videos-with-extractor-and-autoflow'
  ];

  const blogSitemaps = blogPosts.map((post) => ({
    url: `${baseUrl}${post}`,
    lastModified: new Date(),
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
      promptSitemaps = prompts.map((prompt) => ({
        url: `${baseUrl}/prompts/${prompt.id}`,
        lastModified: new Date(prompt.created_at || new Date()),
        changeFrequency: 'monthly',
        priority: 0.9,
        alternates: {
          languages: {
            en: `${baseUrl}/prompts/${prompt.id}`,
            ar: `${baseUrl}/ar/prompts/${prompt.id}`,
            fr: `${baseUrl}/fr/prompts/${prompt.id}`,
          },
        },
      }));
    }
  } catch (error) {
    console.error('Failed to fetch prompts for sitemap:', error);
  }

  return [...staticSitemaps, ...blogSitemaps, ...promptSitemaps];
}
