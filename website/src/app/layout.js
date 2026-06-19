import "./globals.css";
import "./layout.css";
import "./page.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import Script from "next/script";
import MobileMenu from "./MobileMenu";
import StoreLink from "./StoreLink";
import { AuthProvider } from "../context/AuthContext";
import AuthButtons from "./AuthButtons";
import MobileBanner from "./MobileBanner";

export const metadata = {
  metadataBase: new URL("https://www.auto-flow.studio"),
  title: {
    default: "AutoFlow for Google Flow — Batch Prompts & Bulk 4K Veo Video Automation",
    template: "%s | AutoFlow — AI Video Automation",
  },
  description:
    "AutoFlow automates Google Flow (Veo): batch hundreds of prompts, smart queues, auto-retry, and bulk 4K downloads. Free Chrome extension for AI video creators.",
  keywords: [
    // Brand
    "AutoFlow",
    "AutoFlow Chrome extension",
    "AutoFlow for Google Flow",
    "AutoFlow Extractor",
    
    // Primary Core Features
    "Google Flow",
    "Google Flow automation",
    "Google Flow batch processing",
    "Google Flow Chrome extension",
    "Google Flow video generator",
    "Google Flow bulk download",
    "Google Veo 2 automation",
    "Imagen 3 video generation",
    
    // Extractor & Prompt Reverse-Engineering
    "AI video prompt extractor",
    "reverse-engineer AI video",
    "extract prompt from AI video",
    "Midjourney video prompts",
    "Runway Gen-3 prompts",
    "Sora prompt engineering",
    "Kling AI prompts",
    "Luma Dream Machine prompts",
    "Pika Labs prompts",
    "AI video prompt gallery",
    "best AI video prompts",
    
    // AI Video — top search terms
    "AI video generation",
    "AI video generator",
    "AI video maker",
    "AI video creator",
    "AI video automation",
    "automated video generation",
    "batch AI video generation",
    "bulk AI video creation",
    
    // Specific features
    "text to video AI",
    "image to video AI",
    "AI video from text",
    "AI video from image",
    "video prompt automation",
    "batch video prompts",
    "video queue manager",
    "AI video batch download",
    "4K AI video download",
    "AI video upscale",
    
    // Technology
    "Chrome extension video",
    "Chrome extension AI",
    "Veo video generation",
    "Veo 3 automation",
    "Google AI video",
    
    // Long-tail — what people actually search
    "how to batch generate videos in Google Flow",
    "automate Google Flow prompts",
    "Google Flow download all videos",
    "Google Flow queue system",
    "bulk video generation tool",
    "AI video production automation",
    "generate multiple AI videos at once",
    "Google Flow auto retry",
    "reference image video generation",
    "how to reverse engineer Midjourney prompts",
    "how to extract Runway Gen 3 prompts",
    
    // Competitor/alternative terms
    "best AI video automation tool",
    "free AI video generator Chrome extension",
    "fastest AI video generation",
    
    // US-specific monetization terms
    "make money with AI videos",
    "AI video side hustle",
    "how to make money with AI",
    "AI passive income",
    "faceless YouTube channel AI",
    "AI video monetization",
    "sell AI generated videos",
    "AI stock footage",
  ],
  authors: [{ name: "AutoFlow" }],
  creator: "AutoFlow",
  publisher: "AutoFlow",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://www.auto-flow.studio",
    siteName: "AutoFlow for Google Flow",
    title: "AutoFlow for Google Flow — Batch Prompts & Bulk 4K Veo Video Automation",
    description:
      "AutoFlow automates Google Flow (Veo): batch hundreds of prompts, smart queues, auto-retry, and bulk 4K downloads. Free Chrome extension for AI video creators.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "AutoFlow — Automate AI Video Generation with Google Flow",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AutoFlow for Google Flow — Batch Prompts & Bulk 4K Veo Video Automation",
    description:
      "AutoFlow automates Google Flow (Veo): batch hundreds of prompts, smart queues, auto-retry, and bulk 4K downloads. Free Chrome extension for AI video creators.",
    images: ["/og-image.png"],
  },
  alternates: {
    languages: {
      "en": "https://www.auto-flow.studio",
      "ar": "https://www.auto-flow.studio/ar",
      "fr": "https://www.auto-flow.studio/fr",
      "es": "https://www.auto-flow.studio/es",
      "de": "https://www.auto-flow.studio/de",
      "it": "https://www.auto-flow.studio/it",
      "x-default": "https://www.auto-flow.studio",
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "iifc_AkbtTDsKwsKgHHwFuW23nN_kJD2PxGXuyM8Bw8",
  },
};

