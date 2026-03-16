import { getDictionary, locales, defaultLocale } from '../dictionaries';

// Only match locales from generateStaticParams — don't catch /blog, /faq, etc.
export const dynamicParams = false;

export async function generateStaticParams() {
  return locales.map(locale => ({ locale }));
}

export default async function LocaleLayout({ children, params }) {
  const { locale } = await params;
  const t = getDictionary(locale);
  const isRTL = locale === 'ar';
  const prefix = locale === defaultLocale ? '' : `/${locale}`;

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} lang={locale}>
      <header className="site-header">
        <nav className="container header-nav">
          <a href={`${prefix}/`} className="logo">
            <span className="logo-icon">⚡</span>
            <span className="logo-text">AutoFlow</span>
          </a>
          <ul className="nav-links">
            <li><a href={`${prefix}/#features`}>{t.nav.features}</a></li>
            <li><a href={`${prefix}/#how-it-works`}>{t.nav.howItWorks}</a></li>
            <li><a href={`${prefix}/pricing`}>{t.nav.pricing}</a></li>
            <li><a href={`${prefix}/faq`}>{t.nav.faq}</a></li>
          </ul>
          <div className="header-actions">
            <LanguageSwitcher current={locale} />
            <a
              href="https://chromewebstore.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-header"
            >
              {t.nav.install}
            </a>
          </div>
        </nav>
      </header>

      <main>{children}</main>

      <footer className="site-footer">
        <div className="container footer-grid">
          <div className="footer-brand">
            <a href={`${prefix}/`} className="logo">
              <span className="logo-icon">⚡</span>
              <span className="logo-text">AutoFlow</span>
            </a>
            <p className="text-secondary">{t.footer.desc}</p>
          </div>
          <div className="footer-col">
            <h4>{t.footer.product}</h4>
            <ul>
              <li><a href={`${prefix}/#features`}>{t.nav.features}</a></li>
              <li><a href={`${prefix}/#how-it-works`}>{t.nav.howItWorks}</a></li>
              <li><a href={`${prefix}/pricing`}>{t.nav.pricing}</a></li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>{t.footer.support}</h4>
            <ul>
              <li><a href={`${prefix}/faq`}>{t.nav.faq}</a></li>
              <li><a href="mailto:support@auto-flow.studio">{t.footer.contact}</a></li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>{t.footer.legal}</h4>
            <ul>
              <li><a href={`${prefix}/privacy`}>{t.footer.privacy}</a></li>
              <li><a href={`${prefix}/terms`}>{t.footer.terms}</a></li>
            </ul>
          </div>
        </div>
        <div className="container footer-bottom">
          <p className="text-secondary">
            © {new Date().getFullYear()} {t.footer.copyright}
          </p>
        </div>
      </footer>
    </div>
  );
}

const langLabels = {
  en: 'EN',
  ar: 'عربي',
  fr: 'FR',
  es: 'ES',
};

function LanguageSwitcher({ current }) {
  return (
    <div className="lang-switcher">
      {locales.map(loc => {
        const href = loc === defaultLocale ? '/' : `/${loc}`;
        return (
          <a
            key={loc}
            href={href}
            className={`lang-option${loc === current ? ' active' : ''}`}
            hrefLang={loc}
          >
            {langLabels[loc]}
          </a>
        );
      })}
    </div>
  );
}
