import "./download.css";

export const metadata = {
  title: "Download AutoFlow Pro — Direct Install for Maximum Reliability",
  description:
    "Download AutoFlow Pro directly for the most reliable Google Flow automation experience. Full-featured version with guaranteed prompt submission, trusted input events, and zero failures.",
  openGraph: {
    title: "Download AutoFlow Pro — Direct Install",
    description:
      "Get the full-featured AutoFlow Pro with guaranteed prompt submission and zero failures. Direct install from our website.",
  },
};

export default function DownloadPage() {
  return (
    <>
      {/* ── Hero Section ── */}
      <section className="download-hero section">
        <div className="container">
          <div className="hero-glow" />
          <div className="hero-content animate-in">
            <span className="badge">
              <span className="badge-dot" />
              Pro Version
            </span>
            <h1>
              Download <span className="text-gradient">AutoFlow Pro</span>
            </h1>
            <p className="hero-subtitle">
              The full-featured version with <strong>guaranteed prompt submission</strong> and{" "}
              <strong>zero generation failures</strong>. Install directly from our website
              for maximum reliability.
            </p>
            <a
              href="/autoflow-pro.zip"
              className="btn btn-primary btn-lg download-btn"
              id="download-pro-btn"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download AutoFlow Pro
            </a>
            <p className="hero-meta">
              Free • v1.0.0 • Chrome &amp; Edge compatible
            </p>
          </div>
        </div>
      </section>

      {/* ── Why Pro Section ── */}
      <section className="section why-pro">
        <div className="container">
          <div className="section-header">
            <h2>
              Why Install from <span className="text-gradient">Our Website</span>?
            </h2>
            <p>
              Google Flow uses advanced security that blocks automated clicks.
              The Pro version uses browser-native input to bypass this — something
              the Chrome Web Store doesn't allow.
            </p>
          </div>

          <div className="comparison-table">
            <div className="comparison-header">
              <div className="comparison-feature">Feature</div>
              <div className="comparison-store">Chrome Store</div>
              <div className="comparison-pro">Pro (Direct)</div>
            </div>
            <ComparisonRow
              feature="Queue & Batch Processing"
              store={true}
              pro={true}
            />
            <ComparisonRow
              feature="Auto Settings Configuration"
              store={true}
              pro={true}
            />
            <ComparisonRow
              feature="Library Scanner & Downloads"
              store={true}
              pro={true}
            />
            <ComparisonRow
              feature="Prompt Submission"
              store={false}
              storeNote="May fail silently"
              pro={true}
              proNote="100% reliable"
            />
            <ComparisonRow
              feature="Trusted Input Events"
              store={false}
              storeNote="Blocked by Chrome policy"
              pro={true}
              proNote="Full browser-native input"
            />
            <ComparisonRow
              feature="Zero Generation Failures"
              store={false}
              storeNote="Can miss prompts"
              pro={true}
              proNote="Guaranteed delivery"
            />
            <ComparisonRow
              feature="Auto-Updates"
              store={true}
              storeNote="Automatic"
              pro={false}
              proNote="Manual re-download"
            />
          </div>
        </div>
      </section>

      {/* ── Installation Guide ── */}
      <section className="section install-guide" id="install">
        <div className="container">
          <div className="section-header">
            <h2>
              How to <span className="text-gradient">Install</span>
            </h2>
            <p>
              It takes less than 2 minutes. Just follow these 4 simple steps.
            </p>
          </div>

          <div className="steps-grid">
            <Step
              number="1"
              title="Download the ZIP"
              description='Click the "Download AutoFlow Pro" button above. Your browser will download a .zip file.'
              icon="📥"
            />
            <Step
              number="2"
              title="Unzip the Folder"
              description='Right-click the downloaded file and select "Extract All" (Windows) or double-click it (Mac). You will get a folder called "autoflow-pro".'
              icon="📂"
            />
            <Step
              number="3"
              title="Open Chrome Extensions"
              description={
                <>
                  Open Chrome and go to{" "}
                  <code className="code-inline">chrome://extensions</code>
                  <br />
                  Turn on <strong>Developer mode</strong> using the toggle in the top-right corner.
                </>
              }
              icon="⚙️"
            />
            <Step
              number="4"
              title='Click "Load Unpacked"'
              description={
                <>
                  Click the <strong>"Load unpacked"</strong> button that appears.
                  Select the <strong>unzipped folder</strong> (the one containing{" "}
                  <code className="code-inline">manifest.json</code>).
                  <br />
                  <strong>Done!</strong> AutoFlow Pro is now installed.
                </>
              }
              icon="🚀"
            />
          </div>

          {/* ── Visual Guide ── */}
          <div className="visual-guide card-glass">
            <h3>📋 Quick Reference</h3>
            <div className="guide-steps">
              <div className="guide-step">
                <span className="guide-label">Chrome URL Bar:</span>
                <code className="code-block">chrome://extensions</code>
              </div>
              <div className="guide-step">
                <span className="guide-label">Developer Mode:</span>
                <span className="guide-toggle">
                  <span className="toggle-track">
                    <span className="toggle-thumb" />
                  </span>
                  ON
                </span>
              </div>
              <div className="guide-step">
                <span className="guide-label">Then click:</span>
                <span className="guide-button-mock">📦 Load unpacked</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Tech Explanation ── */}
      <section className="section tech-section">
        <div className="container">
          <div className="tech-card card-glass">
            <div className="tech-icon">🔒</div>
            <h3>Why Can't This Be on the Chrome Web Store?</h3>
            <p>
              Google Flow uses <strong>strict security checks</strong> on button
              clicks. It verifies that every click comes from a real human
              (checking a property called <code className="code-inline">isTrusted</code>).
            </p>
            <p>
              Regular Chrome extensions can only send "fake" clicks that Flow
              ignores. AutoFlow Pro uses Chrome's built-in{" "}
              <strong>DevTools Protocol</strong> to send real, hardware-level
              input events — identical to you pressing Enter on your keyboard.
            </p>
            <p>
              This requires the <code className="code-inline">debugger</code> permission,
              which the Chrome Web Store doesn't allow for non-developer tools.
              That's why we offer the Pro version as a direct download.
            </p>
            <div className="tech-note">
              <span className="tech-note-icon">ℹ️</span>
              <span>
                You may briefly see a <em>"Extension is debugging this tab"</em>{" "}
                banner when AutoFlow submits a prompt. This is normal and
                disappears in under a second. It's just Chrome confirming the
                trusted input was sent.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Safety Section ── */}
      <section className="section safety-section">
        <div className="container">
          <div className="section-header">
            <h2>
              100% <span className="text-gradient">Safe & Open</span>
            </h2>
            <p>Your security matters. Here's why you can trust AutoFlow Pro.</p>
          </div>
          <div className="grid-3 safety-grid">
            <div className="card safety-card">
              <div className="safety-icon">🔍</div>
              <h3>Open Source</h3>
              <p>
                The full source code is available for inspection. No hidden
                functionality, no data collection, no analytics.
              </p>
            </div>
            <div className="card safety-card">
              <div className="safety-icon">🔐</div>
              <h3>No Data Leaves Your Browser</h3>
              <p>
                AutoFlow runs entirely in your browser. Your prompts, images, and
                generated videos never touch our servers.
              </p>
            </div>
            <div className="card safety-card">
              <div className="safety-icon">🛡️</div>
              <h3>Minimal Permissions</h3>
              <p>
                Only accesses Google Flow pages. Cannot read your browsing
                history, passwords, or any other websites.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ Section ── */}
      <section className="section download-faq">
        <div className="container">
          <div className="section-header">
            <h2>
              Frequently Asked <span className="text-gradient">Questions</span>
            </h2>
          </div>
          <div className="faq-list">
            <FaqItem
              question="Will I get automatic updates?"
              answer='Not automatically — but we will notify you by email when a new version is available. You just download the new ZIP, replace the old folder, and click "Update" in chrome://extensions.'
            />
            <FaqItem
              question='What is the "Extension is debugging this tab" banner?'
              answer="This briefly appears (under 1 second) when AutoFlow sends a trusted key press to submit your prompt. It's Chrome confirming a real input event was sent. It's completely normal and harmless."
            />
            <FaqItem
              question="Is this safe to use?"
              answer="Yes. AutoFlow only accesses Google Flow pages and runs entirely in your browser. No data is sent to external servers. The source code is fully inspectable."
            />
            <FaqItem
              question="Can I use both the Chrome Store version and Pro?"
              answer="We recommend using only one at a time. If you have the Chrome Store version installed, disable it before loading the Pro version to avoid conflicts."
            />
            <FaqItem
              question="Does this work on Microsoft Edge?"
              answer='Yes! Edge is Chromium-based, so the same installation process works. Go to edge://extensions instead of chrome://extensions.'
            />
            <FaqItem
              question="How do I uninstall?"
              answer='Go to chrome://extensions, find AutoFlow Pro, and click "Remove". Then delete the downloaded folder.'
            />
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="section final-cta">
        <div className="container text-center">
          <h2>
            Ready for <span className="text-gradient">Zero-Failure</span> Automation?
          </h2>
          <p className="text-secondary" style={{ maxWidth: 500, margin: "16px auto 32px" }}>
            Download AutoFlow Pro and never miss a prompt again.
          </p>
          <a
            href="/autoflow-pro.zip"
            className="btn btn-primary btn-lg download-btn"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download AutoFlow Pro
          </a>
        </div>
      </section>
    </>
  );
}

