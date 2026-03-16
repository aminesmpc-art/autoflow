import { getDictionary, locales, defaultLocale } from '../../dictionaries';

export async function generateStaticParams() {
  return locales.filter(l => l !== defaultLocale).map(locale => ({ locale }));
}

export async function generateMetadata({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);
  return {
    title: t.termsPage.title + ' — AutoFlow',
    description: t.footer.terms,
    alternates: {
      canonical: `https://auto-flow.studio/${locale}/terms`,
    },
  };
}

export default async function LocaleTermsPage({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);

  return (
    <>
      <section className="legal-hero">
        <div className="container">
          <h1>{t.termsPage.title}</h1>
          <p className="text-secondary">{t.termsPage.lastUpdated}</p>
        </div>
      </section>

      <section className="section">
        <div className="container legal-content">
          <h2>{locale === 'ar' ? 'قبول الشروط' : locale === 'fr' ? "Acceptation des conditions" : 'Acceptance of Terms'}</h2>
          <p>{locale === 'ar'
            ? 'باستخدام AutoFlow، فإنك توافق على هذه الشروط. AutoFlow هو أداة أتمتة مستقلة لمتصفح Chrome. نحن غير تابعين لـ Google.'
            : locale === 'fr'
            ? "En utilisant AutoFlow, vous acceptez ces conditions. AutoFlow est un outil d'automatisation Chrome indépendant. Nous ne sommes pas affiliés à Google."
            : 'By using AutoFlow, you agree to these terms. AutoFlow is an independent Chrome automation tool. We are not affiliated with Google.'}</p>

          <h2>{locale === 'ar' ? 'وصف الخدمة' : locale === 'fr' ? 'Description du service' : 'Service Description'}</h2>
          <p>{locale === 'ar'
            ? 'يوفر AutoFlow أتمتة المتصفح لـ Google Flow (labs.google). تعمل الإضافة داخل جلسة المتصفح الخاصة بك ولا تصل إلى خوادم خارجية بخلاف التحقق من الترخيص.'
            : locale === 'fr'
            ? "AutoFlow fournit l'automatisation du navigateur pour Google Flow (labs.google). L'extension fonctionne dans votre session navigateur et n'accède pas à des serveurs externes hormis la vérification de licence."
            : 'AutoFlow provides browser automation for Google Flow (labs.google). The extension operates within your browser session and does not access external servers beyond license verification.'}</p>

          <h2>{locale === 'ar' ? 'الاستخدام المقبول' : locale === 'fr' ? 'Utilisation acceptable' : 'Acceptable Use'}</h2>
          <p>{locale === 'ar'
            ? 'توافق على استخدام AutoFlow وفقاً لشروط خدمة Google Flow. أنت مسؤول عن المحتوى الذي تنشئه باستخدام الأداة.'
            : locale === 'fr'
            ? "Vous acceptez d'utiliser AutoFlow conformément aux conditions d'utilisation de Google Flow. Vous êtes responsable du contenu que vous créez avec l'outil."
            : "You agree to use AutoFlow in compliance with Google Flow's terms of service. You are responsible for the content you create using the tool."}</p>

          <h2>{locale === 'ar' ? 'اتصل بنا' : locale === 'fr' ? 'Nous contacter' : 'Contact Us'}</h2>
          <p>{locale === 'ar'
            ? 'لأي أسئلة حول الشروط، تواصل معنا على:'
            : locale === 'fr'
            ? 'Pour toute question sur les conditions, contactez-nous à :'
            : 'For questions about terms, contact us at:'} <a href="mailto:support@auto-flow.studio">support@auto-flow.studio</a></p>
        </div>
      </section>
    </>
  );
}
