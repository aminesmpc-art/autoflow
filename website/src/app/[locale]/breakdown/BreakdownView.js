"use client";

import { clock } from "../extractor/timeFields";
import { useRef } from "react";
import { CopyButton, Icon, useHeadMetrics } from "../extractor/ui";
import PacingChart from "./PacingChart";

/* A "why it works" breakdown, read top to bottom the way a strategist would
   present it: what the video is, its hook, how it is paced, its structure,
   where it risks losing people, how it is made, what it asks for, and what
   to steal. Scores are the model's judgement and are labelled as out of ten;
   pacing is measured and says so. */

/* The report's parts, in reading order, for the jump links in the header.
   `has` says whether a breakdown has anything to show there. */
const PARTS = [
  { id: "bd-hook", label: "Hook", has: (b) => !!b.hook },
  { id: "bd-pacing", label: "Pacing", has: (b) => !!b.pacing?.buckets?.length },
  { id: "bd-structure", label: "Structure", has: (b) => b.beats?.length > 0 },
  { id: "bd-risks", label: "Drop-off risks", has: () => true },
  { id: "bd-techniques", label: "Techniques", has: (b) => b.techniques?.length > 0 },
  { id: "bd-cta", label: "Call to action", has: () => true },
  { id: "bd-copy", label: "What to copy", has: (b) => b.what_to_copy?.length > 0 },
];

function Stat({ name, value, note }) {
  return (
    <div className="xf-stat">
      <div className="xf-stat-k">{name}</div>
      <div className="xf-stat-v">{value}</div>
      {note && <div className="xf-stat-n">{note}</div>}
    </div>
  );
}