/* ── Sub-Components ── */

function ComparisonRow({ feature, store, storeNote, pro, proNote }) {
  return (
    <div className="comparison-row">
      <div className="comparison-feature">{feature}</div>
      <div className={`comparison-store ${store ? "yes" : "no"}`}>
        <span className="check-icon">{store ? "✓" : "✗"}</span>
        {storeNote && <span className="comparison-note">{storeNote}</span>}
      </div>
      <div className={`comparison-pro ${pro ? "yes" : "no"}`}>
        <span className="check-icon">{pro ? "✓" : "✗"}</span>
        {proNote && <span className="comparison-note">{proNote}</span>}
      </div>
    </div>
  );
}

function Step({ number, title, description, icon }) {
  return (
    <div className="step-card card animate-in" style={{ animationDelay: `${number * 0.1}s` }}>
      <div className="step-header">
        <span className="step-number">{number}</span>
        <span className="step-icon">{icon}</span>
      </div>
      <h3>{title}</h3>
      <p className="text-secondary">{description}</p>
    </div>
  );
}

function FaqItem({ question, answer }) {
  return (
    <details className="faq-item">
      <summary className="faq-question">
        <span>{question}</span>
        <span className="faq-chevron">▸</span>
      </summary>
      <p className="faq-answer">{answer}</p>
    </details>
  );
}
