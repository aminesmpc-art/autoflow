"use client";

import { useState } from "react";

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

export default function RefinePanel({ result, jobId, token, apiUrl, log, canUndo, onResult, onUndo }) {
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
    <div className="cyber-panel" style={{ marginBottom: "40px", padding: "28px 32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", flexWrap: "wrap", marginBottom: "6px" }}>
        <h3 className="terminal-text" style={{ margin: 0, fontSize: "1.1rem", textShadow: "none" }}>✨ Refine with AI</h3>
        {canUndo && (
          <button
            type="button"
            onClick={onUndo}
            disabled={busy}
            className="terminal-text"
            style={{ background: "none", border: "none", color: "var(--text-secondary)", textDecoration: "underline", textUnderlineOffset: "4px", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem", textShadow: "none" }}
          >
            ↶ Undo last change
          </button>
        )}
      </div>
      <p className="terminal-text" style={{ margin: "0 0 16px", fontSize: "0.85rem", color: "var(--text-secondary)", textShadow: "none" }}>
        {watchable
          ? `Ask for any change. Until ${timeOfDay(result.refine_until)} the AI can look at the video again when a change needs it.`
          : "Ask for any change. Edits now work from the prompts' text; the video is only kept for an hour after extracting."}
      </p>

      {log.length > 0 && (
        <ol style={{ listStyle: "none", margin: "0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
          {log.map((entry, i) => (
            <li key={i} style={{ fontSize: "0.9rem", lineHeight: 1.5 }}>
              <div style={{ color: "white" }}>› {entry.instruction}</div>
              <div style={{ color: "var(--text-secondary)", paddingLeft: "14px" }}>
                {entry.summary}
                {entry.usedVideo && <span style={{ color: "var(--text-muted)" }}> · looked at the video</span>}
                {entry.undone && <span style={{ color: "var(--text-muted)" }}> · undone</span>}
              </div>
            </li>
          ))}
        </ol>
      )}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => setText(s)}
            style={{ border: "1px solid rgba(255, 92, 0, 0.35)", background: "transparent", color: "var(--text-secondary)", padding: "4px 10px", fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit", borderRadius: "999px" }}
          >
            {s}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        style={{ display: "flex", gap: "10px", alignItems: "stretch", flexWrap: "wrap" }}
      >
        <textarea
          value={text}
          maxLength={MAX_CHARS}
          rows={2}
          disabled={busy}
          placeholder='e.g. "Make shot 4 a close-up" or "Set it on a rainy night"'
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          aria-label="Change to make"
          style={{ flex: "1 1 280px", minWidth: 0, background: "#000", color: "white", border: "1px solid rgba(255, 92, 0, 0.4)", padding: "10px 12px", fontFamily: "inherit", fontSize: "0.95rem", resize: "vertical", lineHeight: 1.5 }}
        />
        <button
          type="submit"
          className="cyber-btn"
          disabled={busy || !text.trim()}
          style={{ padding: "10px 22px", opacity: busy || !text.trim() ? 0.6 : 1 }}
        >
          {busy ? "Working..." : "Apply"}
        </button>
      </form>
      {busy && (
        <p role="status" className="terminal-text" style={{ margin: "10px 0 0", fontSize: "0.8rem", color: "var(--text-muted)", textShadow: "none" }}>
          Most changes take a few seconds; one that needs another look at the video can take a minute or two.
        </p>
      )}
      {error && <p role="alert" style={{ margin: "10px 0 0", color: "var(--accent)", fontSize: "0.9rem" }}>{error}</p>}
    </div>
  );
}
