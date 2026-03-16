import { getDictionary, locales, defaultLocale } from '../../dictionaries';
import FAQClientLocale from './faq-client';

export async function generateStaticParams() {
  return locales.filter(l => l !== defaultLocale).map(locale => ({ locale }));
}

export async function generateMetadata({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);
  return {
    title: t.faq.title + ' ' + t.faq.titleGradient + ' — AutoFlow',
    description: t.faq.subtitle,
    alternates: {
      canonical: `https://auto-flow.studio/${locale}/faq`,
    },
  };
}

export default async function LocaleFAQPage({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);

  return (
    <>
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
