import { getDictionary, locales, defaultLocale } from '../dictionaries';
import StoreLink from '../StoreLink';

export async function generateStaticParams() {
  return locales.map(locale => ({ locale }));
}

export async function generateMetadata({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);
  const baseUrl = 'https://auto-flow.studio';
  const localePath = locale === defaultLocale ? '' : `/${locale}`;

  return {
    title: t.meta.title,
    description: t.meta.description,
    alternates: {
      canonical: `${baseUrl}${localePath}`,
      languages: {
        'en': `${baseUrl}`,
        'ar': `${baseUrl}/ar`,
        'fr': `${baseUrl}/fr`,
        'es': `${baseUrl}/es`,
        'x-default': `${baseUrl}`,
      },
    },
    openGraph: {
      locale: locale === 'en' ? 'en_US' : locale === 'ar' ? 'ar_SA' : locale === 'fr' ? 'fr_FR' : 'es_ES',
      url: `${baseUrl}${localePath}`,
    },
  };
}

export default async function LocaleHomePage({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);
  const isRTL = locale === 'ar';

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      {/* ── JSON-LD Structured Data ── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "AutoFlow",
            applicationCategory: "BrowserApplication",
            applicationSubCategory: "AI Video Automation",
            operatingSystem: "Chrome",
            inLanguage: locale,
            offers: [
              { "@type": "Offer", price: "0", priceCurrency: "USD", name: "Free" },
              { "@type": "Offer", price: "9.99", priceCurrency: "USD", name: "Pro" },
            ],
            description: t.meta.description,
            url: `https://auto-flow.studio${locale === 'en' ? '' : `/${locale}`}`,
          }),
        }}
      />

      {/* ── HERO ── */}
      <section className="hero">
        <div className="hero-bg-glow" aria-hidden="true" />
        <div className="container hero-content">
          <div className="hero-badge badge animate-in">
            <span>⚡</span> {t.hero.badge}
          </div>
          <h1 className="animate-in delay-1">
            {t.hero.titleLine1}<br />
            <span className="text-gradient">{t.hero.titleLine2}</span>
          </h1>
          <p className="hero-subtitle animate-in delay-2">
            {t.hero.subtitle}
          </p>
          <div className="hero-buttons animate-in delay-3">
            <StoreLink className="btn btn-primary btn-lg">
              <ChromeIcon /> {t.hero.installBtn}
            </StoreLink>
            <a href="#features" className="btn btn-secondary btn-lg">
              {t.hero.featuresBtn}
            </a>
          </div>
          <div className="hero-screenshot animate-in delay-4">
            <img
              src="/screenshots/full-workflow.png"
              alt="AutoFlow running alongside Google Flow"
              className="hero-img"
            />
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="section" id="features">
        <div className="container">
          <div className="section-header">
            <div className="badge">{t.features.badge}</div>
            <h2>{t.features.title}<br /><span className="text-gradient">{t.features.titleGradient}</span></h2>
            <p>{t.features.subtitle}</p>
          </div>

          {t.features.items.map((feat, i) => {
            const screenshots = [
              '/screenshots/create-prompts.png',
              '/screenshots/image-mapping.png',
              '/screenshots/queue-card.png',
              '/screenshots/run-monitor.png',
              '/screenshots/library-results.png',
              '/screenshots/settings.png',
            ];
            return (
              <div key={i} className={`feature-showcase${i % 2 === 1 ? ' feature-reverse' : ''}`}>
                <div className="feature-text">
                  <div className="feature-tag">{feat.tag}</div>
                  <h3>{feat.title}</h3>
                  <p className="text-secondary">{feat.desc}</p>
                  <ul className="feature-bullets">
                    {feat.bullets.map((b, j) => <li key={j}>{b}</li>)}
                  </ul>
                </div>
                <div className="feature-image">
                  <img src={screenshots[i]} alt={feat.title} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="section section-alt" id="how-it-works">
        <div className="container">
          <div className="section-header">
            <div className="badge">{t.howItWorks.badge}</div>
            <h2>{t.howItWorks.title}<br /><span className="text-gradient">{t.howItWorks.titleGradient}</span></h2>
            <p>{t.howItWorks.subtitle}</p>
          </div>
          <div className="steps-container">
            {t.howItWorks.steps.map((step, i) => {
              const stepScreenshots = [
                '/screenshots/prompt-list.png',
                '/screenshots/queue-card.png',
                '/screenshots/library-results.png',
              ];
              return (
                <div key={i} className="step-card-rich">
                  <div className="step-badge">{step.num}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p className="text-secondary">{step.desc}</p>
                  </div>
                  <div className="step-image">
                    <img src={stepScreenshots[i]} alt={step.title} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="section cta-section">
        <div className="container">
          <div className="cta-card">
            <div className="cta-glow" aria-hidden="true" />
            <h2>{t.cta.title}</h2>
            <p className="text-secondary">{t.cta.subtitle}</p>
            <StoreLink className="btn btn-primary btn-lg">
              <ChromeIcon /> {t.cta.btn}
            </StoreLink>
          </div>
        </div>
      </section>
    </div>
  );
}

function ChromeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2"/>
      <line x1="12" y1="2" x2="12" y2="8" stroke="currentColor" strokeWidth="2"/>
      <line x1="3.5" y1="17" x2="8.5" y2="14" stroke="currentColor" strokeWidth="2"/>
      <line x1="20.5" y1="17" x2="15.5" y2="14" stroke="currentColor" strokeWidth="2"/>
    </svg>
  );
}
