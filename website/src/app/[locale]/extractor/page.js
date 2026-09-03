"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../context/AuthContext";
import { useRouter } from "next/navigation";
import {
  STUDIO_OPTIONS,
  DEFAULT_STUDIO_OPTS,
  buildStudioWorkflow,
  downloadStudioWorkflow,
} from "./studioWorkflow";
import { studioInstalled, sendToStudio, toBuildOptions } from "./studioBridge";

/* Where "Install AutoFlow Studio" sends people. One constant, so the listing
   moving is a one-line change. */
const STUDIO_STORE_URL =
  "https://chromewebstore.google.com/detail/autoflow-studio-%E2%80%94-node-wo/knodokbipcajhdpafplmlljbaamgfkao";

/* Extraction options. Mirrors ExtractionOptions in
   extractor-backend/app/api/videos.py — the engine validates and falls back on
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

const DEFAULT_EXTRACT_OPTS = {
  shotCount: "auto",
  language: "auto",
  style: "faithful",
  characterSheets: true,
};

/** Send only what the user actually changed; null means "engine defaults". */
function buildExtractionOptions(o) {
  const body = {};
  if (o.shotCount !== "auto") body.shot_count = Number(o.shotCount);
  if (o.language !== "auto") body.language = o.language;
  if (o.style !== "faithful") body.style = o.style;
  if (!o.characterSheets) body.character_sheets = false;
  return Object.keys(body).length ? body : null;
}

/* Field styles for the Studio options grid. The select carries an explicit
   width and height rather than a flex basis — inside a column flex, a basis
   resolves against the cross axis and silently becomes the height. */
const studioFieldStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  minWidth: 0,
};

const studioLabelStyle = {
  fontSize: "0.75rem",
  textTransform: "uppercase",
  letterSpacing: "1px",
  color: "var(--text-secondary)",
  fontFamily: "inherit",
};

const studioSelectStyle = {
  width: "100%",
  height: "44px",
  padding: "0 12px",
  background: "#000",
  color: "white",
  border: "1px solid rgba(255, 92, 0, 0.4)",
  fontSize: "0.9rem",
  cursor: "pointer",
};

