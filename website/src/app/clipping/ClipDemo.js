/**
 * What comes out, drawn rather than described.
 *
 * The page had no images at all — for a product whose entire output is video,
 * a visitor could read 986 words and still not know what lands in their
 * downloads folder. This is that, in one picture: a wide recording with three
 * spans marked on its own waveform, and the three vertical captioned clips
 * those spans become.
 *
 * ── Why it is drawn and not photographed ──────────────────────────────────
 *
 * A screenshot of real output would be more persuasive, and should replace
 * this the moment there is one worth showing. Until then a drawing has three
 * properties a placeholder screenshot does not: it costs no network request,
 * it cannot go stale when the caption style changes, and it renders identically
 * for everyone. It is also in the server-rendered HTML, so it is content a
 * crawler sees rather than something a script paints in later.
 *
 * Deliberately not to scale and not interactive. It is a diagram of the idea —
 * loud parts are candidates, the model picks which are worth posting, the cut
 * lands on whole spoken lines — not a mock of the interface.
 */

/* The three chosen moments, as fractions of the recording. Spread unevenly on
   purpose: an even three would read as decoration rather than as a result. */
const PICKS = [
  { start: 0.08, width: 0.11, score: 91 },
  { start: 0.37, width: 0.13, score: 84 },
  { start: 0.71, width: 0.10, score: 78 },
];

/* A fixed pseudo-waveform. Written out rather than generated so the picture is
   identical on the server and in the browser — a random one would differ
   between the two renders and React would replace the whole thing on hydration. */
const BARS = [
  9, 14, 11, 22, 38, 46, 41, 29, 17, 12, 10, 16, 13, 9, 12, 20, 15, 11, 8, 13,
  10, 18, 14, 9, 11, 26, 44, 52, 47, 33, 19, 13, 10, 15, 12, 9, 14, 11, 17, 12,
  9, 13, 10, 16, 21, 14, 10, 12, 9, 15, 11, 19, 13, 10, 24, 42, 49, 39, 25, 15,
  11, 16, 12, 9, 13, 18, 14, 10, 12, 9,
];

const CLIPS = [
  { rank: 1, caption: "this is the part", second: "people replay", score: 91, secs: "38s" },
  { rank: 2, caption: "nobody tells you", second: "the boring bit", score: 84, secs: "52s" },
  { rank: 3, caption: "do this instead", second: "it takes a minute", score: 78, secs: "44s" },
];

export default function ClipDemo() {
  return (
    <div className="clip-demo" aria-hidden="false">
      {/* ── The recording ── */}
      <figure className="clip-demo-source">
        <figcaption className="clip-demo-label">
          <span className="clip-demo-dot" /> One recording · 1:42:00 · landscape
        </figcaption>

        <div className="clip-demo-track">
          {/* The spans the model chose, behind the waveform so the bars sit on
              top of them rather than being interrupted by them. */}
          {PICKS.map((p, i) => (
            <span
              key={i}
              className="clip-demo-pick"
              style={{ left: `${p.start * 100}%`, width: `${p.width * 100}%` }}
            >
              <span className="clip-demo-pick-score">{p.score}</span>
            </span>
          ))}

          <div className="clip-demo-wave">
            {BARS.map((h, i) => {
              const at = i / BARS.length;
              const chosen = PICKS.some((p) => at >= p.start && at <= p.start + p.width);
              return (
                <i
                  key={i}
                  className={chosen ? "on" : ""}
                  style={{ height: `${Math.max(8, h)}%` }}
                />
              );
            })}
          </div>
        </div>

        <div className="clip-demo-scale">
          <span>0:00</span><span>30:00</span><span>1:00:00</span><span>1:42:00</span>
        </div>
      </figure>

      {/* ── What that becomes ── */}
      <div className="clip-demo-arrow" role="presentation">
        <svg viewBox="0 0 24 34" width="24" height="34" focusable="false" aria-hidden="true">
          <path
            d="M12 1v25m0 0l-7-7m7 7l7-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="clip-demo-out">
        {CLIPS.map((c) => (
          <figure className="clip-demo-clip" key={c.rank}>
            <div className="clip-demo-phone">
              {/* The speaker, kept in frame by the measured face track. A circle
                  and shoulders: enough to read as a person, not enough to
                  pretend to be a photograph. */}
              <svg viewBox="0 0 90 160" className="clip-demo-figure" aria-hidden="true">
                <defs>
                  <linearGradient id={`cdg${c.rank}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(255,92,0,0.30)" />
                    <stop offset="100%" stopColor="rgba(255,92,0,0.05)" />
                  </linearGradient>
                </defs>
                <rect width="90" height="160" fill={`url(#cdg${c.rank})`} />
                <circle cx="45" cy="58" r="19" fill="rgba(255,255,255,0.20)" />
                <path
                  d="M12 128c0-19 15-31 33-31s33 12 33 31v32H12z"
                  fill="rgba(255,255,255,0.14)"
                />
              </svg>

              <span className="clip-demo-ratio">9:16</span>

              {/* Burned-in captions, word-timed. The highlight is the karaoke
                  preset: the word that is being said, lit as it lands. */}
              <div className="clip-demo-caption">
                <b>{c.caption}</b>
                <span>{c.second}</span>
              </div>
            </div>

            <figcaption className="clip-demo-meta">
              <span className="clip-demo-score">{c.score}</span>
              <span>{c.secs}</span>
              <span className="clip-demo-cc">captions</span>
            </figcaption>
          </figure>
        ))}
      </div>

      <p className="clip-demo-note">
        Each clip is cut on the line it opens and closes on, cropped to 9:16 from a
        measured face track, and captioned from the same timings — then handed over
        with an edit sheet timed to the second.
      </p>
    </div>
  );
}
