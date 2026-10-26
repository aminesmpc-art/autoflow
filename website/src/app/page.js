import StoreLink from "./StoreLink";
import HeroProductSwitcher from "./HeroProductSwitcher";
import FaqAccordion from "./FaqAccordion";
import { PRODUCTS, MOTION_STORE_URL } from "./products";
import "./home.css";

/* The home page introduces every AutoFlow tool and sends each visitor to the
   one they need. The Queue Manager's own sections, which used to fill this
   page, live at /queue. */

export const metadata = {
  title: {
    absolute: "AutoFlow for Google Flow — Batch Prompts, Motion Control & AI Video Tools",
  },
  description:
    "Five AI video tools for Google Flow: batch-generate hundreds of prompts, plan multi-shot stories on a node canvas, give a video's motion to your own character, extract the prompts behind any video and cut long videos into clips.",
  alternates: {
    canonical: "https://www.auto-flow.studio",
  },
};

/* What each tool card says and where its two buttons go. */
const TOOL_DETAILS = {
  queue: {
    points: ["Paste 5, 50 or 500 prompts at once", "Retries failed generations for you", "Bulk-downloads every video in 4K"],
    primary: { label: "Learn more", href: "/queue" },
    install: "queue",
  },
  studio: {
    points: ["Connect prompts, images and generators", "Keeps characters the same across shots", "Chains each last frame into the next shot"],
    primary: { label: "Learn more", href: "/studio" },
    install: "studio",
  },
  motion: {
    points: ["Keeps the movement, timing and camera", "Swap the subject or restyle the whole look", "Free: 3 jobs a day · Pro: unlimited"],
    primary: { label: "Learn more", href: "/motion" },
    install: "motion",
  },
  extractor: {
    points: ["Upload a video or paste a link", "Get each shot's prompt and camera moves", "Send the result to Studio in one click"],
    primary: { label: "Try it free", href: "/extractor" },
    secondary: { label: "Read the guide", href: "/blog/how-to-recreate-ai-videos-with-extractor-and-autoflow" },
  },
  clipping: {
    points: ["Drop a podcast, stream or interview", "Get vertical 9:16 clips cut on the spoken line", "Captioned, with an edit sheet"],
    primary: { label: "Try it free", href: "/clipping" },
    secondary: { label: "Read the guide", href: "/blog/how-to-make-money-clipping-videos" },
  },
};

const CHOICES = [
  { need: "I have a list of prompts to generate in Google Flow", key: "queue" },
  { need: "I want a multi-shot story with the same character in every shot", key: "studio" },
  { need: "I have a video and want its motion on my own character", key: "motion" },
  { need: "I saw an AI video and want the prompts behind it", key: "extractor" },
  { need: "I want short clips from a long video", key: "clipping" },
];

const FLOW_STEPS = [
  { title: "Extract", text: "Find the prompts and camera moves behind a video you like.", keys: ["extractor"] },
  { title: "Plan", text: "Lay out your shots and characters on a visual canvas.", keys: ["studio"] },
  { title: "Generate", text: "Run every prompt in Google Flow, or move a real performance onto your character.", keys: ["queue", "motion"] },
  { title: "Clip", text: "Turn long videos into short vertical clips for every platform.", keys: ["clipping"] },
];

const HOME_FAQ = [
  {
    q: "Which AutoFlow tool should I start with?",
    a: "Start with the job in front of you. Many prompts to generate: the Queue Manager. A multi-shot story with the same characters: Studio. A video whose movement you want on your own character: Motion. The prompts behind a video you saw: the Extractor. Short clips from a long recording: Clipping. They share one account and one Pro plan, so you can add the others later.",
  },
  {
    q: "Do I need my own Google Flow and AI accounts?",
    a: "Yes. The AutoFlow extensions work in your own browser, with the Google Flow and AI assistant accounts you are already signed in to, and your generations use your own credits. Your prompts, images and videos go to those services, not to AutoFlow's servers.",
  },
  {
    q: "Is AutoFlow free?",
    a: "Every tool can be used for free: the Queue Manager gives you 50 prompts a day, Studio 10 workflow runs a month and Motion 3 jobs a day, and the Extractor and Clipping are free web apps. AutoFlow Pro ($9.99 a month) makes the Queue Manager, Studio and Motion unlimited and gives you 20 extractions a day.",
  },
  {
    q: "How are the Queue Manager, Studio and Motion different?",
    a: "The Queue Manager runs a long list of prompts in Google Flow for you and downloads the results. Studio is a visual canvas for multi-shot stories, where characters and settings stay consistent from shot to shot. Motion takes the movement of a video you choose and gives it to a new character, subject or look.",
  },
  {
    q: "Which AI platforms do the tools work with?",
    a: "The extensions generate in Google Flow (Veo and Omni). They use ChatGPT, Gemini or Claude as the assistant that writes prompts, and Studio also works with Grok. The Extractor accepts videos from any AI video generator.",
  },
];

