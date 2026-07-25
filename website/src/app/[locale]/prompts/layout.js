import { locales, defaultLocale } from '../../dictionaries';

export async function generateMetadata({ params }) {
  const { locale } = await params;
  const baseUrl = 'https://www.auto-flow.studio';

  const languages = { 'en': `${baseUrl}/prompts`, 'x-default': `${baseUrl}/prompts` };
  locales.filter(l => l !== defaultLocale).forEach(l => {
    languages[l] = `${baseUrl}/${l}/prompts`;
  });

  return {
    title: "AI Video Prompts Gallery — Best Midjourney, Runway & Sora Prompts | AutoFlow",
    description: "Browse the community library of reverse-engineered AI video prompts. Discover exact image and motion prompts for Runway Gen-3, OpenAI Sora, Kling AI, Midjourney, Luma Dream Machine, and Google Veo. Free to copy and use.",
    keywords: [
      "AI video prompts",
      "best AI video prompts",
      "AI video prompt gallery",
      "Midjourney video prompts",
      "Runway Gen-3 prompts",
      "Sora prompt library",
      "Kling AI prompts",
      "Luma Dream Machine prompts",
      "Google Veo prompts",
      "text to video prompts",
      "image to video prompts",
      "reverse engineered AI prompts",
      "AI video prompt examples",
      "free AI video prompts",
      // European keywords
      "prompts vidéo IA gratuits",
      "KI Video Prompts Galerie",
      "prompts de video IA gratis",
      "galleria prompt video AI",
    ],
    alternates: {
      canonical: locale === defaultLocale
        ? `${baseUrl}/prompts`
        : `${baseUrl}/${locale}/prompts`,
      languages,
    },
    openGraph: {
      title: "AI Video Prompts Gallery — Discover & Copy Top AI Prompts | AutoFlow",
      description: "Explore the community library of reverse-engineered AI video prompts. Learn exactly how the best AI videos are made — free to copy and use.",
      url: `${baseUrl}/prompts`,
      siteName: "AutoFlow",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "AI Video Prompts Gallery | AutoFlow",
      description: "Browse free reverse-engineered prompts for Runway, Sora, Midjourney, Kling, and more.",
    },
  };
}

export default function PromptsLayout({ children }) {
  return <>{children}</>;
}
