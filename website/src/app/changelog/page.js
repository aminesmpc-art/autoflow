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
