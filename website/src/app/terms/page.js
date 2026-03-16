
export const dynamic = 'force-static';

export const metadata = {
  title: "Terms of Service",
  description:
    "AutoFlow terms of service. Rules and guidelines for using the AutoFlow Chrome extension for Google Flow automation.",
  alternates: {
    canonical: "https://auto-flow.studio/terms",
  },
  openGraph: {
    title: "Terms of Service — AutoFlow",
    description: "Rules and guidelines for using AutoFlow, the Chrome extension for Google Flow automation.",
    url: "https://auto-flow.studio/terms",
  },
};

export default function TermsPage() {
  return (
    <>
      <section className="legal-hero">
        <div className="container">
          <h1>Terms of Service</h1>
          <p className="text-secondary">Last updated: March 2026</p>
        </div>
      </section>

      <section className="section">
        <div className="container legal-content">
          <h2>Acceptance</h2>
          <p>
            By installing or using AutoFlow, you agree to these terms. If you do not agree,
            please uninstall the extension.
          </p>

          <h2>What AutoFlow Does</h2>
          <p>
            AutoFlow is a browser extension that automates your interactions with Google Flow
            (labs.google). It operates within your existing browser session and does not bypass
            any access controls or authentication.
          </p>

          <h2>Not Affiliated with Google</h2>
          <p>
            AutoFlow is an independent third-party tool. It is not developed by, endorsed by,
            or affiliated with Google. Google Flow is a product of Google LLC.
          </p>

          <h2>Use at Your Own Risk</h2>
          <p>
            You use AutoFlow at your own risk. We are not responsible for any changes Google
            makes to Flow that may affect AutoFlow&apos;s functionality. We do our best to keep the
            extension working but cannot guarantee uninterrupted service.
          </p>

          <h2>Fair Usage</h2>
          <p>
            Free accounts have daily prompt limits. Attempting to circumvent these limits
            (e.g., creating multiple accounts) may result in account suspension.
          </p>

          <h2>Payments & Refunds</h2>
          <p>
            Pro subscriptions are billed monthly. You can cancel at any time. Refunds may be
            issued within 7 days of purchase at our discretion.
          </p>

          <h2>Modifications</h2>
          <p>
            We may update these terms at any time. Continued use of AutoFlow after changes
            constitutes acceptance of the updated terms.
          </p>

          <h2>Contact</h2>
          <p>
            Questions? Email us at{" "}
            <a href="mailto:support@auto-flow.studio">support@auto-flow.studio</a>.
          </p>
        </div>
      </section>
    </>
  );
}
