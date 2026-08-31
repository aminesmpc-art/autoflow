import StoreLink from "../StoreLink";
import "../studio/studio.css";

export const metadata = {
  title: "AI Clipping — Turn Long Videos into Short Clips | AutoFlow Studio",
  description:
    "Studio finds the moments worth posting in a long recording, cuts each one on the words it starts and ends on, keeps the speaker in frame from a measured face track, burns in captions, and hands you a shot-by-shot edit sheet.",
  alternates: {
    canonical: "https://www.auto-flow.studio/clipping",
  },
  openGraph: {
    title: "AI Clipping — Turn Long Videos into Short Clips",
    description:
      "Find the moments, cut on the words, keep the speaker in frame, caption them, and get an edit sheet timed to the second. Inside AutoFlow Studio.",
    url: "https://www.auto-flow.studio/clipping",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Clipping — Turn Long Videos into Short Clips",
    description:
      "Find the moments, cut on the words, keep the speaker in frame, caption them, and get an edit sheet timed to the second.",
  },
};

/* The steps are numbered because the order is load-bearing, not for decoration:
   each one depends on the measurement the one before it produced. That is the
   whole argument of the page. */
const PIPELINE = [
  {
    n: "01",
    title: "Read the recording once",
    body:
      "The whole file is read on the server in a single pass — audio, transcript and timings together. Nothing is transcribed six times, and nothing depends on which chat you happen to have signed in.",
  },
  {
    n: "02",
    title: "Find the moments worth posting",
    body:
      "The loudness envelope narrows a twenty-minute recording down to a shortlist of candidates. A model then reads what is actually said in each one and ranks them — so a moment is chosen for the line in it, not for being the loudest.",
  },
  {
    n: "03",
    title: "Cut on the words, not on a guess",
    body:
      "Every clip is named by the line it opens on and the line it closes on. The seconds come from measuring the audio for those words. Ask a model to timestamp a long recording directly and it invents arithmetic — this never asks it to.",
  },
  {
    n: "04",
    title: "Keep the speaker in frame",
    body:
      "A face track is measured across the clip frame by frame, weighted towards whoever is facing the camera. A 9:16 crop then follows the real position. Asking a model where somebody was standing picked the reflection on a mirror shot; measuring does not.",
  },
  {
    n: "05",
    title: "Burn in captions that land",
    body:
      "Captions come from the same measured timings the cut used, word by word, in five looks including a karaoke-style highlight. A short caption holds only into free time, so it never sits on top of the next one.",
  },
  {
    n: "06",
    title: "Hand you the edit",
    body:
      "Each clip arrives with a sheet: the b-roll, the punch-in, the text on screen, the sound effect, the intro and outro card — each one timed to the second, so you can drop them straight into CapCut instead of rewatching to find the beat.",
  },
];

const FACTS = [
  {
    icon: "🎯",
    title: "Measured, not guessed",
    body:
      "Every number in a finished clip — the in point, the out point, where the speaker is, when a caption appears — comes from measuring the file. Models are asked what a moment is worth and what it says, which is what they are good at.",
  },
  {
    icon: "💾",
    title: "Run it once, ever",
    body:
      "The cuts, the captions and the edit sheet are written down with the workflow. Reopening it asks for nothing and re-cuts nothing, so a clipping run you paid for is a clipping run you keep.",
  },
  {
    icon: "✂️",
    title: "Pieces Omni will take",
    body:
      "Flow edits video up to ten seconds at a time. A longer clip is divided on its own pauses — never mid-word — so every piece is something Flow will actually accept, and the joins fall where a listener expects them.",
  },
  {
    icon: "🔑",
    title: "No API keys",
    body:
      "Clipping runs inside the same extension as everything else in Studio, against the accounts you already have. There is no key to paste and none stored in the extension.",
  },
];

