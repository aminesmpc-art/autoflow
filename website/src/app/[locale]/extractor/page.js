"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/navigation";

export default function ExtractorPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  
  const [file, setFile] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState("idle"); // idle, uploading, processing, completed, error
  const [stepMessage, setStepMessage] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [saveStatus, setSaveStatus] = useState("idle");

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

  const startAnalysis = async () => {
    if (!file) return;

    setStatus("uploading");
    setStepMessage("Checking plan limits...");
    setError(null);

    try {
      // Pre-flight limit check
      const limitRes = await fetch(`${DJANGO_API_URL}/extractions/check-limit/`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (limitRes.ok) {
        const limitData = await limitRes.json();
        if (!limitData.allowed) {
          throw new Error(`You have reached your limit of ${limitData.limit} extractions per ${limitData.period}. ${!limitData.is_pro ? "Upgrade to Pro to unlock 20 extractions per day!" : "Please try again tomorrow."}`);
        }
      }

      setStepMessage("Uploading video...");

      const formData = new FormData();
      formData.append("video", file);

      const response = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`
        },
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Upload failed");
      }

      const data = await response.json();
      setJobId(data.job_id);
      setStatus("processing");
      setStepMessage("Video analysis started. Polling for updates...");
    } catch (err) {
      setStatus("error");
      setError(err.message);
    }
  };

  // Poll for status
  useEffect(() => {
    let interval;
    if (status === "processing" && jobId) {
      interval = setInterval(async () => {
        try {
          const response = await fetch(`${API_URL}/status/${jobId}`, {
            headers: { "Authorization": `Bearer ${token}` }
          });
          const data = await response.json();
          
          if (data.status === "completed") {
            setStatus("completed");
            setResult(data.result);
            clearInterval(interval);
            
            // Auto-save to Django
            setSaveStatus("saving");
            try {
              const saveResponse = await fetch(`${DJANGO_API_URL}/extractions/`, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${token}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  video_name: file.name,
                  video_concept: data.result.video_concept || "",
                  voiceover_text: data.result.voiceover_text || "",
                  character_sheets: data.result.character_sheets || [],
                  shots: data.result.shots || []
                })
              });
              if (saveResponse.ok) {
                setSaveStatus("saved");
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

  if (loading) return <div className="container" style={{ minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center" }}>Loading...</div>;

  return (
    <div className="section" style={{ minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      {/* Absolute Ambient Backgrounds */}
      <div style={{ position: "absolute", top: "-10%", left: "50%", transform: "translateX(-50%)", width: "80vw", height: "80vw", background: "radial-gradient(circle, rgba(79, 70, 229, 0.08) 0%, rgba(0,0,0,0) 70%)", zIndex: -1, pointerEvents: "none" }} />
      
      <div className="container" style={{ position: "relative", zIndex: 1 }}>
        {/* --- Hero Section --- */}
        <div style={{ padding: "120px 0 60px", textAlign: "center" }}>
          <div className="animate-in" style={{ animationDelay: "0.1s" }}>
            <span className="badge" style={{ background: "rgba(79, 70, 229, 0.1)", color: "var(--primary-light)", border: "1px solid rgba(79, 70, 229, 0.3)", padding: "6px 16px", borderRadius: "100px", fontSize: "0.85rem", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "24px", display: "inline-block", boxShadow: "0 0 20px rgba(79, 70, 229, 0.2)" }}>Pro Max Tool</span>
            <h1 style={{ fontSize: "clamp(3rem, 5vw, 4.5rem)", letterSpacing: "-0.04em", marginBottom: "24px", background: "linear-gradient(135deg, #FFF 0%, #A1A1AA 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Video Prompt <span className="text-gradient">Extractor</span>
            </h1>
            <p className="text-secondary" style={{ fontSize: "1.2rem", maxWidth: "650px", margin: "0 auto", lineHeight: "1.6" }}>
              Upload any viral AI video to perfectly reverse-engineer its prompts, lighting, and character designs.
            </p>
          </div>
        </div>

        <div style={{ maxWidth: "860px", margin: "0 auto" }}>
          {/* --- Upload Zone or Auth CTA --- */}
          {status === "idle" && (
            user ? (
              <div 
                className="card-glass animate-in delay-1"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                style={{ 
                  textAlign: "center",
                  cursor: "pointer",
                  padding: "100px 40px",
                  border: "2px dashed rgba(79, 70, 229, 0.4)",
                  background: "linear-gradient(180deg, rgba(79, 70, 229, 0.03) 0%, rgba(0,0,0,0.5) 100%)",
                  backdropFilter: "blur(20px)",
                  borderRadius: "32px",
                  transition: "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                  position: "relative",
                  overflow: "hidden",
                  boxShadow: "0 20px 40px rgba(0,0,0,0.4)"
                }}
                onClick={() => document.getElementById("file-upload").click()}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--primary-light)";
                  e.currentTarget.style.boxShadow = "0 0 60px rgba(79, 70, 229, 0.3), inset 0 0 30px rgba(79, 70, 229, 0.1)";
                  e.currentTarget.style.transform = "translateY(-4px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(79, 70, 229, 0.4)";
                  e.currentTarget.style.boxShadow = "0 20px 40px rgba(0,0,0,0.4)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <div className="cta-glow" style={{ opacity: 0.5 }}></div>
                <input 
                  id="file-upload" 
                  type="file" 
                  accept="video/mp4,video/quicktime,video/webm" 
                  style={{ display: "none" }} 
                  onChange={handleFileSelect}
                />
                {file ? (
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <div style={{ fontSize: "4rem", marginBottom: "20px", filter: "drop-shadow(0 0 30px rgba(79, 70, 229, 0.6))" }}>🎥</div>
                    <h3 style={{ marginBottom: "8px", fontSize: "1.8rem" }}>{file.name}</h3>
                    <p className="text-secondary" style={{ marginBottom: "32px" }}>{(file.size / (1024 * 1024)).toFixed(2)} MB • Ready to reverse-engineer</p>
                    <button 
                      className="btn btn-primary btn-lg" 
                      onClick={(e) => { e.stopPropagation(); startAnalysis(); }}
                      style={{ fontSize: "1.2rem", padding: "16px 40px", borderRadius: "100px", boxShadow: "0 10px 30px rgba(79, 70, 229, 0.4)" }}
                    >
                      Extract Prompts Now ⚡
                    </button>
                  </div>
                ) : (
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <div style={{ width: "100px", height: "100px", margin: "0 auto 24px", background: "rgba(79, 70, 229, 0.1)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(79, 70, 229, 0.2)", filter: "drop-shadow(0 0 20px rgba(79, 70, 229, 0.4))" }}>
                      <span style={{ fontSize: "3rem" }}>📥</span>
                    </div>
                    <h3 style={{ fontSize: "2rem", marginBottom: "12px", letterSpacing: "-0.02em" }}>Drag & Drop Video Here</h3>
                    <p className="text-secondary" style={{ fontSize: "1.1rem" }}>or click to browse your computer (Max 500MB)</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="card-glass animate-in delay-1" style={{ padding: "80px 40px", borderRadius: "32px", textAlign: "center", background: "linear-gradient(180deg, rgba(79, 70, 229, 0.05) 0%, rgba(0,0,0,0.5) 100%)", border: "1px solid rgba(79, 70, 229, 0.3)" }}>
                <div style={{ width: "80px", height: "80px", margin: "0 auto 24px", background: "rgba(79, 70, 229, 0.1)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(79, 70, 229, 0.2)" }}>
                  <span style={{ fontSize: "2.5rem" }}>🔒</span>
                </div>
                <h3 style={{ marginBottom: "16px", fontSize: "2rem" }}>Login to Extract Prompts</h3>
                <p className="text-secondary" style={{ maxWidth: "500px", margin: "0 auto 32px", fontSize: "1.1rem" }}>Create a free account to reverse-engineer viral AI videos and get exact Midjourney and Runway prompts.</p>
                <div style={{ display: "flex", gap: "16px", justifyContent: "center" }}>
                  <a href="/login" className="btn btn-primary btn-lg" style={{ borderRadius: "100px", padding: "16px 40px", fontSize: "1.1rem" }}>Login to AutoFlow</a>
                  <a href="/register" className="btn btn-secondary btn-lg" style={{ borderRadius: "100px", padding: "16px 40px", fontSize: "1.1rem" }}>Create Free Account</a>
                </div>
              </div>
            )
          )}

        {(status === "uploading" || status === "processing") && (
          <div className="card-glass animate-in" style={{ textAlign: "center", padding: "100px 40px", borderRadius: "32px", position: "relative", overflow: "hidden", background: "linear-gradient(180deg, rgba(10, 10, 10, 0.8) 0%, rgba(3, 3, 3, 0.9) 100%)", border: "1px solid var(--border)" }}>
            <div className="cta-glow" style={{ animation: "pulse-glow 3s infinite", background: "radial-gradient(circle, rgba(6, 182, 212, 0.3) 0%, transparent 70%)" }}></div>
            <div style={{ position: "relative", zIndex: 1, maxWidth: "400px", margin: "0 auto" }}>
              <div style={{ position: "relative", width: "80px", height: "80px", margin: "0 auto 32px" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, border: "3px solid rgba(79, 70, 229, 0.1)", borderRadius: "50%" }}></div>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, border: "3px solid transparent", borderTopColor: "var(--accent)", borderRightColor: "var(--primary)", borderRadius: "50%", animation: "spin 1.5s linear infinite" }}></div>
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", fontSize: "1.8rem" }}>🔮</div>
              </div>
              <h3 style={{ fontSize: "1.6rem", marginBottom: "12px", color: "white" }}>{stepMessage}</h3>
              <p className="text-secondary" style={{ fontSize: "1rem" }}>Gemini 1.5 Pro is currently analyzing every frame of your video.</p>
              
              {/* Fake Skeleton Progress */}
              <div style={{ marginTop: "40px", height: "6px", background: "rgba(255,255,255,0.05)", borderRadius: "10px", overflow: "hidden", position: "relative" }}>
                <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: "40%", background: "var(--gradient-primary)", borderRadius: "10px", animation: "loading-bar 4s ease-in-out infinite" }}></div>
              </div>
            </div>
            <style>{`
              @keyframes spin { 100% { transform: rotate(360deg); } }
              @keyframes loading-bar { 0% { left: -40%; width: 40%; } 50% { width: 80%; } 100% { left: 100%; width: 40%; } }
            `}</style>
          </div>
        )}

        {status === "error" && (
          <div className="card-glass animate-in" style={{ padding: "80px 40px", borderRadius: "32px", borderColor: "rgba(245, 158, 11, 0.3)", textAlign: "center", background: "linear-gradient(180deg, rgba(245, 158, 11, 0.05) 0%, rgba(0,0,0,0.5) 100%)" }}>
            <div style={{ width: "80px", height: "80px", margin: "0 auto 24px", background: "rgba(245, 158, 11, 0.1)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(245, 158, 11, 0.2)" }}>
              <span style={{ fontSize: "2.5rem" }}>⚠️</span>
            </div>
            <h3 style={{ color: "var(--warning)", marginBottom: "16px", fontSize: "1.8rem" }}>Extraction Failed</h3>
            <p className="text-secondary" style={{ maxWidth: "500px", margin: "0 auto 32px", fontSize: "1.1rem" }}>{error}</p>
            <button className="btn btn-secondary btn-lg" style={{ borderRadius: "100px" }} onClick={() => { setStatus("idle"); setFile(null); }}>
              Try Another Video
            </button>
          </div>
        )}

        {status === "completed" && result && (
          <div className="animate-in delay-1">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "40px", paddingBottom: "24px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <h2 style={{ fontSize: "2.2rem", margin: 0 }}>Extraction <span className="text-gradient">Results</span></h2>
                {saveStatus === "saving" && (
                  <span className="badge" style={{ background: "rgba(245, 158, 11, 0.1)", color: "var(--warning)", border: "1px solid rgba(245, 158, 11, 0.2)", borderRadius: "100px", padding: "4px 12px", fontSize: "0.8rem" }}>
                    ⏳ Saving to Dashboard...
                  </span>
                )}
                {saveStatus === "saved" && (
                  <span className="badge" style={{ background: "rgba(16, 185, 129, 0.1)", color: "var(--success)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: "100px", padding: "4px 12px", fontSize: "0.8rem" }}>
                    ✓ Auto-saved to Dashboard
                  </span>
                )}
                {saveStatus === "error" && (
                  <span className="badge" style={{ background: "rgba(239, 68, 68, 0.1)", color: "#ef4444", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "100px", padding: "4px 12px", fontSize: "0.8rem" }}>
                    ⚠️ Failed to auto-save
                  </span>
                )}
              </div>
              <button className="btn btn-secondary" style={{ borderRadius: "100px" }} onClick={() => { setStatus("idle"); setFile(null); }}>Extract Another</button>
            </div>

            {/* --- Summary Card --- */}
            <div className="card-glass" style={{ marginBottom: "40px", padding: "32px", borderRadius: "24px", background: "linear-gradient(145deg, rgba(10,10,10,0.9) 0%, rgba(3,3,3,1) 100%)", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px" }}>
                <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem" }}>🎬</div>
                <h3 style={{ margin: 0, fontSize: "1.4rem" }}>Video Concept & Style</h3>
              </div>
              <p style={{ fontSize: "1.1rem", color: "var(--text-secondary)", lineHeight: "1.8" }}>{result.video_concept}</p>
            </div>

            {/* --- Teleprompter Voiceover --- */}
            {result.voiceover_text && (
              <div className="card" style={{ marginBottom: "48px", position: "relative", padding: "0", overflow: "hidden", borderRadius: "24px", border: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ background: "rgba(0,0,0,0.8)", padding: "20px 32px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "1.2rem" }}>🎙️</span>
                    <h3 style={{ margin: 0, fontSize: "1.1rem", textTransform: "uppercase", letterSpacing: "1px", color: "var(--text-muted)" }}>Voiceover Script</h3>
                  </div>
                  <button 
                    style={{ background: "transparent", border: "none", color: "var(--primary-light)", cursor: "pointer", fontSize: "0.9rem", display: "flex", gap: "8px", alignItems: "center" }}
                    onClick={(e) => {
                      navigator.clipboard.writeText(result.voiceover_text);
                      e.currentTarget.innerHTML = "<span>✓ Copied</span>";
                      setTimeout(() => e.currentTarget.innerHTML = "<span>📋 Copy Script</span>", 2000);
                    }}
                  >
                    <span>📋 Copy Script</span>
                  </button>
                </div>
                <div style={{ padding: "40px", background: "#0a0a0a" }}>
                  <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "1.2rem", lineHeight: "2", color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>
                    {result.voiceover_text}
                  </p>
                </div>
              </div>
            )}

            {/* --- Character Designs --- */}
            {result.character_sheets && (
              <div style={{ marginBottom: "64px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "24px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "rgba(79, 70, 229, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", border: "1px solid rgba(79, 70, 229, 0.2)" }}>👤</div>
                  <h3 style={{ margin: 0, fontSize: "1.6rem" }}>Character Designs</h3>
                </div>
                {result.character_sheets.length > 0 ? (
                  <div className="grid-2" style={{ gap: "24px" }}>
                    {result.character_sheets.map((char, i) => (
                      <div key={i} className="card-glass" style={{ padding: "32px", display: "flex", flexDirection: "column", borderRadius: "24px" }}>
                        <h4 style={{ fontSize: "1.2rem", marginBottom: "20px", color: "white", display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--primary-light)", boxShadow: "0 0 10px var(--primary)" }}></span>
                          {char.character_name}
                        </h4>
                        <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
                          <div style={{ padding: "20px", flex: 1, fontSize: "0.95rem", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "12px", color: "var(--text-secondary)", lineHeight: "1.7" }}>
                            {char.prompt}
                          </div>
                          <button 
                            style={{ position: "absolute", top: "12px", right: "12px", padding: "8px 12px", fontSize: "0.8rem", background: "rgba(255,255,255,0.1)", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", transition: "all 0.2s" }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "var(--primary)"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                            onClick={(e) => {
                              navigator.clipboard.writeText(char.prompt);
                              e.currentTarget.innerText = "✓ Copied";
                              setTimeout(() => e.currentTarget.innerText = "Copy", 2000);
                            }}
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-secondary" style={{ fontStyle: "italic", padding: "20px", background: "rgba(255,255,255,0.02)", borderRadius: "12px" }}>No characters detected in this video by the AI.</p>
                )}
              </div>
            )}

            {/* --- Scene Breakdown Timeline --- */}
            {result.shots && (
              <div style={{ marginBottom: "60px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "32px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "rgba(6, 182, 212, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", border: "1px solid rgba(6, 182, 212, 0.2)" }}>🎞️</div>
                  <h3 style={{ margin: 0, fontSize: "1.6rem" }}>Scene Breakdown Timeline</h3>
                </div>
                {result.shots.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "32px", position: "relative", paddingLeft: "16px" }}>
                    {/* Glowing vertical timeline line */}
                    <div style={{ position: "absolute", left: "40px", top: "24px", bottom: "24px", width: "2px", background: "linear-gradient(to bottom, var(--primary) 0%, var(--accent) 100%)", opacity: 0.3, zIndex: 0 }}></div>
                    
                    {result.shots.map((shot, i) => (
                      <div key={i} style={{ position: "relative", zIndex: 1, display: "flex", gap: "32px", width: "100%" }}>
                        {/* Timeline Node */}
                        <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#050505", border: "2px solid var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "1.2rem", flexShrink: 0, zIndex: 2, boxShadow: "0 0 20px rgba(79, 70, 229, 0.3)" }}>
                          {shot.shot_id}
                        </div>
                        
                        {/* Shot Content Card */}
                        <div className="card-glass" style={{ flex: 1, padding: "32px", borderRadius: "24px", background: "rgba(10,10,10,0.6)", border: "1px solid rgba(255,255,255,0.05)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                            <h4 style={{ margin: 0, fontSize: "1.3rem", color: "white" }}>Shot {shot.shot_id}</h4>
                            <span className="badge" style={{ background: "rgba(6, 182, 212, 0.1)", color: "var(--accent-light)", border: "1px solid rgba(6, 182, 212, 0.2)", borderRadius: "100px", padding: "6px 16px" }}>
                              ⏱️ {shot.time_range}
                            </span>
                          </div>
                          
                          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                            {/* Image Prompt */}
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                                <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)" }}></div>
                                <span style={{ fontSize: "0.85rem", textTransform: "uppercase", color: "var(--text-secondary)", letterSpacing: "1px", fontWeight: "600" }}>Image Prompt (Midjourney)</span>
                              </div>
                              <div style={{ position: "relative" }}>
                                <div style={{ padding: "20px 60px 20px 20px", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "12px", color: "var(--text-primary)", fontSize: "0.95rem", lineHeight: "1.6" }}>
                                  {shot.image_prompt}
                                </div>
                                <button 
                                  style={{ position: "absolute", top: "12px", right: "12px", width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.1)", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", transition: "all 0.2s" }}
                                  title="Copy Prompt"
                                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--primary)"}
                                  onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
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
                                  <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--primary-light)" }}></div>
                                  <span style={{ fontSize: "0.85rem", textTransform: "uppercase", color: "var(--primary-light)", letterSpacing: "1px", fontWeight: "600" }}>Motion Prompt (Runway/Sora)</span>
                                </div>
                                <div style={{ position: "relative" }}>
                                  <div style={{ padding: "20px 60px 20px 20px", background: "rgba(79, 70, 229, 0.05)", border: "1px solid rgba(79, 70, 229, 0.2)", borderRadius: "12px", color: "white", fontSize: "0.95rem", lineHeight: "1.6" }}>
                                    {shot.video_prompt}
                                  </div>
                                  <button 
                                    style={{ position: "absolute", top: "12px", right: "12px", width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(79, 70, 229, 0.2)", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", transition: "all 0.2s" }}
                                    title="Copy Prompt"
                                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--primary)"}
                                    onMouseLeave={(e) => e.currentTarget.style.background = "rgba(79, 70, 229, 0.2)"}
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
                  <p className="text-secondary" style={{ fontStyle: "italic", padding: "20px", background: "rgba(255,255,255,0.02)", borderRadius: "12px" }}>No shots detected in this video by the AI.</p>
                )}
              </div>
            )}

            {/* --- Export for AutoFlow --- */}
            {result.shots && result.shots.length > 0 && (
              <div style={{ marginTop: "60px", padding: "48px", borderRadius: "32px", border: "1px solid rgba(22, 163, 74, 0.3)", background: "linear-gradient(145deg, rgba(22, 163, 74, 0.05) 0%, rgba(0,0,0,0.8) 100%)", position: "relative", overflow: "hidden" }}>
                {/* Background glow for integration panel */}
                <div style={{ position: "absolute", top: 0, right: 0, width: "300px", height: "300px", background: "radial-gradient(circle, rgba(22, 163, 74, 0.1) 0%, transparent 70%)", pointerEvents: "none" }}></div>
                
                <div style={{ position: "relative", zIndex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "16px" }}>
                    <div style={{ width: "56px", height: "56px", borderRadius: "16px", background: "rgba(22, 163, 74, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.8rem", border: "1px solid rgba(22, 163, 74, 0.2)", boxShadow: "0 0 20px rgba(22, 163, 74, 0.2)" }}>🚀</div>
                    <h3 style={{ margin: 0, fontSize: "1.8rem", color: "white" }}>Export for <span style={{ color: "#4ade80" }}>AutoFlow Extension</span></h3>
                  </div>
                  <p className="text-secondary" style={{ marginBottom: "40px", fontSize: "1.1rem", maxWidth: "600px" }}>
                    Skip the manual copy-pasting. Batch generate these exact scenes simultaneously using the <a href="https://chromewebstore.google.com/detail/autoflow-video-task-man/egplmjhmcicjkojopeoaohofckgeoipc" target="_blank" rel="noopener noreferrer" style={{ color: "#4ade80", textDecoration: "underline", textUnderlineOffset: "4px" }}>AutoFlow Chrome Extension</a>.
                  </p>

                  <div className="grid-2" style={{ gap: "32px" }}>
                    <div style={{ padding: "24px", background: "rgba(0,0,0,0.4)", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <h4 style={{ fontSize: "1.1rem", marginBottom: "8px", color: "white" }}>1. Image Prompts</h4>
                      <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "20px" }}>Generates the Midjourney style references.</p>
                      <button 
                        style={{ width: "100%", padding: "16px", borderRadius: "12px", background: "white", color: "black", fontWeight: "600", fontSize: "1.05rem", border: "none", cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center", gap: "8px", transition: "transform 0.2s" }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
                        onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
                        onClick={(e) => {
                          const prompts = result.shots.map(s => s.image_prompt).filter(Boolean).join("\n\n");
                          navigator.clipboard.writeText(prompts);
                          const originalHtml = e.currentTarget.innerHTML;
                          e.currentTarget.innerHTML = "<span>✓ Copied All Image Prompts!</span>";
                          setTimeout(() => e.currentTarget.innerHTML = originalHtml, 2000);
                        }}
                      >
                        <span>📋 Copy Image Prompts</span>
                      </button>
                    </div>

                    <div style={{ padding: "24px", background: "rgba(0,0,0,0.4)", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <h4 style={{ fontSize: "1.1rem", marginBottom: "8px", color: "white" }}>2. Video Prompts</h4>
                      <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "20px" }}>Generates the Runway/Sora motion generation.</p>
                      <button 
                        style={{ width: "100%", padding: "16px", borderRadius: "12px", background: "linear-gradient(135deg, #16a34a 0%, #22c55e 100%)", color: "white", fontWeight: "600", fontSize: "1.05rem", border: "none", cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center", gap: "8px", transition: "transform 0.2s", boxShadow: "0 10px 20px rgba(22, 163, 74, 0.2)" }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
                        onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
                        onClick={(e) => {
                          const prompts = result.shots.map(s => s.video_prompt).filter(Boolean).join("\n\n");
                          navigator.clipboard.writeText(prompts);
                          const originalHtml = e.currentTarget.innerHTML;
                          e.currentTarget.innerHTML = "<span>✓ Copied All Video Prompts!</span>";
                          setTimeout(() => e.currentTarget.innerHTML = originalHtml, 2000);
                        }}
                      >
                        <span>📋 Copy Video Prompts</span>
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: "32px", padding: "20px 24px", background: "rgba(245, 158, 11, 0.05)", borderLeft: "4px solid var(--warning)", borderRadius: "0 12px 12px 0", display: "flex", gap: "16px", alignItems: "flex-start" }}>
                    <span style={{ fontSize: "1.5rem", lineHeight: 1 }}>💡</span>
                    <div>
                      <h4 style={{ color: "var(--warning)", margin: "0 0 4px 0", fontSize: "1rem" }}>Auto Character Mapping Pro-Tip</h4>
                      <p style={{ margin: 0, fontSize: "0.95rem", color: "rgba(255,255,255,0.8)", lineHeight: "1.5" }}>
                        Want to use the <em>Auto Character Mapping</em> feature in the extension? Ensure that your generated reference images are named <strong>exactly</strong> the same as the character names in your prompts before clicking the Map button!
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        </div>

        {/* --- SEO Section --- */}
        {status === "idle" && (
          <div style={{ marginTop: "160px", marginBottom: "80px", position: "relative" }}>
            {/* Top border with gradient glow */}
            <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: "100%", height: "1px", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)" }}></div>
            
            <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "60px", paddingTop: "80px", textAlign: "left" }}>
              <div>
                <h2 style={{ fontSize: "2.2rem", marginBottom: "24px", letterSpacing: "-0.02em" }}>Reverse-Engineer Any <span className="text-gradient">AI Video</span></h2>
                <p className="text-secondary" style={{ fontSize: "1.1rem", lineHeight: 1.8 }}>
                  Ever wondered how a stunning AI-generated video was made? Our <strong>Video Prompt Extractor</strong> is the ultimate reverse-engineering tool for AI filmmakers and prompt engineers. Simply upload any MP4 or WebM video generated by tools like <strong>Runway Gen-3, OpenAI Sora, Kling AI, Luma Dream Machine, or Pika Labs</strong>, and our advanced vision models will deconstruct it frame-by-frame.
                </p>
              </div>
              <div className="card-glass" style={{ padding: "40px", borderRadius: "24px", background: "rgba(10,10,10,0.5)" }}>
                <h3 style={{ fontSize: "1.4rem", margin: "0 0 24px 0", color: "white" }}>What our Extractor Reveals:</h3>
                <ul style={{ gap: "20px", listStyle: "none", display: "flex", flexDirection: "column", padding: 0 }}>
                  <li style={{ display: "flex", gap: "16px", alignItems: "flex-start", color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--primary-light)", fontSize: "1.2rem", background: "rgba(79,70,229,0.1)", padding: "4px 8px", borderRadius: "8px" }}>✦</span> 
                    <div>
                      <strong style={{ color: "white", display: "block", marginBottom: "4px" }}>Exact Midjourney Image Prompts</strong>
                      Get the precise text-to-image prompts needed to generate the source frames.
                    </div>
                  </li>
                  <li style={{ display: "flex", gap: "16px", alignItems: "flex-start", color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--primary-light)", fontSize: "1.2rem", background: "rgba(79,70,229,0.1)", padding: "4px 8px", borderRadius: "8px" }}>✦</span> 
                    <div>
                      <strong style={{ color: "white", display: "block", marginBottom: "4px" }}>Motion & Camera Prompts</strong>
                      Uncover the specific camera movements (pan, tilt, zoom) and motion descriptors.
                    </div>
                  </li>
                  <li style={{ display: "flex", gap: "16px", alignItems: "flex-start", color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--primary-light)", fontSize: "1.2rem", background: "rgba(79,70,229,0.1)", padding: "4px 8px", borderRadius: "8px" }}>✦</span> 
                    <div>
                      <strong style={{ color: "white", display: "block", marginBottom: "4px" }}>Character Design Sheets</strong>
                      Automatically extract consistent character descriptions and lighting setups.
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
