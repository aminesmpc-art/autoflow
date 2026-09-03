import StoreLink from "../StoreLink";
import "./studio.css";

export const metadata = {
  title: "AutoFlow Studio — Visual Node Workflows for AI Video Generation",
  description:
    "ComfyUI for AI Video. Lay out prompts, reference images, and video models on a visual canvas. Lock character continuity and orchestrate Google Flow, Grok, ChatGPT & Claude with Zero API Keys.",
  alternates: {
    canonical: "https://www.auto-flow.studio/studio",
  },
  openGraph: {
    title: "AutoFlow Studio — Visual Node Workflows for AI Video",
    description:
      "Design multi-shot AI video pipelines on a visual canvas. Lock character continuity, chain last frames, and orchestrate Google Flow, Grok & ChatGPT in your browser with Zero API Keys.",
    url: "https://www.auto-flow.studio/studio",
    images: [
      {
        url: "/screenshots/studio/workflow-canvas.png",
        width: 1280,
        height: 800,
        alt: "AutoFlow Studio — Visual Node Canvas for AI Video",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AutoFlow Studio — Visual Node Workflows for AI Video",
    description:
      "Design multi-shot AI video pipelines on a visual canvas. Lock character continuity, chain last frames, and orchestrate Google Flow, Grok & ChatGPT in your browser with Zero API Keys.",
    images: ["/screenshots/studio/workflow-canvas.png"],
  },
};

export default function StudioPage() {
  return (
    <>
      {/* ── JSON-LD SoftwareApplication Schema ── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "AutoFlow Studio",
            applicationCategory: "DesignApplication",
            applicationSubCategory: "AI Video Node Workflow Canvas",
            operatingSystem: "Chrome",
            browserRequirements: "Google Chrome 100+",
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: "4.9",
              ratingCount: "28",
            },
            offers: [
              {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
                name: "Free Tier",
                description: "10 Studio workflow runs per month with all node types",
              },
              {
                "@type": "Offer",
                price: "9.99",
                priceCurrency: "USD",
                name: "Pro Tier",
                description: "Unlimited Studio workflow runs & Google Flow automation",
              },
            ],
            description:
              "AutoFlow Studio turns AI video generation into a visual workflow. Connect Prompt, Image, Generate, Last Frame, and Story nodes to automate multi-shot videos across Google Flow, Grok, and ChatGPT.",
            url: "https://www.auto-flow.studio/studio",
            featureList: [
              "Visual node graph editor (React Flow canvas)",
              "Zero API keys required — runs in your signed-in browser tabs",
              "Story Director biometric & wardrobe continuity lock",
              "Multi-model orchestration (Google Veo, Grok, ChatGPT, Claude, Gemini)",
              "Last-frame clip chaining for smooth scene transitions",
              "Natural language AI workflow builder",
              "Local-first browser storage and privacy",
            ],
            screenshot: "https://www.auto-flow.studio/screenshots/studio/workflow-canvas.png",
          }),
        }}
      />

      {/* ── Breadcrumb Schema ── */}
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
              {
                "@type": "ListItem",
                position: 2,
                name: "AutoFlow Studio",
                item: "https://www.auto-flow.studio/studio",
              },
            ],
          }),
        }}
      />

      {/* ── HERO SECTION ── */}
      <section className="studio-hero">
        <div className="studio-hero-bg" aria-hidden="true" />
        <div className="container" style={{ position: "relative", zIndex: 1 }}>
          <div className="studio-badge animate-in">
            <span>✨</span> ComfyUI for Generative AI Video
          </div>

          <h1 className="animate-in delay-1">
            Visual Node Workflows for AI Video<br />
            <span className="text-gradient">on Autopilot</span>
          </h1>

          <p className="hero-subtitle animate-in delay-2">
            Stop juggling prompts across disconnected browser tabs. Design your video pipeline on a visual canvas, lock characters and lighting across cuts with Story Director, and orchestrate Veo, Grok, and ChatGPT with <strong>Zero API Keys</strong>.
          </p>

          <div className="studio-hero-ctas animate-in delay-3">
            <StoreLink product="studio" className="btn btn-primary btn-lg">
              <ChromeIcon /> Install Studio — Free
            </StoreLink>
            <a href="#nodes" className="btn btn-secondary btn-lg">
              Explore Nodes &amp; Canvas ↓
            </a>
          </div>

          {/* Canvas Showcase Visual Frame */}
          <div className="studio-canvas-preview animate-in delay-4">
            <div className="studio-canvas-toolbar">
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div className="canvas-traffic-lights">
                  <span className="dot dot-red" />
                  <span className="dot dot-yellow" />
                  <span className="dot dot-green" />
                </div>
                <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>AutoFlow Studio Canvas</span>
                <span className="canvas-status-pill">
                  <span className="canvas-status-dot" /> Flow + Grok Ready
                </span>
              </div>
              <span className="text-secondary" style={{ fontSize: "0.8rem" }}>Multi-Shot UGC Ad Pipeline</span>
            </div>
            <div className="studio-canvas-inner">
              <img
                src="/screenshots/studio/workflow-canvas.png"
                alt="AutoFlow Studio interactive node canvas with Google Veo and Grok nodes"
                width={1280}
                height={800}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── 4 CORE SUPERPOWERS (PILLARS) ── */}
      <section className="section" style={{ background: "rgba(255,255,255,0.01)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <div className="container">
          <div className="section-header">
            <div className="badge">Why Studio?</div>
            <h2>Built from the Ground Up for<br /><span className="text-gradient">Multi-Shot Storytellers</span></h2>
            <p>Every breakthrough feature in Studio solves a real frustration creators face in AI video production.</p>
          </div>

          <div className="pillars-grid">
            <div className="pillar-card">
              <div className="pillar-icon">🔑</div>
              <h3>Zero API Keys Needed</h3>
              <p>Studio drives the web interfaces you already pay for in your browser (Google Flow, ChatGPT Plus, Claude Pro, Grok). No credit limits, token billing, or exposed API secrets.</p>
            </div>

            <div className="pillar-card">
              <div className="pillar-icon">🎭</div>
              <h3>Story Director Continuity</h3>
              <p>Locks character facial features, skin tone, clothing, set architecture, and camera lighting across every cut so your scenes feel like a cohesive movie instead of random clips.</p>
            </div>

            <div className="pillar-card">
              <div className="pillar-icon">⚡</div>
              <h3>Multi-Model Orchestration</h3>
              <p>Route tasks to the model that does them best: use Claude or ChatGPT for script ideation, Gemini for visual QA, and Veo 3 or Grok Imagine for video rendering on a single canvas.</p>
            </div>

            <div className="pillar-card">
              <div className="pillar-icon">💬</div>
              <h3>Natural Language AI Builder</h3>
              <p>Describe your idea in plain English — <em>&quot;A 6-shot commercial for a coffee brand with warm morning lighting&quot;</em> — and Studio will automatically build the entire node pipeline for you.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── DEEP DIVE FEATURE ROWS ── */}
      <section className="section" id="features">
        <div className="container">
          
          {/* Row 1: Multi-Model Orchestration */}
          <div className="deep-dive-row">
            <div>
              <div className="badge" style={{ marginBottom: "16px", borderColor: "rgba(59, 130, 246, 0.3)", color: "#60A5FA", background: "rgba(59, 130, 246, 0.1)" }}>01. Pipeline Engine</div>
              <h3 style={{ fontSize: "2.2rem", marginBottom: "20px" }}>Connect Any Model to Any Generator</h3>
              <p className="text-secondary" style={{ fontSize: "1.1rem", lineHeight: 1.7, marginBottom: "24px" }}>
                Why settle for a single platform when you can connect the strengths of every AI model? Feed text prompts from ChatGPT or Claude into Google Veo, extract closing frames, and feed them into Grok to extend your video up to 30 seconds seamlessly.
              </p>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "12px", color: "var(--text-secondary)" }}>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "var(--success)" }}>✓</span> Google Flow (Veo 3.1 &amp; Omni)</li>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "var(--success)" }}>✓</span> Grok Imagine video rendering &amp; 30s extensions</li>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "var(--success)" }}>✓</span> ChatGPT, Claude, Gemini &amp; Z.AI intelligence</li>
              </ul>
            </div>
            <div className="deep-dive-media">
              <img src="/screenshots/studio/multimodel-orchestration.png" alt="Multi-model AI orchestration" width={1280} height={800} />
            </div>
          </div>

          {/* Row 2: Story Director Continuity */}
          <div className="deep-dive-row reversed">
            <div>
              <div className="badge" style={{ marginBottom: "16px", borderColor: "rgba(234, 179, 8, 0.3)", color: "#FACC15", background: "rgba(234, 179, 8, 0.1)" }}>02. Biometric Lock</div>
              <h3 style={{ fontSize: "2.2rem", marginBottom: "20px" }}>Story Director &amp; Character Consistency</h3>
              <p className="text-secondary" style={{ fontSize: "1.1rem", lineHeight: 1.7, marginBottom: "24px" }}>
                Multi-shot storytelling used to break down when shot four forgot what your character looked like. Story Director maintains a persistent character bible, wardrobe locks, environment definitions, and negative prompt rules across all connected generation nodes.
              </p>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "12px", color: "var(--text-secondary)" }}>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "var(--warning)" }}>✓</span> Automatic biometric identity repetition</li>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "var(--warning)" }}>✓</span> Camera grammar &amp; lighting consistency</li>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "var(--warning)" }}>✓</span> Multi-character casting with ref image tagging</li>
              </ul>
            </div>
            <div className="deep-dive-media">
              <img src="/screenshots/studio/story-director.png" alt="Story Director character consistency lock" width={1280} height={800} />
            </div>
          </div>

          {/* Row 3: Natural Language Builder */}
          <div className="deep-dive-row">
            <div>
              <div className="badge" style={{ marginBottom: "16px", borderColor: "rgba(16, 185, 129, 0.3)", color: "var(--success)", background: "rgba(16, 185, 129, 0.1)" }}>03. AI Canvas Builder</div>
              <h3 style={{ fontSize: "2.2rem", marginBottom: "20px" }}>Turn Ideas into Workflows with Plain English</h3>
              <p className="text-secondary" style={{ fontSize: "1.1rem", lineHeight: 1.7, marginBottom: "24px" }}>
                Don't want to wire nodes manually? Open the Studio Side Panel, type your vision, and the embedded Gemini engine analyzes your request, creates every prompt node, connects reference images, and wires the entire graph in 3 seconds.
              </p>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "12px", color: "var(--text-secondary)" }}>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "var(--success)" }}>✓</span> One-shot prompt-to-pipeline generation</li>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "var(--success)" }}>✓</span> Editable at any time — change one node without restarting</li>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "var(--success)" }}>✓</span> Community template import &amp; export</li>
              </ul>
            </div>
            <div className="deep-dive-media">
              <img src="/screenshots/studio/natural-language-builder.png" alt="Natural language AI workflow builder" width={1280} height={800} />
            </div>
          </div>

          {/* Row 4: Multi-Shot Pipeline & Last Frame */}
          <div className="deep-dive-row reversed">
            <div>
              <div className="badge" style={{ marginBottom: "16px", borderColor: "rgba(168, 85, 247, 0.3)", color: "#C084FC", background: "rgba(168, 85, 247, 0.1)" }}>04. Seamless Motion</div>
              <h3 style={{ fontSize: "2.2rem", marginBottom: "20px" }}>Last Frame Handoff &amp; Video Chaining</h3>
              <p className="text-secondary" style={{ fontSize: "1.1rem", lineHeight: 1.7, marginBottom: "24px" }}>
                Create long-form scenes by automatically capturing the exact concluding frame of one video generation and passing it as the starting frame of the next shot. No choppy cuts, no manual frame extraction.
              </p>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "12px", color: "var(--text-secondary)" }}>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "#C084FC" }}>✓</span> Automatic closing frame extraction from Veo</li>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "#C084FC" }}>✓</span> Frame-to-frame motion continuity</li>
                <li style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: "#C084FC" }}>✓</span> Grok Extend node for 30-second continuous scenes</li>
              </ul>
            </div>
            <div className="deep-dive-media">
              <img src="/screenshots/studio/multishot-pipeline.png" alt="Multi-shot video pipeline with chained frames" width={1280} height={800} />
            </div>
          </div>

        </div>
      </section>

      {/* ── 7-NODE SYSTEM INTERACTIVE GRID ── */}
      <section className="section" id="nodes" style={{ background: "rgba(0,0,0,0.3)", borderTop: "1px solid var(--border)" }}>
        <div className="container">
          <div className="section-header">
            <div className="badge">The Node Graph</div>
            <h2>7 Powerful Building Blocks<br /><span className="text-gradient">Unlimited Creative Possibilities</span></h2>
            <p>Each node in AutoFlow Studio is specialized, fully configurable, and connects seamlessly to downstream nodes.</p>
          </div>

          <div className="nodes-grid">
            {/* 1. Prompt Node */}
            <div className="node-card">
              <div className="node-header">
                <div className="node-title-group">
                  <span style={{ fontSize: "1.3rem" }}>✍️</span>
                  <h4 style={{ fontSize: "1.15rem" }}>Prompt Node</h4>
                </div>
                <span className="node-badge prompt">Text</span>
              </div>
              <p className="text-secondary" style={{ fontSize: "0.95rem" }}>
                Defines individual scene descriptions, camera directions, lighting cues, and audio sound tags.
              </p>
              <div className="node-ports">
                <span className="node-port">Outputs: text</span>
              </div>
            </div>

            {/* 2. Image Node */}
            <div className="node-card">
              <div className="node-header">
                <div className="node-title-group">
                  <span style={{ fontSize: "1.3rem" }}>🖼️</span>
                  <h4 style={{ fontSize: "1.15rem" }}>Reference Image Node</h4>
                </div>
                <span className="node-badge image">Asset</span>
              </div>
              <p className="text-secondary" style={{ fontSize: "0.95rem" }}>
                Upload character concept art, product photos, or location sketches to pin styles into generation trays.
              </p>
              <div className="node-ports">
                <span className="node-port">Outputs: image_ref</span>
              </div>
            </div>

            {/* 3. Generate Node */}
            <div className="node-card">
              <div className="node-header">
                <div className="node-title-group">
                  <span style={{ fontSize: "1.3rem" }}>🎬</span>
                  <h4 style={{ fontSize: "1.15rem" }}>Generate Node</h4>
                </div>
                <span className="node-badge generate">Engine</span>
              </div>
              <p className="text-secondary" style={{ fontSize: "0.95rem" }}>
                Executes the generation on Google Flow (Veo 3.1 / Omni) or Grok Imagine, handling typing and downloads.
              </p>
              <div className="node-ports">
                <span className="node-port">Inputs: text, image_ref, frame</span>
                <span className="node-port">Outputs: result, video</span>
              </div>
            </div>

            {/* 4. Last Frame Node */}
            <div className="node-card">
              <div className="node-header">
                <div className="node-title-group">
                  <span style={{ fontSize: "1.3rem" }}>🎞️</span>
                  <h4 style={{ fontSize: "1.15rem" }}>Last Frame Node</h4>
                </div>
                <span className="node-badge frame">Continuity</span>
              </div>
              <p className="text-secondary" style={{ fontSize: "0.95rem" }}>
                Extracts the final frame of an upstream video clip and binds it to the start frame of the next shot.
              </p>
              <div className="node-ports">
                <span className="node-port">Inputs: result</span>
                <span className="node-port">Outputs: frame_start</span>
              </div>
            </div>

            {/* 5. Extend Node */}
            <div className="node-card">
              <div className="node-header">
                <div className="node-title-group">
                  <span style={{ fontSize: "1.3rem" }}>⏩</span>
                  <h4 style={{ fontSize: "1.15rem" }}>Grok Extend Node</h4>
                </div>
                <span className="node-badge extend">Length</span>
              </div>
              <p className="text-secondary" style={{ fontSize: "0.95rem" }}>
                Chains consecutive 5-second Grok video extensions to build continuous 30-second fluid sequences.
              </p>
              <div className="node-ports">
                <span className="node-port">Inputs: video, text</span>
                <span className="node-port">Outputs: result</span>
              </div>
            </div>

            {/* 6. Story Director Node */}
            <div className="node-card">
              <div className="node-header">
                <div className="node-title-group">
                  <span style={{ fontSize: "1.3rem" }}>🎭</span>
                  <h4 style={{ fontSize: "1.15rem" }}>Story Director Node</h4>
                </div>
                <span className="node-badge story">Director</span>
              </div>
              <p className="text-secondary" style={{ fontSize: "0.95rem" }}>
                Master scripting controller. Holds global character cast, world rules, and style anchors across shots.
              </p>
              <div className="node-ports">
                <span className="node-port">Outputs: text (enriched with identity locks)</span>
              </div>
            </div>

            {/* 7. Agent Node */}
            <div className="node-card">
              <div className="node-header">
                <div className="node-title-group">
                  <span style={{ fontSize: "1.3rem" }}>🤖</span>
                  <h4 style={{ fontSize: "1.15rem" }}>AI Agent Node</h4>
                </div>
                <span className="node-badge agent">Intelligence</span>
              </div>
              <p className="text-secondary" style={{ fontSize: "0.95rem" }}>
                Sends step outputs to ChatGPT, Claude, Gemini, or Z.AI for autonomous prompt refinement and QA.
              </p>
              <div className="node-ports">
                <span className="node-port">Inputs: text, image</span>
                <span className="node-port">Outputs: text</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PRE-BUILT WORKFLOW TEMPLATES ── */}
      <section className="section" style={{ borderTop: "1px solid var(--border)", background: "rgba(255, 92, 0, 0.015)" }}>
        <div className="container">
          <div className="section-header">
            <div className="badge">Template Library</div>
            <h2>Pre-Built Production Graphs<br /><span className="text-gradient">Ready to Load in 1-Click</span></h2>
            <p>Jumpstart your next project with battle-tested community and studio templates.</p>
          </div>

          <div className="templates-grid">
            {/* Template 1: Dragon Viral Story */}
            <div className="template-card">
              <span className="template-badge">🐉 Story &amp; Cast</span>
              <h4 style={{ fontSize: "1.2rem" }}>Baby Dragon Viral Story</h4>
              <p className="text-secondary" style={{ fontSize: "0.92rem", lineHeight: 1.6 }}>
                Multi-shot narrative maintaining continuous dragon scale textures, eye color, and lighting across 4 connected cuts.
              </p>
              <div className="template-nodes">
                <span className="template-node-chip">Story Director</span>
                <span className="template-node-chip">3x Veo Generator</span>
                <span className="template-node-chip">2x Last Frame</span>
              </div>
            </div>

            {/* Template 2: UGC Sneaker Commercial */}
            <div className="template-card">
              <span className="template-badge" style={{ color: "#60A5FA", borderColor: "rgba(59, 130, 246, 0.3)", background: "rgba(59, 130, 246, 0.1)" }}>👟 Product UGC</span>
              <h4 style={{ fontSize: "1.2rem" }}>Sneaker Unboxing Ad</h4>
              <p className="text-secondary" style={{ fontSize: "0.92rem", lineHeight: 1.6 }}>
                E-commerce commercial pipeline using product reference photos to generate consistent dynamic camera sweeps.
              </p>
              <div className="template-nodes">
                <span className="template-node-chip">Reference Image</span>
                <span className="template-node-chip">Prompt Expander</span>
                <span className="template-node-chip">4K Batch Upscale</span>
              </div>
            </div>

            {/* Template 3: Voiceover & Dialog Reel */}
            <div className="template-card">
              <span className="template-badge" style={{ color: "#FACC15", borderColor: "rgba(234, 179, 8, 0.3)", background: "rgba(234, 179, 8, 0.1)" }}>🎙️ Script &amp; Dialog</span>
              <h4 style={{ fontSize: "1.2rem" }}>Podcast AI Shorts Reel</h4>
              <p className="text-secondary" style={{ fontSize: "0.92rem", lineHeight: 1.6 }}>
                AI scriptwriting agent hands off dialog in emotional delivery tags directly to Google Veo character lipsync.
              </p>
              <div className="template-nodes">
                <span className="template-node-chip">ChatGPT Agent</span>
                <span className="template-node-chip">Veo Generator</span>
                <span className="template-node-chip">Audio Tags</span>
              </div>
            </div>

            {/* Template 4: 30s Sci-Fi Scene Chain */}
            <div className="template-card">
              <span className="template-badge" style={{ color: "#C084FC", borderColor: "rgba(168, 85, 247, 0.3)", background: "rgba(168, 85, 247, 0.1)" }}>🌌 Continuous Cinema</span>
              <h4 style={{ fontSize: "1.2rem" }}>30s Sci-Fi Scene Chain</h4>
              <p className="text-secondary" style={{ fontSize: "0.92rem", lineHeight: 1.6 }}>
                Chains 6 consecutive 5-second Grok video extensions with last-frame continuity for long-form space scenes.
              </p>
              <div className="template-nodes">
                <span className="template-node-chip">Veo Opener</span>
                <span className="template-node-chip">Last Frame</span>
                <span className="template-node-chip">3x Grok Extend</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── COMPARISON TABLE ── */}
      <section className="section">
        <div className="container">
          <div className="section-header">
            <div className="badge">Comparison</div>
            <h2>Why Creators Choose<br /><span className="text-gradient">AutoFlow Studio</span></h2>
            <p>Compare the traditional manual prompting process with the AutoFlow Studio visual pipeline.</p>
          </div>

          <div className="comparison-table-wrapper">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>Feature</th>
                  <th style={{ width: "35%" }}>Manual Browser Prompting</th>
                  <th className="highlight-col" style={{ width: "35%", color: "var(--primary-light)" }}>AutoFlow Studio</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Workflow Layout</strong></td>
                  <td>Scattered across 10+ browser tabs &amp; notes</td>
                  <td className="highlight-col">Single visual node canvas (React Flow)</td>
                </tr>
                <tr>
                  <td><strong>Character Continuity</strong></td>
                  <td>Faces mutate and clothing changes every cut</td>
                  <td className="highlight-col">Story Director biometric &amp; wardrobe lock</td>
                </tr>
                <tr>
                  <td><strong>API Key Costs</strong></td>
                  <td>$50–$300/mo in raw model API bills</td>
                  <td className="highlight-col"><strong>$0 in API fees</strong> (uses your browser sessions)</td>
                </tr>
                <tr>
                  <td><strong>Clip Chaining</strong></td>
                  <td>Manual screenshot crop &amp; re-upload</td>
                  <td className="highlight-col">Automated Last Frame handoff</td>
                </tr>
                <tr>
                  <td><strong>Multi-Model Pipeline</strong></td>
                  <td>Copy-paste between ChatGPT, Grok, and Flow</td>
                  <td className="highlight-col">Direct node wiring across platforms</td>
                </tr>
                <tr>
                  <td><strong>AI Graph Builder</strong></td>
                  <td>Build everything manually from scratch</td>
                  <td className="highlight-col">Natural Language prompt-to-workflow AI</td>
                </tr>
                <tr>
                  <td><strong>Data Privacy</strong></td>
                  <td>Uploaded to cloud servers</td>
                  <td className="highlight-col">100% local in your browser (chrome.storage)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="section cta-section" style={{ position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/screenshots/studio/marquee.png)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.2 }} />
        <div className="container" style={{ position: "relative", zIndex: 1 }}>
          <div className="cta-card">
            <div className="cta-glow" aria-hidden="true" />
            <div className="studio-badge" style={{ marginBottom: "16px" }}>⚡ Free to Start</div>
            <h2>Ready to Transform Your Video Pipeline?</h2>
            <p className="text-secondary" style={{ maxWidth: "600px", margin: "0 auto 32px" }}>
              Install AutoFlow Studio for Google Chrome. Free tier includes 10 full workflow runs every month with all node types unlocked.
            </p>
            <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
              <StoreLink product="studio" className="btn btn-primary btn-lg">
                <ChromeIcon /> Install AutoFlow Studio — Free
              </StoreLink>
              <a href="/pricing" className="btn btn-secondary btn-lg">
                View Pricing ($9.99/mo Pro)
              </a>
            </div>
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
