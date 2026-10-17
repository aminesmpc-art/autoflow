"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../context/AuthContext";
import { parseClock, sectionOptions, sectionProblem } from "../extractor/timeFields";
import UploadBox, { ToggleChip } from "../extractor/UploadBox";
import ProgressView from "../extractor/ProgressView";
import { Icon, displayName } from "../extractor/ui";
import BreakdownView, { BreakdownHeader } from "./BreakdownView";
import "../extractor/extractor.css";

/* "Why it works" — its own page, with no prompts on it.

   The same engine and the same job as the extractor, asked a different
   question: what makes this video hold attention, and what is worth copying.
   It is saved as a breakdown, so it appears in the dashboard and counts
   toward the same daily allowance as an extraction. */

const API_URL = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL || "https://autoflow-extractor-production.up.railway.app/api/videos";
const DJANGO_API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.auto-flow.studio/api";

/* A link as typed: "youtube.com/watch?v=…" works as well as the full URL. */
function normalizeLink(text) {
  const t = String(text || "").trim();
  if (!/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(t)) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export default function BreakdownPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState("");
  const [times, setTimes] = useState({ sectionStart: "", sectionEnd: "" });
  const [showPart, setShowPart] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | starting | processing | done | error
  const [step, setStep] = useState("");
  const [startedAt, setStartedAt] = useState(null);
  const [error, setError] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [result, setResult] = useState(null);

  const problem = sectionProblem(times);
  const link = normalizeLink(url);
  const ready = (file ? true : !!link) && !problem;
  const hasPart = !!(times.sectionStart.trim() || times.sectionEnd.trim());
  // A time that cannot be read keeps the button off; its message must show.
  const partOpen = showPart || !!problem;
  const videoName = file ? file.name : (() => { try { return new URL(link).hostname; } catch (e) { return "Video link"; } })();
  const busy = status === "starting" || status === "processing";

  const start = async () => {
    if (!ready) return;
    // Signing in comes back here, to the same page, rather than to the extractor.
    if (!user || !token) {
      router.push("/login?next=/breakdown");
      return;
    }
    setStatus("starting");
    setStartedAt(Date.now());
    setError(null);
    setStep("Checking your plan...");
    try {
      const limit = await fetch(`${DJANGO_API_URL}/extractions/check-limit/`, { headers: { Authorization: `Bearer ${token}` } });
      if (limit.ok) {
        const l = await limit.json();
        if (!l.allowed) throw new Error(`You have used your ${l.limit} extractions for this ${l.period}. A breakdown counts as one per 10 minutes analysed.`);
      }
      const options = sectionOptions(times);
      let res;
      if (file) {
        setStep("Uploading video...");
        const form = new FormData();
        form.append("video", file);
        form.append("mode", "breakdown");
        if (Object.keys(options).length) form.append("options", JSON.stringify(options));
        res = await fetch(`${API_URL}/analyze`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      } else {
        setStep("Sending the link...");
        setUrl(link);
        res = await fetch(`${API_URL}/analyze-url`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: link, mode: "breakdown", ...(Object.keys(options).length ? { options } : {}) }),
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
          window.scrollTo({ top: 0 });
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
              job_id: jobId,
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

  const reset = () => {
    setStatus("idle");
    setResult(null);
    setFile(null);
    setUrl("");
    setJobId(null);
    setError(null);
    window.scrollTo({ top: 0 });
  };

  if (loading) {
    return <div className="container" style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>Loading...</div>;
  }

  return (
    <div className="xf" style={{ minHeight: "100vh", paddingBottom: "80px" }}>
      <div className="container" style={{ maxWidth: status === "done" ? "1040px" : undefined }}>
        {status === "done" && result ? (
          <div className="xf-ws">
            <BreakdownHeader
              breakdown={result}
              name={file ? file.name : displayName(url)}
              actions={(
                <button type="button" className="xf-btn xf-btn-primary" onClick={reset}>
                  <Icon name="plus" /><span className="xf-btn-label">Break down another</span>
                </button>
              )}
            />
            <div style={{ marginTop: 18 }}>
              <BreakdownView breakdown={result} />
            </div>
          </div>
        ) : (
          <>
            <header className="xf-hero">
              <h1>Why it <span className="text-gradient">works</span></h1>
              <p className="xf-hero-lead">
                Get a video&apos;s hook, pacing and structure, the moments viewers might leave, and a list of
                what to copy.
              </p>
              <p className="xf-hero-alt">
                Want prompts to recreate a video instead? Use the <Link href="/extractor">Extractor</Link>
              </p>
            </header>

            {busy ? (
              <ProgressView kind="breakdown" status={status} step={step} startedAt={startedAt} name={file ? file.name : displayName(url)} />
            ) : (
              <>
                {status === "error" && (
                  <div className="xf-start" style={{ marginBottom: 12 }}>
                    <div className="xf-callout xf-callout-error" role="alert">
                      <Icon name="alert" />
                      <div>
                        <strong style={{ color: "var(--text-primary)", display: "block" }}>That breakdown did not finish</strong>
                        {error}
                      </div>
                    </div>
                  </div>
                )}
                <UploadBox
                  file={file}
                  onFile={setFile}
                  url={url}
                  onUrl={setUrl}
                  onStart={start}
                  ready={ready}
                  busy={busy}
                  goLabel={user ? "Break it down" : "Sign in to start"}
                >
                  <div className="xf-opts">
                    <ToggleChip
                      name="Part"
                      icon="clock"
                      value={hasPart ? `${times.sectionStart.trim() || "0:00"}–${times.sectionEnd.trim() || "end"}` : "Whole video"}
                      on={hasPart || partOpen}
                      expanded={partOpen}
                      onClick={() => setShowPart((v) => !v)}
                    />
                    <span className="xf-help">Counts as one extraction per 10 minutes analysed.</span>
                  </div>
                  {partOpen && (
                    <div className="xf-drawer">
                      <div className="xf-drawer-head">
                        <strong>Analyse part of the video</strong>
                        <span>Empty means the whole video</span>
                      </div>
                      <div className="xf-fields xf-fields-2">
                        <label className="xf-field">
                          <span className="xf-label">From</span>
                          <input className="xf-input xf-tc" type="text" inputMode="numeric" placeholder="0:00" value={times.sectionStart}
                            onChange={(e) => setTimes((t) => ({ ...t, sectionStart: e.target.value }))}
                            aria-invalid={Number.isNaN(parseClock(times.sectionStart))} />
                        </label>
                        <label className="xf-field">
                          <span className="xf-label">To</span>
                          <input className="xf-input xf-tc" type="text" inputMode="numeric" placeholder="end" value={times.sectionEnd}
                            onChange={(e) => setTimes((t) => ({ ...t, sectionEnd: e.target.value }))}
                            aria-invalid={Number.isNaN(parseClock(times.sectionEnd))} />
                        </label>
                      </div>
                      {problem && <p role="alert" className="xf-error" style={{ margin: "8px 0 0" }}>{problem}</p>}
                    </div>
                  )}
                </UploadBox>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
