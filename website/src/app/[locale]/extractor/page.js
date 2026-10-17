"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../../context/AuthContext";
import { useRouter } from "next/navigation";
import { parseClock, sectionOptions, sectionProblem } from "./timeFields";
import { OPEN_KEY, asResult, savedExtras, savedVersion } from "./saved";
import UploadBox, { SelectChip, ToggleChip } from "./UploadBox";
import ProgressView from "./ProgressView";
import Workspace from "./Workspace";
import { Icon, displayName } from "./ui";
import "./extractor.css";

/* Extraction options. Mirrors ExtractionOptions in
   extractor-backend/app/extraction.py — the engine validates and falls back on
   anything it doesn't recognise, so an older engine simply ignores these. */
const EXTRACT_LANGUAGES = [
  ["auto", "Same as video"],
  ["English", "English"],
  ["French", "French"],
  ["Spanish", "Spanish"],
  ["German", "German"],
  ["Italian", "Italian"],
  ["Arabic", "Arabic"],
  ["Portuguese", "Portuguese"],
];

const EXTRACT_STYLES = [
  ["faithful", "Match the video"],
  ["cinematic", "Cinematic"],
  ["photorealistic", "Photorealistic"],
  ["illustrated", "Illustrated"],
  ["anime", "Anime"],
  ["3d", "3D render"],
];

const EXTRACT_RATIOS = [
  ["source", "Same as video"],
  ["16:9", "16:9 landscape"],
  ["9:16", "9:16 vertical"],
  ["1:1", "1:1 square"],
  ["4:5", "4:5 portrait"],
];

const SHOT_COUNTS = [["auto", "Auto"], ...[3, 4, 5, 6, 8, 10, 12, 16, 20].map((n) => [String(n), String(n)])];

/* The engine cuts anything longer, so the box stops at the same place. */
const MAX_DIRECTION_CHARS = 300;

const DEFAULT_EXTRACT_OPTS = {
  shotCount: "auto",
  language: "auto",
  style: "faithful",
  characterSheets: true,
  aspectRatio: "source",
  creativeDirection: "",
  sectionStart: "",
  sectionEnd: "",
};

/** Send only what the user actually changed; null means "engine defaults". */
function buildExtractionOptions(o) {
  const body = {};
  if (o.shotCount !== "auto") body.shot_count = Number(o.shotCount);
  if (o.language !== "auto") body.language = o.language;
  if (o.style !== "faithful") body.style = o.style;
  if (!o.characterSheets) body.character_sheets = false;
  if (o.aspectRatio !== "source") body.aspect_ratio = o.aspectRatio;
  const direction = o.creativeDirection.trim();
  if (direction) body.creative_direction = direction;
  Object.assign(body, sectionOptions(o));
  return Object.keys(body).length ? body : null;
}

/* A link as typed: "youtube.com/watch?v=…" works as well as the full URL. */
const LINKISH = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