function Section({ id, icon, title, aside, children, accent }) {
  return (
    <section id={id} className="xf-panel xf-bd-section" style={accent ? { borderColor: "var(--xf-accent-line)" } : undefined}>
      <div className="xf-panel-head">
        <h3 className="xf-panel-title"><Icon name={icon} /> {title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** The sticky header over a breakdown: what the video is, its key numbers,
    the page's actions, and a link to each part of the report. */
export function BreakdownHeader({ breakdown: b, name, actions }) {
  const head = useRef(null);
  useHeadMetrics(head);
  const parts = PARTS.filter((p) => p.has(b));
  const span = b.section ? b.section.end_sec - b.section.start_sec : b.duration_sec;
  const jump = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <header className="xf-ws-head" ref={head}>
      <div className="xf-ws-top">
        <div className="xf-ws-id">
          {b.cover_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="xf-ws-cover" src={b.cover_url} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          )}
          <div style={{ minWidth: 0 }}>
            <h1 className="xf-ws-name" title={name}>{name}</h1>
            <div className="xf-ws-stats">
              <span><Icon name="layers" size={13} />Why it works</span>
              {span > 0 && <span><Icon name="clock" size={13} /><span className="xf-tc">{clock(span)}</span></span>}
              {b.hook && <span>hook {b.hook.strength}/10</span>}
              {b.pacing && <span>{b.pacing.cuts_per_minute} cuts a minute</span>}
            </div>
          </div>
        </div>
        <div className="xf-ws-actions">{actions}</div>
      </div>
      <nav className="xf-tabs" aria-label="Parts of the breakdown">
        {parts.map((p) => (
          <button key={p.id} type="button" className="xf-tab" onClick={() => jump(p.id)}>{p.label}</button>
        ))}
      </nav>
    </header>
  );
}

export default function BreakdownView({ breakdown: b }) {
  if (!b) return null;
  const hook = b.hook;
  const cta = b.call_to_action || {};
  const pacing = b.pacing;

  return (
    <div className="xf-bd">
      {/* What it is */}
      <div className="xf-panel">
        <p className="xf-prose" style={{ whiteSpace: "normal" }}>{b.summary}</p>
        {(b.format || b.tone || b.section) && (
          <div className="xf-tags" style={{ marginTop: 12 }}>
            {b.format && <span className="xf-tag">{b.format}</span>}
            {b.tone && <span className="xf-tag">{b.tone}</span>}
            {b.section && (
              <span className="xf-tag">
                <Icon name="clock" size={12} />
                <span className="xf-tc">{clock(b.section.start_sec)}–{clock(b.section.end_sec)}</span> of <span className="xf-tc">{clock(b.duration_sec)}</span>
              </span>
            )}
          </div>
        )}
        {(b.audience || b.platform_fit) && (
          <div className="xf-two">
            {b.audience && <div><div className="xf-kv-k">Audience</div><p className="xf-kv-v">{b.audience}</p></div>}
            {b.platform_fit && <div><div className="xf-kv-k">Platform fit</div><p className="xf-kv-v">{b.platform_fit}</p></div>}
          </div>
        )}
      </div>

      {b.warnings?.length > 0 && (
        <div className="xf-callout" role="status" style={{ marginTop: 14 }}>
          <Icon name="alert" />
          <div>
            <strong style={{ color: "var(--text-primary)", display: "block", marginBottom: 4 }}>Notes on this breakdown</strong>
            <ul>{b.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        </div>
      )}

      {/* The numbers */}
      <div className="xf-stats">
        {hook && <Stat name="Hook" value={`${hook.strength}/10`} note="AI's judgement" />}
        {pacing && <Stat name="Cuts per minute" value={pacing.cuts_per_minute} note="Measured from the video" />}
        {pacing && <Stat name="Average shot" value={`${pacing.average_shot_sec}s`} note={`${pacing.cut_count} cuts`} />}
        <Stat
          name="Call to action"
          value={cta.present ? `${cta.strength}/10` : "None"}
          note={cta.present && cta.at_sec != null ? `at ${clock(cta.at_sec)}` : "AI's judgement"}
        />
      </div>

      {hook && (
        <Section
          id="bd-hook"
          icon="hook"
          title="The hook"
          aside={<span className="xf-tc xf-muted">{clock(hook.start_sec)}–{clock(hook.end_sec)}</span>}
        >
          {hook.technique && <div className="xf-tags"><span className="xf-tag xf-tag-accent">{hook.technique}</span></div>}
          <p className="xf-prose" style={{ marginTop: 10, whiteSpace: "normal" }}>{hook.what_happens}</p>
          {hook.why && <p className="xf-why"><strong>Why it works:</strong> {hook.why}</p>}
          {hook.improve && <p className="xf-why"><strong>Make it stronger:</strong> {hook.improve}</p>}
        </Section>
      )}

      {pacing?.buckets?.length > 0 && (
        <Section id="bd-pacing" icon="scissors" title={`Pacing — cuts per ${pacing.bucket_sec || 10} seconds`}>
          <PacingChart pacing={pacing} />
        </Section>
      )}

      {b.beats?.length > 0 && (
        <Section id="bd-structure" icon="layers" title="Structure">
          <ol className="xf-timeline">
            {b.beats.map((beat, i) => (
              <li key={i}>
                <span className="xf-tc">{clock(beat.start_sec)}–{clock(beat.end_sec)}</span>
                <div style={{ minWidth: 0 }}>
                  <span className="xf-tag xf-tag-accent">{beat.label}</span>
                  <p>{beat.what_happens}</p>
                  {beat.purpose && <p className="xf-quiet">{beat.purpose}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section id="bd-risks" icon="trendDown" title="Where viewers might leave">
        {b.attention_risks?.length ? (
          <ol className="xf-timeline">
            {b.attention_risks.map((r, i) => (
              <li key={i}>
                <span className="xf-tc">at {clock(r.at_sec)}</span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ marginTop: 0 }}>{r.why}</p>
                  {r.fix && <p className="xf-quiet"><strong style={{ color: "var(--text-primary)" }}>Fix:</strong> {r.fix}</p>}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="xf-muted" style={{ margin: 0 }}>No moment stood out as a likely drop-off.</p>
        )}
      </Section>

      {b.techniques?.length > 0 && (
        <Section id="bd-techniques" icon="film" title="Techniques">
          <div className="xf-techs">
            {b.techniques.map((t, i) => (
              <div className="xf-tech" key={i}>
                <strong>{t.name}</strong>
                {t.where && <span className="xf-tc">{t.where}</span>}
                <p>{t.why_it_works}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section id="bd-cta" icon="megaphone" title="Call to action">
        {cta.present ? (
          <p className="xf-prose" style={{ whiteSpace: "normal" }}>
            {cta.at_sec != null && <span className="xf-tc xf-muted" style={{ marginRight: 8 }}>{clock(cta.at_sec)}</span>}
            {cta.what}
          </p>
        ) : (
          <p className="xf-muted" style={{ margin: 0 }}>The video does not ask the viewer to do anything.</p>
        )}
        {cta.suggestion && <p className="xf-why"><strong>Suggestion:</strong> {cta.suggestion}</p>}
      </Section>

      {b.what_to_copy?.length > 0 && (
        <Section
          id="bd-copy"
          icon="checkList"
          title="What to copy"
          accent
          aside={<CopyButton text={() => b.what_to_copy.map((x, i) => `${i + 1}. ${x}`).join("\n")} label="Copy list" />}
        >
          <ol className="xf-copylist">
            {b.what_to_copy.map((x, i) => <li key={i}>{x}</li>)}
          </ol>
        </Section>
      )}
    </div>
  );
}
