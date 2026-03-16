


export const metadata = {
  title: "Privacy Policy",
  description: "AutoFlow privacy policy. Learn how we handle your data.",
};

export default function PrivacyPage() {
  return (
    <>
      <section className="legal-hero">
        <div className="container">
          <h1>Privacy Policy</h1>
          <p className="text-secondary">Last updated: March 2026</p>
        </div>
      </section>

      <section className="section">
        <div className="container legal-content">
          <h2>Overview</h2>
          <p>
            AutoFlow (&quot;we&quot;, &quot;our&quot;, &quot;the extension&quot;) is a Chrome
            extension that automates interactions with Google Flow. We take your privacy seriously.
            This policy explains what data we collect, why, and how we handle it.
          </p>

          <h2>Data We Collect</h2>
          <p>AutoFlow collects minimal data:</p>
          <ul>
            <li><strong>Account info:</strong> Email address for authentication.</li>
            <li><strong>Usage counts:</strong> Anonymous daily prompt counts to enforce plan limits.</li>
          </ul>

          <h2>Data We Do NOT Collect</h2>
          <ul>
            <li>Your prompts or text content</li>
            <li>Your images or generated videos</li>
            <li>Your browsing history or activity on other sites</li>
            <li>Any personal data beyond your email</li>
          </ul>

          <h2>Where Data Is Stored</h2>
          <p>
            All your prompts, queues, settings, and images are stored locally in your browser
            using Chrome&apos;s built-in storage and IndexedDB. This data never leaves your device.
          </p>
          <p>
            Account data (email, plan type, usage counts) is stored on our secure servers.
          </p>

          <h2>Third-Party Services</h2>
          <p>
            AutoFlow interacts with Google Flow (labs.google) within your browser session.
            We do not share your data with any other third parties.
          </p>

          <h2>Data Retention</h2>
          <p>
            Local data is retained until you clear it or uninstall the extension. Account data
            is deleted upon request. To delete your account, email{" "}
            <a href="mailto:support@auto-flow.studio">support@auto-flow.studio</a>.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about privacy? Email us at{" "}
            <a href="mailto:support@auto-flow.studio">support@auto-flow.studio</a>.
          </p>
        </div>
      </section>
    </>
  );
}
