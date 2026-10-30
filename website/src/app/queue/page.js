import StoreLink from "../StoreLink";
import { WhatsNew } from "../changelog/Changelog";
import "./queue.css";

/* The Queue Manager's own page. Its sections used to be the home page; the
   home page now introduces every AutoFlow tool and links here. */

const DESCRIPTION =
  "AutoFlow Queue Manager automates Google Flow: batch hundreds of prompts, run smart queues, auto-retry failures and bulk download every video in 4K.";

export const metadata = {
  title: "Queue Manager — Batch Prompts & Bulk 4K Downloads for Google Flow",
  description: DESCRIPTION,
  alternates: {
    canonical: "https://www.auto-flow.studio/queue",
  },
  openGraph: {
    title: "AutoFlow Queue Manager — Batch Prompts for Google Flow",
    description: DESCRIPTION,
    url: "https://www.auto-flow.studio/queue",
    images: [{ url: "/screenshots/create-prompts.png", alt: "AutoFlow Queue Manager batch prompt editor" }],
  },
};

export default function QueuePage() {
  return (
    <>
      {/* ── JSON-LD Structured Data ── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "AutoFlow Queue Manager",
            applicationCategory: "BrowserApplication",
            applicationSubCategory: "AI Video Automation",
            operatingSystem: "Chrome",
            browserRequirements: "Google Chrome 100+",
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: "4.65",
              ratingCount: "57"
            },
            offers: [
              {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
                name: "Free",
                description: "Text-to-video automation with batch processing",
              },
              {
                "@type": "Offer",
                price: "9.99",
                priceCurrency: "USD",
                name: "Pro",
                description: "Full access: image-to-video, ingredients, unlimited queues",
              },
            ],
            description:
              "AutoFlow automates Google Flow AI video generation. Batch process hundreds of prompts, manage smart queues, auto-retry failures, and bulk download videos in 4K. 10x faster video creation.",
            url: "https://www.auto-flow.studio/queue",
            featureList: [
              "Batch prompt processing (text-to-video, image-to-video, ingredients)",
              "Smart queue management with per-queue settings",
              "Live run monitor with pause, resume, skip, retry",
              "Library scanner with grouped results",
              "Batch download in 720p, 1080p, or 4K",
              "Auto-retry on generation failures",
              "Reference image mapping and character matching",
              "Configurable typing mode and wait times",
            ],
            screenshot: "https://www.auto-flow.studio/screenshots/create-prompts.png",
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: "https://www.auto-flow.studio" },
              { "@type": "ListItem", position: 2, name: "Queue Manager", item: "https://www.auto-flow.studio/queue" },
            ],
          }),
        }}
      />

      {/* ── HERO ── */}
      <section className="queue-hero">
        <div className="queue-hero-glow" aria-hidden="true" />
        <div className="container queue-hero-grid">
          <div>
            <div className="queue-badge animate-in">
              <span aria-hidden="true">⚡</span> Batch automation for Google Flow
            </div>
            <h1 className="animate-in delay-1">
              Google Flow Batch Generation{" "}
              <span className="text-gradient">on Autopilot</span>
            </h1>
            <p className="queue-lead animate-in delay-2">
              Paste 5, 50 or 500 prompts. The Queue Manager types them into
              Google Flow, retries failures and bulk-downloads every video in
              4K — while you do something else.
            </p>
            <div className="queue-ctas animate-in delay-3">
              <StoreLink product="queue" className="btn btn-primary btn-lg">
                <ChromeIcon /> Install Queue Manager — Free
              </StoreLink>
              <a href="#features" className="btn btn-secondary btn-lg">
                See features ↓
              </a>
            </div>
            <p className="queue-note animate-in delay-3">
              <strong>4.65 / 5</strong> on the Chrome Web Store · used by 3,750+ creators
            </p>
            <WhatsNew product="queue" className="animate-in delay-3" />
          </div>
          <div className="queue-hero-media animate-in delay-4">
            <img
              src="/screenshots/hero-overview.webp"
              alt="AutoFlow Queue Manager running a batch beside Google Flow"
              width={1400}
              height={1400}
            />
          </div>
        </div>
      </section>

      {/* ── BENTO FEATURES GRID ── */}
      <section className="section" id="features" style={{ padding: "120px 0" }}>
        <div className="container">
          <div className="section-header">
            <div className="badge" style={{ marginBottom: "24px" }}>Queue Features</div>
            <h2 style={{ marginBottom: "24px" }}>Everything You Need to<br /><span className="text-gradient">Generate at Scale</span></h2>
            <p>AutoFlow supercharges Google Flow with powerful automation tools designed for professional creators.</p>
          </div>

          <div className="bento-grid">

            {/* Bento Card 1 (Full Width) - Batch Prompts */}
            <div className="bento-card bento-col-12" style={{ minHeight: "450px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "48px", alignItems: "center" }}>
              <div style={{ zIndex: 1 }}>
                <div className="badge" style={{ marginBottom: "16px", background: "rgba(79, 70, 229, 0.1)", color: "var(--primary-light)", borderColor: "rgba(79, 70, 229, 0.2)" }}>01. Create</div>
                <h3 style={{ fontSize: "2rem", marginBottom: "20px" }}>Google Flow Batch Generator</h3>
                <p className="text-secondary" style={{ fontSize: "1.1rem", marginBottom: "24px" }}>
                  Stop copy-pasting prompts one by one. Paste your entire script — 5, 50, or 500 prompts — into our bulk editor to automate Veo video generation. AutoFlow instantly parses each block into a separate task.
                </p>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "12px", color: "var(--text-secondary)" }}>
                  <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "var(--success)" }}>✓</span> Auto-detects scene numbers</li>
                  <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "var(--success)" }}>✓</span> Supports Text, Image & Ingredients mode</li>
                </ul>
              </div>
              <div style={{ position: "relative", height: "100%", minHeight: "300px", borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid rgba(255,255,255,0.05)", boxShadow: "0 20px 40px rgba(0,0,0,0.5)", transform: "perspective(1000px) rotateY(-5deg)" }}>
                <img src="/screenshots/create-prompts.webp" alt="Batch Prompting" style={{ position: "absolute", width: "150%", top: "10%", left: "10%", objectFit: "cover", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.1)" }} />
              </div>
            </div>

            {/* Bento Card 2 (Half) - Image Mapping */}
            <div className="bento-card bento-col-6" style={{ minHeight: "450px" }}>
              <div className="badge" style={{ marginBottom: "16px", background: "rgba(6, 182, 212, 0.1)", color: "var(--accent-light)", borderColor: "rgba(6, 182, 212, 0.2)" }}>02. Images</div>
              <h3 style={{ fontSize: "1.8rem", marginBottom: "16px" }}>Reference Mapping</h3>
              <p className="text-secondary" style={{ marginBottom: "40px", flex: 1 }}>
                Attach reference images globally, or let AutoFlow automatically map character faces to specific scenes.
              </p>
              <div style={{ position: "relative", marginTop: "auto", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)", overflow: "hidden", transform: "translateY(20px)" }}>
                <img src="/screenshots/image-mapping.webp" alt="Image Mapping" style={{ width: "100%", display: "block", borderTopLeftRadius: "12px", borderTopRightRadius: "12px" }} />
              </div>
            </div>

            {/* Bento Card 3 (Half) - Smart Queue */}
            <div className="bento-card bento-col-6" style={{ minHeight: "450px", background: "linear-gradient(145deg, rgba(79, 70, 229, 0.1) 0%, rgba(10, 10, 10, 1) 100%)" }}>
              <div className="badge" style={{ marginBottom: "16px", background: "rgba(16, 185, 129, 0.1)", color: "var(--success)", borderColor: "rgba(16, 185, 129, 0.2)" }}>03. Queues</div>
              <h3 style={{ fontSize: "1.8rem", marginBottom: "16px" }}>Smart Queues</h3>
              <p className="text-secondary" style={{ marginBottom: "40px", flex: 1 }}>
                Create multiple queues with different configs (Veo 3, 1080p, 4K). Reorder them and run sequentially.
              </p>
              <div style={{ position: "relative", marginTop: "auto", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.1)", overflow: "hidden", transform: "scale(1.05) translateY(20px)", boxShadow: "0 20px 40px rgba(0,0,0,0.6)" }}>
                <img src="/screenshots/queue-card.webp" alt="Smart Queues" style={{ width: "100%", display: "block" }} />
              </div>
            </div>

            {/* Bento Card 4 (Full Width) - Library & Run Monitor */}
            <div className="bento-card bento-col-12" style={{ minHeight: "450px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "48px", alignItems: "center" }}>
              <div style={{ position: "relative", height: "100%", minHeight: "300px", borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid rgba(255,255,255,0.05)", boxShadow: "0 20px 40px rgba(0,0,0,0.5)", transform: "perspective(1000px) rotateY(5deg)" }}>
                <img src="/screenshots/library-results.webp" alt="Library Scanner" style={{ position: "absolute", width: "150%", top: "10%", right: "10%", objectFit: "cover", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.1)" }} />
              </div>
              <div style={{ zIndex: 1 }}>
                <div className="badge" style={{ marginBottom: "16px", background: "rgba(245, 158, 11, 0.1)", color: "var(--warning)", borderColor: "rgba(245, 158, 11, 0.2)" }}>04. Harvest</div>
                <h3 style={{ fontSize: "2rem", marginBottom: "20px" }}>How to Download Veo Videos in 4K</h3>
                <p className="text-secondary" style={{ fontSize: "1.1rem", marginBottom: "24px" }}>
                  Wondering how to download Veo videos in 4K easily? After generation, scan your project to see all videos grouped by prompt. Select your favorites and batch download everything in 4K with a single click.
                </p>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "12px", color: "var(--text-secondary)" }}>
                  <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "var(--warning)" }}>✓</span> Grouped by prompt automatically</li>
                  <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "var(--warning)" }}>✓</span> Bulk upscaling and downloading</li>
                </ul>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="section" id="how-it-works" style={{ position: "relative" }}>
        <div className="container">
          <div className="section-header">
            <div className="badge" style={{ marginBottom: "24px" }}>Workflow</div>
            <h2 style={{ marginBottom: "24px" }}>Three Steps to<br /><span className="text-gradient">Automated Generation</span></h2>
            <p>Get started in under a minute. No complex setup required.</p>
          </div>

          <div className="steps-container" style={{ position: "relative", maxWidth: "900px", margin: "0 auto", paddingLeft: "40px" }}>
            {/* Vertical Line */}
            <div style={{ position: "absolute", left: "20px", top: "0", bottom: "0", width: "2px", background: "linear-gradient(to bottom, var(--primary) 0%, rgba(79, 70, 229, 0.1) 100%)", zIndex: 0 }}></div>

            <div className="step-card-rich" style={{ position: "relative", zIndex: 1, display: "flex", gap: "40px", marginBottom: "60px", alignItems: "center" }}>
              <div style={{ position: "absolute", left: "-40px", top: "50%", transform: "translateY(-50%)", width: "42px", height: "42px", borderRadius: "50%", background: "var(--gradient-primary)", border: "2px solid rgba(255,255,255,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "900", color: "#FFFFFF", zIndex: 2, boxShadow: "0 0 25px rgba(255, 92, 0, 0.7)" }}>1</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: "1.5rem", marginBottom: "16px" }}>Paste Your Prompts</h3>
                <p className="text-secondary" style={{ fontSize: "1.05rem" }}>
                  Open AutoFlow's side panel on any Google Flow page. Choose your mode
                  and paste all your prompts. Each paragraph becomes a separate task.
                </p>
              </div>
              <div style={{ flex: 1, borderRadius: "16px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 15px 35px rgba(0,0,0,0.6)" }}>
                <img src="/screenshots/prompt-list.webp" alt="Parsed prompts" style={{ width: "100%", display: "block" }} />
              </div>
            </div>

            <div className="step-card-rich" style={{ position: "relative", zIndex: 1, display: "flex", gap: "40px", marginBottom: "60px", alignItems: "center", flexDirection: "row-reverse" }}>
              <div style={{ position: "absolute", left: "-40px", top: "50%", transform: "translateY(-50%)", width: "42px", height: "42px", borderRadius: "50%", background: "var(--gradient-primary)", border: "2px solid rgba(255,255,255,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "900", color: "#FFFFFF", zIndex: 2, boxShadow: "0 0 25px rgba(255, 92, 0, 0.7)" }}>2</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: "1.5rem", marginBottom: "16px" }}>Configure &amp; Run</h3>
                <p className="text-secondary" style={{ fontSize: "1.05rem" }}>
                  Choose your video model, orientation, generation count, and download settings. Set your run target and hit Run.
                </p>
              </div>
              <div style={{ flex: 1, borderRadius: "16px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 15px 35px rgba(0,0,0,0.6)" }}>
                <img src="/screenshots/queue-card.webp" alt="Queue card" style={{ width: "100%", display: "block" }} />
              </div>
            </div>

            <div className="step-card-rich" style={{ position: "relative", zIndex: 1, display: "flex", gap: "40px", alignItems: "center" }}>
              <div style={{ position: "absolute", left: "-40px", top: "50%", transform: "translateY(-50%)", width: "42px", height: "42px", borderRadius: "50%", background: "var(--gradient-primary)", border: "2px solid rgba(255,255,255,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "900", color: "#FFFFFF", zIndex: 2, boxShadow: "0 0 25px rgba(255, 92, 0, 0.7)" }}>3</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: "1.5rem", marginBottom: "16px" }}>Sit Back &amp; Collect</h3>
                <p className="text-secondary" style={{ fontSize: "1.05rem" }}>
                  AutoFlow types, clicks, waits, and downloads automatically. When it's done, batch download everything in 4K.
                </p>
              </div>
              <div style={{ flex: 1, borderRadius: "16px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 15px 35px rgba(0,0,0,0.6)" }}>
                <img src="/screenshots/library-results.webp" alt="Library results" style={{ width: "100%", display: "block" }} />
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── RESULTS SHOWCASE ── */}
      <section className="section" style={{ position: "relative" }}>
        <div className="container queue-results">
          <div>
            <div className="badge" style={{ marginBottom: "24px", background: "rgba(16, 185, 129, 0.1)", color: "var(--success)", borderColor: "rgba(16, 185, 129, 0.2)" }}>Results</div>
            <h2 style={{ marginBottom: "24px" }}>Set It Up Once,<br /><span className="text-gradient">Generate Endlessly</span></h2>
            <p className="text-secondary" style={{ fontSize: "1.15rem", marginBottom: "32px", lineHeight: 1.7 }}>
              While you sleep, AutoFlow processes hundreds of prompts, retries failures, and downloads everything in 4K. Wake up to a folder full of ready-to-publish AI videos.
            </p>
            <div style={{ display: "flex", gap: "40px", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--success)" }}>100%</div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Auto-retry success</div>
              </div>
              <div>
                <div style={{ fontSize: "2rem", fontWeight: 800 }}>10x</div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Faster than manual</div>
              </div>
              <div>
                <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--primary)" }}>4K</div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Auto download</div>
              </div>
            </div>
          </div>
          <div style={{ borderRadius: "16px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(16, 185, 129, 0.1)" }}>
            <img src="/screenshots/completed-run.webp" alt="AutoFlow completed run — all videos generated successfully" style={{ width: "100%", display: "block" }} />
          </div>
        </div>
      </section>

      {/* ── PLANS ── */}
      <section className="section queue-plans-section">
        <div className="container">
          <div className="queue-plans">
            <div>
              <div className="queue-plan-name">Free</div>
              <p>50 prompts a day and 20 image-to-video prompts a day.</p>
            </div>
            <div>
              <div className="queue-plan-name queue-plan-name--pro">AutoFlow Pro · $9.99 / month</div>
              <p>Unlimited prompts, plus everything else in Pro: unlimited Studio runs and Motion jobs.</p>
            </div>
            <a href="/pricing" className="btn btn-secondary">Compare plans →</a>
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="section cta-section" style={{ position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/screenshots/cta-bg.webp)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.3 }} />
        <div className="container" style={{ position: "relative", zIndex: 1 }}>
          <div className="cta-card">
            <div className="cta-glow" aria-hidden="true" />
            <h2>Ready to Automate Your Workflow?</h2>
            <p className="text-secondary">
              Join 3,750+ creators using AutoFlow to generate AI videos 10x faster.
              Free to start — no account required.
            </p>
            <StoreLink product="queue" className="btn btn-primary btn-lg">
              <ChromeIcon /> Install Queue Manager — Free
            </StoreLink>
          </div>
        </div>
      </section>
    </>
  );
}

function ChromeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2"/>
      <line x1="12" y1="2" x2="12" y2="8" stroke="currentColor" strokeWidth="2"/>
      <line x1="3.5" y1="17" x2="8.5" y2="14" stroke="currentColor" strokeWidth="2"/>
      <line x1="20.5" y1="17" x2="15.5" y2="14" stroke="currentColor" strokeWidth="2"/>
    </svg>
  );
}
