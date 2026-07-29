export const dynamic = 'force-static';

export const metadata = {
  title: "Changelog — AutoFlow Version History & Updates",
  description:
    "See what's new in AutoFlow. Latest features, improvements, and bug fixes for the #1 Chrome extension for Google Flow automation.",
  alternates: {
    canonical: "https://www.auto-flow.studio/changelog",
  },
};

const releases = [
  {
    version: "5.0",
    date: "2026-07-29",
    title: "AutoFlow Studio — Visual Workflow Builder",
    highlights: [
      "AutoFlow Studio — build workflows on a canvas instead of a list. Connect a prompt to a generation, feed that result into the next one, and run the whole chain in a single click",
      "12 ready-made workflows with working example prompts — UGC product ads, character sheets, virtual try-on, B-roll packs and more, so there is nothing to write before your first run",
      "Character consistency — generate a character sheet once, then reuse it as a reference so the same face carries across every shot",
      "Multi-reference generation — lock face, outfit and scene with separate reference images, so a new outfit no longer quietly changes the face",
      "ChatGPT workflows — design an image on ChatGPT, then animate it on Google Flow in the same run",
      "Save, reload, import and export workflows, with autosave so closing the window no longer loses work",
    ],
    improvements: [
      "Reference images now reach the generator — image connections drawn on the canvas were previously ignored, so character references had no effect",
      "Generated results now preview inside each node instead of showing a broken thumbnail",
      "Model lists corrected — the picker offered names that do not exist on Flow (\"Veo 3\", \"Imagen 4 Ultra\"), which silently fell back to whichever model was already selected",
      "10-second clips selectable on every video node",
      "Image → Video switching made reliable in multi-step workflows; the run now stops with a clear message rather than generating the wrong media type",
      "Studio opens your Flow project, or a ChatGPT tab, automatically when one is not already open",
      "Removed the forced page reload that hit every Google Flow visit",
      "Free plan includes 15 Studio runs per month and workflows up to 5 nodes; Pro is unlimited",
      "No API key is embedded in the extension any more — AI Assist now uses your own free Gemini key",
    ],
  },
  {
    version: "4.2",
    date: "2026-07-04",
    title: "Instagram Extractor Fix & Smart Retry Engine",
    highlights: [
      "Instagram Extractor resilience — restricted and private Instagram posts now return clear, user-friendly error messages instead of raw technical errors",
      "Smart retry engine — failed generations now click the DOM retry button (up to 3 attempts) instead of re-submitting the entire prompt, saving time and credits",
      "Whop email mismatch prevention — a visible warning on registration and upgrade buttons reminds users to use the same email on Whop and AutoFlow for automatic Pro activation",
    ],
    improvements: [
      "Increased MAX_RETRIES to 3 with a new VERIFY_MAX_RETRIES constant for finer retry control",
      "MediaID capture reliability improved during the verification loop",
      "Backend now categorizes Instagram errors into 'Restricted Content' vs 'Server Block' with actionable guidance",
      "Upgrade button shows a confirmation alert before redirecting to Whop checkout",
    ],
  },
  {
    version: "4.0",
    date: "2026-06-22",
    title: "Official v4.0 Production Release",
    highlights: [
      "Major version release for the AutoFlow Chrome extension",
      "Clean zip packaging for Chrome Web Store and direct site downloads",
    ],
    improvements: [
      "Upgraded manifest and package versioning configurations",
    ],
  },
  {
    version: "3.6",
    date: "2026-06-19",
    title: "Cancelled Video Rescue & API Verification Fix",
    highlights: [
      "Fake Cancel Rescue — cancelled videos that actually exist on Google's CDN are now automatically detected and saved instead of being re-submitted or lost",
      "CSP-Safe API Checking — rewrote the active status check to work with Google's Content Security Policy, fixing the 'API credentials not captured' timeout that broke verification",
      "Universal DOM Tiebreaker — when the API cache shows stale 'generating' status but tiles are already settled, the bot now immediately routes to recovery in all modes (previously Full mode was stuck looping)",
    ],
    improvements: [
      "CDN URL verification now runs on both 'no API data' and 'no retry button' paths, catching all fake cancel scenarios",
      "Race condition fix between API cache updates and status check responses using cache confirmation polling",
      "Verification rounds resolve in 1–2 rounds instead of looping through all 12 when tiles are already settled",
    ],
  },
  {
    version: "3.5",
    date: "2026-06-16",
    title: "Stuck Wait Loop Fix & Scroll Optimization",
    highlights: [
      "Robust Tag-Agnostic Icon Detection — updated generation tile parsing to support new Google Flow span elements, preventing completed items from getting falsely stuck in generating status.",
      "Grid Scroll Optimization — wait loop now checks settles status directly via DOM and performs scroll confirmations exactly once, eliminating continuous scrolling.",
      "Recovery Scan Optimization — removed redundant page scrolling blocks from recovery scan, cutting recovery checking time in half.",
    ],
    improvements: [
      "Bundled build optimizations and bumped manifest version to 3.5 for Chrome Web Store publishing.",
    ],
  },
  {
    version: "3.4",
    date: "2026-06-14",
    title: "Zero-Intervention Reliability & CORS Resolution",
    highlights: [
      "Safety Policy Failures Classification — automatically identifies policy and safety blocks to instantly skip them without wasting retries",
      "Exact Failure Reasons — sidepanel's Failed Generations section now displays the specific reason why a prompt failed (e.g. policy violations or server errors) alongside its text",
      "CORS Redirect Bypass — redesigned network media verification using manual redirect tracking, resolving Chrome extension cross-origin blockages",
    ],
    improvements: [
      "Stuck queue mitigation — 30-second API staleness detector triggers active refreshes and DOM tiebreakers to prevent queue stagnation",
      "Automated queue-to-download pipeline robustness enhancements",
    ],
  },
  {
    version: "3.3",
    date: "2026-06-10",
    title: "Omni Flash Model & Duration Controls",
    highlights: [
      "Omni Flash model support — Google's new high-speed video generation model is now fully integrated",
      "10-second video clips — available exclusively with Omni Flash for longer, richer generations",
      "Duration selector on queue cards — change clip length directly from each queue without opening Settings",
      "Run button on every queue — run any queue instantly, not just the first one in the list",
    ],
    improvements: [
      "Updated model list across Settings and queue cards to match latest Google Flow lineup",
      "Scheduling UI temporarily removed while being redesigned for a better experience",
      "Library scanner now correctly detects and labels Omni Flash-generated assets",
      "Model selector in automation engine recognizes Omni as a new model family",
    ],
  },
  {
    version: "3.2",
    date: "2026-06-01",
    title: "Premium UI Redesign & Scalability Upgrade",
    highlights: [
      "Complete UI overhaul — electric blue glassmorphic design with micro-animations",
      "Scalable prompt list — scrollable container handles 2,000+ prompts smoothly",
      "Breathing icon animations on active mode cards for visual feedback",
      "Animated header accent line with shimmer effect",
      "Enhanced textarea focus states with multi-layer glow effects",
    ],
    improvements: [
      "Auto-expire system for time-limited Pro access (review rewards)",
      "Paying subscribers are now protected from accidental downgrades",
      "Refined tab navigation with sleek active-state underlines",
      "Compact prompt row design with stronger hover interactions",
      "Performance-optimized CSS with reduced repaints",
    ],
  },
  {
    version: "2.7",
    date: "2026-05-26",
    title: "Mixed Queue Tracking & Review Rewards",
    highlights: [
      "Mixed-type queue support — text and image prompts counted separately per queue",
      "Review Reward system — get free Pro by leaving a Chrome Web Store review",
      "Smart eligibility gate — reward CTA only appears when you hit your daily limit",
      "Limit dialog now shows 'Get Free Pro' option alongside upgrade",
    ],
    improvements: [
      "More accurate prompt tracking for mixed content queues",
      "Backend pre-consumption splits text/image credits atomically",
    ],
  },
  {
    version: "2.6",
    date: "2026-05-19",
    title: "Analytics & Usage Tracking Overhaul",
    highlights: [
      "Per-prompt type counting — each prompt in a queue is individually classified",
      "Usage analytics now based on actual execution events, not reserved quotas",
      "Enhanced admin dashboard with real-time metrics",
    ],
    improvements: [
      "Fixed mixed queues being reported as single type",
      "Improved reliability of queue consumption tracking",
    ],
  },
  {
    version: "2.5",
    date: "2026-05-13",
    title: "Browser Notifications & Queue Improvements",
    highlights: [
      "Browser notifications when queues complete or fail",
      "Notification sound toggle in settings",
      "Click notification to focus the active Flow tab",
      "Extend feature for Text-to-Video and Ingredients modes",
    ],
    improvements: [
      "Fixed Stop button reliability during long queues",
      "Better error handling for failed generation chains",
      "Improved queue stop signal propagation",
    ],
  },
  {
    version: "2.4",
    date: "2026-04-28",
    title: "Prompt Extractor & Library Scan",
    highlights: [
      "Prompt Extractor — reverse-engineer prompts from any AI video",
      "Auto-scan library after queue completion",
      "Batch download with quality selection (720p, 1080p, 4K)",
      "Re-prompt dialog for failed generations",
    ],
    improvements: [
      "Faster library scanning with grouped assets",
      "Better error messages for generation failures",
    ],
  },
  {
    version: "2.3",
    date: "2026-04-10",
    title: "Multi-Queue & Character Libraries",
    highlights: [
      "Multiple named queues with independent configurations",
      "Character image library for consistent subjects across prompts",
      "Frame chain support — use output from one generation as input for the next",
      "Queue reordering via drag-and-drop",
    ],
    improvements: [
      "Reduced memory usage for large queues (100+ prompts)",
      "Improved image attachment reliability",
    ],
  },
  {
    version: "2.0",
    date: "2026-03-15",
    title: "Major Redesign — Pro Plans & Account System",
    highlights: [
      "Complete UI redesign with dark theme",
      "Account system with Free and Pro plans",
      "Daily usage tracking with visual progress bars",
      "Veo 3 model support",
      "Multi-language support (English, Arabic, French)",
    ],
    improvements: [
      "Full rewrite of automation engine for reliability",
      "New side panel architecture",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <>
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
              {
                "@type": "ListItem",
                position: 2,
                name: "Changelog",
                item: "https://www.auto-flow.studio/changelog",
              },
            ],
          }),
        }}
      />

      <section className="faq-hero">
        <div className="container">
          <div className="badge">Changelog</div>
          <h1>
            What&apos;s New in{" "}
            <span className="text-gradient">AutoFlow</span>
          </h1>
          <p>Latest features, improvements, and fixes.</p>
        </div>
      </section>

      <section className="section">
        <div className="container" style={{ maxWidth: "780px" }}>
          {releases.map((release, i) => (
            <div
              key={release.version}
              style={{
                marginBottom: "48px",
                paddingBottom: "48px",
                borderBottom: i < releases.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                <span
                  style={{
                    background: i === 0 ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "rgba(99,102,241,0.15)",
                    color: i === 0 ? "#fff" : "#a5b4fc",
                    padding: "4px 14px",
                    borderRadius: "20px",
                    fontSize: "13px",
                    fontWeight: 700,
                  }}
                >
                  v{release.version}
                </span>
                <span style={{ color: "#64748b", fontSize: "13px" }}>
                  {new Date(release.date).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                {i === 0 && (
                  <span
                    style={{
                      background: "rgba(16,185,129,0.15)",
                      color: "#10b981",
                      padding: "2px 10px",
                      borderRadius: "12px",
                      fontSize: "11px",
                      fontWeight: 600,
                    }}
                  >
                    LATEST
                  </span>
                )}
              </div>

              <h2 style={{ margin: "0 0 16px", fontSize: "22px", fontWeight: 700, color: "#f1f5f9" }}>
                {release.title}
              </h2>

              <div style={{ marginBottom: "12px" }}>
                <h4 style={{ color: "#a5b4fc", fontSize: "13px", fontWeight: 600, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  ✨ Highlights
                </h4>
                <ul style={{ margin: 0, paddingLeft: "20px", color: "#cbd5e1", fontSize: "14px", lineHeight: 1.8 }}>
                  {release.highlights.map((h, j) => (
                    <li key={j}>{h}</li>
                  ))}
                </ul>
              </div>

              {release.improvements && (
                <div>
                  <h4 style={{ color: "#64748b", fontSize: "13px", fontWeight: 600, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    🔧 Improvements
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: "20px", color: "#94a3b8", fontSize: "14px", lineHeight: 1.8 }}>
                    {release.improvements.map((imp, j) => (
                      <li key={j}>{imp}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
