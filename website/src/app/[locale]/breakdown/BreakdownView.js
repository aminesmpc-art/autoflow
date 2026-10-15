"use client";

import { clock } from "../extractor/timeFields";
import PacingChart from "./PacingChart";

/* A "why it works" breakdown, read top to bottom the way a strategist would
   present it: what the video is, its hook, how it is paced, its structure,
   where it risks losing people, how it is made, what it asks for, and what
   to steal. Scores are the model's judgement and are labelled as out of ten;
   pacing is measured and says so. */

const panel = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px", marginBottom: "24px" };
const h3 = { margin: "0 0 14px", fontSize: "1.15rem", color: "white", fontWeight: 700 };
const label = { fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "1px", color: "var(--text-muted)" };
const body = { color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 };
const chip = { border: "1px solid rgba(255, 92, 0, 0.4)", padding: "2px 10px", fontSize: "0.8rem", color: "var(--text-primary)", borderRadius: "999px" };

function Stat({ name, value, note }) {
  return (
    <div style={{ ...panel, marginBottom: 0, padding: "16px 20px", flex: "1 1 160px" }}>
      <div style={label}>{name}</div>
      <div style={{ fontSize: "1.8rem", fontWeight: 600, color: "white", margin: "4px 0 2px" }}>{value}</div>
      {note && <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{note}</div>}
    </div>
  );
}

