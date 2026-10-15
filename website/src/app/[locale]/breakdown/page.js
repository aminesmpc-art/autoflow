"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../context/AuthContext";
import { parseClock, sectionOptions, sectionProblem } from "../extractor/timeFields";
import BreakdownView from "./BreakdownView";

/* "Why it works" — its own page, with no prompts on it.

   The same engine and the same job as the extractor, asked a different
   question: what makes this video hold attention, and what is worth copying.
   It is saved as a breakdown, so it appears in the dashboard and counts
   toward the same daily allowance as an extraction. */

const API_URL = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL || "https://autoflow-extractor-production.up.railway.app/api/videos";
const DJANGO_API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.auto-flow.studio/api";

const field = { display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 };
const fieldLabel = { fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "1px", color: "var(--text-secondary)" };
const input = {
  width: "100%", height: "44px", padding: "0 12px", background: "#000", color: "white",
  border: "1px solid rgba(255, 92, 0, 0.4)", fontSize: "0.95rem", fontFamily: "inherit",
};

export default function BreakdownPage() {
  const { user, token, loading } = useAuth();
  const [source, setSource] = useState("upload"); // upload | url
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState("");
  const [times, setTimes] = useState({ sectionStart: "", sectionEnd: "" });
  const [status, setStatus] = useState("idle"); // idle | starting | processing | done | error
  const [step, setStep] = useState("");
  const [error, setError] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [result, setResult] = useState(null);

  const problem = sectionProblem(times);
  const ready = (source === "upload" ? !!file : !!url.trim()) && !problem;
  const videoName = source === "upload" ? file?.name : (() => { try { return new URL(url).hostname; } catch (e) { return "Video link"; } })();

  const start = async () => {
    if (!ready || !token) return;
    setStatus("starting");
    setError(null);
    setStep("Checking your plan...");
    try {
      const limit = await fetch(`${DJANGO_API_URL}/extractions/check-limit/`, { headers: { Authorization: `Bearer ${token}` } });
      if (limit.ok) {
        const l = await limit.json();
        if (!l.allowed) throw new Error(`You have reached your limit of ${l.limit} per ${l.period}. A breakdown counts as one extraction.`);
      }
      const options = sectionOptions(times);
      let res;
      if (source === "upload") {
        setStep("Uploading video...");
        const form = new FormData();
        form.append("video", file);
        form.append("mode", "breakdown");
        if (Object.keys(options).length) form.append("options", JSON.stringify(options));
        res = await fetch(`${API_URL}/analyze`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      } else {
        setStep("Sending the link...");
        res = await fetch(`${API_URL}/analyze-url`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim(), mode: "breakdown", ...(Object.keys(options).length ? { options } : {}) }),
        });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "The video could not be sent.");
      }
      setJobId((await res.json()).job_id);
      setStatus("processing");
    } catch (e) {
      setStatus("error");
      setError(e.message);
    }
  };

  // Poll until the job finishes, then save it as a breakdown.
  useEffect(() => {
    if (status !== "processing" || !jobId) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/status/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401 || res.status === 404) {
          clearInterval(timer);
          setStatus("error");
          setError(res.status === 401 ? "Your session expired. Sign in and run it again." : "This breakdown could not be found on the server. Please run it again.");
          return;
        }
        const data = await res.json();
        if (data.status === "completed") {
          clearInterval(timer);
          setResult(data.result);
          setStatus("done");
          fetch(`${DJANGO_API_URL}/extractions/`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              video_name: videoName || "Video",
              video_concept: data.result.summary || "",
              voiceover_text: "",
              character_sheets: [],
              shots: [],
              kind: "breakdown",
              breakdown: data.result,
              details: {
                duration_sec: data.result.duration_sec ?? null,
                section: data.result.section || null,
                read_from: data.result.read_from || "file",
                model: data.result.model || "",
              },
            }),
          }).catch(() => { /* the breakdown is on screen either way */ });
        } else if (data.status === "failed") {
          clearInterval(timer);
          setStatus("error");
          setError(data.error || "The breakdown failed.");
        } else {
          setStep(data.step || "Working...");
        }
      } catch (e) {
        /* a dropped poll is retried on the next tick */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [status, jobId, token, videoName]);

  if (loading) {
    return <div className="container" style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>Loading...</div>;
  }

  return (
    <div className="section" style={{ minHeight: "100vh" }}>
      <div className="container" style={{ maxWidth: "960px", padding: "100px 16px 80px" }}>
        <h1 style={{ fontSize: "clamp(2rem, 4vw, 2.6rem)", marginBottom: "10px" }}>Why it works</h1>
        <p className="text-secondary" style={{ fontSize: "1.05rem", maxWidth: "640px", marginBottom: "32px" }}>
          Upload a video or paste a link. Get its hook, pacing, structure, the moments viewers might leave,
          and a list of what to copy. Want prompts to recreate a video instead? Use the{" "}
          <Link href="/extractor" style={{ color: "var(--primary)" }}>Extractor</Link>.
        </p>

        {!user ? (
          <div className="cyber-panel" style={{ padding: "32px", textAlign: "center" }}>
            <p style={{ marginBottom: "16px" }}>Sign in to break down a video. It counts as one extraction from your daily allowance.</p>
            <Link href="/login" className="cyber-btn" style={{ padding: "12px 24px", display: "inline-block" }}>Sign in</Link>
          </div>
        ) : status === "done" ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", gap: "12px", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: "1.5rem" }}>{videoName}</h2>
              <button className="cyber-btn" style={{ padding: "10px 20px" }} onClick={() => { setStatus("idle"); setResult(null); setFile(null); setJobId(null); }}>
                Break down another
              </button>
            </div>
            <BreakdownView breakdown={result} />
          </>
        ) : (
          <div className="cyber-panel" style={{ padding: "28px" }}>
            <div role="tablist" style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
              {[["upload", "📁 Upload file"], ["url", "🔗 Paste link"]].map(([v, l]) => (
                <button key={v} role="tab" aria-selected={source === v} onClick={() => setSource(v)} className="cyber-btn"
                  style={{ padding: "8px 16px", background: source === v ? "var(--primary)" : "#000", color: source === v ? "#000" : "var(--primary)" }}>
                  {l}
                </button>
              ))}
            </div>

            {source === "upload" ? (
              <label style={field}>
                <span style={fieldLabel}>Video file (MP4, MOV, WebM)</span>
                <input key="file" type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ ...input, height: "auto", padding: "10px" }} />
              </label>
            ) : (
              <label style={field}>
                <span style={fieldLabel}>Video link (YouTube, TikTok, Instagram...)</span>
                <input key="url" type="url" placeholder="https://www..." value={url} onChange={(e) => setUrl(e.target.value)} style={input} />
              </label>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "16px", marginTop: "18px" }}>
              <label style={field}>
                <span style={fieldLabel}>From (optional)</span>
                <input type="text" inputMode="numeric" placeholder="0:00" value={times.sectionStart}
                  onChange={(e) => setTimes((t) => ({ ...t, sectionStart: e.target.value }))} style={input}
                  aria-invalid={Number.isNaN(parseClock(times.sectionStart))} />
              </label>
              <label style={field}>
                <span style={fieldLabel}>To (optional)</span>
                <input type="text" inputMode="numeric" placeholder="end of video" value={times.sectionEnd}
                  onChange={(e) => setTimes((t) => ({ ...t, sectionEnd: e.target.value }))} style={input}
                  aria-invalid={Number.isNaN(parseClock(times.sectionEnd))} />
              </label>
            </div>
            {problem && <p role="alert" style={{ color: "var(--accent)", fontSize: "0.85rem", margin: "8px 0 0" }}>{problem}</p>}

            {status === "error" && (
              <p role="alert" style={{ color: "var(--accent)", margin: "18px 0 0" }}>{error}</p>
            )}

            {status === "starting" || status === "processing" ? (
              <div role="status" style={{ marginTop: "22px", color: "var(--text-secondary)" }}>
                <span style={{ color: "var(--primary)" }}>●</span> {step || "Working..."}
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "4px" }}>A few minutes for a long video.</div>
              </div>
            ) : (
              <button className="cyber-btn" disabled={!ready} onClick={start}
                style={{ marginTop: "22px", padding: "14px 28px", opacity: ready ? 1 : 0.5, cursor: ready ? "pointer" : "not-allowed" }}>
                Break it down
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