function normalizeLink(text) {
  const t = String(text || "").trim();
  if (!LINKISH.test(t)) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** The options as chips under the box. Section and brief need typing, so
    they open a small drawer instead of a list. */
function ExtractOptions({ opts, setOpt, reset, drawer, setDrawer }) {
  const problem = sectionProblem(opts);
  const hasSection = !!(opts.sectionStart.trim() || opts.sectionEnd.trim());
  const brief = opts.creativeDirection.trim();
  const changed = JSON.stringify(opts) !== JSON.stringify(DEFAULT_EXTRACT_OPTS);
  const toggle = (name) => setDrawer(drawer === name ? null : name);

  return (
    <>
      <div className="xf-opts" aria-label="Extraction options">
        <SelectChip name="Shots" value={opts.shotCount} options={SHOT_COUNTS} fallback="auto" onChange={(v) => setOpt("shotCount", v)} />
        <SelectChip name="Style" value={opts.style} options={EXTRACT_STYLES} fallback="faithful" onChange={(v) => setOpt("style", v)} />
        <SelectChip name="Frame" value={opts.aspectRatio} options={EXTRACT_RATIOS} fallback="source" onChange={(v) => setOpt("aspectRatio", v)} />
        <SelectChip name="Language" value={opts.language} options={EXTRACT_LANGUAGES} fallback="auto" onChange={(v) => setOpt("language", v)} />
        <ToggleChip
          name="Character sheets"
          value={opts.characterSheets ? "On" : "Off"}
          on={!opts.characterSheets}
          pressed={opts.characterSheets}
          onClick={() => setOpt("characterSheets", !opts.characterSheets)}
        />
        <ToggleChip
          name="Part"
          icon="clock"
          value={hasSection ? `${opts.sectionStart.trim() || "0:00"}–${opts.sectionEnd.trim() || "end"}` : "Whole video"}
          on={hasSection || drawer === "section"}
          expanded={drawer === "section"}
          onClick={() => toggle("section")}
        />
        <ToggleChip
          name="Brief"
          icon="sparkles"
          value={brief ? "Added" : "None"}
          on={!!brief || drawer === "brief"}
          expanded={drawer === "brief"}
          onClick={() => toggle("brief")}
        />
        {changed && (
          <button type="button" className="xf-link xf-link-muted xf-chip-reset" onClick={() => { reset(); setDrawer(null); }}>
            Reset
          </button>
        )}
      </div>

      {drawer === "section" && (
        <div className="xf-drawer">
          <div className="xf-drawer-head">
            <strong>Analyse part of the video</strong>
            <span>Empty means the whole video</span>
          </div>
          <div className="xf-fields xf-fields-2">
            <label className="xf-field">
              <span className="xf-label">From</span>
              <input
                className="xf-input xf-tc"
                type="text"
                inputMode="numeric"
                placeholder="0:00"
                value={opts.sectionStart}
                onChange={(e) => setOpt("sectionStart", e.target.value)}
                aria-invalid={Number.isNaN(parseClock(opts.sectionStart))}
              />
            </label>
            <label className="xf-field">
              <span className="xf-label">To</span>
              <input
                className="xf-input xf-tc"
                type="text"
                inputMode="numeric"
                placeholder="end"
                value={opts.sectionEnd}
                onChange={(e) => setOpt("sectionEnd", e.target.value)}
                aria-invalid={Number.isNaN(parseClock(opts.sectionEnd))}
              />
            </label>
          </div>
          {problem
            ? <p role="alert" className="xf-error" style={{ margin: "8px 0 0" }}>{problem}</p>
            : <p className="xf-help" style={{ margin: "8px 0 0" }}>Long videos count as one extraction per 10 minutes analysed, so a part of a long video uses fewer — and is read more closely.</p>}
        </div>
      )}

      {drawer === "brief" && (
        <div className="xf-drawer">
          <div className="xf-drawer-head">
            <strong>Creative direction</strong>
            <span>{opts.creativeDirection.length}/{MAX_DIRECTION_CHARS}</span>
          </div>
          <textarea
            className="xf-textarea"
            value={opts.creativeDirection}
            maxLength={MAX_DIRECTION_CHARS}
            rows={3}
            placeholder='Remix it instead of copying it — "same story, set in Tokyo at night" or "replace the man with a friendly robot".'
            onChange={(e) => setOpt("creativeDirection", e.target.value)}
            aria-label="Creative direction"
          />
          <p className="xf-help" style={{ margin: "8px 0 0" }}>
            A brief, not a prompt: it changes what the prompts describe, while the shots, timing and camera work stay the source&apos;s.
          </p>
        </div>
      )}
    </>
  );
}

export default function ExtractorPage() {
  const { user, token, loading, login, register } = useAuth();
  const router = useRouter();

  const [videoUrl, setVideoUrl] = useState("");
  const [file, setFile] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState("idle"); // idle, uploading, processing, completed, error
  const [stepMessage, setStepMessage] = useState("");
  const [startedAt, setStartedAt] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [extractOpts, setExtractOpts] = useState(DEFAULT_EXTRACT_OPTS);
  const [drawer, setDrawer] = useState(null); // section | brief
  const [savedId, setSavedId] = useState(null);
  /* A saved extraction opened from the dashboard keeps the name it was saved under. */
  const [openedName, setOpenedName] = useState(null);
  /* Every edit is a version; Undo goes back one. The first is what the
     engine returned. */
  const [versions, setVersions] = useState([]);
  const [refineLog, setRefineLog] = useState([]);
  const [isPublished, setIsPublished] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);

  // In-page Auth Modal state for guests
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authTab, setAuthTab] = useState("register"); // "register" or "login"
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  /* No tabs: a chosen file is what runs, otherwise the link. */
  const source = file ? "upload" : "url";
  const link = normalizeLink(videoUrl);
  const ready = source === "upload" || !!link;
  const busy = status === "uploading" || status === "processing";

  /** Publishing is opt-in: extractions save privately, and this is the only
      thing that puts one in the public gallery. */
  const togglePublished = async () => {
    if (!savedId || publishBusy) return;
    const next = !isPublished;
    setPublishBusy(true);
    try {
      const res = await fetch(`${DJANGO_API_URL}/extractions/${savedId}/`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ is_public: next }),
      });
      if (res.ok) setIsPublished(next);
    } catch (e) {
      /* leave the toggle where it was; the extraction itself is unaffected */
    } finally {
      setPublishBusy(false);
    }
  };

  const setExtractOpt = (key, value) =>
    setExtractOpts((prev) => ({ ...prev, [key]: value }));

  /* The extractor is its own service on Railway; api.auto-flow.studio is the
     Django API and answers /api/videos with a 404. */
  const API_URL = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL || "https://autoflow-extractor-production.up.railway.app/api/videos";
  const DJANGO_API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.auto-flow.studio/api";

  /* Each version is saved onto the same row: an edit never creates an
     extraction, so it never counts toward the allowance. */
  const persistVersion = (version) => {
    if (!savedId || !token) return;
    fetch(`${DJANGO_API_URL}/extractions/${savedId}/`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(savedVersion(version)),
    }).catch(() => { /* the version is on screen; the next edit saves again */ });
  };

  const applyRefined = (next, entry) => {
    setVersions((v) => [...v, next]);
    setResult(next);
    setRefineLog((l) => [...l, entry]);
    persistVersion(next);
  };

  const undoRefine = () => {
    if (versions.length < 2) return;
    const back = versions[versions.length - 2];
    setVersions(versions.slice(0, -1));
    setResult(back);
    // Mark the newest change that is still standing as undone.
    setRefineLog((l) => {
      const i = l.map((e) => !e.undone).lastIndexOf(true);
      return i < 0 ? l : l.map((e, j) => (j === i ? { ...e, undone: true } : e));
    });
    persistVersion(back);
  };

  /* Opened from the dashboard: the saved extraction arrives through
     sessionStorage and lands straight in the results view, ready to edit. */
  useEffect(() => {
    if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("open")) return;
    try {
      const raw = sessionStorage.getItem(OPEN_KEY);
      sessionStorage.removeItem(OPEN_KEY);
      if (!raw) return;
      const row = JSON.parse(raw);
      const opened = asResult(row);
      setResult(opened);
      setVersions([opened]);
      setRefineLog([]);
      setSavedId(row.id);
      setOpenedName(row.video_name || null);
      setIsPublished(!!row.is_public);
      setSaveStatus("saved");
      setStatus("completed");
      window.history.replaceState(null, "", window.location.pathname);
    } catch (e) {
      /* nothing to open */
    }
  }, []);

  const resetAll = () => {
    setStatus("idle");
    setFile(null);
    setVideoUrl("");
    setResult(null);
    setSavedId(null);
    setOpenedName(null);
    setIsPublished(false);
    setVersions([]);
    setRefineLog([]);
    setJobId(null);
    setSaveStatus("idle");
    setError(null);
    window.scrollTo({ top: 0 });
  };

  const startAnalysis = async (explicitToken = null) => {
    if (!ready) return;
    if (sectionProblem(extractOpts)) {
      // The message sits under the time fields; make sure it is on screen.
      setDrawer("section");
      return;
    }

    const activeToken = explicitToken || token || (typeof window !== "undefined" ? localStorage.getItem("access_token") : null);

    if (!user && !activeToken) {
      setAuthError(null);
      setShowAuthModal(true);
      return;
    }

    setStatus("uploading");
    setStartedAt(Date.now());
    setStepMessage("Checking plan limits...");
    setError(null);

    try {
      // Pre-flight limit check
      const limitRes = await fetch(`${DJANGO_API_URL}/extractions/check-limit/`, {
        headers: { "Authorization": `Bearer ${activeToken}` }
      });
      if (limitRes.ok) {
        const limitData = await limitRes.json();
        if (!limitData.allowed) {
          throw new Error(`You have reached your limit of ${limitData.limit} extractions per ${limitData.period}. ${!limitData.is_pro ? "Upgrade to Pro to unlock 20 extractions per day!" : "Please try again tomorrow."}`);
        }
      }

      // Only send what differs from the engine's defaults, so an untouched
      // form produces exactly the same extraction it always did.
      const options = buildExtractionOptions(extractOpts);

      let response;
      if (source === "upload") {
        setStepMessage("Uploading video...");
        const formData = new FormData();
        formData.append("video", file);
        // Multipart can't nest JSON next to the file — the API reads this
        // field as a JSON string.
        if (options) formData.append("options", JSON.stringify(options));

        response = await fetch(`${API_URL}/analyze`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${activeToken}`
          },
          body: formData,
        });
      } else {
        setStepMessage("Sending the link...");
        setVideoUrl(link);
        response = await fetch(`${API_URL}/analyze-url`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${activeToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ url: link, ...(options ? { options } : {}) }),
        });
      }

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || err.message || "Upload failed");
      }

      const data = await response.json();
      setJobId(data.job_id);
      setStatus("processing");
      setStepMessage(source === "upload" ? "Preparing video for AI..." : "Downloading video from URL...");
    } catch (err) {
      setStatus("error");
      setError(err.message);
    }
  };

  const handleAuthSubmit = async (e) => {
    e?.preventDefault();
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError("Please enter both email and password.");
      return;
    }
    setAuthSubmitting(true);
    setAuthError(null);

    try {
      const res = authTab === "login"
        ? await login(authEmail.trim(), authPassword.trim())
        : await register(authEmail.trim(), authPassword.trim());

      if (res && res.success) {
        setShowAuthModal(false);
        const storedToken = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
        // Resume the extraction automatically with the new session
        startAnalysis(storedToken);
      } else {
        setAuthError(res?.error || (authTab === "login" ? "Invalid email or password" : "Registration failed"));
      }
    } catch (err) {
      setAuthError(err.message || "Authentication failed");
    } finally {
      setAuthSubmitting(false);
    }
  };

  // Poll for status
  useEffect(() => {
    let interval;
    const activeToken = token || (typeof window !== "undefined" ? localStorage.getItem("access_token") : null);
    if (status === "processing" && jobId) {
      interval = setInterval(async () => {
        try {
          const response = await fetch(`${API_URL}/status/${jobId}`, {
            headers: activeToken ? { "Authorization": `Bearer ${activeToken}` } : {}
          });
          // A job this account cannot see (signed out, or another account)
          // answers 401/404, which used to leave the spinner going forever.
          if (response.status === 401 || response.status === 404) {
            setStatus("error");
            setError(response.status === 401
              ? "Your session expired while the video was being analysed. Sign in and run it again."
              : "This analysis could not be found on the server. Please run it again.");
            clearInterval(interval);
            return;
          }
          const data = await response.json();

          if (data.status === "completed") {
            setStatus("completed");
            setResult(data.result);
            setVersions([data.result]);
            setRefineLog([]);
            clearInterval(interval);
            window.scrollTo({ top: 0 });

            // Auto-save to Django
            setSaveStatus("saving");
            try {
              const saveHeaders = {
                "Content-Type": "application/json"
              };
              if (activeToken) saveHeaders["Authorization"] = `Bearer ${activeToken}`;

              const saveResponse = await fetch(`${DJANGO_API_URL}/extractions/`, {
                method: "POST",
                headers: saveHeaders,
                body: JSON.stringify({
                  video_name: source === "upload" ? file?.name : (() => {
                    try { return new URL(videoUrl).hostname; }
                    catch(e) { return "Video Link"; }
                  })(),
                  video_concept: data.result.video_concept || "",
                  voiceover_text: data.result.voiceover_text || "",
                  character_sheets: data.result.character_sheets || [],
                  shots: data.result.shots || [],
                  // The job this came from: its extractions were reserved when
                  // it started, so saving it must not count them again.
                  job_id: jobId,
                  ...savedExtras(data.result),
                })
              });
              if (saveResponse.ok) {
                setSaveStatus("saved");
                // Keep the id so the user can choose to publish it. Saved
                // extractions are private until they say otherwise.
                try {
                  const saved = await saveResponse.json();
                  if (saved?.id) setSavedId(saved.id);
                } catch (e) { /* id is a nice-to-have, not required */ }
              } else {
                setSaveStatus("error");
              }
            } catch (err) {
              setSaveStatus("error");
            }
          } else if (data.status === "failed") {
            setStatus("error");
            setError(data.error || "Analysis failed");
            clearInterval(interval);
          } else {
            setStepMessage(data.step || "Processing...");
          }
        } catch (err) {
          console.error("Polling error:", err);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [status, jobId, token, API_URL]);

  const sourceName = openedName || (file ? file.name : videoUrl);
  const shownName = openedName || (file ? file.name : displayName(videoUrl));
  const refineToken = token || (typeof window !== "undefined" ? localStorage.getItem("access_token") : null);

  return (
    <div className="xf" style={{ minHeight: "100vh", position: "relative", paddingBottom: "40px" }}>
      {/* No z-index here: it would trap the dialogs and the refine sheet
          beneath the site header. */}
      <div className="container">
        {status === "completed" && result ? (
          <Workspace
            result={result}
            name={shownName}
            sourceName={sourceName}
            saveStatus={saveStatus}
            savedId={savedId}
            isPublished={isPublished}
            publishBusy={publishBusy}
            onTogglePublished={togglePublished}
            onReset={resetAll}
            refine={result.shots?.length > 0 && (token || user) ? {
              result,
              jobId,
              token: refineToken,
              apiUrl: API_URL,
              log: refineLog,
              canUndo: versions.length > 1,
              onResult: applyRefined,
              onUndo: undoRefine,
            } : null}
          />
        ) : (
          <>
            <header className="xf-hero">
              <h1>Video <span className="text-gradient">Extractor</span></h1>
              <p className="xf-hero-lead">
                Drop in any video and get every shot back as image and motion prompts, with the
                voiceover script and a design sheet for each character.
              </p>
              <p className="xf-hero-alt">
                Want to know why a video works instead? <a href="/breakdown">Break it down</a>
              </p>
            </header>

            {busy ? (
              <ProgressView
                status={status}
                step={stepMessage}
                startedAt={startedAt}
                name={file ? file.name : displayName(videoUrl)}
              />
            ) : (
              <>
                {status === "error" && (
                  <div className="xf-start" style={{ marginBottom: 12 }}>
                    <div className="xf-callout xf-callout-error" role="alert">
                      <Icon name="alert" />
                      <div>
                        <strong style={{ color: "var(--text-primary)", display: "block" }}>That extraction did not finish</strong>
                        {error}
                        <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: "0.82rem" }}>
                          Your video and options are still below — fix what it says and press the button again.
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <UploadBox
                  file={file}
                  onFile={setFile}
                  url={videoUrl}
                  onUrl={setVideoUrl}
                  onStart={() => startAnalysis()}
                  ready={ready}
                  busy={busy}
                  goLabel="Extract prompts"
                >
                  <ExtractOptions
                    opts={extractOpts}
                    setOpt={setExtractOpt}
                    reset={() => setExtractOpts(DEFAULT_EXTRACT_OPTS)}
                    drawer={drawer}
                    setDrawer={setDrawer}
                  />
                  <p className="xf-help" style={{ marginTop: 14, textAlign: "center" }}>
                    Works with videos made in Runway, Sora, Kling, Veo, Luma, Pika and Midjourney — and with any filmed video.
                  </p>
                </UploadBox>
              </>
            )}
          </>
        )}

        {/* --- SEO Section --- */}
        {status === "idle" && (
          <div style={{ marginTop: "160px", marginBottom: "80px", position: "relative" }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "1px", background: "linear-gradient(90deg, transparent, var(--primary), transparent)", opacity: 0.3 }}></div>

            {/* --- How It Works --- */}
            <div style={{ paddingTop: "80px", marginBottom: "100px" }}>
              <div style={{ textAlign: "center", marginBottom: "60px" }}>
                <div style={{ display: "inline-block", padding: "6px 16px", border: "1px solid var(--primary)", borderRadius: "20px", fontSize: "0.85rem", color: "var(--primary)", marginBottom: "20px", background: "rgba(255,92,0,0.05)" }}>How It Works</div>
                <h2 style={{ fontSize: "2.4rem", marginBottom: "16px", letterSpacing: "-0.02em" }}>Extract Prompts in <span className="text-gradient">3 Simple Steps</span></h2>
                <p className="text-secondary" style={{ fontSize: "1.1rem", maxWidth: "600px", margin: "0 auto" }}>No technical skills needed. Upload your video and get results in under 2 minutes.</p>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "32px" }}>
                {[
                  { num: "01", icon: "📤", title: "Upload Your Video", desc: "Drag and drop any AI-generated video file (MP4, MOV, WebM) or paste a link from YouTube, TikTok, Instagram, or X." },
                  { num: "02", icon: "🔍", title: "AI Analyzes Every Frame", desc: "Our advanced vision model deconstructs the video frame-by-frame — identifying lighting, camera angles, character designs, and artistic style." },
                  { num: "03", icon: "📋", title: "Copy Your Prompts", desc: "Get ready-to-use image prompts, motion prompts, voiceover scripts, and character sheets. One click to copy into any AI tool." },
                ].map((step) => (
                  <div key={step.num} className="card-glass" style={{ padding: "40px 32px", borderRadius: "var(--radius-xl)", background: "rgba(10,10,10,0.5)", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: "16px", right: "20px", fontSize: "4rem", fontWeight: 900, opacity: 0.06, color: "var(--primary)" }}>{step.num}</div>
                    <div style={{ fontSize: "2.5rem", marginBottom: "20px" }}>{step.icon}</div>
                    <h3 style={{ fontSize: "1.3rem", marginBottom: "12px", color: "white" }}>{step.title}</h3>
                    <p className="text-secondary" style={{ fontSize: "1rem", lineHeight: 1.7 }}>{step.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* --- Feature Grid --- */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "60px", marginBottom: "100px", textAlign: "left" }}>
              <div>
                <h2 style={{ fontSize: "2.2rem", marginBottom: "24px", letterSpacing: "-0.02em" }}>Reverse-Engineer Any <span className="text-gradient">AI Video</span></h2>
                <p className="text-secondary" style={{ fontSize: "1.1rem", lineHeight: 1.8 }}>
                  Ever wondered how a stunning AI-generated video was made? Our <strong>Video Prompt Extractor</strong> is the ultimate reverse-engineering tool for AI filmmakers and prompt engineers. Simply upload any MP4 or WebM video generated by tools like <strong>Runway Gen-3, OpenAI Sora, Kling AI, Luma Dream Machine, or Pika Labs</strong>, and our advanced vision models will deconstruct it frame-by-frame.
                </p>
                <p className="text-secondary" style={{ fontSize: "1.05rem", lineHeight: 1.8, marginTop: "16px" }}>
                  Whether you want to <strong>recreate a viral AI video</strong>, learn from the best prompt engineers, or speed up your own video production workflow — AutoFlow's extractor gives you the exact blueprint behind any AI-generated content.
                </p>
              </div>
              <div className="card-glass" style={{ padding: "40px", borderRadius: "var(--radius-xl)", background: "rgba(10,10,10,0.5)" }}>
                <h3 style={{ fontSize: "1.4rem", margin: "0 0 24px 0", color: "white" }}>What Our Extractor Reveals:</h3>
                <ul style={{ gap: "20px", listStyle: "none", display: "flex", flexDirection: "column", padding: 0 }}>
                  <li style={{ display: "flex", gap: "16px", alignItems: "flex-start", color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--primary-light)", fontSize: "1.2rem", background: "rgba(255, 92, 0, 0.1)", padding: "4px 8px", borderRadius: "var(--radius-sm)" }}>✦</span> 
                    <div>
                      <strong style={{ color: "white", display: "block", marginBottom: "4px" }}>Exact Image Generation Prompts</strong>
                      Get the precise text-to-image prompts needed to generate the source frames with Midjourney V6, DALL·E 3, or Flux.
                    </div>
                  </li>
                  <li style={{ display: "flex", gap: "16px", alignItems: "flex-start", color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--primary-light)", fontSize: "1.2rem", background: "rgba(255, 92, 0, 0.1)", padding: "4px 8px", borderRadius: "var(--radius-sm)" }}>✦</span> 
                    <div>
                      <strong style={{ color: "white", display: "block", marginBottom: "4px" }}>Motion &amp; Camera Movement Prompts</strong>
                      Uncover the specific camera movements (pan, tilt, dolly zoom) and motion descriptors used in Runway Gen-3 or Sora.
                    </div>
                  </li>
                  <li style={{ display: "flex", gap: "16px", alignItems: "flex-start", color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--primary-light)", fontSize: "1.2rem", background: "rgba(255, 92, 0, 0.1)", padding: "4px 8px", borderRadius: "var(--radius-sm)" }}>✦</span> 
                    <div>
                      <strong style={{ color: "white", display: "block", marginBottom: "4px" }}>Character Design Sheets</strong>
                      Automatically extract consistent character descriptions, visual references, and lighting setups for every character.
                    </div>
                  </li>
                  <li style={{ display: "flex", gap: "16px", alignItems: "flex-start", color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--primary-light)", fontSize: "1.2rem", background: "rgba(255, 92, 0, 0.1)", padding: "4px 8px", borderRadius: "var(--radius-sm)" }}>✦</span> 
                    <div>
                      <strong style={{ color: "white", display: "block", marginBottom: "4px" }}>Voiceover &amp; Narration Scripts</strong>
                      Extract the full narration text with timing, tone, and delivery notes for easy recreation.
                    </div>
                  </li>
                </ul>
              </div>
            </div>

            {/* --- FAQ Section --- */}
            <div style={{ maxWidth: "800px", margin: "0 auto" }}>
              <div style={{ textAlign: "center", marginBottom: "48px" }}>
                <h2 style={{ fontSize: "2.2rem", marginBottom: "16px", letterSpacing: "-0.02em" }}>Frequently Asked <span className="text-gradient">Questions</span></h2>
                <p className="text-secondary" style={{ fontSize: "1.1rem" }}>Everything you need to know about the AI Video Prompt Extractor.</p>
              </div>
              {[
                { q: "Is the AI Video Prompt Extractor free to use?", a: "Yes! You get 3 free extractions per day on the free plan. Need more? Upgrade to Pro for 20 extractions per day. No credit card required to start." },
                { q: "What video formats are supported?", a: "We support MP4, MOV, and WebM video files up to 500MB. You can also paste a direct link from YouTube, TikTok, Instagram, or X — we'll download and analyze it for you." },
                { q: "Which AI video generators does it work with?", a: "Our extractor works with videos made by any AI tool — including Runway Gen-3, OpenAI Sora, Kling AI, Luma Dream Machine, Pika Labs, Google Veo, Minimax, and more. It can also analyze traditional footage to generate AI-ready prompts." },
                { q: "How accurate are the extracted prompts?", a: "Our vision AI analyzes every frame to identify artistic style, lighting, camera angles, character details, and motion patterns. While no extraction is 100% identical to the original, our prompts consistently produce visually similar results when used with the same AI tools." },
                { q: "Can I extract prompts from YouTube or TikTok videos?", a: "Yes! Paste any public video link into the box. We support YouTube, TikTok, Instagram Reels, and X/Twitter videos. The video is downloaded temporarily on our servers for analysis and deleted immediately after." },
                { q: "What's the difference between image prompts and motion prompts?", a: "Image prompts describe what each frame looks like — the subject, style, lighting, and composition. Motion prompts describe how the camera moves and how elements animate between frames — things like 'slow dolly zoom' or 'pan left with parallax'." },
              ].map((faq, i) => (
                <details key={i} style={{ marginBottom: "12px", border: "1px solid rgba(255,92,0,0.15)", borderRadius: "12px", background: "rgba(10,10,10,0.4)", overflow: "hidden" }}>
                  <summary style={{ padding: "20px 24px", cursor: "pointer", fontSize: "1.1rem", fontWeight: 600, color: "white", listStyle: "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    {faq.q}
                    <span style={{ color: "var(--primary)", fontSize: "1.4rem", fontWeight: 300, flexShrink: 0, marginLeft: "16px" }}>+</span>
                  </summary>
                  <div style={{ padding: "0 24px 20px", color: "var(--text-secondary)", fontSize: "1rem", lineHeight: 1.7 }}>
                    {faq.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}

        {/* --- JSON-LD Structured Data --- */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "AutoFlow Video Prompt Extractor",
              description: "Upload any AI-generated video and extract the exact image prompts, motion prompts, voiceover scripts, and character designs used to create it. Works with Runway, Sora, Kling, Midjourney, Luma, and more.",
              applicationCategory: "MultimediaApplication",
              operatingSystem: "Web",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              creator: {
                "@type": "Organization",
                name: "AutoFlow",
                url: "https://www.auto-flow.studio",
              },
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: [
                { "@type": "Question", name: "Is the AI Video Prompt Extractor free to use?", acceptedAnswer: { "@type": "Answer", text: "Yes! You get 3 free extractions per day on the free plan. Upgrade to Pro for 20 extractions per day." } },
                { "@type": "Question", name: "What video formats are supported?", acceptedAnswer: { "@type": "Answer", text: "We support MP4, MOV, and WebM video files up to 500MB. You can also paste a link from YouTube, TikTok, Instagram, or X." } },
                { "@type": "Question", name: "Which AI video generators does it work with?", acceptedAnswer: { "@type": "Answer", text: "Our extractor works with videos from Runway Gen-3, OpenAI Sora, Kling AI, Luma Dream Machine, Pika Labs, Google Veo, Minimax, and more." } },
                { "@type": "Question", name: "How accurate are the extracted prompts?", acceptedAnswer: { "@type": "Answer", text: "Our vision AI analyzes every frame to identify style, lighting, camera angles, and motion patterns. Prompts consistently produce visually similar results." } },
                { "@type": "Question", name: "Can I extract prompts from YouTube or TikTok videos?", acceptedAnswer: { "@type": "Answer", text: "Yes! Paste any public video link from YouTube, TikTok, Instagram Reels, or X/Twitter into the box." } },
                { "@type": "Question", name: "What's the difference between image prompts and motion prompts?", acceptedAnswer: { "@type": "Answer", text: "Image prompts describe what each frame looks like. Motion prompts describe camera movements and element animations between frames." } },
              ],
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Home", item: "https://www.auto-flow.studio" },
                { "@type": "ListItem", position: 2, name: "Video Prompt Extractor", item: "https://www.auto-flow.studio/extractor" },
              ],
            }),
          }}
        />
        {/* --- In-Page Cyberpunk Auth Modal for Guests --- */}
        {showAuthModal && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.85)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "20px",
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowAuthModal(false);
            }}
          >
            <div
              className="cyber-panel animate-in"
              style={{
                maxWidth: "460px",
                width: "100%",
                padding: "36px 28px",
                position: "relative",
                background: "#080808",
                border: "1px solid var(--primary)",
                boxShadow: "0 0 50px rgba(255, 92, 0, 0.25), inset 0 0 30px rgba(255, 92, 0, 0.05)",
              }}
            >
              {/* Corner brackets */}
              <div style={{ position: "absolute", top: 8, left: 8, width: 16, height: 16, borderTop: "2px solid var(--primary)", borderLeft: "2px solid var(--primary)" }}></div>
              <div style={{ position: "absolute", top: 8, right: 8, width: 16, height: 16, borderTop: "2px solid var(--primary)", borderRight: "2px solid var(--primary)" }}></div>
              <div style={{ position: "absolute", bottom: 8, left: 8, width: 16, height: 16, borderBottom: "2px solid var(--primary)", borderLeft: "2px solid var(--primary)" }}></div>
              <div style={{ position: "absolute", bottom: 8, right: 8, width: 16, height: 16, borderBottom: "2px solid var(--primary)", borderRight: "2px solid var(--primary)" }}></div>

              {/* Close button */}
              <button
                onClick={() => setShowAuthModal(false)}
                className="terminal-text"
                style={{
                  position: "absolute",
                  top: 14,
                  right: 14,
                  background: "transparent",
                  border: "1px solid rgba(255, 92, 0, 0.3)",
                  color: "var(--text-secondary)",
                  width: "32px",
                  height: "32px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1rem",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#FFF";
                  e.currentTarget.style.borderColor = "var(--primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-secondary)";
                  e.currentTarget.style.borderColor = "rgba(255, 92, 0, 0.3)";
                }}
                aria-label="Close modal"
              >
                ✕
              </button>

              {/* Header Badge */}
              <div style={{ textAlign: "center", marginBottom: "16px" }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "4px 12px",
                    background: "rgba(255, 92, 0, 0.1)",
                    border: "1px solid rgba(255, 92, 0, 0.4)",
                    borderRadius: "20px",
                    fontSize: "0.8rem",
                    color: "var(--primary)",
                  }}
                >
                  <span>⚡</span>
                  <span className="terminal-text" style={{ fontSize: "0.78rem", letterSpacing: "1px", textTransform: "uppercase" }}>
                    Free Plan • 3 Extractions / Day
                  </span>
                </div>
              </div>

              {/* Title & Subtitle */}
              <h3
                style={{
                  fontSize: "1.5rem",
                  textAlign: "center",
                  color: "#FFF",
                  fontFamily: "'JetBrains Mono', monospace",
                  marginBottom: "8px",
                  textTransform: "uppercase",
                }}
              >
                {authTab === "register" ? "Create Free Account" : "Welcome Back"}
              </h3>
              <p
                className="terminal-text"
                style={{
                  textAlign: "center",
                  color: "var(--text-secondary)",
                  fontSize: "0.88rem",
                  marginBottom: "20px",
                  lineHeight: "1.5",
                }}
              >
                {authTab === "register"
                  ? "Sign up in 5 seconds to reverse-engineer this video and extract full prompts."
                  : "Log in to your AutoFlow account to continue extracting."}
              </p>

              {/* Dual Tabs */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "0",
                  marginBottom: "20px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  onClick={() => { setAuthTab("register"); setAuthError(null); }}
                  style={{
                    padding: "10px",
                    background: authTab === "register" ? "var(--primary)" : "transparent",
                    color: authTab === "register" ? "#000" : "var(--text-secondary)",
                    border: "none",
                    fontWeight: "600",
                    cursor: "pointer",
                    fontSize: "0.88rem",
                    transition: "all 0.2s",
                  }}
                >
                  Create Account
                </button>
                <button
                  type="button"
                  onClick={() => { setAuthTab("login"); setAuthError(null); }}
                  style={{
                    padding: "10px",
                    background: authTab === "login" ? "var(--primary)" : "transparent",
                    color: authTab === "login" ? "#000" : "var(--text-secondary)",
                    border: "none",
                    fontWeight: "600",
                    cursor: "pointer",
                    fontSize: "0.88rem",
                    transition: "all 0.2s",
                  }}
                >
                  Log In
                </button>
              </div>

              {/* Error Alert */}
              {authError && (
                <div
                  className="terminal-text"
                  style={{
                    background: "rgba(255, 59, 48, 0.1)",
                    border: "1px solid rgba(255, 59, 48, 0.4)",
                    color: "#ff6b6b",
                    padding: "10px 14px",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.85rem",
                    marginBottom: "16px",
                    textAlign: "center",
                  }}
                >
                  ⚠ {authError}
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleAuthSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div>
                  <label className="terminal-text" style={{ display: "block", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "1px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    autoFocus
                    placeholder="creator@example.com"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="terminal-text"
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      background: "#000",
                      border: "1px solid var(--border)",
                      color: "#FFF",
                      fontSize: "0.95rem",
                      outline: "none",
                      borderRadius: "var(--radius-sm)",
                      boxSizing: "border-box",
                    }}
                    onFocus={(e) => e.target.style.borderColor = "var(--primary)"}
                    onBlur={(e) => e.target.style.borderColor = "var(--border)"}
                  />
                </div>

                <div>
                  <label className="terminal-text" style={{ display: "block", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "1px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="terminal-text"
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      background: "#000",
                      border: "1px solid var(--border)",
                      color: "#FFF",
                      fontSize: "0.95rem",
                      outline: "none",
                      borderRadius: "var(--radius-sm)",
                      boxSizing: "border-box",
                    }}
                    onFocus={(e) => e.target.style.borderColor = "var(--primary)"}
                    onBlur={(e) => e.target.style.borderColor = "var(--border)"}
                  />
                </div>

                <button
                  type="submit"
                  className="cyber-btn"
                  disabled={authSubmitting}
                  style={{
                    marginTop: "6px",
                    padding: "14px",
                    fontSize: "1rem",
                    fontWeight: "700",
                    width: "100%",
                    cursor: authSubmitting ? "wait" : "pointer",
                    opacity: authSubmitting ? 0.7 : 1,
                  }}
                >
                  {authSubmitting
                    ? "Authenticating..."
                    : authTab === "register"
                    ? "Create Account & Extract"
                    : "Log In & Extract"}
                </button>
              </form>

              {/* Bottom Switcher */}
              <div style={{ marginTop: "18px", textAlign: "center" }}>
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab(authTab === "register" ? "login" : "register");
                    setAuthError(null);
                  }}
                  className="terminal-text"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-secondary)",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  {authTab === "register"
                    ? "Already have an account? Log In"
                    : "Don't have an account? Create one"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
