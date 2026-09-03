import { getDictionary, locales, defaultLocale } from '../../dictionaries';
import PricingCalculator from '../../PricingCalculator';

export async function generateStaticParams() {
  return locales.filter(l => l !== defaultLocale).map(locale => ({ locale }));
}

export async function generateMetadata({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);
  const baseUrl = 'https://www.auto-flow.studio';

  const languages = { 'en': `${baseUrl}/pricing`, 'x-default': `${baseUrl}/pricing` };
  locales.filter(l => l !== defaultLocale).forEach(l => {
    languages[l] = `${baseUrl}/${l}/pricing`;
  });

  return {
    title: t.pricing.title + ' ' + t.pricing.titleGradient + ' — AutoFlow',
    description: t.pricing.subtitle,
    alternates: {
      canonical: `${baseUrl}/${locale}/pricing`,
      languages,
    },
  };
}

export default async function LocalePricingPage({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);

  return (
    <>
      <section className="pricing-hero" style={{ paddingTop: "160px", paddingBottom: "60px", textAlign: "center" }}>
        <div className="container">
          <div className="badge" style={{ marginBottom: "20px" }}>{t.pricing.badge}</div>
          <h1 style={{ fontSize: "2.8rem", marginBottom: "16px" }}>
            {t.pricing.title} <span className="text-gradient">{t.pricing.titleGradient}</span>
          </h1>
          <p style={{ maxWidth: "680px", margin: "0 auto", fontSize: "1.15rem", color: "var(--text-secondary)" }}>
            {t.pricing.subtitle}
          </p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: "20px", paddingBottom: "120px" }}>
        <div className="container">
          <PricingCalculator />
        </div>
      </section>
    </>
  );
}
