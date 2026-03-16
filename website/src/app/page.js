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
      <section className="hero">
        <div className="hero-bg-glow" aria-hidden="true" />
        <div className="container hero-content">
          <div className="hero-badge badge animate-in">
            <span>⚡</span> Chrome Extension for Google Flow
          </div>
          <h1 className="animate-in delay-1">
            AI Video Generation<br />
            <span className="text-gradient">on Autopilot</span>
          </h1>
          <p className="hero-subtitle animate-in delay-2">
            Paste your prompts, hit run, and walk away. AutoFlow handles the clicking,
            waiting, retrying, and downloading — so you can focus on creating.
          </p>
          <div className="hero-buttons animate-in delay-3">
            <a
              href="https://chromewebstore.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-lg"
            >
              <ChromeIcon /> Install Free — It&apos;s Fast
            </a>
            <a href="#features" className="btn btn-secondary btn-lg">
              See Features →
            </a>
          </div>
          <div className="hero-screenshot animate-in delay-4">
            <img
              src="/screenshots/full-workflow.png"
              alt="AutoFlow running alongside Google Flow — queue completed with generated videos"
              className="hero-img"
            />
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="section" id="features">
        <div className="container">
          <div className="section-header">
            <div className="badge">Features</div>
            <h2>Everything You Need to<br /><span className="text-gradient">Generate at Scale</span></h2>
            <p>AutoFlow supercharges Google Flow with powerful automation — from prompt to download.</p>
          </div>

          {/* Feature 1: Batch Prompts */}
          <div className="feature-showcase">
            <div className="feature-text">
              <div className="feature-tag">Create</div>
              <h3>Batch Prompt Processing</h3>
              <p className="text-secondary">
                Stop copy-pasting prompts one by one. Paste your entire script — 5, 50, or
                500 prompts — into the editor. AutoFlow instantly parses each block into a
                separate task, ready to queue. Supports text-to-video, image-to-video,
                frame-to-video, and ingredients mode.
              </p>
              <ul className="feature-bullets">
                <li>Paste all prompts at once — separated by blank lines</li>
                <li>Auto-detects scene numbers and formats</li>
                <li>Supports every Google Flow creation mode</li>
              </ul>
            </div>
            <div className="feature-image">
              <img
                src="/screenshots/create-prompts.png"
                alt="AutoFlow Create tab showing batch prompt editor with 5 parsed scenes"
              />
            </div>
          </div>

          {/* Feature 2: Image Mapping */}
          <div className="feature-showcase feature-reverse">
            <div className="feature-text">
              <div className="feature-tag">Images</div>
              <h3>Reference Image Mapping</h3>
              <p className="text-secondary">
                Attach reference images to your prompts for image-to-video generation.
                Use shared images (applied to every prompt), per-prompt images, or
                automatic character matching — upload a character sheet and AutoFlow
                maps the right face to each scene.
              </p>
              <ul className="feature-bullets">
                <li>Shared references attached to every prompt</li>
                <li>Character image auto-matching by name</li>
                <li>Per-prompt image selection (up to 10 each)</li>
              </ul>
            </div>
            <div className="feature-image">
              <img
                src="/screenshots/image-mapping.png"
                alt="AutoFlow showing shared reference images, character matching, and per-prompt image slots"
              />
            </div>
          </div>

          {/* Feature 3: Smart Queue */}
          <div className="feature-showcase">
            <div className="feature-text">
              <div className="feature-tag">Queues</div>
              <h3>Smart Queue Management</h3>
              <p className="text-secondary">
                Every setting is visible at a glance — model, orientation, generations,
                timing, download quality, and more. Create multiple queues with different
                configs, reorder them, and run them sequentially. Each queue remembers
                its own settings.
              </p>
              <ul className="feature-bullets">
                <li>Full settings grid — model, timing, downloads, behavior</li>
                <li>Run target: new project or current project</li>
                <li>Progress tracking with prompts/done/failed/pending</li>
              </ul>
            </div>
            <div className="feature-image">
              <img
                src="/screenshots/queue-card.png"
                alt="AutoFlow queue card showing Veo 3.1 Fast settings, 4 prompts pending, ready to run"
              />
            </div>
          </div>

          {/* Feature 4: Run Monitor */}
          <div className="feature-showcase feature-reverse">
            <div className="feature-text">
              <div className="feature-tag">Automation</div>
              <h3>Live Run Monitor</h3>
              <p className="text-secondary">
                Watch AutoFlow work in real time. The run monitor shows every action —
                opening settings, filling prompts, detecting tiles, waiting for generation.
                Pause, resume, skip a prompt, or force retry whenever you want.
                Full transparency, full control.
              </p>
              <ul className="feature-bullets">
                <li>Real-time log of every automation step</li>
                <li>Pause / Resume / Stop / Skip / Retry controls</li>
                <li>Auto-retry on failures with configurable behavior</li>
              </ul>
            </div>
            <div className="feature-image">
              <img
                src="/screenshots/run-monitor.png"
                alt="AutoFlow Run Monitor showing live automation log with pause, resume, stop, skip, and retry controls"
              />
            </div>
          </div>

          {/* Feature 5: Library Scanner */}
          <div className="feature-showcase">
            <div className="feature-text">
              <div className="feature-tag">Library</div>
              <h3>Library Scanner &amp; Batch Download</h3>
              <p className="text-secondary">
                After generation, scan your Flow project to see all videos and images
                grouped by prompt. Select favorites, batch download in 720p, 1080p, or 4K,
                or trigger upscaling — all from the side panel. No more right-clicking
                one video at a time.
              </p>
              <ul className="feature-bullets">
                <li>One-click scan of all generated assets</li>
                <li>Grouped by prompt with video/image counts</li>
                <li>Batch download or upscale selected assets</li>
              </ul>
            </div>
            <div className="feature-image">
              <img
                src="/screenshots/library-results.png"
                alt="AutoFlow Library showing scanned videos grouped by prompt — cats, sniper, babies — with select and download controls"
              />
            </div>
          </div>

          {/* Feature 6: Settings */}
          <div className="feature-showcase feature-reverse">
            <div className="feature-text">
              <div className="feature-tag">Settings</div>
              <h3>Fully Configurable</h3>
              <p className="text-secondary">
                Choose your video model (Veo 3.1 Fast, Veo 3, etc.), aspect ratio,
                generation count, wait times, and download preferences. Enable typing
                mode for natural input pacing, set auto-download to save videos
                automatically, and choose your preferred language.
              </p>
              <ul className="feature-bullets">
                <li>Video model and resolution selection</li>
                <li>Auto-download with custom resolution (720p – 4K)</li>
                <li>Typing mode for human-like input pacing</li>
              </ul>
            </div>
            <div className="feature-image">
              <img
                src="/screenshots/settings.png"
                alt="AutoFlow Settings showing video model, ratio, timing, download, and language options"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="section section-alt" id="how-it-works">
        <div className="container">
          <div className="section-header">
            <div className="badge">How It Works</div>
            <h2>Three Steps to<br /><span className="text-gradient">Automated Generation</span></h2>
            <p>Get started in under a minute. No complex setup required.</p>
          </div>
          <div className="steps-container">
            <div className="step-card-rich">
              <div className="step-badge">01</div>
              <div className="step-content">
                <h3>Paste Your Prompts</h3>
                <p className="text-secondary">
                  Open AutoFlow&apos;s side panel on any Google Flow page. Choose your mode
                  (text-to-video, image-to-video, ingredients), then paste all your prompts.
                  Each paragraph becomes a separate task. Attach reference images if needed.
                </p>
              </div>
              <div className="step-image">
                <img
                  src="/screenshots/prompt-list.png"
                  alt="5 parsed prompts ready to be queued"
                />
              </div>
            </div>
            <div className="step-card-rich">
              <div className="step-badge">02</div>
              <div className="step-content">
                <h3>Configure &amp; Run</h3>
                <p className="text-secondary">
                  Add your prompts to a queue. Choose your video model, orientation,
                  generation count, and download settings. Set your run target (new or
                  current project) and hit Run. AutoFlow takes over from here.
                </p>
              </div>
              <div className="step-image">
                <img
                  src="/screenshots/queue-card.png"
                  alt="Queue card with all settings configured and Run button"
                />
              </div>
            </div>
            <div className="step-card-rich">
              <div className="step-badge">03</div>
              <div className="step-content">
                <h3>Sit Back &amp; Collect</h3>
                <p className="text-secondary">
                  AutoFlow types each prompt, clicks generate, waits for results,
                  downloads the videos, and moves to the next prompt automatically.
                  When it&apos;s done, scan the library to review, select, and batch
                  download everything.
                </p>
              </div>
              <div className="step-image">
                <img
                  src="/screenshots/library-results.png"
                  alt="Library showing all generated videos grouped and ready for download"
                />
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
            <a
              href="https://chromewebstore.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-lg"
            >
              <ChromeIcon /> Install AutoFlow — Free
            </a>
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
