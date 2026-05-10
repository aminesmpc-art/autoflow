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

export const metadata = {
  metadataBase: new URL("https://auto-flow.studio"),
  title: {
    default: "AutoFlow — Automate Google Flow AI Video Generation | Batch Prompts & Queue Manager",
    template: "%s | AutoFlow — AI Video Automation",
  },
  description:
    "AutoFlow Chrome extension automates Google Flow video generation. Batch process hundreds of prompts, smart queue management, auto-retry failures, bulk download in 4K. Generate AI videos 10x faster — text-to-video, image-to-video, and ingredients mode. Free to install.",
  keywords: [
    // Brand
    "AutoFlow",
    "AutoFlow Chrome extension",
    "AutoFlow for Google Flow",
    // Primary — high volume
    "Google Flow",
    "Google Flow automation",
    "Google Flow batch processing",
    "Google Flow Chrome extension",
    "Google Flow video generator",
    "Google Flow bulk download",
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
    // Competitor/alternative terms
    "best AI video automation tool",
    "free AI video generator Chrome extension",
    "fastest AI video generation",
  ],
  authors: [{ name: "AutoFlow" }],
  creator: "AutoFlow",
  publisher: "AutoFlow",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://auto-flow.studio",
    siteName: "AutoFlow",
    title: "AutoFlow — Automate Google Flow AI Video Generation",
    description:
      "Batch process hundreds of prompts, auto-retry failures, bulk download in 4K. The #1 Chrome extension for Google Flow automation. Free to install.",
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
    title: "AutoFlow — Automate Google Flow AI Video Generation",
    description:
      "Batch process prompts, smart queues, auto-retry, bulk download. Generate AI videos 10x faster. Free Chrome extension.",
    images: ["/og-image.png"],
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

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
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
              url: "https://auto-flow.studio",
              logo: {
                "@type": "ImageObject",
                url: "https://auto-flow.studio/og-image.png"
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
              url: "https://auto-flow.studio",
              potentialAction: {
                "@type": "SearchAction",
                target: "https://auto-flow.studio/faq?q={search_term_string}",
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
          <li><a href="/pricing">Pricing</a></li>
          <li><a href="/blog">Blog</a></li>
          <li><a href="/faq">FAQ</a></li>
        </ul>
        <div className="header-actions">
          <div className="lang-switcher">
            <a href="/" className="lang-option active">EN</a>
            <a href="/ar" className="lang-option">AR</a>
            <a href="/fr" className="lang-option">FR</a>
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
