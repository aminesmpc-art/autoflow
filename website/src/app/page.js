import StoreLink from "./StoreLink";

export default function HomePage() {
  return (
    <>
      {/* ── JSON-LD Structured Data ── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "AutoFlow",
            applicationCategory: "BrowserApplication",
            applicationSubCategory: "AI Video Automation",
            operatingSystem: "Chrome",
            browserRequirements: "Google Chrome 100+",
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: "4.9",
              ratingCount: "86"
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
            url: "https://auto-flow.studio",
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
            screenshot: "https://auto-flow.studio/screenshots/create-prompts.png",
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
            ],
          }),
        }}
      />

      {/* ── HERO ── */}
      <section className="hero" style={{ paddingTop: "180px", paddingBottom: "120px", position: "relative", overflow: "hidden" }}>
        <div className="hero-bg-glow" aria-hidden="true" style={{ position: "absolute", top: "20%", left: "50%", transform: "translate(-50%, -50%)", width: "1000px", height: "1000px", background: "radial-gradient(circle, rgba(79, 70, 229, 0.15) 0%, transparent 60%)", filter: "blur(60px)", pointerEvents: "none" }} />
        
        <div className="container hero-content" style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
          <div className="badge animate-in" style={{ marginBottom: "32px", border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.4)" }}>
            <span style={{ color: "var(--accent-light)" }}>⚡</span> Chrome Extension for Google Flow
          </div>
          
          <h1 className="animate-in delay-1" style={{ marginBottom: "24px", textShadow: "0 10px 40px rgba(0,0,0,0.5)" }}>
            AI Video Generation<br />
            <span className="text-gradient">on Autopilot</span>
          </h1>
          
          <p className="text-secondary animate-in delay-2" style={{ fontSize: "1.25rem", maxWidth: "600px", margin: "0 auto 48px", lineHeight: 1.7 }}>
            Paste your prompts, hit run, and walk away. AutoFlow handles the clicking,
            waiting, retrying, and downloading — so you can focus on creating.
          </p>
          
          <div className="animate-in delay-3" style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap", marginBottom: "80px" }}>
            <StoreLink className="btn btn-primary btn-lg">
              <ChromeIcon /> Install Free — It&apos;s Fast
            </StoreLink>
            <a href="#features" className="btn btn-secondary btn-lg">
              See Features →
            </a>
          </div>

          <div className="animate-in delay-4" style={{ perspective: "1200px" }}>
            <div style={{ transform: "rotateX(5deg) scale(0.95)", transformStyle: "preserve-3d", transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)", borderRadius: "var(--radius-xl)", overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 40px 100px -20px rgba(79, 70, 229, 0.4), 0 20px 40px rgba(0,0,0,0.8)" }}>
              <img
                src="/screenshots/full-workflow.webp"
                alt="AutoFlow running alongside Google Flow"
                style={{ width: "100%", display: "block" }}
                width="1200"
                height="750"
                fetchPriority="high"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── BENTO FEATURES GRID ── */}
      <section className="section" id="features" style={{ padding: "120px 0" }}>
        <div className="container">
          <div className="section-header">
            <div className="badge" style={{ marginBottom: "24px" }}>Platform Features</div>
            <h2 style={{ marginBottom: "24px" }}>Everything You Need to<br /><span className="text-gradient">Generate at Scale</span></h2>
            <p>AutoFlow supercharges Google Flow with powerful automation tools designed for professional creators.</p>
          </div>

          <div className="bento-grid">
            
            {/* Bento Card 1 (Full Width) - Batch Prompts */}
            <div className="bento-card bento-col-12" style={{ minHeight: "450px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "48px", alignItems: "center" }}>
              <div style={{ zIndex: 1 }}>
                <div className="badge" style={{ marginBottom: "16px", background: "rgba(79, 70, 229, 0.1)", color: "var(--primary-light)", borderColor: "rgba(79, 70, 229, 0.2)" }}>01. Create</div>
                <h3 style={{ fontSize: "2rem", marginBottom: "20px" }}>Batch Prompt Processing</h3>
                <p className="text-secondary" style={{ fontSize: "1.1rem", marginBottom: "24px" }}>
                  Stop copy-pasting prompts one by one. Paste your entire script — 5, 50, or 500 prompts — into the editor. AutoFlow instantly parses each block into a separate task.
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
                <h3 style={{ fontSize: "2rem", marginBottom: "20px" }}>Batch Download</h3>
                <p className="text-secondary" style={{ fontSize: "1.1rem", marginBottom: "24px" }}>
                  After generation, scan your project to see all videos grouped by prompt. Select your favorites and batch download everything in 4K with a single click.
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
              <div style={{ position: "absolute", left: "-40px", top: "50%", transform: "translateY(-50%)", width: "40px", height: "40px", borderRadius: "50%", background: "var(--bg-dark)", border: "2px solid var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "900", color: "var(--primary-light)", zIndex: 2, boxShadow: "0 0 20px rgba(79, 70, 229, 0.4)" }}>1</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: "1.5rem", marginBottom: "16px" }}>Paste Your Prompts</h3>
                <p className="text-secondary" style={{ fontSize: "1.05rem" }}>
                  Open AutoFlow's side panel on any Google Flow page. Choose your mode
                  and paste all your prompts. Each paragraph becomes a separate task.
                </p>
              </div>
              <div style={{ flex: 1, borderRadius: "16px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.05)", boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }}>
                <img src="/screenshots/prompt-list.webp" alt="Parsed prompts" style={{ width: "100%", display: "block" }} />
              </div>
            </div>

            <div className="step-card-rich" style={{ position: "relative", zIndex: 1, display: "flex", gap: "40px", marginBottom: "60px", alignItems: "center", flexDirection: "row-reverse" }}>
              <div style={{ position: "absolute", left: "-40px", top: "50%", transform: "translateY(-50%)", width: "40px", height: "40px", borderRadius: "50%", background: "var(--bg-dark)", border: "2px solid var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "900", color: "var(--primary-light)", zIndex: 2, boxShadow: "0 0 20px rgba(79, 70, 229, 0.4)" }}>2</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: "1.5rem", marginBottom: "16px" }}>Configure &amp; Run</h3>
                <p className="text-secondary" style={{ fontSize: "1.05rem" }}>
                  Choose your video model, orientation, generation count, and download settings. Set your run target and hit Run.
                </p>
              </div>
              <div style={{ flex: 1, borderRadius: "16px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.05)", boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }}>
                <img src="/screenshots/queue-card.webp" alt="Queue card" style={{ width: "100%", display: "block" }} />
              </div>
            </div>

            <div className="step-card-rich" style={{ position: "relative", zIndex: 1, display: "flex", gap: "40px", alignItems: "center" }}>
              <div style={{ position: "absolute", left: "-40px", top: "50%", transform: "translateY(-50%)", width: "40px", height: "40px", borderRadius: "50%", background: "var(--bg-dark)", border: "2px solid var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "900", color: "var(--primary-light)", zIndex: 2, boxShadow: "0 0 20px rgba(79, 70, 229, 0.4)" }}>3</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: "1.5rem", marginBottom: "16px" }}>Sit Back &amp; Collect</h3>
                <p className="text-secondary" style={{ fontSize: "1.05rem" }}>
                  AutoFlow types, clicks, waits, and downloads automatically. When it's done, batch download everything in 4K.
                </p>
              </div>
              <div style={{ flex: 1, borderRadius: "16px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.05)", boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }}>
                <img src="/screenshots/library-results.webp" alt="Library results" style={{ width: "100%", display: "block" }} />
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="section cta-section">
        <div className="container">
          <div className="cta-card">
            <div className="cta-glow" aria-hidden="true" />
            <h2>Ready to Automate Your Workflow?</h2>
            <p className="text-secondary">
              Join creators using AutoFlow to generate AI videos 10x faster.
              Free to start — no account required.
            </p>
            <StoreLink className="btn btn-primary btn-lg">
              <ChromeIcon /> Install AutoFlow — Free
            </StoreLink>
          </div>
        </div>
      </section>
    </>
  );
}

function ChromeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2"/>
      <line x1="12" y1="2" x2="12" y2="8" stroke="currentColor" strokeWidth="2"/>
      <line x1="3.5" y1="17" x2="8.5" y2="14" stroke="currentColor" strokeWidth="2"/>
      <line x1="20.5" y1="17" x2="15.5" y2="14" stroke="currentColor" strokeWidth="2"/>
    </svg>
  );
}
