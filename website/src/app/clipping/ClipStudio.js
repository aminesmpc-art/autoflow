"use client";

/**
 * Clipping, running on the website.
 *
 * The whole pipeline lives in the extension's source and is compiled into
 * src/vendor/autoflow-clip.js — see studio-extension/webpack.web.js. Nothing
 * about what a clip IS is decided in this file: it collects a video and some
 * settings, hands them over, and renders what comes back. That is deliberate,
 * and the reason is in the bundle's own header — a second implementation of
 * the survey prompt and the caption timing would drift from the first one the
 * week it was written.
 *
 * So this component is a form, a progress rail and a results grid.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import StoreLink from "../StoreLink";
import "./clipStudio.css";

/* The extractor service. api.auto-flow.studio is Django and serves none of
   the clip routes — it answers 404 for every one of them — so the default
   here is the same host the extension ships with. */
const EXTRACTOR_BASE =
  process.env.NEXT_PUBLIC_EXTRACTOR_BASE_URL
  || "https://autoflow-extractor-production.up.railway.app";

const DJANGO_API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.auto-flow.studio/api";

const STAGE_LABELS = {
  ingest: "Read the file",
  transcribe: "Read the recording",
  survey: "Rank the moments",
  layout: "Lay out the cuts",
};
const STAGE_ORDER = ["ingest", "transcribe", "survey", "layout"];

const PRESETS = [
  ["clean", "Clean — white, centred, readable"],
  ["bold", "Bold — heavy, high contrast"],
  ["emphasis", "Emphasis — the key word coloured"],
  ["karaoke", "Karaoke — the word lights as it lands"],
  ["minimal", "Minimal — small and out of the way"],
];

const ASPECTS = [
  [9 / 16, "9:16 — Reels, Shorts, TikTok"],
  [1, "1:1 — square"],
  [4 / 5, "4:5 — feed"],
  [16 / 9, "16:9 — leave it landscape"],
];

const MAX_BYTES = 500 * 1024 * 1024;
const MAX_SECONDS = 2 * 60 * 60;

/* Reading a video runs a model over the whole file, which is why it is
   rationed at all. These mirror FREE_CLIPPING_DAILY_LIMIT and
   PRO_CLIPPING_DAILY_LIMIT in apps/usage/services.py, which is the authority —
   the server refuses past them whatever this says. They are stated up front
   because a free account gets ONE, and finding that out after uploading
   400MB is the page's failure rather than the limit's. */
const READS_PER_DAY = { free: 1, pro: 10 };

