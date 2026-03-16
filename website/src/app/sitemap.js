export default function sitemap() {
  const baseUrl = "https://auto-flow.studio";
  const locales = ['', '/ar', '/fr', '/es'];
  const pages = [
    { path: '', changeFrequency: 'weekly', priority: 1 },
    { path: '/pricing', changeFrequency: 'monthly', priority: 0.8 },
    { path: '/faq', changeFrequency: 'monthly', priority: 0.7 },
    { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
    { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
  ];

  const entries = [];
  for (const page of pages) {
    for (const locale of locales) {
      entries.push({
        url: `${baseUrl}${locale}${page.path}`,
        lastModified: new Date(),
        changeFrequency: page.changeFrequency,
        priority: locale === '' ? page.priority : page.priority * 0.9,
      });
    }
  }

  return entries;
}