export default function BreakdownView({ breakdown: b }) {
  if (!b) return null;
  const hook = b.hook;
  const cta = b.call_to_action || {};
  const pacing = b.pacing;

  return (
    <div>
      {/* What it is */}
      <div style={panel}>
        {b.cover_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.cover_url} alt="Video cover" loading="lazy"
            style={{ maxWidth: "220px", width: "100%", display: "block", marginBottom: "14px", borderRadius: "6px" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }} />
        )}
        <p style={{ ...body, color: "var(--text-primary)", fontSize: "1.05rem" }}>{b.summary}</p>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
          {b.format && <span style={chip}>{b.format}</span>}
          {b.tone && <span style={chip}>{b.tone}</span>}
          {b.section && <span style={chip}>⏱ {clock(b.section.start_sec)}–{clock(b.section.end_sec)} of {clock(b.duration_sec)}</span>}
        </div>
        {(b.audience || b.platform_fit) && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px", marginTop: "16px" }}>
            {b.audience && <div><div style={label}>Audience</div><p style={body}>{b.audience}</p></div>}
            {b.platform_fit && <div><div style={label}>Platform fit</div><p style={body}>{b.platform_fit}</p></div>}
          </div>
        )}
      </div>

      {b.warnings?.length > 0 && (
        <div role="status" style={{ ...panel, borderColor: "var(--warning)", padding: "16px 24px" }}>
          <div style={{ color: "var(--warning)", fontSize: "0.9rem", marginBottom: "6px" }}>⚠ Notes on this breakdown</div>
          <ul style={{ margin: 0, paddingLeft: "20px", color: "var(--text-secondary)", fontSize: "0.88rem", lineHeight: 1.6 }}>
            {b.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* The numbers */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "24px" }}>
        {hook && <Stat name="Hook" value={`${hook.strength}/10`} note="AI's judgement" />}
        {pacing && <Stat name="Cuts per minute" value={pacing.cuts_per_minute} note="Measured from the video" />}
        {pacing && <Stat name="Average shot" value={`${pacing.average_shot_sec}s`} note={`${pacing.cut_count} cuts`} />}
        <Stat name="Call to action" value={cta.present ? `${cta.strength}/10` : "None"} note={cta.present && cta.at_sec != null ? `at ${clock(cta.at_sec)}` : "AI's judgement"} />
      </div>

      {/* Hook */}
      {hook && (
        <div style={panel}>
          <h3 style={h3}>🎣 The hook <span style={{ ...label, marginLeft: "6px" }}>{clock(hook.start_sec)}–{clock(hook.end_sec)}</span></h3>
          {hook.technique && <span style={chip}>{hook.technique}</span>}
          <p style={{ ...body, marginTop: "12px", color: "var(--text-primary)" }}>{hook.what_happens}</p>
          {hook.why && <p style={{ ...body, marginTop: "8px" }}><strong style={{ color: "white" }}>Why it works:</strong> {hook.why}</p>}
          {hook.improve && <p style={{ ...body, marginTop: "8px" }}><strong style={{ color: "white" }}>Make it stronger:</strong> {hook.improve}</p>}
        </div>
      )}

      {/* Pacing */}
      {pacing ? (
        <div style={panel}>
          <h3 style={h3}>✂ Pacing — cuts per {pacing.bucket_sec || 10} seconds</h3>
          <PacingChart pacing={pacing} />
        </div>
      ) : null}

      {/* Structure */}
      {b.beats?.length > 0 && (
        <div style={panel}>
          <h3 style={h3}>🧱 Structure</h3>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "14px" }}>
            {b.beats.map((beat, i) => (
              <li key={i} style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
                <span style={{ ...label, minWidth: "86px", paddingTop: "3px", fontVariantNumeric: "tabular-nums" }}>
                  {clock(beat.start_sec)}–{clock(beat.end_sec)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <span style={chip}>{beat.label}</span>
                  <p style={{ ...body, marginTop: "6px", color: "var(--text-primary)" }}>{beat.what_happens}</p>
                  {beat.purpose && <p style={{ ...body, fontSize: "0.88rem" }}>{beat.purpose}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Risks */}
      <div style={panel}>
        <h3 style={h3}>📉 Where viewers might leave</h3>
        {b.attention_risks?.length ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
            {b.attention_risks.map((r, i) => (
              <li key={i} style={{ display: "flex", gap: "12px" }}>
                <span aria-hidden="true" style={{ color: "var(--warning)" }}>⚠</span>
                <div>
                  <span style={{ ...label, fontVariantNumeric: "tabular-nums" }}>Risk at {clock(r.at_sec)}</span>
                  <p style={{ ...body, color: "var(--text-primary)" }}>{r.why}</p>
                  {r.fix && <p style={{ ...body, fontSize: "0.88rem" }}><strong style={{ color: "white" }}>Fix:</strong> {r.fix}</p>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p style={body}>No moment stood out as a likely drop-off.</p>
        )}
      </div>

      {/* Techniques */}
      {b.techniques?.length > 0 && (
        <div style={panel}>
          <h3 style={h3}>🎬 Techniques</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px" }}>
            {b.techniques.map((t, i) => (
              <div key={i} style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "14px" }}>
                <div style={{ color: "white", fontWeight: 600 }}>{t.name}</div>
                {t.where && <div style={{ ...label, margin: "4px 0 6px" }}>{t.where}</div>}
                <p style={{ ...body, fontSize: "0.88rem" }}>{t.why_it_works}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Call to action */}
      <div style={panel}>
        <h3 style={h3}>📣 Call to action</h3>
        {cta.present ? (
          <p style={{ ...body, color: "var(--text-primary)" }}>
            {cta.at_sec != null && <span style={{ ...label, marginRight: "8px" }}>{clock(cta.at_sec)}</span>}
            {cta.what}
          </p>
        ) : (
          <p style={body}>The video does not ask the viewer to do anything.</p>
        )}
        {cta.suggestion && <p style={{ ...body, marginTop: "8px" }}><strong style={{ color: "white" }}>Suggestion:</strong> {cta.suggestion}</p>}
      </div>

      {/* What to copy */}
      {b.what_to_copy?.length > 0 && (
        <div style={{ ...panel, borderColor: "rgba(255, 92, 0, 0.5)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
            <h3 style={{ ...h3, margin: 0 }}>✅ What to copy</h3>
            <button
              type="button"
              className="cyber-btn"
              style={{ padding: "6px 14px", fontSize: "0.8rem" }}
              onClick={(e) => {
                navigator.clipboard.writeText(b.what_to_copy.map((x, i) => `${i + 1}. ${x}`).join("\n"));
                const btn = e.currentTarget; const was = btn.textContent;
                btn.textContent = "✓ Copied"; setTimeout(() => { btn.textContent = was; }, 2000);
              }}
            >
              Copy list
            </button>
          </div>
          <ol style={{ margin: 0, paddingLeft: "22px", color: "var(--text-primary)", lineHeight: 1.7 }}>
            {b.what_to_copy.map((x, i) => <li key={i}>{x}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}
