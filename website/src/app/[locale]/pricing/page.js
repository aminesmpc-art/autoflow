import { getDictionary, locales, defaultLocale } from '../../dictionaries';

export async function generateStaticParams() {
  return locales.filter(l => l !== defaultLocale).map(locale => ({ locale }));
}

export async function generateMetadata({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);
  return {
    title: t.pricing.title + ' ' + t.pricing.titleGradient + ' — AutoFlow',
    description: t.pricing.subtitle,
    alternates: {
      canonical: `https://auto-flow.studio/${locale}/pricing`,
    },
  };
}

export default async function LocalePricingPage({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);

  return (
    <>
      <section className="pricing-hero">
        <div className="container">
          <div className="badge">{t.pricing.badge}</div>
          <h1>{t.pricing.title} <span className="text-gradient">{t.pricing.titleGradient}</span></h1>
          <p>{t.pricing.subtitle}</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="pricing-grid">
            {/* Free Tier */}
            <div className="pricing-card">
              <div className="pricing-name">{t.pricing.free.name}</div>
              <div className="pricing-price">{t.pricing.free.price} <span>{t.pricing.free.period}</span></div>
              <div className="pricing-desc">{t.pricing.free.desc}</div>
              <ul className="pricing-features">
                {t.pricing.free.features.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
              <a
                href="https://chromewebstore.google.com"
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="btn btn-secondary"
              >
                {t.pricing.free.btn}
              </a>
            </div>

            {/* Pro Tier */}
            <div className="pricing-card featured">
              <div className="pricing-name">{t.pricing.pro.name}</div>
              <div className="pricing-price">{t.pricing.pro.price} <span>{t.pricing.pro.period}</span></div>
              <div className="pricing-desc">{t.pricing.pro.desc}</div>
              <ul className="pricing-features">
                {t.pricing.pro.features.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
              <a
                href="https://whop.com/checkout/plan_fxMVMOmbFPcp4"
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="btn btn-primary"
              >
                {t.pricing.pro.btn}
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
