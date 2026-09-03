import StoreLink from "../StoreLink";
import ClipStudio from "./ClipStudio";
import ClipDemo from "./ClipDemo";
import "../studio/studio.css";
import "./clipDemo.css";
import "./clipPage.css";

export const metadata = {
  /* `absolute` because the root layout appends "| AutoFlow — AI Video
     Automation" to every title, and this page was shipping 97 characters with
     the brand in it twice. Google renders about 60. */
  title: {
    absolute: "Free AI Clip Maker — Turn Long Videos into Shorts | AutoFlow",
  },
  description:
    "Free AI video clipper. Drop a podcast, stream or interview and get short vertical clips for TikTok, Reels and YouTube Shorts — cut on the spoken line, reframed to 9:16 from a measured face track, captioned, and handed over with an edit sheet.",
  keywords: [
    "ai clip maker", "long video to shorts", "podcast to shorts",
    "ai video clipper", "free clip generator", "tiktok clips from long video",
    "youtube shorts maker", "reels clip maker", "auto captions 9:16",
  ],
  alternates: {
    canonical: "https://www.auto-flow.studio/clipping",
  },
  openGraph: {
    title: "Free AI Clip Maker — Turn Long Videos into Shorts",
    description:
      "Drop a long recording and get short vertical clips: cut on the spoken line, reframed to 9:16, captioned, with an edit sheet timed to the second.",
    url: "https://www.auto-flow.studio/clipping",
    type: "website",
    /* Named explicitly. Next MERGES this object over the root layout's rather
       than inheriting the parts left out, so omitting images here meant every
       share of this page was a bare card with no picture at all. */
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "AutoFlow — turn a long recording into short vertical clips",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Free AI Clip Maker — Turn Long Videos into Shorts",
    description:
      "Drop a long recording and get short vertical clips: cut on the spoken line, reframed to 9:16, captioned, with an edit sheet.",
    images: ["/og-image.png"],
  },
};

/* Questions people actually ask before using something like this — what it
   costs, what happens to the file, whether it works where they are. Rendered
   on the page AND emitted as FAQPage, which is the schema type here that
   Google still turns into a result. */
