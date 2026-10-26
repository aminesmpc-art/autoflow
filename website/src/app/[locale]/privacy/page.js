import { getDictionary, locales, defaultLocale } from '../../dictionaries';
import PrivacyPolicy, { PRIVACY_UPDATED } from '../../privacy/PrivacyPolicy';

/* The policy has one official text, in English, and every language shows it.
   This page used to carry a short translated summary instead — one that said
   AutoFlow collects no personal data and never uploads your content — and a
   visitor whose browser is not set to English, a store reviewer included, was
   served that summary at /privacy rather than the policy. */
const OFFICIAL_TEXT_NOTE = {
  ar: 'النص الرسمي لسياسة الخصوصية هذه باللغة الإنجليزية، وهو معروض أدناه.',
  fr: 'Le texte officiel de cette politique de confidentialité est en anglais ; il figure ci-dessous.',
  es: 'El texto oficial de esta política de privacidad está en inglés y se muestra a continuación.',
  de: 'Die offizielle Fassung dieser Datenschutzerklärung ist auf Englisch und steht unten.',
  it: 'Il testo ufficiale di questa informativa sulla privacy è in inglese ed è riportato qui sotto.',
};

export async function generateStaticParams() {
  return locales.filter(l => l !== defaultLocale).map(locale => ({ locale }));
}

export async function generateMetadata({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);

  /* The same English text as /privacy, so that is the canonical page and
     there are no language alternates to advertise. */
  return {
    title: t.privacyPage.title + ' — AutoFlow',
    description: t.footer.privacy,
    alternates: {
      canonical: 'https://www.auto-flow.studio/privacy',
    },
  };
}

export default async function LocalePrivacyPage({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);

  return (
    <>
      <section className="legal-hero">
        <div className="container">
          <h1>{t.privacyPage.title}</h1>
          {OFFICIAL_TEXT_NOTE[locale] && (
            <p className="text-secondary">{OFFICIAL_TEXT_NOTE[locale]}</p>
          )}
          <p className="text-secondary" dir="ltr" lang="en">
            Last updated: {PRIVACY_UPDATED}
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container legal-content" dir="ltr" lang="en">
          <PrivacyPolicy />
        </div>
      </section>
    </>
  );
}
