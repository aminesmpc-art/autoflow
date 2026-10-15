import { locales, defaultLocale } from '../../dictionaries';

export async function generateMetadata({ params }) {
  const { locale } = await params;
  const baseUrl = 'https://www.auto-flow.studio';

  const languages = { 'en': `${baseUrl}/breakdown`, 'x-default': `${baseUrl}/breakdown` };
  locales.filter(l => l !== defaultLocale).forEach(l => {
    languages[l] = `${baseUrl}/${l}/breakdown`;
  });

  return {
    title: "Why It Works — AI Video Breakdown: Hook, Pacing & Structure | AutoFlow",
    description: "Upload a video or paste a link and see why it holds attention: the hook, measured pacing, story beats, where viewers might leave, the techniques it uses, and a list of what to copy.",
    alternates: {
      canonical: locale === defaultLocale ? `${baseUrl}/breakdown` : `${baseUrl}/${locale}/breakdown`,
      languages,
    },
  };
}

export default function BreakdownLayout({ children }) {
  return children;
}
