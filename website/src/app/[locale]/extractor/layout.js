import { locales, defaultLocale } from '../../dictionaries';

export async function generateMetadata({ params }) {
  const { locale } = await params;
  const baseUrl = 'https://www.auto-flow.studio';

  // Build hreflang alternates for every locale
  const languages = { 'en': `${baseUrl}/extractor`, 'x-default': `${baseUrl}/extractor` };
  locales.filter(l => l !== defaultLocale).forEach(l => {
    languages[l] = `${baseUrl}/${l}/extractor`;
  });

  return {
    title: "AI Video Prompt Extractor — Reverse Engineer Runway, Sora & Midjourney Prompts | AutoFlow",
    description: "Upload any AI-generated video and instantly extract the exact image prompts, motion prompts, voiceover scripts, and character descriptions. Works with Runway Gen-3, OpenAI Sora, Kling AI, Midjourney, Luma Dream Machine, and Pika Labs. Free online tool by AutoFlow.",
    keywords: [
      "AI video prompt extractor",
      "reverse engineer AI video",
      "extract prompt from AI video",
      "video to prompt converter",
      "how to recreate AI videos",
      "Midjourney video prompts",
      "Runway Gen-3 prompt extractor",
      "extract Sora video prompts",
      "Kling AI reverse engineer",
      "Luma Dream Machine prompts",
      "Pika Labs prompts",
      "Google Veo 2 prompts",
      "AI video analysis tool",
      "reverse engineer video style",
      "AI prompt extraction tool",
      // European language keywords
      "extracteur de prompts vidéo IA",
      "KI Video Prompt Extraktor",
      "extractor de prompts de video IA",
      "estrattore prompt video AI",
    ],
    alternates: {
      canonical: locale === defaultLocale
        ? `${baseUrl}/extractor`
        : `${baseUrl}/${locale}/extractor`,
      languages,
    },
    openGraph: {
      title: "AI Video Prompt Extractor — Reverse Engineer Any AI Video | AutoFlow",
      description: "Upload any AI video to extract the exact image and motion prompts used to create it. Works with Runway, Sora, Kling, Midjourney, Luma, and Google Flow.",
      url: `${baseUrl}/extractor`,
      siteName: "AutoFlow",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "AI Video Prompt Extractor | AutoFlow",
      description: "Reverse-engineer any AI video. Extract image prompts, motion prompts, and character designs instantly.",
    },
  };
}

export default function ExtractorLayout({ children }) {
  return <>{children}</>;
}