export default function HomePage() {
  const byKey = Object.fromEntries(PRODUCTS.map((product) => [product.key, product]));

  return (
    <>
      {/* ── JSON-LD Structured Data ── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: "AutoFlow tools for Google Flow",
            itemListElement: PRODUCTS.map((product, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: product.fullName,
              url: `https://www.auto-flow.studio${product.href}`,
            })),
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
            ],
          }),
        }}
      />

      {/* ── HERO ── */}
      <section className="hero" style={{ paddingTop: "180px", paddingBottom: "120px", position: "relative", overflow: "hidden" }}>
        <div className="hero-bg-glow" aria-hidden="true" style={{ position: "absolute", top: "20%", left: "50%", transform: "translate(-50%, -50%)", width: "1000px", height: "1000px", background: "radial-gradient(circle, rgba(79, 70, 229, 0.15) 0%, transparent 60%)", filter: "blur(60px)", pointerEvents: "none" }} />

        <div className="container hero-content" style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap", marginBottom: "32px" }}>
            <a href="/motion" className="badge animate-in" style={{ border: "1px solid rgba(255, 92, 0, 0.5)", background: "rgba(255, 92, 0, 0.12)", color: "#FFF", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "8px", boxShadow: "0 0 25px rgba(255, 92, 0, 0.2)" }}>
              {/* One span, so on a phone it wraps as one line of text
                  instead of two side-by-side columns. */}
              <span>🕺 New: AutoFlow Motion — give any video&apos;s motion to your character →</span>
            </a>
          </div>

          <h1 className="animate-in delay-1" style={{ marginBottom: "24px", textShadow: "0 10px 40px rgba(0,0,0,0.5)" }}>
            AI Video Tools<br />
            <span className="text-gradient">for Google Flow</span>
          </h1>

          <p className="text-secondary animate-in delay-2" style={{ fontSize: "1.25rem", maxWidth: "680px", margin: "0 auto 48px", lineHeight: 1.7 }}>
            Batch-generate hundreds of prompts, plan multi-shot stories, give a video&apos;s motion to your own character, and turn any video into prompts or short clips — in your own browser, with your own accounts.
          </p>

          <div className="animate-in delay-3" style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap", marginBottom: "80px" }}>
            <a href="#tools" className="btn btn-primary btn-lg">
              Find your tool ↓
            </a>
            <a href="/pricing" className="btn btn-secondary btn-lg">
              See pricing
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

      {/* ── THE TOOLS ── */}
      <section className="section home-tools" id="tools">
        <div className="container">
          <div className="section-header">
            <div className="badge" style={{ marginBottom: "16px" }}>The AutoFlow Tools</div>
            <h2 style={{ marginBottom: "16px" }}>Five Tools.<br /><span className="text-gradient">One Platform.</span></h2>
            <p>Each does one job well. Start with the one you need — they share one account and one Pro plan.</p>
          </div>

          <div className="home-tools-grid">
            {PRODUCTS.map((product) => {
              const details = TOOL_DETAILS[product.key];
              return (
                <div key={product.key} className={`home-tool${product.badge === "New" ? " home-tool--new" : ""}`}>
                  <div className="home-tool-top">
                    <span className="home-tool-icon" aria-hidden="true">{product.icon}</span>
                    <span className="home-tool-kind">{product.kind}</span>
                    {product.badge && (
                      <span className={`nav-badge ${product.badge === "Free" ? "nav-badge--free" : ""}`}>{product.badge}</span>
                    )}
                  </div>
                  <h3>{product.fullName}</h3>
                  <p className="home-tool-blurb">{product.blurb}.</p>
                  <ul className="home-tool-points">
                    {details.points.map((point) => <li key={point}>{point}</li>)}
                  </ul>
                  <div className="home-tool-actions">
                    <a href={details.primary.href} className="btn btn-primary">{details.primary.label} →</a>
                    {details.install && <InstallButton product={details.install} />}
                    {details.secondary && (
                      <a href={details.secondary.href} className="btn btn-secondary">{details.secondary.label}</a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── WHICH TOOL DO I NEED ── */}
      <section className="section home-choose">
        <div className="container">
          <div className="section-header">
            <div className="badge" style={{ marginBottom: "16px" }}>Not Sure Where to Start?</div>
            <h2 style={{ marginBottom: "16px" }}>Which Tool<br /><span className="text-gradient">Do I Need?</span></h2>
          </div>
          <div className="home-choose-list">
            {CHOICES.map((choice) => {
              const product = byKey[choice.key];
              return (
                <a key={choice.key} href={product.href} className="home-choose-row">
                  <span className="home-choose-need">{choice.need}</span>
                  <span className="home-choose-tool">
                    <span aria-hidden="true">{product.icon}</span> {product.name} →
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── HOW THE TOOLS FIT TOGETHER ── */}
      <section className="section home-flow">
        <div className="container">
          <div className="section-header">
            <div className="badge" style={{ marginBottom: "16px" }}>Better Together</div>
            <h2 style={{ marginBottom: "16px" }}>From Idea to<br /><span className="text-gradient">Finished Clips</span></h2>
            <p>Use one tool on its own, or chain them from first idea to final clip.</p>
          </div>
          <ol className="home-flow-steps">
            {FLOW_STEPS.map((step, index) => (
              <li key={step.title} className="home-flow-step">
                <span className="home-flow-num" aria-hidden="true">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                <div className="home-flow-links">
                  {step.keys.map((key) => (
                    <a key={key} href={byKey[key].href}>{byKey[key].name} →</a>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── ONE PLAN ── */}
      <section className="section home-plans">
        <div className="container">
          <div className="section-header">
            <div className="badge" style={{ marginBottom: "16px" }}>Pricing</div>
            <h2 style={{ marginBottom: "16px" }}>Start Free.<br /><span className="text-gradient">One Pro Plan for Everything.</span></h2>
          </div>
          <div className="home-plans-grid">
            <div className="home-plan">
              <div className="home-plan-name">Free</div>
              <div className="home-plan-price">$0 <span>/ forever</span></div>
              <ul>
                <li>Queue Manager: 50 prompts a day</li>
                <li>Studio: 10 workflow runs a month</li>
                <li>Motion: 3 jobs a day</li>
                <li>Extractor and Clipping: free web apps</li>
              </ul>
            </div>
            <div className="home-plan home-plan--pro">
              <div className="home-plan-name">AutoFlow Pro</div>
              <div className="home-plan-price">$9.99 <span>/ month</span></div>
              <ul>
                <li>Unlimited Queue Manager prompts</li>
                <li>Unlimited Studio runs</li>
                <li>Unlimited Motion jobs</li>
                <li>20 extractions a day</li>
              </ul>
              <a href="/pricing" className="btn btn-primary">See full pricing →</a>
            </div>
          </div>
        </div>
      </section>

      {/* ── FREQUENTLY ASKED QUESTIONS ── */}
      <section className="section" id="faq" style={{ padding: "100px 0", borderTop: "1px solid var(--border)", position: "relative" }}>
        <div className="container">
          <div className="section-header" style={{ marginBottom: "48px" }}>
            <div className="badge" style={{ marginBottom: "16px" }}>FAQ</div>
            <h2>Frequently Asked <span className="text-gradient">Questions</span></h2>
            <p>The short answers. There are more on the <a href="/faq" style={{ color: "var(--primary-light)" }}>FAQ page</a>.</p>
          </div>
          <FaqAccordion items={HOME_FAQ} />
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="section cta-section" style={{ position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/screenshots/cta-bg.webp)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.3 }} />
        <div className="container" style={{ position: "relative", zIndex: 1 }}>
          <div className="cta-card">
            <div className="cta-glow" aria-hidden="true" />
            <h2>Ready to Make Your Next Video?</h2>
            <p className="text-secondary">
              Join 3,750+ creators using AutoFlow. Pick the tool that fits your
              project — every one of them starts free.
            </p>
            <div className="home-cta-actions">
              <a href="#tools" className="btn btn-primary btn-lg">Find your tool ↑</a>
              <a href="/pricing" className="btn btn-secondary btn-lg">See pricing</a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* The store button for an extension. Motion's listing is not published yet,
   so its card says so instead of linking anywhere. */
function InstallButton({ product }) {
  if (product === "motion" && !MOTION_STORE_URL) {
    return <span className="home-tool-soon">Coming soon</span>;
  }
  return (
    <StoreLink product={product} href={product === "motion" ? MOTION_STORE_URL : undefined} className="btn btn-secondary">
      Install free
    </StoreLink>
  );
}
