import StoreLink from "./StoreLink";
import { YouTubeEmbed } from '@next/third-parties/google';
import HeroProductSwitcher from "./HeroProductSwitcher";
import FaqAccordion from "./FaqAccordion";

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
            name: "AutoFlow for Google Flow",
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
            url: "https://www.auto-flow.studio",
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
                item: "https://www.auto-flow.studio",
              },
            ],
          }),
        }}
      />

      {/* ── HERO ── */}
      <section className="hero" style={{ paddingTop: "180px", paddingBottom: "120px", position: "relative", overflow: "hidden" }}>
        <div className="hero-bg-glow" aria-hidden="true" style={{ position: "absolute", top: "20%", left: "50%", transform: "translate(-50%, -50%)", width: "1000px", height: "1000px", background: "radial-gradient(circle, rgba(79, 70, 229, 0.15) 0%, transparent 60%)", filter: "blur(60px)", pointerEvents: "none" }} />
        
        <div className="container hero-content" style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap", marginBottom: "32px" }}>
            <a href="/studio" className="badge animate-in" style={{ border: "1px solid rgba(255, 92, 0, 0.35)", background: "rgba(255, 92, 0, 0.1)", color: "var(--primary-light)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "8px", boxShadow: "0 0 20px rgba(255, 92, 0, 0.15)" }}>
              <span>✨ AutoFlow Studio</span> — Visual Node Workflows →
            </a>
            <a href="/extractor" className="badge animate-in" style={{ border: "1px solid rgba(255, 92, 0, 0.5)", background: "rgba(255, 92, 0, 0.15)", color: "#FFF", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "8px", boxShadow: "0 0 25px rgba(255, 92, 0, 0.2)" }}>
              <span>🔍 Video Extractor</span> — Reverse-Engineer AI Video Prompts (Free) →
            </a>
          </div>
          
          <h1 className="animate-in delay-1" style={{ marginBottom: "24px", textShadow: "0 10px 40px rgba(0,0,0,0.5)" }}>
            AI Video Generation<br />
            <span className="text-gradient">on Autopilot</span>
          </h1>
          
          <p className="text-secondary animate-in delay-2" style={{ fontSize: "1.25rem", maxWidth: "640px", margin: "0 auto 48px", lineHeight: 1.7 }}>
            Automate prompt batches, manage smart queues, retry failures, and bulk download in 4K — or build multi-shot movie pipelines with our visual node canvas.
          </p>
          
          <div className="animate-in delay-3" style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap", marginBottom: "80px" }}>
            <StoreLink product="queue" className="btn btn-primary btn-lg">
              <ChromeIcon /> Install Queue Manager — Free
            </StoreLink>
            <a href="/studio" className="btn btn-secondary btn-lg" style={{ borderColor: "rgba(255, 92, 0, 0.3)", background: "rgba(255, 92, 0, 0.05)" }}>
              ✨ Explore Studio Canvas →
            </a>
            <a href="/extractor" className="btn btn-secondary btn-lg" style={{ borderColor: "rgba(255, 92, 0, 0.6)", background: "rgba(255, 92, 0, 0.12)", color: "#FFF" }}>
              🔍 Prompt Extractor (Free) →
            </a>
          </div>

          <HeroProductSwitcher />

          {/* ── Key Metrics & Trust Highlights ── */}
          <div className="metrics-strip animate-in delay-4" style={{ marginTop: "48px" }}>
            <div className="metric-item">
              <span className="metric-value">380,000+</span>
              <span className="metric-label">Total Prompts Run</span>
            </div>
            <div className="metric-item">
              <span className="metric-value">315,000+</span>
              <span className="metric-label">Videos Downloaded</span>
            </div>
            <div className="metric-item">
              <span className="metric-value">3,750+</span>
              <span className="metric-label">Active Creators</span>
            </div>
            <div className="metric-item">
              <span className="metric-value">4.65 / 5</span>
              <span className="metric-label">Chrome Store Rating</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── SOCIAL PROOF & RATING SHOWCASE ── */}
      <section style={{ padding: "80px 0", borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.01)", position: "relative" }}>
        <div className="container">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "48px", alignItems: "center" }}>
            
            {/* Left Column: Overall Metrics & Headline */}
            <div style={{ display: "flex", flexDirection: "column", gap: "24px", justifyContent: "center" }}>
              <div>
                <div className="badge" style={{ marginBottom: "16px", borderColor: "rgba(16, 185, 129, 0.2)", background: "rgba(16, 185, 129, 0.05)", color: "var(--success)" }}>
                  ✓ Verified Chrome Web Store Stats
                </div>
                <h2 style={{ fontSize: "2.5rem", marginBottom: "16px", background: "var(--gradient-primary)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                  Loved by Creators
                </h2>
                <p className="text-secondary" style={{ fontSize: "1.05rem", lineHeight: 1.6 }}>
                  AutoFlow is trusted by <strong>3,750+</strong> video directors, agencies, and creators worldwide who have automated over <strong>380,000+</strong> prompts and downloaded <strong>315,000+</strong> 4K videos.
                </p>
              </div>
              
              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                {/* Rating Card */}
                <div style={{ flex: "1 1 120px", background: "rgba(255, 92, 0, 0.02)", border: "1px solid rgba(255, 92, 0, 0.15)", borderRadius: "var(--radius-xl)", padding: "24px", textAlign: "center", boxShadow: "0 10px 30px rgba(255, 92, 0, 0.03)" }}>
                  <div style={{ fontSize: "3rem", fontWeight: 900, color: "var(--text-primary)", lineHeight: 1 }}>4.65</div>
                  <div style={{ display: "flex", gap: "2px", justifyContent: "center", margin: "12px 0" }}>
                    {[1,2,3,4,5].map(i => (
                      <span key={i} style={{ color: "#FBBF24", fontSize: "1.2rem" }}>
                        {i <= 4 ? "★" : "⯪"}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Out of 5 stars</div>
                </div>
                
                {/* Total Ratings Card */}
                <div style={{ flex: "1 1 150px", background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "var(--radius-xl)", padding: "24px", display: "flex", flexDirection: "column", justifyContent: "center", gap: "8px" }}>
                  <div>
                    <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--text-primary)" }}>57</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Total ratings</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--text-primary)" }}>49</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Ratings with reviews</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Rating Breakdown Visualizer */}
            <div style={{ background: "rgba(10, 10, 10, 0.4)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "var(--radius-xl)", padding: "32px", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* 5 Stars */}
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <span style={{ width: "90px", fontSize: "0.85rem", color: "var(--text-secondary)", fontWeight: 500 }}>Five stars</span>
                  <div style={{ flex: 1, height: "8px", background: "rgba(255,255,255,0.05)", borderRadius: "99px", overflow: "hidden" }}>
                    <div style={{ width: "91%", height: "100%", background: "var(--gradient-primary)", boxShadow: "0 0 12px rgba(255, 92, 0, 0.5)" }} />
                  </div>
                  <span style={{ width: "40px", textAlign: "right", fontSize: "0.85rem", fontWeight: 700, color: "var(--primary-light)" }}>91%</span>
                </div>
                
                {/* 4 Stars */}
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <span style={{ width: "90px", fontSize: "0.85rem", color: "var(--text-muted)" }}>Four stars</span>
                  <div style={{ flex: 1, height: "8px", background: "rgba(255,255,255,0.02)", borderRadius: "99px" }} />
                  <span style={{ width: "40px", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)" }}>0%</span>
                </div>

                {/* 3 Stars */}
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <span style={{ width: "90px", fontSize: "0.85rem", color: "var(--text-muted)" }}>Three stars</span>
                  <div style={{ flex: 1, height: "8px", background: "rgba(255,255,255,0.02)", borderRadius: "99px" }} />
                  <span style={{ width: "40px", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)" }}>0%</span>
                </div>

                {/* 2 Stars */}
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <span style={{ width: "90px", fontSize: "0.85rem", color: "var(--text-muted)" }}>Two stars</span>
                  <div style={{ flex: 1, height: "8px", background: "rgba(255,255,255,0.02)", borderRadius: "99px" }} />
                  <span style={{ width: "40px", textAlign: "right", fontSize: "0.85rem", color: "var(--text-muted)" }}>0%</span>
                </div>

                {/* 1 Star */}
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <span style={{ width: "90px", fontSize: "0.85rem", color: "var(--text-secondary)", fontWeight: 500 }}>One star</span>
                  <div style={{ flex: 1, height: "8px", background: "rgba(255,255,255,0.05)", borderRadius: "99px", overflow: "hidden" }}>
                    <div style={{ width: "9%", height: "100%", background: "rgba(255,255,255,0.2)" }} />
                  </div>
                  <span style={{ width: "40px", textAlign: "right", fontSize: "0.85rem", fontWeight: 700, color: "var(--text-secondary)" }}>9%</span>
                </div>
              </div>
            </div>
            
          </div>

          {/* ── Wall of Love Testimonial Cards ── */}
          <div className="testimonials-grid">
            <div className="testimonial-card">
              <div className="testimonial-stars">★★★★★</div>
              <p className="testimonial-quote">
                &quot;AutoFlow Studio completely revolutionized our agency workflow. Being able to lock character faces and wardrobe across consecutive cuts without API fees is unprecedented.&quot;
              </p>
              <div className="testimonial-author">
                <div className="author-avatar">MV</div>
                <div className="author-info">
                  <h4>Marcus Vance</h4>
                  <span>Generative Video Director</span>
                </div>
              </div>
            </div>

            <div className="testimonial-card">
              <div className="testimonial-stars">★★★★★</div>
              <p className="testimonial-quote">
                &quot;I loaded 350 prompts before going to bed. Woke up to all renders cleanly completed and bulk downloaded in 4K. It literally saved me 15 hours of manual clicking.&quot;
              </p>
              <div className="testimonial-author">
                <div className="author-avatar">ER</div>
                <div className="author-info">
                  <h4>Elena Rostova</h4>
                  <span>Commercial AI Artist</span>
                </div>
              </div>
            </div>

            <div className="testimonial-card">
              <div className="testimonial-stars">★★★★★</div>
              <p className="testimonial-quote">
                &quot;Connecting ChatGPT script ideation directly into Google Veo and Grok video extensions on one canvas is pure genius. Best $9.99/mo tool in AI right now.&quot;
              </p>
              <div className="testimonial-author">
                <div className="author-avatar">AC</div>
                <div className="author-info">
                  <h4>Alex Chen</h4>
                  <span>YouTube Shorts &amp; TikTok Creator</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ── PRODUCT SUITE TRIPLE SPOTLIGHT ── */}
      <section className="section" style={{ background: "rgba(255, 92, 0, 0.02)", borderBottom: "1px solid var(--border)", position: "relative" }}>
        <div className="container">
          <div className="section-header">
            <div className="badge" style={{ marginBottom: "16px" }}>The AutoFlow Ecosystem</div>
            <h2 style={{ marginBottom: "16px" }}>Three Flagship Creation Tools.<br /><span className="text-gradient">One Unified Platform.</span></h2>
            <p>From prompt reverse-engineering to visual node storytelling and massive batch automation.</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "32px", marginTop: "40px" }}>
            
            {/* Product 1: AutoFlow Studio */}
            <div className="bento-card" style={{ display: "flex", flexDirection: "column", padding: "36px", border: "1px solid rgba(255, 92, 0, 0.25)", background: "linear-gradient(160deg, rgba(255, 92, 0, 0.08) 0%, rgba(10, 10, 10, 0.95) 100%)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <span className="badge" style={{ background: "rgba(255, 92, 0, 0.2)", borderColor: "rgba(255, 92, 0, 0.4)", color: "var(--primary-light)" }}>✨ NEW</span>
                <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>React Flow Canvas</span>
              </div>
              <h3 style={{ fontSize: "1.75rem", marginBottom: "12px" }}>AutoFlow Studio</h3>
              <p className="text-secondary" style={{ fontSize: "1rem", lineHeight: 1.6, marginBottom: "24px", flex: 1 }}>
                &quot;ComfyUI for AI Video&quot;. A visual node canvas orchestrating Google Flow, Grok, and ChatGPT. Lock character continuity with Story Director, chain last frames, and build graphs with plain English.
              </p>
              <div style={{ borderRadius: "8px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", marginBottom: "24px" }}>
                <img src="/screenshots/studio/workflow-canvas.png" alt="AutoFlow Studio canvas" width={1280} height={800} style={{ width: "100%", display: "block" }} />
              </div>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <a href="/studio" className="btn btn-primary" style={{ flex: 1, textAlign: "center" }}>
                  Explore Studio Page →
                </a>
                <StoreLink product="studio" className="btn btn-secondary">
                  Install Studio
                </StoreLink>
              </div>
            </div>

            {/* Product 2: AI Video Prompt Extractor */}
            <div className="bento-card" style={{ display: "flex", flexDirection: "column", padding: "36px", border: "1px solid rgba(255, 92, 0, 0.4)", background: "linear-gradient(160deg, rgba(255, 92, 0, 0.12) 0%, rgba(10, 10, 10, 0.95) 100%)", boxShadow: "0 0 30px rgba(255, 92, 0, 0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <span className="badge" style={{ background: "rgba(255, 92, 0, 0.25)", borderColor: "var(--primary)", color: "#FFF" }}>🔍 WEB APP</span>
                <span style={{ fontSize: "0.85rem", color: "var(--primary-light)" }}>Free • 3 Runs / Day</span>
              </div>
              <h3 style={{ fontSize: "1.75rem", marginBottom: "12px" }}>Video Prompt Extractor</h3>
              <p className="text-secondary" style={{ fontSize: "1rem", lineHeight: 1.6, marginBottom: "24px", flex: 1 }}>
                Upload any Sora, Runway, or Kling AI video or paste a YouTube/TikTok link. Our vision AI breaks down every shot, extracting exact image prompts, camera motion cues, voiceover scripts, and character design sheets.
              </p>
              <div style={{ borderRadius: "8px", overflow: "hidden", border: "1px solid rgba(255, 92, 0, 0.2)", background: "rgba(0,0,0,0.6)", padding: "24px 16px", marginBottom: "24px", textAlign: "center" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>⚡ ➔ 🎬</div>
                <div style={{ fontSize: "0.9rem", color: "var(--primary-light)", fontFamily: "'JetBrains Mono', monospace" }}>
                  Video In ➔ Prompts + Studio Graph Out
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <a href="/extractor" className="btn btn-primary" style={{ flex: 1, textAlign: "center", background: "var(--primary)", color: "#000", fontWeight: "700" }}>
                  Open Extractor (Free) →
                </a>
                <a href="/blog/how-to-recreate-ai-videos-with-extractor-and-autoflow" className="btn btn-secondary">
                  Read Guide
                </a>
              </div>
            </div>

            {/* Product 3: AutoFlow Queue Manager */}
            <div className="bento-card" style={{ display: "flex", flexDirection: "column", padding: "36px", border: "1px solid rgba(255, 255, 255, 0.08)", background: "linear-gradient(160deg, rgba(79, 70, 229, 0.08) 0%, rgba(10, 10, 10, 0.95) 100%)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <span className="badge" style={{ background: "rgba(79, 70, 229, 0.2)", borderColor: "rgba(79, 70, 229, 0.4)", color: "#818CF8" }}>⚡ AUTOMATION</span>
                <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Batch Runner</span>
              </div>
              <h3 style={{ fontSize: "1.75rem", marginBottom: "12px" }}>AutoFlow Queue Manager</h3>
              <p className="text-secondary" style={{ fontSize: "1rem", lineHeight: 1.6, marginBottom: "24px", flex: 1 }}>
                The high-speed batch automation engine for Google Flow. Paste 500+ prompts, auto-retry failed generations, configure multi-queues, and harvest finished videos in 4K with 1-click bulk download.
              </p>
              <div style={{ borderRadius: "8px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", marginBottom: "24px" }}>
                <img src="/screenshots/create-prompts.webp" alt="AutoFlow Queue Manager batch prompts" width={1280} height={800} style={{ width: "100%", display: "block" }} />
              </div>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <a href="#features" className="btn btn-secondary" style={{ flex: 1, textAlign: "center" }}>
                  View Batch Features ↓
                </a>
                <StoreLink product="queue" className="btn btn-primary">
                  Install Queue
                </StoreLink>
              </div>
            </div>

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
        <div className="container" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "60px", alignItems: "center" }}>
          <div>
            <div className="badge" style={{ marginBottom: "24px", background: "rgba(16, 185, 129, 0.1)", color: "var(--success)", borderColor: "rgba(16, 185, 129, 0.2)" }}>Results</div>
            <h2 style={{ marginBottom: "24px" }}>Set It Up Once,<br /><span className="text-gradient">Generate Endlessly</span></h2>
            <p className="text-secondary" style={{ fontSize: "1.15rem", marginBottom: "32px", lineHeight: 1.7 }}>
              While you sleep, AutoFlow processes hundreds of prompts, retries failures, and downloads everything in 4K. Wake up to a folder full of ready-to-publish AI videos.
            </p>
            <div style={{ display: "flex", gap: "40px" }}>
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

      {/* ── FREQUENTLY ASKED QUESTIONS ── */}
      <section className="section" id="faq" style={{ padding: "100px 0", borderTop: "1px solid var(--border)", position: "relative" }}>
        <div className="container">
          <div className="section-header" style={{ marginBottom: "48px" }}>
            <div className="badge" style={{ marginBottom: "16px" }}>FAQ</div>
            <h2>Frequently Asked <span className="text-gradient">Questions</span></h2>
            <p>Everything you need to know about AutoFlow Studio, Extractor, and the Queue Manager.</p>
          </div>
          <FaqAccordion />
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
