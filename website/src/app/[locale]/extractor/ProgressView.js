"use client";

import { useEffect, useState } from "react";
import { clock } from "./timeFields";

/* What the server is doing, read from the step line it reports while a job
   runs. The four stages are the engine's own order — get the video, hand it
   to the model, watch it, write it up — so the bar never claims a stage the
   server has not reached. The server's own words are shown underneath. */

const STAGES = {
  prompts: ["Get the video", "Prepare it", "Watch it", "Write the prompts"],
  breakdown: ["Get the video", "Prepare it", "Watch it", "Write the breakdown"],
};

/** Which of the four stages a step line belongs to. */
export function stageOf(status, step) {
  const s = String(step || "").toLowerCase();
  // The page's own phase, before the server has a job: sending the file or link.
  if (status === "uploading" || status === "starting") return 0;
  if (/putting the parts|written|lining shots|thumbnail|measuring the pacing/.test(s)) return 3;
  if (/watching|studying|retrying/.test(s)) return 2;
  if (/download|proxy|bypass|blocked|checking the video|submitting|sending|fetching/.test(s)) return 0;
  return 1;
}

/** "(2 of 5 parts done)" as numbers, for a long video read in parts. */
export function partsOf(step) {
  const m = /\((\d+) of (\d+) parts done\)/.exec(String(step || ""));
  return m ? { done: Number(m[1]), total: Number(m[2]) } : null;
}

export default function ProgressView({ status, step, startedAt, name, kind = "prompts" }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const stages = STAGES[kind] || STAGES.prompts;
  const at = stageOf(status, step);
  const parts = partsOf(step);
  const elapsed = startedAt ? (now - startedAt) / 1000 : 0;
  const line = (step || "").replace(/\.\.\.$/, "…") || "Starting…";

  return (
    <section className="xf-progress" aria-labelledby="xf-progress-title">
      <div className="xf-progress-head">
        <div style={{ minWidth: 0 }}>
          <h2 id="xf-progress-title">
            {kind === "breakdown" ? "Breaking down your video" : "Extracting prompts"}
          </h2>
          {name && <p>{name}</p>}
        </div>
        <span className="xf-elapsed" aria-label={`${Math.round(elapsed)} seconds elapsed`}>{clock(elapsed)}</span>
      </div>

      <ol className="xf-steps">
        {stages.map((label, i) => (
          <li
            key={label}
            className={`xf-step${i < at ? " is-done" : ""}${i === at ? " is-active" : ""}`}
            aria-current={i === at ? "step" : undefined}
          >
            {label}
          </li>
        ))}
      </ol>

      <div className="xf-now" role="status" aria-live="polite">
        <span className="xf-spinner" aria-hidden="true" />
        <span>{line}</span>
      </div>

      {parts && (
        <div className="xf-parts">
          <div className="xf-parts-bar" aria-hidden="true">
            <span style={{ width: `${Math.round((parts.done / parts.total) * 100)}%` }} />
          </div>
          <div className="xf-parts-label">
            {parts.done} of {parts.total} parts read — a long video is watched in sections at the same time.
          </div>
        </div>
      )}

      <p className="xf-progress-foot">
        A short clip takes about a minute; an hour-long video can take several. Keep this tab open —
        the result is saved to your dashboard when it finishes.
      </p>
    </section>
  );
}
