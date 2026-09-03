
export const dynamic = 'force-static';

export const metadata = {
  title: "Privacy Policy",
  description:
    "AutoFlow Studio privacy policy. Learn what data we collect, how we handle it, where it is stored, and your rights.",
  alternates: {
    canonical: "https://www.auto-flow.studio/privacy",
  },
  openGraph: {
    title: "Privacy Policy — AutoFlow Studio",
    description:
      "AutoFlow Studio privacy policy. Details on data collection, handling, storage, sharing, and user rights.",
    url: "https://www.auto-flow.studio/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <>
      <section className="legal-hero">
        <div className="container">
          <h1>Privacy Policy</h1>
          <p className="text-secondary">Last updated: 23 August 2026</p>
        </div>
      </section>

      <section className="section">
        <div className="container legal-content">
          {/* ── 1. Introduction ── */}
          <h2>1. Introduction</h2>
          <p>
            AutoFlow Studio (&quot;AutoFlow&quot;, &quot;we&quot;, &quot;us&quot;,
            &quot;our&quot;) is a Chrome browser extension operated by amine.smpc.
            This Privacy Policy explains what personal data we collect through the
            AutoFlow Studio extension and the website at{" "}
            <a href="https://www.auto-flow.studio">auto-flow.studio</a>, how we
            use it, how we store and protect it, who we share it with, and your
            rights regarding that data.
          </p>
          <p>
            By installing or using AutoFlow Studio you agree to this policy. If
            you do not agree, please uninstall the extension and do not use our
            services.
          </p>

          {/* ── 2. Data We Collect ── */}
          <h2>2. Data We Collect</h2>

          <h3>2.1 Account &amp; Authentication Data</h3>
          <p>When you create an account or sign in, we collect:</p>
          <ul>
            <li>
              <strong>Email address</strong> — used to identify your account,
              communicate important service updates, and link your subscription.
            </li>
            <li>
              <strong>Password</strong> (email/password sign-up only) — hashed
              on the server; we never store or transmit your password in plain
              text.
            </li>
            <li>
              <strong>Google ID token</strong> (Google Sign-In only) — received
              from Google via Chrome&apos;s <code>identity</code> API and sent to
              our server solely to verify your identity. We do not receive or
              store your Google password.
            </li>
          </ul>

          <h3>2.2 Usage Data</h3>
          <p>
            To enforce plan limits (free vs. Pro) and prevent abuse, we collect
            the following <em>numeric counts only</em>:
          </p>
          <ul>
            <li>
              <strong>Prompt counts</strong> — number of text and full prompts
              submitted per day.
            </li>
            <li>
              <strong>Workflow run counts</strong> — number of queue runs started
              per day, broken down by mode (lite / flow / full).
            </li>
            <li>
              <strong>Download counts</strong> — number of media downloads per
              day.
            </li>
            <li>
              <strong>Node and generate counts</strong> — number of nodes and
              generation steps per workflow run.
            </li>
          </ul>
          <p>
            These counts are tied to your account for billing purposes. We do{" "}
            <strong>not</strong> collect the content of your prompts, the text of
            AI responses, or any images or videos.
          </p>

          <h3>2.3 Community Template Submissions (Optional)</h3>
          <p>
            If you choose to share a workflow as a community template, we
            collect:
          </p>
          <ul>
            <li>
              <strong>Your display name</strong> (author name you provide).
            </li>
            <li>
              <strong>The workflow payload</strong> — the node graph, prompt
              text, and settings you explicitly choose to publish.
            </li>
          </ul>
          <p>
            This is entirely voluntary. Workflows are never uploaded unless you
            press the &quot;Share&quot; button.
          </p>

          <h3>2.4 Review Reward Claims (Optional)</h3>
          <p>
            If you claim a review reward, we collect the{" "}
            <strong>reviewer name</strong> you provide so we can verify the
            review.
          </p>

          <h3>2.5 Website Content Read by the Extension</h3>
          <p>
            AutoFlow Studio injects content scripts into the following sites to
            automate video generation workflows on your behalf:
          </p>
          <ul>
            <li>labs.google (Google Flow / Veo)</li>
            <li>chatgpt.com</li>
            <li>gemini.google.com</li>
            <li>claude.ai</li>
            <li>grok.com</li>
            <li>chat.z.ai</li>
          </ul>
          <p>
            On these sites, the extension reads text and images{" "}
            <strong>only from the composer and result areas</strong> to bring AI
            responses back into your workflow. This data is processed locally in
            your browser and is <strong>not</strong> sent to our servers. The
            extension does not access your conversation history, other tabs, or
            any other website.
          </p>

          {/* ── 3. Data We Do NOT Collect ── */}
          <h2>3. Data We Do NOT Collect</h2>
          <ul>
            <li>Your prompts, AI responses, or generated images/videos</li>
            <li>Your browsing history or activity on sites other than the six listed above</li>
            <li>Financial or payment information (payments are handled by our third-party payment processor, Whop; see Section 6)</li>
            <li>Location data</li>
            <li>Health or biometric data</li>
            <li>
              Any personal data beyond what is described in Section 2
            </li>
          </ul>

          {/* ── 4. How We Use Your Data ── */}
          <h2>4. How We Use Your Data</h2>
          <ul>
            <li>
              <strong>Authentication:</strong> To sign you in, issue and refresh
              session tokens, and reset your password.
            </li>
            <li>
              <strong>Plan enforcement:</strong> To check and enforce daily and
              monthly usage limits for your plan tier.
            </li>
            <li>
              <strong>Service operation:</strong> To maintain the extension,
              detect and prevent abuse, and improve reliability.
            </li>
            <li>
              <strong>Community features:</strong> To display shared templates
              and attribute them to their authors.
            </li>
          </ul>
          <p>
            We do <strong>not</strong> use your data for advertising,
            profiling, or any purpose unrelated to operating AutoFlow Studio.
          </p>

          {/* ── 5. Where and How Data Is Stored ── */}
          <h2>5. Where and How Data Is Stored</h2>

          <h3>5.1 Data Stored Locally (On Your Device)</h3>
          <p>
            The following data is stored entirely in your browser using
            Chrome&apos;s <code>chrome.storage.local</code> and IndexedDB. It
            never leaves your device unless you explicitly share it:
          </p>
          <ul>
            <li>Workflows (node graphs, prompt text, settings)</li>
            <li>Reference images and extracted video frames</li>
            <li>Queue configurations and run logs</li>
            <li>Extension settings and preferences</li>
            <li>Authentication tokens (used to stay signed in)</li>
          </ul>

          <h3>5.2 Data Stored on Our Servers</h3>
          <p>
            The following data is stored on our backend at{" "}
            <code>api.auto-flow.studio</code>, hosted on secured
            infrastructure:
          </p>
          <ul>
            <li>Email address and hashed password</li>
            <li>Plan type and subscription status</li>
            <li>Daily and monthly usage counts (numeric values only)</li>
            <li>
              Community templates you choose to share (pending moderation before
              publication)
            </li>
            <li>Review reward claim records</li>
          </ul>

          {/* ── 6. Data Sharing and Third Parties ── */}
          <h2>6. Data Sharing and Third Parties</h2>
          <p>
            We do <strong>not sell</strong> your data to any third party.
          </p>
          <p>We share data only with the following parties:</p>
          <ul>
            <li>
              <strong>Google (Sign-In):</strong> When you sign in with Google,
              your Google ID token is sent from Google to our server to verify
              your identity. We receive your email address from this token. No
              other Google data is accessed.
            </li>
            <li>
              <strong>Whop (Payment processing):</strong> If you upgrade to Pro,
              payment is processed by{" "}
              <a
                href="https://whop.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
              >
                Whop
              </a>
              . Your email is shared with Whop to match the payment to your
              AutoFlow account. We do not handle credit card numbers or payment
              details directly.
            </li>
            <li>
              <strong>AI platforms (in-browser only):</strong> The extension
              interacts with the AI platforms listed in Section 2.5, but this
              happens entirely within your browser session using your own
              signed-in accounts. No data is routed through our servers.
            </li>
            <li>
              <strong>Vercel (Website hosting):</strong> Our website at
              auto-flow.studio is hosted on Vercel, which may collect standard
              web analytics (page views, country-level geo). This does not apply
              to the extension itself.
            </li>
          </ul>
          <p>
            Your data is <strong>not</strong> used or transferred for purposes
            unrelated to the extension&apos;s core functionality, and is{" "}
            <strong>not</strong> used to determine creditworthiness or for
            lending purposes.
          </p>

          {/* ── 7. Data Retention ── */}
          <h2>7. Data Retention</h2>
          <ul>
            <li>
              <strong>Local data</strong> is retained until you clear it
              manually, clear your browser data, or uninstall the extension.
            </li>
            <li>
              <strong>Server-side account data</strong> is retained for as long
              as your account is active. Usage counts are aggregated daily and
              older daily records are automatically purged.
            </li>
            <li>
              <strong>Deleted accounts:</strong> Upon account deletion request,
              all personal data (email, usage records, shared templates) is
              permanently deleted from our servers within 30 days.
            </li>
          </ul>

          {/* ── 8. Your Rights ── */}
          <h2>8. Your Rights</h2>
          <p>You have the right to:</p>
          <ul>
            <li>
              <strong>Access</strong> the personal data we hold about you.
            </li>
            <li>
              <strong>Correct</strong> inaccurate data (e.g., update your email
              or password).
            </li>
            <li>
              <strong>Delete</strong> your account and all associated data.
            </li>
            <li>
              <strong>Export</strong> your locally stored workflows (the
              extension provides a Share/Export feature).
            </li>
            <li>
              <strong>Withdraw consent</strong> by uninstalling the extension at
              any time, which stops all data collection immediately.
            </li>
          </ul>
          <p>
            To exercise any of these rights, email{" "}
            <a href="mailto:support@auto-flow.studio">
              support@auto-flow.studio
            </a>
            .
          </p>

          {/* ── 9. Security ── */}
          <h2>9. Security</h2>
          <p>
            We protect your data with the following measures:
          </p>
          <ul>
            <li>Passwords are hashed server-side and never stored in plain text.</li>
            <li>All communication between the extension and our backend uses HTTPS (TLS encryption).</li>
            <li>Authentication tokens are stored locally in Chrome&apos;s sandboxed extension storage, inaccessible to other extensions or websites.</li>
            <li>The extension does not load or execute any remotely fetched code.</li>
          </ul>

          {/* ── 10. Children's Privacy ── */}
          <h2>10. Children&apos;s Privacy</h2>
          <p>
            AutoFlow Studio is not directed at children under the age of 13. We
            do not knowingly collect personal data from children. If you believe
            a child has provided us with personal data, please contact us and we
            will delete it promptly.
          </p>

          {/* ── 11. Changes to This Policy ── */}
          <h2>11. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. When we do, we
            will update the &quot;Last updated&quot; date at the top of this page.
            Continued use of the extension after changes constitutes acceptance
            of the updated policy.
          </p>

          {/* ── 12. Contact ── */}
          <h2>12. Contact</h2>
          <p>
            If you have questions, concerns, or requests regarding this Privacy
            Policy or your personal data, contact us at:
          </p>
          <ul>
            <li>
              Email:{" "}
              <a href="mailto:support@auto-flow.studio">
                support@auto-flow.studio
              </a>
            </li>
            <li>
              Website:{" "}
              <a href="https://www.auto-flow.studio">
                auto-flow.studio
              </a>
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}

