export const dynamic = 'force-static';

export const metadata = {
  title: "Contact AutoFlow — Support, Billing and Feedback",
  description:
    "How to reach AutoFlow: email support@auto-flow.studio for help with the Chrome extensions, the Video Prompt Extractor, billing, your account or your data.",
  alternates: {
    canonical: "https://www.auto-flow.studio/contact",
  },
  openGraph: {
    title: "Contact AutoFlow",
    description: "Support, billing, privacy requests and feedback for AutoFlow.",
    url: "https://www.auto-flow.studio/contact",
  },
};

export default function ContactPage() {
  return (
    <>
      <section className="legal-hero">
        <div className="container">
          <h1>Contact</h1>
          <p className="text-secondary">
            Email <a href="mailto:support@auto-flow.studio">support@auto-flow.studio</a> — a person reads every message.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container legal-content">
          <h2>Before you write</h2>
          <p>
            Many questions are already answered in the <a href="/faq">FAQ</a>, and the{" "}
            <a href="/changelog">changelog</a> says what changed in each release. If a tool stopped
            working after an update, the changelog is the quickest place to check.
          </p>

          <h2>Help with a tool</h2>
          <p>
            Write to <a href="mailto:support@auto-flow.studio?subject=Help%20with%20AutoFlow">support@auto-flow.studio</a>.
            It helps us answer in one reply if you include:
          </p>
          <ul>
            <li>which tool — Queue Manager, Studio, the Extractor, Why it works or Clipping;</li>
            <li>the email address of your AutoFlow account;</li>
            <li>what you expected to happen and what happened instead;</li>
            <li>a screenshot, and for the extensions the version shown in the side panel.</li>
          </ul>

          <h2>Billing and Pro</h2>
          <p>
            For a payment, a renewal, a refund request or Pro not switching on, email us from the
            address you paid with and include the date of the payment. Plans and prices are on the{" "}
            <a href="/pricing">pricing page</a>; the rules for subscriptions are in the{" "}
            <a href="/terms">Terms of Service</a>.
          </p>

          <h2>Your data</h2>
          <p>
            To see, export or delete the data we hold about your account, email us with the subject
            &quot;Data request&quot; from your account&apos;s address. What we keep and for how long is set out
            in the <a href="/privacy">Privacy Policy</a>. Saved extractions can also be deleted at any
            time from your dashboard.
          </p>

          <h2>Ideas and partnerships</h2>
          <p>
            Feature ideas, workflow suggestions, and press or partnership enquiries go to the same
            address. We read all of them, and many features in the changelog started as an email.
          </p>

          <h2>Who you are writing to</h2>
          <p>
            AutoFlow is built and run independently by amine.smpc. It is not affiliated with Google,
            OpenAI, Anthropic, xAI or the AI services it works with, so questions about those
            services&apos; own accounts and limits are best sent to them. More on the{" "}
            <a href="/about">About page</a>.
          </p>
        </div>
      </section>
    </>
  );
}
