import { getDictionary, locales } from '../dictionaries';
import StoreLink from '../StoreLink';

// Only match locales from generateStaticParams — don't catch /blog, /faq, etc.
export const dynamicParams = false;

export async function generateStaticParams() {
  return locales.map(locale => ({ locale }));
}

export default async function LocaleLayout({ children, params }) {
  const { locale } = await params;
  const t = getDictionary(locale);
  const isRTL = locale === 'ar';

  return (
    <div className="locale-wrapper" dir={isRTL ? 'rtl' : 'ltr'} lang={locale}>
      {/* Locale-specific header */}
      <header className="site-header locale-header">
        <nav className="container header-nav">
          <a href={`/${locale}`} className="logo">
            <span className="logo-icon">⚡</span>
            <span className="logo-text">AutoFlow</span>
          </a>
          <ul className="nav-links">
            <li><a href={`/${locale}#features`}>{t.nav.features}</a></li>
            <li><a href={`/${locale}#how-it-works`}>{t.nav.howItWorks}</a></li>
            <li><a href="/extractor">Extractor</a></li>
            <li><a href={`/${locale}/pricing`}>{t.nav.pricing}</a></li>
            <li><a href={`/${locale}/blog`}>Blog</a></li>
            <li><a href={`/${locale}/faq`}>{t.nav.faq}</a></li>
          </ul>
          <div className="header-actions">
            <div className="lang-switcher">
              <a href="/" className={locale === 'en' ? 'active' : ''}>EN</a>
              <a href="/ar" className={locale === 'ar' ? 'active' : ''}>AR</a>
              <a href="/fr" className={locale === 'fr' ? 'active' : ''}>FR</a>
            </div>
            <StoreLink className="btn btn-primary btn-header">
              {t.nav.install}
            </StoreLink>
          </div>
        </nav>
      </header>

      {children}

      {/* Locale-specific footer */}
      <footer className="site-footer locale-footer">
        <div className="container footer-grid">
          <div className="footer-brand">
            <a href={`/${locale}`} className="logo">
              <span className="logo-icon">⚡</span>
              <span className="logo-text">AutoFlow</span>
            </a>
            <p className="text-secondary">{t.footer.desc}</p>
          </div>
          <div className="footer-col">
            <h4>{t.footer.product}</h4>
            <ul>
              <li><a href={`/${locale}#features`}>{t.nav.features}</a></li>
              <li><a href={`/${locale}#how-it-works`}>{t.nav.howItWorks}</a></li>
              <li><a href={`/${locale}/pricing`}>{t.nav.pricing}</a></li>
              <li><a href={`/${locale}/blog`}>Blog</a></li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>{t.footer.support}</h4>
            <ul>
              <li><a href={`/${locale}/faq`}>{t.nav.faq}</a></li>
              <li><a href="mailto:support@auto-flow.studio">{t.footer.contact}</a></li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>{t.footer.legal}</h4>
            <ul>
              <li><a href={`/${locale}/privacy`}>{t.footer.privacy}</a></li>
              <li><a href={`/${locale}/terms`}>{t.footer.terms}</a></li>
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