import { Inter } from 'next/font/google';

const inter = Inter({ 
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* ── Google Analytics (GA4) ── */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-ZJ953YL6EK"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-ZJ953YL6EK');
          `}
        </Script>

        {/* ── Subscribe with Google (SwG) ── */}
        <Script
          src="https://news.google.com/swg/js/v1/swg-basic.js"
          strategy="afterInteractive"
        />
        <Script id="swg-init" strategy="afterInteractive">
          {`
            (self.SWG_BASIC = self.SWG_BASIC || []).push(basicSubscriptions => {
              basicSubscriptions.init({
                type: "NewsArticle",
                isPartOfType: ["Product"],
                isPartOfProductId: "CAow0LrLDA:openaccess",
                clientOptions: { theme: "light", lang: "en-GB" },
              });
            });
          `}
        </Script>
      </head>
      <body>
        {/* ── Organization Schema — tells Google who you are ── */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "AutoFlow",
              alternateName: "AutoFlow for Google Flow",
              url: "https://www.auto-flow.studio",
              logo: {
                "@type": "ImageObject",
                url: "https://www.auto-flow.studio/og-image.png"
              },
              description:
                "AutoFlow automates Google Flow AI video generation — batch prompts, smart queues, auto-retry, and bulk download.",
              contactPoint: {
                "@type": "ContactPoint",
                email: "support@auto-flow.studio",
                contactType: "customer support",
              },
            }),
          }}
        />
        {/* ── WebSite Schema — enables search box in Google ── */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "AutoFlow",
              alternateName: "AutoFlow for Google Flow",
              url: "https://www.auto-flow.studio",
              potentialAction: {
                "@type": "SearchAction",
                target: "https://www.auto-flow.studio/faq?q={search_term_string}",
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />
        <AuthProvider>
          <Header />
          <main>{children}</main>
          <Footer />
        </AuthProvider>
        <MobileBanner />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

function Header() {
  return (
    <header className="site-header">
      <nav className="container header-nav">
        <a href="/" className="logo">
          <span className="logo-icon">⚡</span>
          <span className="logo-text">AutoFlow</span>
        </a>
        <ul className="nav-links">
          <li><a href="/#features">Features</a></li>
          <li><a href="/#how-it-works">How It Works</a></li>
          <li><a href="/extractor">Extractor</a></li>
          <li><a href="/prompts">Prompts</a></li>
          <li><a href="/pricing">Pricing</a></li>
          <li><a href="/blog">Blog</a></li>
          <li><a href="/faq">FAQ</a></li>
        </ul>
        <div className="header-actions">
          <div className="lang-switcher">
            <a href="/" className="lang-option active">EN</a>
            <a href="/es" className="lang-option">ES</a>
            <a href="/de" className="lang-option">DE</a>
            <a href="/ar" className="lang-option">AR</a>
            <a href="/fr" className="lang-option">FR</a>
            <a href="/it" className="lang-option">IT</a>
          </div>
          <AuthButtons />
          <StoreLink className="btn btn-primary btn-header">
            Install Free
          </StoreLink>
        </div>
        <MobileMenu />
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <a href="/" className="logo">
            <span className="logo-icon">⚡</span>
            <span className="logo-text">AutoFlow</span>
          </a>
          <p className="text-secondary">
            Automate AI video generation with Google Flow. Batch process, queue,
            and download — all on autopilot.
          </p>
        </div>
        <div className="footer-col">
          <span className="footer-heading">Product</span>
          <ul>
            <li><a href="/#features">Features</a></li>
            <li><a href="/#how-it-works">How It Works</a></li>
            <li><a href="/pricing">Pricing</a></li>
            <li><a href="/prompts">Prompts</a></li>
            <li><a href="/blog">Blog</a></li>
          </ul>
        </div>
        <div className="footer-col">
          <span className="footer-heading">Support</span>
          <ul>
            <li><a href="/faq">FAQ</a></li>
            <li><a href="mailto:support@auto-flow.studio">Contact</a></li>
          </ul>
        </div>
        <div className="footer-col">
          <span className="footer-heading">Legal</span>
          <ul>
            <li><a href="/privacy">Privacy Policy</a></li>
            <li><a href="/terms">Terms of Service</a></li>
          </ul>
        </div>
      </div>
      <div className="container footer-bottom">
        <p className="text-secondary">
          © {new Date().getFullYear()} AutoFlow. Not affiliated with Google.
          Third-party automation tool.
        </p>
      </div>
    </footer>
  );
}
