import { locales } from '../dictionaries';

// Only match locales from generateStaticParams — don't catch /blog, /faq, etc.
export const dynamicParams = false;

export async function generateStaticParams() {
  return locales.map(locale => ({ locale }));
}

export default async function LocaleLayout({ children, params }) {
  const { locale } = await params;
  const isRTL = locale === 'ar';

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} lang={locale}>
      {children}
    </div>
  );
}
