"use client";

import { useState } from "react";
import { Icon } from "./ui";

/* Edit an extraction by asking for the change.

   The page owns the versions: every successful edit is pushed as a new one
   and Undo goes back a step, so nothing the AI does is irreversible. The
   server edits whatever version it is sent, and re-watches the video only
   within the hour after extracting — and only when the request needs it. */

const MAX_CHARS = 600;

const SUGGESTIONS = [
  "Make every shot golden hour",
  "Split shot 2 into a wide and a close-up",
  "Rewrite the prompts for a 9:16 vertical frame",
  "Delete the last shot",
];

function timeOfDay(epochSec) {
  try {
    return new Date(epochSec * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}

export default function RefinePanel({ result, jobId, token, apiUrl, log, canUndo, onResult, onUndo, onClose }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const watchable = result?.refine_until && result.refine_until * 1000 > Date.now();

  const send = async (instruction) => {
    const ask = (instruction ?? text).trim();
    if (!ask || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/refine`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: ask, extraction: result, job_id: jobId || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "That change could not be made.");
      onResult(data.extraction, { instruction: ask, summary: data.summary, usedVideo: data.used_video });
      setText("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="xf-refine" aria-labelledby="xf-refine-title">
      <div className="xf-refine-head">
        <h3 id="xf-refine-title"><Icon name="sparkles" /> Refine with AI</h3>
        <div style={{ display: "flex", gap: 4 }}>
          {canUndo && (
            <button type="button" className="xf-btn xf-btn-ghost xf-btn-sm" onClick={onUndo} disabled={busy}>
              <Icon name="undo" /> Undo
            </button>
          )}
          {onClose && (
            <button type="button" className="xf-btn xf-btn-ghost xf-btn-sm xf-btn-icon xf-refine-close" onClick={onClose} aria-label="Close">
              <Icon name="x" />
            </button>
          )}
        </div>
      </div>
      <p className="xf-refine-note">
        {watchable
          ? `Ask for any change. Until ${timeOfDay(result.refine_until)} the AI can look at the video again when a change needs it.`
          : "Ask for any change. Edits work from the prompts' text; the video is only kept for an hour after extracting."}
      </p>

      {log.length > 0 && (
        <ol className="xf-refine-log">
          {log.map((entry, i) => (
            <li key={i} className={entry.undone ? "is-undone" : undefined}>
              <div className="xf-refine-ask">{entry.instruction}</div>
              <div className="xf-refine-reply">
                {entry.summary}
                {entry.usedVideo && <small> · looked at the video</small>}
                {entry.undone && <small> · undone</small>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {log.length === 0 && (
        <div className="xf-suggest">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" disabled={busy} onClick={() => setText(s)}>{s}</button>
          ))}
        </div>
      )}

      <form className="xf-refine-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          className="xf-textarea"
          value={text}
          maxLength={MAX_CHARS}
          rows={2}
          disabled={busy}
          placeholder='e.g. "Make shot 4 a close-up" or "Set it on a rainy night"'
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          aria-label="Change to make"
        />
        <div className="xf-refine-row">
          <span className="xf-help">{busy ? "Working — a change that needs the video can take a minute." : "Enter to apply · Shift+Enter for a new line"}</span>
          <button type="submit" className="xf-btn xf-btn-primary xf-btn-sm" disabled={busy || !text.trim()}>
            {busy ? <span className="xf-spinner" aria-hidden="true" /> : <Icon name="sparkles" />}
            {busy ? "Working" : "Apply"}
          </button>
        </div>
      </form>
      {error && <p role="alert" className="xf-error" style={{ margin: 0 }}>{error}</p>}
    </section>
  );
}