const FAQ = [
  {
    q: "Is the AI clip maker free?",
    a: "Yes. A free account clips one recording a day; Pro raises that to ten. Reading a video runs a model over the whole file, which is the part that costs money — the cutting, reframing and captioning all happen in your own browser and cost nothing.",
  },
  {
    q: "What happens to my video?",
    a: "It is uploaded once so the model can read it — audio, transcript and timings in a single pass — and it is deleted when the reading finishes. Every clip is then cut, cropped and captioned locally in your browser, so the footage is not sent anywhere a second time.",
  },
  {
    q: "How long can the recording be?",
    a: "Up to two hours and 500 MB, in MP4, MOV, WebM or MKV. A twenty-minute recording is read in well under a minute; the encoding afterwards depends on your machine and how many clips you asked for.",
  },
  {
    q: "Does it add captions automatically?",
    a: "Yes, burned into the picture, word by word, in five looks including a karaoke-style highlight. The cue times come from the same measured reading the cut used, so they follow the voice rather than drifting from it.",
  },
  {
    q: "Will the clips be vertical for TikTok, Reels and Shorts?",
    a: "9:16 by default, with 1:1, 4:5 and 16:9 available. The crop follows a face track measured across the clip frame by frame, so the speaker stays in shot instead of walking out of a fixed centre crop.",
  },
  {
    q: "Which browsers does it work in?",
    a: "Any browser with WebCodecs: Chrome and Edge 94 and up, Safari 16.4 and up, Firefox 130 and up. The page checks before you upload anything and says so if it cannot encode, rather than failing after the reading is paid for.",
  },
  {
    q: "How does it decide which moments are worth posting?",
    a: "The loudness envelope shortlists candidates from the audio, then a model reads what is actually said in each one and scores it out of 100. You set the bar. Nothing is chosen for being loud — that only decides where to look.",
  },
  {
    q: "Do I need the Chrome extension?",
    a: "Not for this page. AutoFlow Studio runs the same pipeline on a canvas where clips become nodes you can re-cut, re-frame and re-caption without paying for the reading again, and every run here can be downloaded as a Studio workflow.",
  },
];

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
      {/* One graph rather than four tags. HowTo is kept because it still
          describes the page honestly to anything that reads it, but Google
          stopped rendering HowTo results in 2023, so it is no longer carrying
          this page on its own — SoftwareApplication, FAQPage and
          BreadcrumbList are the ones that can still produce a result. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "SoftwareApplication",
                "@id": "https://www.auto-flow.studio/clipping#app",
                name: "AutoFlow AI Clip Maker",
                url: "https://www.auto-flow.studio/clipping",
                applicationCategory: "MultimediaApplication",
                applicationSubCategory: "Video Editing",
                operatingSystem: "Any browser with WebCodecs (Chrome 94+, Edge 94+, Safari 16.4+, Firefox 130+)",
                description:
                  "Turns a long recording into short vertical clips: moments ranked from the audio, cut on the spoken line, reframed to 9:16 from a measured face track, captioned, and delivered with an edit sheet.",
                featureList: [
                  "Finds the moments worth posting in a long recording",
                  "Cuts on the spoken line rather than a guessed timestamp",
                  "9:16, 1:1, 4:5 and 16:9 reframing from a measured face track",
                  "Burned-in word-timed captions in five styles",
                  "Shot-by-shot edit sheet timed to the second",
                  "Exports MP4 clips and an AutoFlow Studio workflow",
                ],
                offers: {
                  "@type": "Offer",
                  price: "0",
                  priceCurrency: "USD",
                  description: "One recording a day free; ten a day on Pro.",
                },
              },
              {
                "@type": "FAQPage",
                "@id": "https://www.auto-flow.studio/clipping#faq",
                mainEntity: FAQ.map(({ q, a }) => ({
                  "@type": "Question",
                  name: q,
                  acceptedAnswer: { "@type": "Answer", text: a },
                })),
              },
              {
                "@type": "BreadcrumbList",
                itemListElement: [
                  {
                    "@type": "ListItem",
                    position: 1,
                    name: "AutoFlow",
                    item: "https://www.auto-flow.studio",
                  },
                  {
                    "@type": "ListItem",
                    position: 2,
                    name: "AI Clipping",
                    item: "https://www.auto-flow.studio/clipping",
                  },
                ],
              },
              {
                "@type": "HowTo",
                name: "Turn a long recording into short clips with AutoFlow",
                description:
                  "How AutoFlow finds postable moments in a long video, cuts them on the spoken words, keeps the speaker in frame and captions them.",
                step: PIPELINE.map((s, i) => ({
                  "@type": "HowToStep",
                  position: i + 1,
                  name: s.title,
                  text: s.body,
                })),
              },
            ],
          }),
        }}
      />

      {/* ── HERO — the tool IS the hero ──
          Everything below this section is the argument for the pipeline, and
          a working one is a better argument than a description of one. The
          headline is kept short so the drop zone is reachable without
          scrolling on a laptop. */}
      <section className="studio-hero clip-hero" id="clip-it">
        <div className="studio-hero-bg" />
        <div className="container" style={{ position: "relative", zIndex: 1 }}>
          <div className="studio-badge">✂️ Free · runs in your browser</div>
          <h1>
            Turn a long video into<br />
            <span className="text-gradient">short clips worth posting.</span>
          </h1>
          <p className="clip-hero-sub">
            Drop a podcast, stream or interview. You get vertical clips for TikTok,
            Reels and YouTube Shorts — cut on the line they open and close on,
            reframed to 9:16, captioned, with the edit already written down.
          </p>

          <div className="clip-hero-tool">
            <ClipStudio />
          </div>

          <ul className="clip-hero-trust">
            <li>One recording a day, free</li>
            <li>Up to 2 hours · 500 MB</li>
            <li>Cut and captioned in your browser</li>
            <li>No watermark</li>
          </ul>
        </div>
      </section>

      {/* ── WHAT COMES OUT ──
          The page had no images at all, which for a video product meant a
          visitor could read the whole argument and never see the output. */}
      <section className="section" style={{ paddingTop: "40px" }}>
        <div className="container">
          <div className="section-header">
            <div className="badge">What comes back</div>
            <h2>
              One recording in,<br />
              <span className="text-gradient">a field of clips out.</span>
            </h2>
          </div>
          <ClipDemo />
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

      {/* ── FAQ ──
          Real questions, and the schema type on this page most likely to earn
          a result now that HowTo no longer does. Plain <details> so it works
          with no JavaScript and every answer is in the HTML a crawler reads,
          open or closed. */}
      <section
        className="section"
        style={{ background: "rgba(255,255,255,0.01)", borderTop: "1px solid var(--border)" }}
      >
        <div className="container">
          <div className="section-header">
            <div className="badge">Questions</div>
            <h2>
              Before you upload<br />
              <span className="text-gradient">two hours of anything.</span>
            </h2>
          </div>

          <div className="clip-faq">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="clip-faq-item">
                <summary>
                  <h3>{q}</h3>
                  <span className="clip-faq-mark" aria-hidden="true" />
                </summary>
                <p>{a}</p>
              </details>
            ))}
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
            Clip one here for free, or run the same pipeline on a canvas in AutoFlow
            Studio, where every clip becomes a node you can re-cut without paying for
            the reading again.
          </p>
          <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
            <a href="#clip-it" className="btn btn-primary btn-lg">Clip a recording →</a>
            <StoreLink product="studio" className="btn btn-secondary btn-lg">Install Studio — Free</StoreLink>
          </div>
        </div>
      </section>
    </>
  );
}