const mmss = (sec) => {
  if (!Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}:${String(r).padStart(2, "0")}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

const mb = (bytes) => `${(bytes / 1e6).toFixed(0)} MB`;

/** A filename a person can find again in a downloads folder. */
const safeName = (text, fallback) => {
  const cleaned = String(text || "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
  return (cleaned || fallback).slice(0, 60);
};

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Not revoked immediately: Safari has been observed to cancel a download
     whose blob URL is released in the same tick as the click. */
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The edit sheet as the lines a clipper reads in CapCut. */
function sheetText(ops) {
  return (ops || [])
    .slice()
    .sort((a, b) => a.atSec - b.atSec)
    .map((op) => {
      const at = `${mmss(op.atSec)}`;
      const held = op.seconds ? ` (${op.seconds.toFixed(1)}s)` : "";
      return `${at}${held}  ${op.kind.toUpperCase()} — ${op.what}`;
    })
    .join("\n");
}

export default function ClipStudio() {
  const { user, token, loading } = useAuth();

  const [file, setFile] = useState(null);
  const [duration, setDuration] = useState(null);
  const [over, setOver] = useState(false);
  const [ready, setReady] = useState(null); // null = not checked, {ok, reason}

  const [clipCount, setClipCount] = useState(6);
  const [longest, setLongest] = useState(90);
  const [minScore, setMinScore] = useState(60);
  const [aspect, setAspect] = useState(9 / 16);
  const [captions, setCaptions] = useState(true);
  const [preset, setPreset] = useState("clean");
  const [planEdit, setPlanEdit] = useState(true);
  const [mode, setMode] = useState("explainer");

  const [running, setRunning] = useState(false);
  const [run, setRun] = useState(null);
  const [log, setLog] = useState("");
  const [planned, setPlanned] = useState(null);
  const [clips, setClips] = useState([]);
  const [failed, setFailed] = useState([]);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [isPro, setIsPro] = useState(null);

  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const madeUrls = useRef([]);

  /* Object URLs outlive React state, and so do the source file and the
     encoded clips the engine is holding. Without this a session of six runs
     keeps six recordings and their clips in memory until the tab closes. */
  const forget = useCallback(() => {
    madeUrls.current.forEach((url) => URL.revokeObjectURL(url));
    madeUrls.current = [];
    import("../../vendor/autoflow-clip").then((mod) => mod.release()).catch(() => {});
  }, []);

  useEffect(() => () => {
    madeUrls.current.forEach((url) => URL.revokeObjectURL(url));
    abortRef.current?.abort();
    import("../../vendor/autoflow-clip").then((mod) => mod.release()).catch(() => {});
  }, []);

  /* Asked before the click, not at it: a browser that cannot encode should
     say so before someone uploads 400MB and pays for a reading, not after.
     But only once there is an account to clip with. /clipping is linked from
     the nav now, so most people arriving here are signed out, cannot run
     anything, and were being made to fetch 152KB of demuxer to be told so. */
  useEffect(() => {
    if (!user) return;
    let alive = true;
    import("../../vendor/autoflow-clip")
      .then((mod) => { if (alive) setReady(mod.supported()); })
      .catch(() => {
        if (alive) setReady({ ok: false, reason: "The clipping engine could not be loaded." });
      });
    return () => { alive = false; };
  }, [user]);

  /* Which allowance applies. Only the plan is asked for — the used count is
     written by the reserve call and has no route that reads it back. */
  useEffect(() => {
    if (!token) return;
    let alive = true;
    fetch(`${DJANGO_API_URL}/entitlements`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (alive && body) setIsPro(body.is_pro_active === true); })
      .catch(() => {});
    return () => { alive = false; };
  }, [token]);

  const takeFile = useCallback(async (picked) => {
    setError(null);
    setClips([]);
    setFailed([]);
    setPlan(null);
    setRun(null);
    setPlanned(null);
    setDuration(null);

    if (!picked) return;
    if (!picked.type.startsWith("video/")) {
      setError(`${picked.name} is not a video file.`);
      return;
    }
    if (picked.size > MAX_BYTES) {
      setError(`${picked.name} is ${mb(picked.size)}. The limit is 500 MB.`);
      return;
    }
    setFile(picked);

    /* Read the length locally so an over-long video is refused here rather
       than after the upload. */
    try {
      const { probeDuration } = await import("../../vendor/autoflow-clip");
      const seconds = await probeDuration(picked);
      if (seconds && seconds > MAX_SECONDS) {
        setError(`That recording is ${mmss(seconds)} long. The limit is two hours.`);
        setFile(null);
        return;
      }
      setDuration(seconds);
    } catch {
      /* A container this cannot read is the server's to refuse, with a better
         message than this could write. */
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setOver(false);
    takeFile(e.dataTransfer?.files?.[0] || null);
  }, [takeFile]);

  const start = async () => {
    if (!file || !token || running) return;
    setRunning(true);
    setError(null);
    setClips([]);
    setFailed([]);
    setLog("");
    setPlanned(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { runWebClipping } = await import("../../vendor/autoflow-clip");
      const result = await runWebClipping(file, {
        token,
        baseUrl: EXTRACTOR_BASE,
        clipCount,
        minClipScore: minScore,
        longestSeconds: longest,
        targetAspect: aspect,
        captions,
        captionPreset: preset,
        planEdit,
        mode,
        sourceName: file.name.replace(/\.[^.]+$/, ""),
        signal: controller.signal,
        onStages: setRun,
        onLog: setLog,
        onPlanned: setPlanned,
        onClip: (clip) => {
          madeUrls.current.push(clip.url);
          /* Appended as they finish rather than all at the end: the first
             clip of ten is watchable four encodes before the run is over. */
          setClips((was) => [...was, clip]);
        },
      });
      setPlan(result.plan);
      setFailed(result.failed);
      if (!result.clips.length && !result.failed.length) {
        setError(
          "Nothing in that recording scored above the bar you set. Lower "
          + "“Worth posting, above” and run it again — the reading is already paid for.",
        );
      }
    } catch (e) {
      if (e?.name !== "AbortError") setError(e?.message || String(e));
    } finally {
      setRunning(false);
      abortRef.current = null;
      setLog("");
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const downloadAll = () => {
    /* One at a time with a gap. A browser asked for ten downloads in one tick
       shows ten permission prompts, or silently drops nine. */
    clips.forEach((clip, i) => {
      setTimeout(
        () => download(clip.blob, `${String(clip.rank).padStart(2, "0")}-${safeName(clip.title || clip.hookLine, "clip")}.mp4`),
        i * 400,
      );
    });
  };

  const downloadPlan = () => {
    if (!plan) return;
    download(
      new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }),
      `${safeName(plan.name, "clips")}.json`,
    );
  };

  const downloadSheets = () => {
    const text = clips
      .map((clip) => {
        const head = `# ${clip.rank}. ${clip.title || clip.hookLine}`;
        const span = `Source ${mmss(clip.startSec)}–${mmss(clip.endSec)} · ${clip.seconds.toFixed(1)}s · ${clip.width}×${clip.height}`;
        const why = clip.why ? `Why: ${clip.why}` : "";
        const sheet = sheetText(clip.editSheet);
        return [head, span, why, sheet].filter(Boolean).join("\n");
      })
      .join("\n\n----------------------------------------\n\n");
    download(new Blob([text], { type: "text/plain" }), `${safeName(file?.name, "clips")}-edit-sheet.txt`);
  };

  const stageRows = useMemo(() => STAGE_ORDER.map((id) => {
    const rec = run?.stages?.[id] || { status: "pending" };
    const mark = { done: "✓", running: "…", failed: "✕", skipped: "–", pending: "○" }[rec.status] || "○";
    return { id, rec, mark, label: STAGE_LABELS[id] };
  }), [run]);

  /* ── Screens ────────────────────────────────────────────────────── */

  if (loading) {
    return <div className="clip-tool"><p className="clip-log">Checking your account…</p></div>;
  }

  if (!user) {
    return (
      <div className="clip-tool">
        <div className="clip-tool-head">
          <div>
            <h2>Clip a recording</h2>
            <p>
              Reading a video runs a model over the whole file, so it needs an account —
              that is what the daily allowance is counted against.
            </p>
          </div>
        </div>
        <div className="clip-actions-row">
          <a href="/login" className="btn btn-primary btn-lg">Sign in to clip</a>
          <a href="/register" className="btn btn-secondary btn-lg">Create a free account</a>
        </div>
        <p className="clip-note info">
          Prefer to keep the video on your own machine end to end?{" "}
          <StoreLink product="studio">AutoFlow Studio</StoreLink> runs the same pipeline
          inside the extension, against the chat accounts you already have.
        </p>
      </div>
    );
  }

  if (ready && !ready.ok) {
    return (
      <div className="clip-tool">
        <div className="clip-tool-head"><div><h2>Clip a recording</h2></div></div>
        <p className="clip-note warn">{ready.reason}</p>
      </div>
    );
  }

  return (
    <div className="clip-tool">
      <div className="clip-tool-head">
        <div>
          <h2>Clip a recording</h2>
          <p>
            The whole file is read once on the server. Every clip is then cut in this
            browser — the video never leaves it a second time.
          </p>
        </div>
        {isPro !== null && (
          <span className="clip-score">
            {isPro ? READS_PER_DAY.pro : READS_PER_DAY.free} recording
            {(isPro ? READS_PER_DAY.pro : READS_PER_DAY.free) === 1 ? "" : "s"} a day
          </span>
        )}
      </div>

      {!file ? (
        <div
          className={`clip-drop${over ? " is-over" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <span className="clip-drop-icon">✂️</span>
          <strong>Drop a recording here</strong>
          <span className="hint">MP4, MOV, WebM or MKV · up to 500 MB and two hours</span>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => takeFile(e.target.files?.[0] || null)}
          />
        </div>
      ) : (
        <div className="clip-file">
          <div>
            <div className="clip-file-name">{file.name}</div>
            <div className="clip-file-meta">
              {mb(file.size)}{duration ? ` · ${mmss(duration)}` : ""}
            </div>
          </div>
          {!running && (
            <button
              className="clip-mini"
              onClick={() => { forget(); setFile(null); setDuration(null); setClips([]); }}
            >
              Choose another
            </button>
          )}
        </div>
      )}

      {file && !running && clips.length === 0 && (
        <>
          <div className="clip-options">
            <div className="clip-field">
              <label htmlFor="clip-count">How many clips</label>
              <input
                id="clip-count" type="number" min="1" max="20" value={clipCount}
                onChange={(e) => setClipCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              />
              <span className="note">The best ones, ranked. Ten is a lot to review.</span>
            </div>

            <div className="clip-field">
              <label htmlFor="clip-longest">Longest clip (seconds)</label>
              <input
                id="clip-longest" type="number" min="15" max="200" value={longest}
                onChange={(e) => setLongest(Math.max(15, Math.min(200, Number(e.target.value) || 90)))}
              />
              <span className="note">A hard cap. Clips still end on a spoken line.</span>
            </div>

            <div className="clip-field">
              <label htmlFor="clip-score">Worth posting, above</label>
              <input
                id="clip-score" type="number" min="0" max="100" value={minScore}
                onChange={(e) => setMinScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              />
              <span className="note">Out of 100. Below this a moment is dropped.</span>
            </div>

            <div className="clip-field">
              <label htmlFor="clip-aspect">Shape</label>
              <select id="clip-aspect" value={aspect} onChange={(e) => setAspect(Number(e.target.value))}>
                {ASPECTS.map(([value, text]) => (
                  <option key={text} value={value}>{text}</option>
                ))}
              </select>
              <span className="note">A measured face track keeps the speaker in frame.</span>
            </div>

            <div className="clip-field">
              <label htmlFor="clip-preset">Caption look</label>
              <select
                id="clip-preset" value={preset} disabled={!captions}
                onChange={(e) => setPreset(e.target.value)}
              >
                {PRESETS.map(([value, text]) => (
                  <option key={value} value={value}>{text}</option>
                ))}
              </select>
              <span className="note">Timed from the same reading the cut used.</span>
            </div>

            <div className="clip-field">
              <label htmlFor="clip-mode">What this is for</label>
              <select id="clip-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="explainer">My own content</option>
                <option value="campaign">Paid clipping, under a brief</option>
              </select>
              <span className="note">
                A brief usually forbids anything not affiliated with the campaign, so
                that mode plans nothing extra.
              </span>
            </div>
          </div>

          <div className="clip-checks">
            <label className="clip-check">
              <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
              Burn in captions
            </label>
            <label className="clip-check">
              <input type="checkbox" checked={planEdit} onChange={(e) => setPlanEdit(e.target.checked)} />
              Plan the edit for each clip
            </label>
          </div>

          <div className="clip-actions-row">
            <button className="btn btn-primary btn-lg" onClick={start} disabled={!ready?.ok}>
              {ready ? "✂️ Find the clips" : "Loading the engine…"}
            </button>
            <span className="clip-log">
              One reading of the video, then one encode per clip in this tab.
              {isPro === false && (
                <> Free accounts read one recording a day — <a href="/pricing">Pro raises it to ten</a>.</>
              )}
            </span>
          </div>
        </>
      )}

      {(running || run) && (
        <>
          <div className="clip-rail">
            {stageRows.map(({ id, rec, mark, label }) => (
              <div key={id} className={`clip-stage ${rec.status}`}>
                <span className="mark">{mark}</span>
                <span>{label}</span>
                {rec.status === "failed" && rec.error && <span className="took">{rec.error}</span>}
                {rec.tookMs != null && rec.status === "done" && (
                  <span className="took">{(rec.tookMs / 1000).toFixed(1)}s</span>
                )}
              </div>
            ))}
            {planned != null && (
              <div className={`clip-stage ${clips.length >= planned ? "done" : "running"}`}>
                <span className="mark">{clips.length >= planned ? "✓" : "…"}</span>
                <span>Cut and encode</span>
                <span className="took">{clips.length} of {planned}</span>
              </div>
            )}
          </div>
          <p className="clip-log">{log}</p>
          {running && (
            <div className="clip-actions-row">
              <button className="clip-mini" onClick={stop}>Stop</button>
            </div>
          )}
        </>
      )}

      {error && <p className="clip-note error">{error}</p>}

      {failed.length > 0 && (
        <div className="clip-note warn">
          <strong>{failed.length} cut{failed.length === 1 ? "" : "s"} could not be made:</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: "20px" }}>
            {failed.map((f, i) => <li key={i}>{f.label} — {f.error}</li>)}
          </ul>
        </div>
      )}

      {clips.length > 0 && (
        <>
          <div className="clip-actions-row">
            <button className="clip-mini primary" onClick={downloadAll}>
              ↓ Download all {clips.length}
            </button>
            <button className="clip-mini" onClick={downloadPlan} disabled={!plan}>
              ⭱ Studio workflow .json
            </button>
            {clips.some((c) => c.editSheet?.length) && (
              <button className="clip-mini" onClick={downloadSheets}>Edit sheets .txt</button>
            )}
          </div>

          <div className="clip-results">
            {clips.map((clip) => (
              <article className="clip-card" key={clip.id}>
                <video src={clip.url} controls preload="metadata" playsInline />
                <div className="clip-card-body">
                  <h3 className="clip-card-title">{clip.title || clip.hookLine}</h3>
                  {clip.why && <p className="clip-card-why">{clip.why}</p>}
                  <div className="clip-card-meta">
                    {clip.score != null && <span className="clip-score">{clip.score}</span>}
                    <span>{clip.seconds.toFixed(1)}s</span>
                    <span>{mmss(clip.startSec)}–{mmss(clip.endSec)}</span>
                    <span>{clip.width}×{clip.height}</span>
                  </div>
                  {clip.editSheet?.length > 0 && (
                    <details>
                      <summary className="clip-card-why" style={{ cursor: "pointer" }}>
                        Edit sheet — {clip.editSheet.length} beats
                      </summary>
                      <pre className="clip-sheet">{sheetText(clip.editSheet)}</pre>
                    </details>
                  )}
                  <div className="clip-card-actions">
                    <button
                      className="clip-mini primary"
                      onClick={() => download(
                        clip.blob,
                        `${String(clip.rank).padStart(2, "0")}-${safeName(clip.title || clip.hookLine, "clip")}.mp4`,
                      )}
                    >
                      ↓ MP4
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <p className="clip-note info">
            The .json opens in <StoreLink product="studio">AutoFlow Studio</StoreLink> — press
            <strong> ⭱ Import</strong> on the gallery screen and every clip arrives as a node
            you can re-cut, re-frame or re-caption without paying for the reading again.
          </p>
        </>
      )}
    </div>
  );
}
