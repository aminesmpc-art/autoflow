export const dynamic = 'force-static';
import FAQClient from "./faq-client";

export const metadata = {
  title: "FAQ — AutoFlow",
  description:
    "Frequently asked questions about AutoFlow — how it works, installation, Free vs Pro plans, privacy, and more.",
  alternates: {
    canonical: "https://auto-flow.studio/faq",
  },
};

const faqs = [
  {
    q: "What is AutoFlow?",
    a: "AutoFlow is a Chrome extension that automates your workflow on Google Flow (labs.google). It lets you batch process video prompts, manage queues, attach images, and auto-download results — turning hours of manual clicking into minutes.",
  },
  {
    q: "Is AutoFlow affiliated with Google?",
    a: "No. AutoFlow is an independent third-party tool. It automates your interactions with Google Flow inside your own browser session. We do not access Google's servers directly.",
  },
  {
    q: "How do I install AutoFlow?",
    a: "Click 'Install Free' to go to the Chrome Web Store. Click 'Add to Chrome' and the extension will be ready. Open Google Flow, then click the AutoFlow icon to open the side panel.",
  },
  {
    q: "What's the difference between Free and Pro?",
    a: "Free gives you daily-limited text and full-feature prompts. Pro removes all limits — unlimited prompts, bulk upscale, character libraries, frame chains, and priority support.",
  },
  {
    q: "What are 'text' vs 'full-feature' prompts?",
    a: "Text prompts are pure text-to-video. Full-feature prompts include image attachments (reference images, character images, or frame chains). Full-feature prompts have a separate daily limit on the Free plan.",
  },
  {
    q: "Does AutoFlow store my prompts or videos?",
    a: "No. All data stays in your browser's local storage. AutoFlow never uploads your prompts, images, or generated videos to any external server. Only anonymous usage counts are sent to verify your plan limits.",
  },
  {
    q: "Can I use AutoFlow on multiple tabs?",
    a: "AutoFlow runs one queue at a time on a single Google Flow tab. You can prepare queues in the side panel while another is running, then switch when ready.",
  },
  {
    q: "What happens if my generation fails?",
    a: "AutoFlow automatically retries failed prompts (up to 2 retries). If a prompt still fails, it's marked as failed and you can retry it later or copy the failed prompts to try again.",
  },
  {
    q: "How do I cancel my Pro subscription?",
    a: "You can cancel anytime from your account settings. Your Pro features will remain active until the end of your billing period.",
  },
];

export default function FAQPage() {
  return (
    <>
      {/* ── FAQPage JSON-LD Schema for Google Rich Snippets ── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqs.map((faq) => ({
              "@type": "Question",
              name: faq.q,
              acceptedAnswer: {
                "@type": "Answer",
                text: faq.a,
              },
            })),
          }),
        }}
      />

      {/* ── BreadcrumbList Schema ── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: "https://auto-flow.studio",
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "FAQ",
                item: "https://auto-flow.studio/faq",
              },
            ],
          }),
        }}
      />

      <section className="faq-hero">
        <div className="container">
          <div className="badge">FAQ</div>
          <h1>
            Frequently Asked{" "}
            <span className="text-gradient">Questions</span>
          </h1>
          <p>Everything you need to know about AutoFlow.</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <FAQClient faqs={faqs} />
        </div>
      </section>
    </>
  );
}
