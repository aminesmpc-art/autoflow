import { getDictionary, locales, defaultLocale } from '../../dictionaries';
import FAQClientLocale from './faq-client';

export async function generateStaticParams() {
  return locales.filter(l => l !== defaultLocale).map(locale => ({ locale }));
}

export async function generateMetadata({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);
  const baseUrl = 'https://www.auto-flow.studio';

  const languages = { 'en': `${baseUrl}/faq`, 'x-default': `${baseUrl}/faq` };
  locales.filter(l => l !== defaultLocale).forEach(l => {
    languages[l] = `${baseUrl}/${l}/faq`;
  });

  return {
    title: t.faq.title + ' ' + t.faq.titleGradient + ' — AutoFlow',
    description: t.faq.subtitle,
    alternates: {
      canonical: `${baseUrl}/${locale}/faq`,
      languages,
    },
  };
}

export default async function LocaleFAQPage({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);
  const baseUrl = 'https://www.auto-flow.studio';

  return (
    <>
      {/* ── FAQPage JSON-LD Schema ── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            inLanguage: locale,
            mainEntity: t.faq.items.map((faq) => ({
              "@type": "Question",
              name: faq.q,
              acceptedAnswer: {
                "@type": "Answer",
                text: faq.a,
              },
            })),
          }),
        }}
      />

      {/* ── BreadcrumbList Schema ── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: `${baseUrl}/${locale}`,
              },
              {
                "@type": "ListItem",
                position: 2,
                name: t.faq.badge,
                item: `${baseUrl}/${locale}/faq`,
              },
            ],
          }),
        }}
      />

      <section className="faq-hero">
        <div className="container">
          <div className="badge">{t.faq.badge}</div>
          <h1>
            {t.faq.title}{" "}
            <span className="text-gradient">{t.faq.titleGradient}</span>
          </h1>
          <p>{t.faq.subtitle}</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <FAQClientLocale faqs={t.faq.items} />
        </div>
      </section>
    </>
  );
}