export default function ClippingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "HowTo",
            name: "Turn a long recording into short clips with AutoFlow Studio",
            description:
              "How AutoFlow Studio finds postable moments in a long video, cuts them on the spoken words, keeps the speaker in frame and captions them.",
            step: PIPELINE.map((s, i) => ({
              "@type": "HowToStep",
              position: i + 1,
              name: s.title,
              text: s.body,
            })),
          }),
        }}
      />

      {/* ── HERO ── */}
      <section className="studio-hero">
        <div className="studio-hero-bg" />
        <div className="container" style={{ position: "relative", zIndex: 1 }}>
          <div className="studio-badge">✂️ Inside AutoFlow Studio</div>
          <h1>
            A long recording in.<br />
            <span className="text-gradient">Clips worth posting out.</span>
          </h1>
          <p
            className="text-secondary"
            style={{ maxWidth: "760px", margin: "24px auto 0", fontSize: "1.15rem", lineHeight: 1.7 }}
          >
            Studio listens to the whole thing, picks the moments that carry, and cuts each one on the
            words it actually starts and ends on. The speaker stays in frame, the captions land on the
            beat, and every clip comes with the edit already written down.
          </p>
          <div className="studio-hero-ctas">
            <StoreLink product="studio" className="btn btn-primary btn-lg">Install Studio — Free</StoreLink>
            <a href="/pricing" className="btn btn-secondary btn-lg">
              See Pricing →
            </a>
          </div>
        </div>
      </section>

      {/* ── THE ONE THING THAT SHAPES EVERYTHING ── */}
      <section
        className="section"
        style={{
          background: "rgba(255,255,255,0.01)",
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="container">
          <div className="section-header">
            <div className="badge">The constraint everything is built around</div>
            <h2>
              Models cannot reliably timestamp<br />
              <span className="text-gradient">a long recording.</span>
            </h2>
            <p>
              Ask one for the seconds and it will answer confidently and be wrong, and the further into
              the file you go the worse it gets. Most clipping tools ask anyway. This one is built the
              other way round.
            </p>
          </div>

          <div className="pillars-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
            <div className="pillar-card">
              <div className="pillar-icon">🗣️</div>
              <h3>What a model is asked</h3>
              <p>
                Which moment is worth posting, what it actually says, what to caption it, and what the
                edit should do. Judgement and language — the things it is genuinely good at.
              </p>
            </div>
            <div className="pillar-card">
              <div className="pillar-icon">📏</div>
              <h3>What is measured instead</h3>
              <p>
                Every number. Where the words fall in the audio, where the face is in each frame, where
                the pauses are, how long the clip runs. None of it is a model&apos;s answer.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── THE PIPELINE ── */}
      <section className="section">
        <div className="container">
          <div className="section-header">
            <div className="badge">How a clip gets made</div>
            <h2>
              Six steps, and each one<br />
              <span className="text-gradient">depends on the last</span>
            </h2>
            <p>
              The order matters. Captions are timed against the boundary the cut really used, and the
              framing follows a track measured on the clip that was really made.
            </p>
          </div>

          <div className="pillars-grid">
            {PIPELINE.map((step) => (
              <div className="pillar-card" key={step.n}>
                <div
                  className="terminal-text"
                  style={{
                    fontSize: "0.8rem",
                    letterSpacing: "0.12em",
                    color: "var(--primary)",
                    marginBottom: "10px",
                    textShadow: "none",
                  }}
                >
                  {step.n}
                </div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHAT MAKES IT DIFFERENT ── */}
      <section
        className="section"
        style={{
          background: "rgba(255,255,255,0.01)",
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="container">
          <div className="section-header">
            <div className="badge">Why it holds up</div>
            <h2>
              Four things that are true of<br />
              <span className="text-gradient">every clip it makes</span>
            </h2>
          </div>

          <div className="pillars-grid">
            {FACTS.map((f) => (
              <div className="pillar-card" key={f.title}>
                <div className="pillar-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── THE EDIT SHEET ── */}
      <section className="section">
        <div className="container">
          <div className="section-header">
            <div className="badge">The part nobody else hands you</div>
            <h2>
              A clip is the raw material.<br />
              <span className="text-gradient">The edit is the video.</span>
            </h2>
            <p>
              Every cut arrives with a director&apos;s sheet — what to add, and the second to add it at.
            </p>
          </div>

          <div className="comparison-table-wrapper">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Move</th>
                  <th>What it does</th>
                  <th className="highlight-col">When it lands</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>B-roll</strong></td>
                  <td>Covers a line that is being told rather than shown</td>
                  <td className="highlight-col">On the noun, held about 1.5–2s</td>
                </tr>
                <tr>
                  <td><strong>Punch-in</strong></td>
                  <td>Tightens the frame so a line reads as the point</td>
                  <td className="highlight-col">On the emphasised word</td>
                </tr>
                <tr>
                  <td><strong>Text on screen</strong></td>
                  <td>Puts the number or the claim where it cannot be missed</td>
                  <td className="highlight-col">As it is said, not after</td>
                </tr>
                <tr>
                  <td><strong>Sound effect</strong></td>
                  <td>Marks the beat a viewer would otherwise scroll past</td>
                  <td className="highlight-col">0.2–0.4s, on the hit</td>
                </tr>
                <tr>
                  <td><strong>Intro / outro card</strong></td>
                  <td>Frames the clip for somebody who arrived mid-thought</td>
                  <td className="highlight-col">Before the first word, after the last</td>
                </tr>
                <tr>
                  <td><strong>Whoosh on a seam</strong></td>
                  <td>Covers a join where two pieces meet</td>
                  <td className="highlight-col">Across the cut itself</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section
        className="section"
        style={{ borderTop: "1px solid var(--border)", textAlign: "center" }}
      >
        <div className="container">
          <h2 style={{ marginBottom: "16px" }}>
            Stop scrubbing a two-hour recording<br />
            <span className="text-gradient">looking for the good bit.</span>
          </h2>
          <p className="text-secondary" style={{ maxWidth: "640px", margin: "0 auto 32px" }}>
            Clipping is part of AutoFlow Studio. Free to install, ten workflow runs a month included.
          </p>
          <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
            <StoreLink product="studio" className="btn btn-primary btn-lg">Install Studio — Free</StoreLink>
            <a href="/studio" className="btn btn-secondary btn-lg">
              Explore the Canvas →
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