export default function ExtractorPage() {
  const { user, token, loading, login, register } = useAuth();
  const router = useRouter();
  
  const [mode, setMode] = useState("upload"); // upload, url
  const [videoUrl, setVideoUrl] = useState("");
  const [file, setFile] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState("idle"); // idle, uploading, processing, completed, error
  const [stepMessage, setStepMessage] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [studioOpts, setStudioOpts] = useState(DEFAULT_STUDIO_OPTS);
  const [studioSent, setStudioSent] = useState(false);
  /* null while the answer is unknown. Three states that look different on
     screen: asking waits, installed sends, missing offers the install. */
  const [hasStudio, setHasStudio] = useState(null);
  const [studioSend, setStudioSend] = useState({ state: "idle", message: "", notes: [] });
  const [extractOpts, setExtractOpts] = useState(DEFAULT_EXTRACT_OPTS);
  const [showExtractOpts, setShowExtractOpts] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [isPublished, setIsPublished] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);

  // In-page Auth Modal state for guests
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authTab, setAuthTab] = useState("register"); // "register" or "login"
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

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

  const setStudioOpt = (key, value) =>
    setStudioOpts((prev) => ({ ...prev, [key]: value }));

  // Built on every render so the counts below always match the current options.
  // Cheap — a handful of shots, no I/O.
  /* Asked as soon as there is a result rather than at the moment of the
     click, so the button is right before it is reached for. */
  useEffect(() => {
    if (!result?.shots?.length) return;
    let alive = true;
    studioInstalled().then((yes) => { if (alive) setHasStudio(yes); });
    return () => { alive = false; };
  }, [result]);

  /** Hand the extraction to the extension, which builds it and opens it. */
  const handleSendToStudio = async () => {
    if (!result) return;
    setStudioSend({ state: "sending", message: "", notes: [] });
    const reply = await sendToStudio(
      result,
      toBuildOptions(studioOpts, result.video_name || "Extracted Workflow"),
    );
    if (reply.ok) {
      setStudioSend({
        state: "sent",
        message: `Opened in Studio — ${reply.nodes} nodes. If the canvas did not come up, open the extension and it is waiting.`,
        notes: reply.notes || [],
      });
      return;
    }
    setStudioSend({
      state: "error",
      message: reply.error || "Studio could not build that.",
      notes: [],
    });
  };

  const studioPreview =
    result?.shots?.length ? buildStudioWorkflow(result, studioOpts) : null;
  const studioGenCount =
    studioPreview?.nodes.filter((n) => n.data.type === "generate").length ?? 0;
  const studioBuildsImages = studioOpts.chain !== "videos";
  const studioBuildsVideos = studioOpts.chain !== "images";

  const API_URL = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL || "https://api.auto-flow.studio/api/videos";
  const DJANGO_API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.auto-flow.studio/api";

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const startAnalysis = async (explicitToken = null) => {
    if (mode === "upload" && !file) return;
    if (mode === "url" && !videoUrl.trim()) return;

    const activeToken = explicitToken || token || (typeof window !== "undefined" ? localStorage.getItem("access_token") : null);

    if (!user && !activeToken) {
      setAuthError(null);
      setShowAuthModal(true);
      return;
    }

    setStatus("uploading");
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
      if (mode === "upload") {
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
        setStepMessage("Submitting video URL...");
        response = await fetch(`${API_URL}/analyze-url`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${activeToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ url: videoUrl.trim(), ...(options ? { options } : {}) }),
        });
      }

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || err.message || "Upload failed");
      }

      const data = await response.json();
      setJobId(data.job_id);
      setStatus("processing");
      setStepMessage(mode === "upload" ? "Video analysis started. Polling for updates..." : "Downloading video on server...");
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
          const data = await response.json();
          
          if (data.status === "completed") {
            setStatus("completed");
            setResult(data.result);
            clearInterval(interval);
            
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
                  video_name: mode === "upload" ? file?.name : (() => {
                    try { return new URL(videoUrl).hostname; }
                    catch(e) { return "Video Link"; }
                  })(),
                  video_concept: data.result.video_concept || "",
                  voiceover_text: data.result.voiceover_text || "",
                  character_sheets: data.result.character_sheets || [],
                  shots: data.result.shots || []
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

  return (
    <div className="section" style={{ minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      {/* Absolute Ambient Backgrounds */}
      <div style={{ position: "absolute", top: "-10%", left: "50%", transform: "translateX(-50%)", width: "80vw", height: "80vw", background: "radial-gradient(circle, rgba(255, 92, 0, 0.08) 0%, rgba(0,0,0,0) 70%)", zIndex: -1, pointerEvents: "none" }} />
      
      <div className="container" style={{ position: "relative", zIndex: 1 }}>
        <div style={{ padding: "100px 0 60px", textAlign: "center", position: "relative" }}>
          <div className="animate-in" style={{ animationDelay: "0.1s" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "12px", marginBottom: "24px", padding: "8px 16px", border: "1px solid var(--primary)", background: "rgba(255, 92, 0, 0.05)" }}>
              <div style={{ width: "8px", height: "8px", background: "var(--primary)", animation: "terminal-blink 1s infinite" }}></div>
              <span className="terminal-text" style={{ fontSize: "0.9rem", letterSpacing: "2px", textTransform: "uppercase", textShadow: "none" }}>AI-Powered Video Analysis</span>
            </div>
            <h1 style={{ 
              fontSize: "clamp(3rem, 6vw, 5rem)", 
              letterSpacing: "-0.02em", 
              marginBottom: "24px", 
              fontWeight: "800",
              color: "#FFF",
            }}>
              Video <span className="text-gradient">Extractor</span>
            </h1>
            <p style={{ fontSize: "1.15rem", maxWidth: "650px", margin: "0 auto", lineHeight: "1.7", color: "var(--text-secondary)" }}>
              Upload any AI-generated video and our AI will extract the exact image prompts, motion prompts, voiceover script, and character descriptions used to create it.
            </p>
            {/* Supported Platforms */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "center", marginTop: "28px" }}>
              {["Runway Gen-3", "OpenAI Sora", "Kling AI", "Midjourney", "Luma", "Pika Labs", "Google Veo"].map((platform) => (
                <span key={platform} style={{ padding: "6px 16px", border: "1px solid rgba(255,92,0,0.3)", borderRadius: "20px", fontSize: "0.85rem", color: "var(--text-secondary)", background: "rgba(255,92,0,0.05)", letterSpacing: "0.3px" }}>
                  {platform}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ maxWidth: "860px", margin: "0 auto" }}>
          {/* Toggle Tab */}
            <div style={{ display: "flex", gap: "0", justifyContent: "center", marginBottom: "40px" }}>
              <button 
                onClick={() => setMode("upload")}
                style={{ 
                  padding: "14px 32px", 
                  background: mode === "upload" ? "var(--primary)" : "transparent",
                  color: mode === "upload" ? "#000" : "var(--text-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm) 0 0 var(--radius-sm)",
                  cursor: "pointer",
                  fontSize: "0.95rem",
                  fontWeight: "600",
                  transition: "all 0.2s ease"
                }}
              >
                📁 Upload File
              </button>
              <button 
                onClick={() => setMode("url")}
                style={{ 
                  padding: "14px 32px", 
                  background: mode === "url" ? "var(--primary)" : "transparent",
                  color: mode === "url" ? "#000" : "var(--text-secondary)",
                  border: "1px solid var(--border)",
                  borderLeft: "none",
                  borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
                  cursor: "pointer",
                  fontSize: "0.95rem",
                  fontWeight: "600",
                  transition: "all 0.2s ease"
                }}
              >
                🔗 Paste URL
              </button>
            </div>

            {/* Quick Demo Sample Chips */}
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "8px", marginBottom: "32px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginRight: "4px" }}>Test with 1-click sample:</span>
              <button
                type="button"
                className="sample-chip"
                onClick={() => {
                  setMode("url");
                  setUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
                }}
              >
                🌆 Cyberpunk Tokyo (Sora)
              </button>
              <button
                type="button"
                className="sample-chip"
                onClick={() => {
                  setMode("url");
                  setUrl("https://www.youtube.com/watch?v=jNQXAC9IVRw");
                }}
              >
                🦅 Cinematic Drone (Runway)
              </button>
              <button
                type="button"
                className="sample-chip"
                onClick={() => {
                  setMode("url");
                  setUrl("https://www.youtube.com/shorts/sample-video");
                }}
              >
                ⚔️ Ronin Samurai (Kling)
              </button>
            </div>

            {/* --- Upload Zone or URL Input (Available to All Visitors) --- */}
          {status === "idle" && (
            mode === "upload" ? (
              <div 
                className="cyber-panel animate-in delay-1"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                style={{ 
                  textAlign: "center",
                  cursor: "pointer",
                  padding: "100px 40px",
                  transition: "all 0.2s",
                }}
                onClick={() => document.getElementById("file-upload").click()}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = "0 0 40px rgba(255, 92, 0, 0.2), inset 0 0 40px rgba(255, 92, 0, 0.1)";
                  e.currentTarget.style.borderColor = "#FFF";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = "0 0 20px rgba(255, 92, 0, 0.05), inset 0 0 20px rgba(255, 92, 0, 0.05)";
                  e.currentTarget.style.borderColor = "var(--primary)";
                }}
              >
                <div style={{ position: "absolute", top: 10, left: 10, width: 20, height: 20, borderTop: "2px solid var(--primary)", borderLeft: "2px solid var(--primary)" }}></div>
                <div style={{ position: "absolute", top: 10, right: 10, width: 20, height: 20, borderTop: "2px solid var(--primary)", borderRight: "2px solid var(--primary)" }}></div>
                <div style={{ position: "absolute", bottom: 10, left: 10, width: 20, height: 20, borderBottom: "2px solid var(--primary)", borderLeft: "2px solid var(--primary)" }}></div>
                <div style={{ position: "absolute", bottom: 10, right: 10, width: 20, height: 20, borderBottom: "2px solid var(--primary)", borderRight: "2px solid var(--primary)" }}></div>
                
                <input 
                  id="file-upload" 
                  type="file" 
                  accept="video/mp4,video/quicktime,video/webm" 
                  style={{ display: "none" }} 
                  onChange={handleFileSelect}
                />
                {file ? (
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <div className="terminal-text" style={{ fontSize: "4rem", marginBottom: "20px" }}>✅ Ready to Extract</div>
                    <h3 style={{ marginBottom: "8px", fontSize: "1.8rem", color: "#FFF", fontFamily: "'JetBrains Mono', monospace" }}>{file.name}</h3>
                    <p className="terminal-text" style={{ marginBottom: "32px", color: "var(--text-secondary)" }}>{(file.size / (1024 * 1024)).toFixed(2)} MB • Ready to analyze</p>
                    <button 
                      className="cyber-btn" 
                      onClick={(e) => { e.stopPropagation(); startAnalysis(); }}
                      style={{ fontSize: "1.2rem", padding: "16px 40px", fontWeight: "700" }}
                    >
                      Extract Prompts
                    </button>
                  </div>
                ) : (
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <div className="terminal-text" style={{ fontSize: "3rem", marginBottom: "24px", animation: "terminal-blink 2s infinite" }}>📤</div>
                    <h3 style={{ fontSize: "2rem", marginBottom: "12px", fontFamily: "'JetBrains Mono', monospace", color: "#FFF", textTransform: "uppercase" }}>Drop your video here</h3>
                    <p className="terminal-text" style={{ fontSize: "1.1rem", color: "var(--text-secondary)" }}>Drag & drop or click to browse (Max 500MB)</p>
                  </div>
                )}
              </div>
            ) : (
              <div 
                className="cyber-panel animate-in delay-1"
                style={{ 
                  textAlign: "center",
                  padding: "80px 40px",
                }}
              >
                <div style={{ position: "absolute", top: 10, left: 10, width: 20, height: 20, borderTop: "2px solid var(--primary)", borderLeft: "2px solid var(--primary)" }}></div>
                <div style={{ position: "absolute", top: 10, right: 10, width: 20, height: 20, borderTop: "2px solid var(--primary)", borderRight: "2px solid var(--primary)" }}></div>
                <div style={{ position: "absolute", bottom: 10, left: 10, width: 20, height: 20, borderBottom: "2px solid var(--primary)", borderLeft: "2px solid var(--primary)" }}></div>
                <div style={{ position: "absolute", bottom: 10, right: 10, width: 20, height: 20, borderBottom: "2px solid var(--primary)", borderRight: "2px solid var(--primary)" }}></div>
                
                <div style={{ position: "relative", zIndex: 1 }}>
                  <div className="terminal-text" style={{ fontSize: "3rem", marginBottom: "24px" }}>🔗</div>
                  <h3 style={{ fontSize: "2rem", marginBottom: "12px", fontFamily: "'JetBrains Mono', monospace", color: "#FFF", textTransform: "uppercase" }}>Paste a video link</h3>
                  <p className="terminal-text" style={{ fontSize: "1.1rem", marginBottom: "32px", color: "var(--text-secondary)" }}>
                    Supports YouTube, TikTok, Instagram, Twitter/X
                  </p>
                  
                  <div style={{ display: "flex", gap: "0", maxWidth: "600px", margin: "0 auto", width: "100%" }}>
                    <input 
                      type="text"
                      placeholder="https://www..."
                      value={videoUrl}
                      onChange={(e) => setVideoUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && videoUrl.trim()) startAnalysis(); }}
                      className="terminal-text"
                      style={{
                        flex: 1,
                        padding: "16px 24px",
                        background: "#000",
                        border: "1px solid var(--primary)",
                        color: "var(--primary)",
                        fontSize: "1rem",
                        outline: "none",
                        transition: "all 0.3s ease"
                      }}
                      onFocus={(e) => e.target.style.boxShadow = "inset 0 0 10px rgba(255, 92, 0, 0.2)"}
                      onBlur={(e) => e.target.style.boxShadow = "none"}
                    />
                    <button 
                      className="cyber-btn" 
                      onClick={() => startAnalysis()}
                      disabled={!videoUrl.trim()}
                      style={{ 
                        fontSize: "1.1rem", 
                        padding: "16px 36px", 
                        borderLeft: "none",
                        whiteSpace: "nowrap",
                        opacity: !videoUrl.trim() ? 0.5 : 1
                      }}
                    >
                      Extract Prompts
                    </button>
                  </div>
                </div>
              </div>
            )
          )}

        {/* ── Extraction options (Open to all visitors) ──
            Collapsed by default: the defaults reproduce the original
            behaviour exactly, so most people never need to open this. */}
        {(status === "idle" || status === "error") && (
          <div className="cyber-panel animate-in" style={{ marginTop: "24px", padding: "0", overflow: "hidden" }}>
            <button
              onClick={() => setShowExtractOpts((v) => !v)}
              className="terminal-text"
              style={{
                width: "100%", padding: "20px 28px", background: "transparent",
                border: "none", color: "var(--primary)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                fontSize: "0.95rem", textTransform: "uppercase", letterSpacing: "1px",
                textShadow: "none", fontFamily: "inherit",
              }}
              aria-expanded={showExtractOpts}
            >
              <span>⚙ Extraction options</span>
              <span>{showExtractOpts ? "−" : "+"}</span>
            </button>

            {showExtractOpts && (
              <div style={{ padding: "0 28px 28px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "16px" }}>
                  <label style={studioFieldStyle}>
                    <span style={studioLabelStyle}>Number of shots</span>
                    <select
                      value={extractOpts.shotCount}
                      onChange={(e) => setExtractOpt("shotCount", e.target.value)}
                      style={studioSelectStyle}
                    >
                      <option value="auto">Auto</option>
                      {[3, 4, 5, 6, 8, 10, 12, 16, 20].map((n) => (
                        <option key={n} value={n}>{n} shots</option>
                      ))}
                    </select>
                  </label>

                  <label style={studioFieldStyle}>
                    <span style={studioLabelStyle}>Voiceover language</span>
                    <select
                      value={extractOpts.language}
                      onChange={(e) => setExtractOpt("language", e.target.value)}
                      style={studioSelectStyle}
                    >
                      {EXTRACT_LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>

                  <label style={studioFieldStyle}>
                    <span style={studioLabelStyle}>Visual style</span>
                    <select
                      value={extractOpts.style}
                      onChange={(e) => setExtractOpt("style", e.target.value)}
                      style={studioSelectStyle}
                    >
                      {EXTRACT_STYLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>

                  <label style={{ ...studioFieldStyle, justifyContent: "flex-end" }}>
                    <span style={studioLabelStyle}>Character sheets</span>
                    <button
                      type="button"
                      onClick={() => setExtractOpt("characterSheets", !extractOpts.characterSheets)}
                      className="terminal-text"
                      style={{
                        ...studioSelectStyle,
                        textAlign: "left",
                        color: extractOpts.characterSheets ? "var(--primary)" : "var(--text-secondary)",
                        textShadow: "none",
                        fontFamily: "inherit",
                      }}
                      aria-pressed={extractOpts.characterSheets}
                    >
                      {extractOpts.characterSheets ? "✓ Included" : "✗ Skipped"}
                    </button>
                  </label>
                </div>

                {buildExtractionOptions(extractOpts) && (
                  <button
                    onClick={() => setExtractOpts(DEFAULT_EXTRACT_OPTS)}
                    className="terminal-text"
                    style={{
                      marginTop: "16px", background: "transparent", border: "none",
                      color: "var(--text-secondary)", cursor: "pointer", padding: 0,
                      fontSize: "0.85rem", textDecoration: "underline",
                      textUnderlineOffset: "4px", textShadow: "none", fontFamily: "inherit",
                    }}
                  >
                    Reset to defaults
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {(status === "uploading" || status === "processing") && (
          <div className="cyber-panel animate-in" style={{ padding: "50px 36px", textAlign: "left", position: "relative", overflow: "hidden" }}>
            <div className="laser-scanner-line" />
            
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
              <div className="terminal-text" style={{ fontSize: "1.2rem", fontWeight: "700" }}>
                ⚡ Neural Vision Analysis in Progress...
              </div>
              <span className="badge" style={{ background: "rgba(255, 92, 0, 0.2)", color: "var(--primary-light)", borderColor: "var(--primary)" }}>
                {status === "uploading" ? "UPLOADING MEDIA" : "ANALYZING SHOTS"}
              </span>
            </div>

            <div style={{ background: "#050507", border: "1px solid rgba(255, 92, 0, 0.35)", borderRadius: "10px", padding: "24px", fontFamily: "'JetBrains Mono', monospace", color: "var(--primary)", minHeight: "220px", position: "relative", boxShadow: "inset 0 0 30px rgba(0,0,0,0.9)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", color: "#10B981" }}>
                <span>●</span> <span>[SYSTEM] Vision pipeline initialized</span>
              </div>
              <p style={{ margin: "0 0 10px 0", color: "#FFF" }}>
                &gt; Current Stage: <strong style={{ color: "var(--primary-light)" }}>{stepMessage || "Deconstructing video into keyframe sequences..."}</strong>
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", opacity: 0.8, fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "16px" }}>
                <div>[01/04] Detecting shot cuts, aspect ratio &amp; focal length...</div>
                <div>[02/04] Vision AI extracting cinematic prompt &amp; lighting cues...</div>
                <div>[03/04] Transcribing voiceover &amp; sound effect cues...</div>
                <div>[04/04] Building character sheet &amp; ComfyUI node graph...</div>
              </div>
              <div style={{ width: "10px", height: "18px", background: "var(--primary)", display: "inline-block", animation: "terminal-blink 1s infinite", verticalAlign: "middle", marginTop: "12px" }}></div>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="cyber-panel animate-in" style={{ padding: "80px 40px", borderColor: "var(--accent)", textAlign: "center", boxShadow: "inset 0 0 40px rgba(229, 9, 20, 0.2)" }}>
            <div className="terminal-text" style={{ fontSize: "3rem", marginBottom: "24px", color: "var(--accent)", textShadow: "0 0 10px var(--accent)" }}>⚠️ Error</div>
            <h3 style={{ color: "var(--accent)", marginBottom: "16px", fontSize: "1.8rem", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>Extraction Failed</h3>
            <p className="terminal-text" style={{ maxWidth: "600px", margin: "0 auto 32px", fontSize: "1rem", color: "var(--text-secondary)" }}>{error}</p>
            <button className="cyber-btn" style={{ border: "1px solid var(--accent)", color: "var(--accent)", boxShadow: "none" }} onClick={() => { setStatus("idle"); setFile(null); }}>
              Try Again
            </button>
          </div>
        )}

        {status === "completed" && result && (
          <div className="animate-in delay-1">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "40px", paddingBottom: "24px", borderBottom: "1px solid var(--primary)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <h2 className="terminal-text" style={{ fontSize: "2.2rem", margin: 0, textShadow: "none" }}>Extraction Results</h2>
                {saveStatus === "saving" && (
                  <span style={{ background: "transparent", color: "var(--warning)", border: "1px solid var(--warning)", padding: "4px 12px", fontSize: "0.8rem", borderRadius: "6px" }}>
                    Saving...
                  </span>
                )}
                {saveStatus === "saved" && (
                  <span style={{ background: "rgba(255,92,0,0.1)", color: "var(--primary)", border: "1px solid var(--primary)", padding: "4px 12px", fontSize: "0.8rem", borderRadius: "6px" }}>
                    ✓ Saved
                  </span>
                )}
                {saveStatus === "error" && (
                  <span style={{ background: "transparent", color: "var(--accent)", border: "1px solid var(--accent)", padding: "4px 12px", fontSize: "0.8rem", borderRadius: "6px" }}>
                    Save failed
                  </span>
                )}
              </div>
              <button className="cyber-btn" style={{ padding: "12px 24px" }} onClick={() => { setStatus("idle"); setFile(null); setSavedId(null); setIsPublished(false); setStudioSent(false); }}>Extract Another</button>
            </div>

            {/* ── Privacy ──
                Extractions save privately. This is the only thing that puts
                one in the public gallery, and it says so plainly, because the
                gallery is indexed by search engines. */}
            {savedId && (
              <div
                className="cyber-panel"
                style={{ marginBottom: "40px", padding: "24px 28px", display: "flex", gap: "20px", alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}
              >
                <div style={{ maxWidth: "560px" }}>
                  <h4 className="terminal-text" style={{ margin: "0 0 6px 0", fontSize: "1rem", color: "white", textShadow: "none" }}>
                    {isPublished ? "🌐 Listed in the public gallery" : "🔒 Private to your account"}
                  </h4>
                  <p className="terminal-text" style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5, textShadow: "none" }}>
                    {isPublished
                      ? "Anyone can view these prompts on the Prompts page, and search engines may index them."
                      : "Only you can see this extraction. Publish it to share the prompts on the Prompts page."}
                  </p>
                </div>
                <button
                  className="cyber-btn"
                  onClick={togglePublished}
                  disabled={publishBusy}
                  style={{
                    padding: "14px 28px", whiteSpace: "nowrap",
                    background: isPublished ? "#000" : "var(--primary)",
                    color: isPublished ? "var(--primary)" : "#000",
                    opacity: publishBusy ? 0.6 : 1,
                  }}
                  aria-pressed={isPublished}
                >
                  {publishBusy ? "..." : isPublished ? "Make Private" : "Publish to Gallery"}
                </button>
              </div>
            )}

            {/* --- Summary Card --- */}
            <div className="cyber-panel" style={{ marginBottom: "40px", padding: "32px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px" }}>
                <div className="terminal-text" style={{ fontSize: "1.5rem" }}>🎬 Video Concept & Style</div>
              </div>
              <p className="terminal-text" style={{ fontSize: "1.1rem", color: "var(--text-secondary)", lineHeight: "1.8", textShadow: "none" }}>{result.video_concept}</p>
            </div>

            {/* --- Teleprompter Voiceover --- */}
            {result.voiceover_text && (
              <div className="cyber-panel" style={{ marginBottom: "48px", position: "relative", padding: "0" }}>
                <div style={{ background: "#000", padding: "20px 32px", borderBottom: "1px solid var(--primary)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <h3 className="terminal-text" style={{ margin: 0, fontSize: "1.1rem", textShadow: "none" }}>🎙️ Voiceover Script</h3>
                  </div>
                  <button 
                    className="cyber-btn"
                    style={{ padding: "8px 16px", fontSize: "0.9rem" }}
                    onClick={(e) => {
                      navigator.clipboard.writeText(result.voiceover_text);
                      e.currentTarget.innerHTML = "✓ Copied!";
                      setTimeout(() => e.currentTarget.innerHTML = "Copy Script", 2000);
                    }}
                  >
                    Copy Script
                  </button>
                </div>
                <div style={{ padding: "40px" }}>
                  <p className="terminal-text" style={{ fontSize: "1.2rem", lineHeight: "2", color: "var(--text-primary)", whiteSpace: "pre-wrap", textShadow: "none" }}>
                    {result.voiceover_text}
                  </p>
                </div>
              </div>
            )}

            {/* --- Character Designs --- */}
            {result.character_sheets && (
              <div style={{ marginBottom: "64px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "24px" }}>
                  <h3 className="terminal-text" style={{ margin: 0, fontSize: "1.6rem", textShadow: "none" }}>👤 Character Designs</h3>
                </div>
                {result.character_sheets.length > 0 ? (
                  <div className="grid-2" style={{ gap: "24px" }}>
                    {result.character_sheets.map((char, i) => (
                      <div key={i} className="cyber-panel" style={{ padding: "32px", display: "flex", flexDirection: "column" }}>
                        <h4 className="terminal-text" style={{ fontSize: "1.2rem", marginBottom: "20px", display: "flex", alignItems: "center", gap: "8px", textShadow: "none" }}>
                          &gt; {char.character_name}
                        </h4>
                        <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
                          <div className="terminal-text" style={{ padding: "20px", flex: 1, fontSize: "0.95rem", background: "#000", border: "1px solid rgba(255, 92, 0,0.3)", color: "var(--text-secondary)", lineHeight: "1.7", textShadow: "none" }}>
                            {char.prompt}
                          </div>
                          <button 
                            className="cyber-btn"
                            style={{ position: "absolute", top: "12px", right: "12px", padding: "8px 12px", fontSize: "0.8rem", background: "#000" }}
                            onClick={(e) => {
                              navigator.clipboard.writeText(char.prompt);
                              e.currentTarget.innerText = "✓ Copied!";
                              setTimeout(() => e.currentTarget.innerText = "COPY", 2000);
                            }}
                          >
                            COPY
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="terminal-text" style={{ opacity: 0.5, padding: "20px", background: "rgba(255, 92, 0,0.05)", textShadow: "none" }}>No character data found in this video.</p>
                )}
              </div>
            )}

            {/* --- Scene Breakdown Timeline --- */}
            {result.shots && (
              <div style={{ marginBottom: "60px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "32px" }}>
                  <h3 className="terminal-text" style={{ margin: 0, fontSize: "1.6rem", textShadow: "none" }}>🎞️ Scene Breakdown</h3>
                </div>
                {result.shots.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "32px", position: "relative", paddingLeft: "16px" }}>
                    {/* Glowing vertical timeline line */}
                    <div style={{ position: "absolute", left: "40px", top: "24px", bottom: "24px", width: "1px", background: "var(--primary)", opacity: 0.5, zIndex: 0 }}></div>
                    
                    {result.shots.map((shot, i) => (
                      <div key={i} style={{ position: "relative", zIndex: 1, display: "flex", gap: "32px", width: "100%" }}>
                        {/* Timeline Node */}
                        <div className="terminal-text" style={{ width: "48px", height: "48px", background: "#000", border: "1px solid var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "1.2rem", flexShrink: 0, zIndex: 2 }}>
                          {shot.shot_id}
                        </div>
                        
                        {/* Shot Content Card */}
                        <div className="cyber-panel" style={{ flex: 1, padding: "32px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                            <h4 style={{ margin: 0, fontSize: "1.3rem", color: "white", fontWeight: 700 }}>Scene {shot.shot_id}</h4>
                            <span className="terminal-text" style={{ background: "rgba(255, 92, 0, 0.1)", border: "1px solid var(--primary)", padding: "6px 16px", textShadow: "none" }}>
                              {shot.time_range}
                            </span>
                          </div>
                          
                          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                            {/* Image Prompt */}
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                                <div style={{ width: "8px", height: "8px", background: "var(--primary)", animation: "terminal-blink 1.5s infinite" }}></div>
                                <span className="terminal-text" style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "1px", textShadow: "none" }}>Image Prompt</span>
                              </div>
                              <div style={{ position: "relative" }}>
                                <div className="terminal-text" style={{ padding: "20px 60px 20px 20px", background: "#000", border: "1px dashed rgba(255, 92, 0,0.4)", color: "var(--text-primary)", fontSize: "0.95rem", lineHeight: "1.6", textShadow: "none" }}>
                                  {shot.image_prompt}
                                </div>
                                <button 
                                  className="cyber-btn"
                                  style={{ position: "absolute", top: "12px", right: "12px", width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center", background: "#000", fontSize: "1.2rem", padding: 0 }}
                                  title="Copy Prompt"
                                  onClick={(e) => {
                                    navigator.clipboard.writeText(shot.image_prompt);
                                    e.currentTarget.innerHTML = "✓";
                                    setTimeout(() => e.currentTarget.innerHTML = "📋", 2000);
                                  }}
                                >
                                  📋
                                </button>
                              </div>
                            </div>

                            {/* Video Prompt */}
                            {shot.video_prompt && (
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                                  <div style={{ width: "8px", height: "8px", background: "var(--primary)" }}></div>
                                  <span className="terminal-text" style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "1px", textShadow: "none" }}>Video / Motion Prompt</span>
                                </div>
                                <div style={{ position: "relative" }}>
                                  <div className="terminal-text" style={{ padding: "20px 60px 20px 20px", background: "#000", border: "1px solid var(--primary)", color: "white", fontSize: "0.95rem", lineHeight: "1.6", textShadow: "none" }}>
                                    {shot.video_prompt}
                                  </div>
                                  <button 
                                    className="cyber-btn"
                                    style={{ position: "absolute", top: "12px", right: "12px", width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--primary)", color: "#000", fontSize: "1.2rem", padding: 0 }}
                                    title="Copy Prompt"
                                    onClick={(e) => {
                                      navigator.clipboard.writeText(shot.video_prompt);
                                      e.currentTarget.innerHTML = "✓";
                                      setTimeout(() => e.currentTarget.innerHTML = "📋", 2000);
                                    }}
                                  >
                                    📋
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="terminal-text" style={{ opacity: 0.5, padding: "20px", background: "rgba(255, 92, 0,0.05)", textShadow: "none" }}>No scene data found in this video.</p>
                )}
              </div>
            )}

            {/* --- Export for AutoFlow --- */}
            {result.shots && result.shots.length > 0 && (
              <div className="cyber-panel" style={{ marginTop: "60px", padding: "48px" }}>
                <div style={{ position: "relative", zIndex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "16px" }}>
                    <h3 style={{ margin: 0, fontSize: "1.8rem", color: "white", fontWeight: 700 }}>Export to AutoFlow</h3>
                  </div>
                  <p className="terminal-text" style={{ marginBottom: "40px", fontSize: "1.1rem", maxWidth: "600px", color: "var(--text-secondary)", textShadow: "none" }}>
                    Copy all prompts at once and batch-generate videos using the <a href="https://chromewebstore.google.com/detail/autoflow-video-task-man/egplmjhmcicjkojopeoaohofckgeoipc" target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: "4px" }}>AutoFlow Extension</a>.
                  </p>

                  <div className="grid-2" style={{ gap: "32px" }}>
                    <div style={{ padding: "24px", background: "#000", border: "1px solid rgba(255, 92, 0,0.3)" }}>
                      <h4 className="terminal-text" style={{ fontSize: "1.1rem", marginBottom: "8px", color: "white", textShadow: "none" }}>Image Prompts</h4>
                      <p className="terminal-text" style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "20px", textShadow: "none" }}>Copy all image prompts at once.</p>
                      <button 
                        className="cyber-btn"
                        style={{ width: "100%", padding: "16px", background: "#000", color: "white" }}
                        onClick={(e) => {
                          const prompts = result.shots.map(s => s.image_prompt).filter(Boolean).join("\n\n");
                          navigator.clipboard.writeText(prompts);
                          const originalHtml = e.currentTarget.innerHTML;
                          e.currentTarget.innerHTML = "✓ Copied!";
                          setTimeout(() => e.currentTarget.innerHTML = originalHtml, 2000);
                        }}
                      >
                        Copy All
                      </button>
                    </div>

                    <div style={{ padding: "24px", background: "#000", border: "1px solid var(--primary)" }}>
                      <h4 className="terminal-text" style={{ fontSize: "1.1rem", marginBottom: "8px", color: "white", textShadow: "none" }}>Video Prompts</h4>
                      <p className="terminal-text" style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "20px", textShadow: "none" }}>Copy all motion prompts at once.</p>
                      <button 
                        className="cyber-btn"
                        style={{ width: "100%", padding: "16px", background: "var(--primary)", color: "#000" }}
                        onClick={(e) => {
                          const prompts = result.shots.map(s => s.video_prompt).filter(Boolean).join("\n\n");
                          navigator.clipboard.writeText(prompts);
                          const originalHtml = e.currentTarget.innerHTML;
                          e.currentTarget.innerHTML = "✓ Copied!";
                          setTimeout(() => e.currentTarget.innerHTML = originalHtml, 2000);
                        }}
                      >
                        Copy All
                      </button>
                    </div>
                  </div>

                  {/* ── Send to Studio ──
                      A .json in Studio's own export format. Studio already
                      imports that shape, so this needs no extension update. */}
                  <div style={{ marginTop: "32px", padding: "28px", background: "#000", border: "1px solid var(--primary)" }}>
                    <h4 className="terminal-text" style={{ fontSize: "1.2rem", margin: "0 0 8px 0", color: "white", textShadow: "none" }}>
                      ⚡ Build an AutoFlow Studio Workflow
                    </h4>
                    <p className="terminal-text" style={{ fontSize: "0.9rem", color: "var(--text-secondary)", margin: "0 0 24px 0", textShadow: "none" }}>
                      Every shot becomes real nodes with its prompts already wired in — no copy-pasting, nothing left to rebuild by hand.
                    </p>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "16px", marginBottom: "24px" }}>
                      <label style={studioFieldStyle}>
                        <span style={studioLabelStyle}>Build</span>
                        <select
                          value={studioOpts.chain}
                          onChange={(e) => setStudioOpt("chain", e.target.value)}
                          style={studioSelectStyle}
                        >
                          <option value="image_to_video">Still → Clip</option>
                          <option value="images">Stills only</option>
                          <option value="videos">Clips only</option>
                        </select>
                      </label>

                      {studioBuildsImages && (
                        <label style={studioFieldStyle}>
                          <span style={studioLabelStyle}>Image model</span>
                          <select
                            value={studioOpts.imageModel}
                            onChange={(e) => setStudioOpt("imageModel", e.target.value)}
                            style={studioSelectStyle}
                          >
                            {STUDIO_OPTIONS.imageModels.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </label>
                      )}

                      {studioBuildsVideos && (
                        <label style={studioFieldStyle}>
                          <span style={studioLabelStyle}>Video model</span>
                          <select
                            value={studioOpts.videoModel}
                            onChange={(e) => setStudioOpt("videoModel", e.target.value)}
                            style={studioSelectStyle}
                          >
                            {STUDIO_OPTIONS.videoModels.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </label>
                      )}

                      <label style={studioFieldStyle}>
                        <span style={studioLabelStyle}>Aspect ratio</span>
                        <select
                          value={studioOpts.aspectRatio}
                          onChange={(e) => setStudioOpt("aspectRatio", e.target.value)}
                          style={studioSelectStyle}
                        >
                          {(studioBuildsImages ? STUDIO_OPTIONS.imageRatios : STUDIO_OPTIONS.videoRatios)
                            .map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </label>

                      {studioBuildsVideos && (
                        <label style={studioFieldStyle}>
                          <span style={studioLabelStyle}>Clip length</span>
                          <select
                            value={studioOpts.duration}
                            onChange={(e) => setStudioOpt("duration", e.target.value)}
                            style={studioSelectStyle}
                          >
                            {STUDIO_OPTIONS.durations.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </label>
                      )}

                      <label style={studioFieldStyle}>
                        <span style={studioLabelStyle}>Platform</span>
                        <select
                          value={studioOpts.platform}
                          onChange={(e) => setStudioOpt("platform", e.target.value)}
                          style={studioSelectStyle}
                        >
                          <option value="flow">Google Flow</option>
                          <option value="chatgpt">ChatGPT</option>
                        </select>
                      </label>
                    </div>

                    {studioBuildsVideos && !STUDIO_OPTIONS.videoRatios.includes(studioOpts.aspectRatio) && (
                      <p className="terminal-text" style={{ fontSize: "0.85rem", color: "var(--primary)", margin: "0 0 16px 0", textShadow: "none" }}>
                        Flow only offers {STUDIO_OPTIONS.videoRatios.join(", ")} for video — clips will use 9:16.
                      </p>
                    )}

                    <div style={{ display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
                      {/* Installed: hand the extraction over and let the
                          extension build it on the canvas. */}
                      {hasStudio === true && (
                        <button
                          className="cyber-btn"
                          style={{ padding: "16px 32px", background: "var(--primary)", color: "#000", fontWeight: 700 }}
                          disabled={
                            !studioPreview
                            || studioPreview.nodes.length === 0
                            || studioSend.state === "sending"
                          }
                          onClick={handleSendToStudio}
                        >
                          {studioSend.state === "sending" ? "Building…" : "⚡ Open in Studio"}
                        </button>
                      )}

                      {/* Still asking. Showing either of the other two here
                          would change shape under the cursor a moment later. */}
                      {hasStudio === null && (
                        <button
                          className="cyber-btn"
                          style={{ padding: "16px 32px", background: "var(--primary)", color: "#000", fontWeight: 700, opacity: 0.6 }}
                          disabled
                        >
                          Looking for Studio…
                        </button>
                      )}

                      {/* Not installed: installing is the offer, because it is
                          the one that ends in a canvas rather than a file. */}
                      {hasStudio === false && (
                        <a
                          className="cyber-btn"
                          href={STUDIO_STORE_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ padding: "16px 32px", background: "var(--primary)", color: "#000", fontWeight: 700, textDecoration: "none", display: "inline-block" }}
                        >
                          ⚡ Install AutoFlow Studio
                        </a>
                      )}

                      <span className="terminal-text" style={{ fontSize: "0.9rem", color: "var(--text-secondary)", textShadow: "none" }}>
                        {studioPreview?.nodes.length ?? 0} nodes · {studioGenCount} generation{studioGenCount === 1 ? "" : "s"}
                      </span>

                      {/* The file, always available and never the headline.
                          It uses this page's own builder, so it works with or
                          without the extension. */}
                      <button
                        onClick={() => {
                          downloadStudioWorkflow(
                            result,
                            studioOpts,
                            (result.video_name || "Extracted Workflow")
                          );
                          setStudioSent(true);
                        }}
                        disabled={!studioPreview || studioPreview.nodes.length === 0}
                        className="terminal-text"
                        style={{
                          background: "none", border: "none", padding: 0, cursor: "pointer",
                          fontSize: "0.85rem", color: "var(--text-secondary)",
                          textDecoration: "underline", textShadow: "none",
                        }}
                      >
                        or download the .json
                      </button>
                    </div>

                    {studioSend.state === "sent" && (
                      <p className="terminal-text" style={{ fontSize: "0.9rem", color: "var(--primary)", marginTop: "20px", marginBottom: 0, textShadow: "none" }}>
                        ✓ {studioSend.message}
                      </p>
                    )}

                    {studioSend.notes.length > 0 && (
                      <ul className="terminal-text" style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "12px 0 0 0", paddingLeft: "20px", textShadow: "none", lineHeight: 1.6 }}>
                        {studioSend.notes.map((note, i) => <li key={i}>{note}</li>)}
                      </ul>
                    )}

                    {studioSend.state === "error" && (
                      <p className="terminal-text" style={{ fontSize: "0.9rem", color: "#ff6b6b", marginTop: "20px", marginBottom: 0, textShadow: "none" }}>
                        {studioSend.message}
                      </p>
                    )}

                    {hasStudio === false && (
                      <p className="terminal-text" style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "16px", marginBottom: 0, textShadow: "none", lineHeight: 1.7 }}>
                        With AutoFlow Studio installed this becomes one click: every shot arrives
                        as a node with its prompts already wired in, on a canvas you can run.{" "}
                        <a
                          href={STUDIO_STORE_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: "4px" }}
                        >
                          Install it
                        </a>
                        , reload this page, and the button above sends straight to the canvas.
                      </p>
                    )}

                    {studioSent && (
                      <p className="terminal-text" style={{ fontSize: "0.9rem", color: "var(--primary)", marginTop: "20px", marginBottom: 0, textShadow: "none" }}>
                        ✓ Saved. In the extension open <strong>Studio → Import</strong> and pick the file.
                      </p>
                    )}
                  </div>

                  <div style={{ marginTop: "32px", padding: "20px 24px", background: "rgba(255, 92, 0,0.05)", borderLeft: "4px solid var(--primary)", display: "flex", gap: "16px", alignItems: "flex-start" }}>
                    <span className="terminal-text" style={{ fontSize: "1.5rem", lineHeight: 1 }}>!</span>
                    <div>
                      <h4 className="terminal-text" style={{ color: "var(--primary)", margin: "0 0 4px 0", fontSize: "1rem", textShadow: "none" }}>💡 Pro Tip</h4>
                      <p className="terminal-text" style={{ margin: 0, fontSize: "0.95rem", color: "rgba(255,255,255,0.8)", lineHeight: "1.5", textShadow: "none" }}>
                        For best results with AutoFlow's Auto Character Mapping, make sure your reference images match the character descriptions above.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Sticky Floating Action Bar */}
            <div
              className="glass-panel"
              style={{
                position: "sticky",
                bottom: "24px",
                margin: "40px auto 0",
                maxWidth: "780px",
                padding: "14px 24px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "16px",
                flexWrap: "wrap",
                zIndex: 90,
                border: "1px solid rgba(255, 92, 0, 0.4)",
                boxShadow: "0 20px 50px rgba(0,0,0,0.9), 0 0 30px rgba(255, 92, 0, 0.2)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "1.2rem" }}>⚡</span>
                <span style={{ fontSize: "0.9rem", fontWeight: "600", color: "#FFF" }}>
                  {result.shots?.length || 0} Shots Extracted
                </span>
              </div>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const allPrompts = result.shots?.map((s, i) => `Shot ${i+1}: ${s.prompt || s.visual_prompt || ''}`).join("\n\n");
                    navigator.clipboard?.writeText(allPrompts || "");
                    alert("All prompts copied to clipboard!");
                  }}
                  style={{ padding: "8px 16px", fontSize: "0.85rem" }}
                >
                  📋 Copy All Prompts
                </button>
                <a
                  href="/studio"
                  className="btn btn-primary"
                  style={{ padding: "8px 18px", fontSize: "0.85rem" }}
                >
                  ✨ Open in Studio Canvas →
                </a>
              </div>
            </div>
          </div>
        )}
        </div>

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
                { q: "Can I extract prompts from YouTube or TikTok videos?", a: "Yes! Switch to 'Paste URL' mode and enter any public video link. We support YouTube, TikTok, Instagram Reels, and X/Twitter videos. The video is downloaded temporarily on our servers for analysis and deleted immediately after." },
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
                { "@type": "Question", name: "Can I extract prompts from YouTube or TikTok videos?", acceptedAnswer: { "@type": "Answer", text: "Yes! Switch to Paste URL mode and enter any public video link from YouTube, TikTok, Instagram Reels, or X/Twitter." } },
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
