/* What the "Why it works" page explains under its upload box: what each part
   of a breakdown means, how the numbers are made, and the questions people
   ask. It sits under the tool, like the Extractor's guide, so the page says
   what it does before anyone runs it. */

const PARTS = [
  {
    name: "The hook",
    body: "The opening seconds, scored out of ten: what happens, the technique behind it (a question, a pattern break, a payoff shown first), why it stops the scroll, and one way to make it stronger.",
  },
  {
    name: "Pacing",
    body: "Cuts per ten seconds across the whole video, measured from the real cuts in the file rather than guessed, with the average shot length. A chart shows where the video speeds up and where it rests.",
  },
  {
    name: "Structure",
    body: "The video split into its beats — setup, turn, payoff and so on — each with its timing, what happens and what job it does for the story.",
  },
  {
    name: "Where viewers might leave",
    body: "The moments a viewer is most likely to scroll away, with the reason and a concrete fix: a repeated shot, a slow line, a beat that arrives too late.",
  },
  {
    name: "Techniques",
    body: "The craft choices that carry the video — camera angles, cutting on dialogue, sound cues, on-screen text — with where they happen and why they work.",
  },
  {
    name: "Call to action and what to copy",
    body: "Whether the video asks the viewer to do anything and how well, then a short list of the ideas worth reusing in your own videos, ready to copy.",
  },
];

const FAQ = [
  {
    q: "How is this different from the Video Prompt Extractor?",
    a: "The Extractor answers how a video was made: a prompt for every shot, character sheets and a master prompt to remake it. Why it works answers why the video holds attention, and gives you no prompts at all. Many people run both on the same video.",
  },
  {
    q: "Are the scores objective?",
    a: "No. The hook and call-to-action scores are the AI's judgement and are labelled that way. The pacing is different: it is counted from the cuts detected in the video file itself.",
  },
  {
    q: "What videos can I break down?",
    a: "An MP4, MOV or WebM file up to 500 MB, or a link from YouTube, TikTok, Instagram or X. Videos up to two hours work, and you can analyse just one part of a long video.",
  },
  {
    q: "Is my video kept?",
    a: "No. The video is deleted within an hour of being analysed. The breakdown is saved privately to your dashboard so you can read it again later.",
  },
  {
    q: "Does it cost anything?",
    a: "A breakdown uses the same allowance as an extraction. See the pricing page for what the free plan and Pro include.",
  },
];

export default function BreakdownGuide() {
  return (
    <section style={{ maxWidth: "860px", margin: "96px auto 0", textAlign: "left" }}>
      <h2 style={{ fontSize: "clamp(1.6rem, 3vw, 2.1rem)", marginBottom: "12px" }}>
        What a breakdown tells you
      </h2>
      <p className="text-secondary" style={{ fontSize: "1.02rem", lineHeight: 1.7, marginBottom: "28px" }}>
        A video that gets watched to the end is rarely an accident. It opens on something that stops the scroll,
        changes pace before attention drops, and lands its payoff at the right second. A breakdown takes a finished
        video apart along those lines, so you can see what is doing the work and use it in your own.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px", marginBottom: "56px" }}>
        {PARTS.map((p) => (
          <div key={p.name} style={{ border: "1px solid var(--border)", borderRadius: "12px", padding: "18px", background: "rgba(255,255,255,0.02)" }}>
            <h3 style={{ fontSize: "1.02rem", margin: "0 0 8px", letterSpacing: "-0.01em" }}>{p.name}</h3>
            <p className="text-secondary" style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.6 }}>{p.body}</p>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: "clamp(1.4rem, 2.6vw, 1.8rem)", marginBottom: "12px" }}>How to use it</h2>
      <ol className="text-secondary" style={{ paddingLeft: "22px", lineHeight: 1.8, marginBottom: "56px", fontSize: "1rem" }}>
        <li>Pick a video in your niche that performed far above the creator&apos;s usual numbers.</li>
        <li>Break it down and read the hook and the drop-off risks first: they explain most of the difference.</li>
        <li>Compare its pacing chart with one of your own videos broken down the same way.</li>
        <li>Take one item from &quot;What to copy&quot; into your next video, and change one thing at a time.</li>
      </ol>

      <h2 style={{ fontSize: "clamp(1.4rem, 2.6vw, 1.8rem)", marginBottom: "16px" }}>Questions</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {FAQ.map((f) => (
          <details key={f.q} style={{ border: "1px solid var(--border)", borderRadius: "12px", padding: "14px 18px", background: "rgba(255,255,255,0.02)" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>{f.q}</summary>
            <p className="text-secondary" style={{ margin: "10px 0 0", lineHeight: 1.7 }}>{f.a}</p>
          </details>
        ))}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQ.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          }),
        }}
      />
    </section>
  );
}
