export default function sitemap() {
  const baseUrl = "https://auto-flow.studio";
  const locales = ['', '/ar', '/fr', '/es'];
  const pages = [
    { path: '', changeFrequency: 'weekly', priority: 1.0 },
    { path: '/pricing', changeFrequency: 'monthly', priority: 0.8 },
    { path: '/faq', changeFrequency: 'monthly', priority: 0.7 },
    { path: '/blog', changeFrequency: 'weekly', priority: 0.9 },
    { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
    { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
  ];

  const entries = [];
  for (const page of pages) {
    for (const locale of locales) {
      const localePriority = locale === '' ? page.priority : Math.round(page.priority * 0.9 * 100) / 100;
      entries.push({
        url: `${baseUrl}${locale}${page.path}`,
        lastModified: new Date(),
        changeFrequency: page.changeFrequency,
        priority: localePriority,
      });
    }
  }

  return entries;
}
