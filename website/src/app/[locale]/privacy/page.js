import { getDictionary, locales, defaultLocale } from '../../dictionaries';

export async function generateStaticParams() {
  return locales.filter(l => l !== defaultLocale).map(locale => ({ locale }));
}

export async function generateMetadata({ params }) {
  const { locale } = await params;
  const t = getDictionary(locale);
  return {
    title: t.privacyPage.title + ' — AutoFlow',
    description: t.footer.privacy,
    alternates: {
      canonical: `https://auto-flow.studio/${locale}/privacy`,
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
          <p className="text-secondary">{t.privacyPage.lastUpdated}</p>
        </div>
      </section>

      <section className="section">
        <div className="container legal-content">
          <h2>{locale === 'ar' ? 'ما هي المعلومات التي نجمعها' : locale === 'fr' ? 'Informations que nous collectons' : 'Information We Collect'}</h2>
          <p>{locale === 'ar'
            ? 'AutoFlow لا يجمع بيانات شخصية. تتم جميع عمليات المعالجة محلياً في متصفحك. نرسل فقط عدادات استخدام مجهولة للتحقق من حدود الخطة.'
            : locale === 'fr'
            ? "AutoFlow ne collecte pas de données personnelles. Tout le traitement se fait localement dans votre navigateur. Seuls des compteurs d'utilisation anonymes sont envoyés pour vérifier les limites de votre plan."
            : 'AutoFlow does not collect personal data. All processing happens locally in your browser. We only send anonymous usage counts to verify plan limits.'}</p>

          <h2>{locale === 'ar' ? 'تخزين البيانات' : locale === 'fr' ? 'Stockage des données' : 'Data Storage'}</h2>
          <p>{locale === 'ar'
            ? 'جميع النصوص والصور والفيديوهات المُنشأة تبقى في التخزين المحلي لمتصفحك. AutoFlow لا يرفع أبداً محتواك إلى أي خادم خارجي.'
            : locale === 'fr'
            ? "Tous les prompts, images et vidéos générées restent dans le stockage local de votre navigateur. AutoFlow n'envoie jamais votre contenu vers un serveur externe."
            : 'All prompts, images, and generated videos stay in your browser\'s local storage. AutoFlow never uploads your content to any external server.'}</p>

          <h2>{locale === 'ar' ? 'خدمات الطرف الثالث' : locale === 'fr' ? 'Services tiers' : 'Third-Party Services'}</h2>
          <p>{locale === 'ar'
            ? 'يتفاعل AutoFlow مع Google Flow (labs.google) داخل جلسة المتصفح الخاصة بك. نحن لا نصل إلى Google APIs أو خوادم خارجية أخرى مباشرة.'
            : locale === 'fr'
            ? "AutoFlow interagit avec Google Flow (labs.google) dans votre session navigateur. Nous n'accédons pas directement aux APIs Google ni à d'autres serveurs."
            : 'AutoFlow interacts with Google Flow (labs.google) within your browser session. We do not access Google APIs or other external servers directly.'}</p>

          <h2>{locale === 'ar' ? 'اتصل بنا' : locale === 'fr' ? 'Nous contacter' : 'Contact Us'}</h2>
          <p>{locale === 'ar'
            ? 'لأي أسئلة حول الخصوصية، تواصل معنا على:'
            : locale === 'fr'
            ? 'Pour toute question sur la confidentialité, contactez-nous à :'
            : 'For any privacy questions, contact us at:'} <a href="mailto:support@auto-flow.studio">support@auto-flow.studio</a></p>
        </div>
      </section>
    </>
  );
}
