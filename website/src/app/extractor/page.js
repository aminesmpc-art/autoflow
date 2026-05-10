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

  const API_URL = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL || "http://127.0.0.1:8000/api/videos";

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

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
    setStepMessage("Uploading video...");
    setError(null);

    const formData = new FormData();
    formData.append("video", file);

    try {
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
          } else if (data.status === "failed") {
            setStatus("error");
            setError(data.error || "Analysis failed");
            clearInterval(interval);
          } else {
            setStepMessage(data.step || "Processing...");
          }
        } catch (err) {
          // ignore network errors during polling, maybe it will recover
          console.error("Polling error:", err);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [status, jobId, token, API_URL]);


  if (loading || !user) return <div className="container" style={{ minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center" }}>Loading...</div>;

  return (
    <div className="section" style={{ minHeight: "80vh" }}>
      <div className="container">
        {/* --- Hero Section --- */}
        <div className="hero" style={{ padding: "140px 0 60px" }}>
          <div className="hero-bg-glow"></div>
          <div className="hero-content">
            <span className="badge hero-badge">PRO TOOL</span>
            <h1 className="text-gradient">Video Prompt Extractor</h1>
            <p className="hero-subtitle" style={{ marginBottom: 0 }}>
              Upload any AI video to reverse-engineer its prompts, lighting, and character designs.
            </p>
          </div>
        </div>

        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          {/* --- Upload Zone --- */}
          {status === "idle" && (
            <div 
              className="card-glass animate-in delay-1"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              style={{ 
                textAlign: "center",
                cursor: "pointer",
                padding: "80px 40px",
                border: "2px dashed var(--border)",
                transition: "all 0.3s ease",
                position: "relative",
                overflow: "hidden"
              }}
              onClick={() => document.getElementById("file-upload").click()}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--primary-light)";
                e.currentTarget.style.boxShadow = "var(--shadow-glow)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <div className="cta-glow"></div>
              <input 
                id="file-upload" 
                type="file" 
                accept="video/mp4,video/quicktime,video/webm" 
                style={{ display: "none" }} 
                onChange={handleFileSelect}
              />
              {file ? (
                <div style={{ position: "relative", zIndex: 1 }}>
                  <div style={{ fontSize: "3rem", marginBottom: "16px" }}>🎥</div>
                  <h3 style={{ marginBottom: "24px" }}>{file.name}</h3>
                  <button className="btn btn-primary btn-lg" onClick={(e) => { e.stopPropagation(); startAnalysis(); }}>
                    Extract Prompts Now ⚡
                  </button>
                </div>
              ) : (
                <div style={{ position: "relative", zIndex: 1 }}>
                  <div style={{ fontSize: "3.5rem", marginBottom: "16px", filter: "drop-shadow(0 0 20px rgba(79, 70, 229, 0.4))" }}>📥</div>
                  <h3 style={{ fontSize: "1.8rem", marginBottom: "8px" }}>Drag & Drop Video Here</h3>
                  <p className="text-secondary">or click to browse your computer (Max 500MB)</p>
                </div>
              )}
            </div>
          )}

        {(status === "uploading" || status === "processing") && (
          <div className="card-glass animate-in" style={{ textAlign: "center", padding: "80px 40px", position: "relative", overflow: "hidden" }}>
            <div className="cta-glow" style={{ animation: "pulse-glow 3s infinite" }}></div>
            <div style={{ position: "relative", zIndex: 1 }}>
              <div style={{ fontSize: "3.5rem", marginBottom: "24px", animation: "spin 3s linear infinite", display: "inline-block", filter: "drop-shadow(0 0 20px rgba(79, 70, 229, 0.4))" }}>⚙️</div>
              <h3 style={{ fontSize: "1.5rem", marginBottom: "8px" }}>{stepMessage}</h3>
              <p className="text-secondary">Please don't close this window.</p>
            </div>
            <style>{`
              @keyframes spin { 100% { transform: rotate(360deg); } }
            `}</style>
          </div>
        )}

        {status === "error" && (
          <div className="card-glass animate-in" style={{ padding: "60px 40px", borderColor: "var(--warning)", textAlign: "center", background: "rgba(245, 158, 11, 0.05)" }}>
            <div style={{ fontSize: "3.5rem", marginBottom: "16px" }}>⚠️</div>
            <h3 style={{ color: "var(--warning)", marginBottom: "16px", fontSize: "1.5rem" }}>Extraction Failed</h3>
            <p className="text-secondary" style={{ maxWidth: "500px", margin: "0 auto 32px" }}>{error}</p>
            <button className="btn btn-secondary btn-lg" onClick={() => { setStatus("idle"); setFile(null); }}>
              Try Another Video
            </button>
          </div>
        )}

        {status === "completed" && result && (
          <div className="animate-in delay-1">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "40px", paddingBottom: "24px", borderBottom: "1px solid var(--border)" }}>
              <h2>Extraction Results</h2>
              <button className="btn btn-secondary" onClick={() => { setStatus("idle"); setFile(null); }}>Extract Another Video</button>
            </div>

            <div className="card" style={{ marginBottom: "32px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                <span style={{ fontSize: "1.5rem" }}>🎬</span>
                <h3 style={{ margin: 0 }}>Video Concept & Style</h3>
              </div>
              <p className="text-secondary" style={{ fontSize: "1.05rem" }}>{result.video_concept}</p>
            </div>

            {result.voiceover_text && (
              <div className="card-glass" style={{ marginBottom: "48px", position: "relative" }}>
                <span style={{ position: "absolute", top: "-20px", left: "24px", fontSize: "4rem", color: "var(--primary)", opacity: 0.2, fontFamily: "serif", lineHeight: 1 }}>"</span>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", position: "relative", zIndex: 1 }}>
                  <span style={{ fontSize: "1.5rem" }}>🎙️</span>
                  <h3 style={{ margin: 0 }}>Voiceover Script</h3>
                </div>
                <p style={{ fontStyle: "italic", fontSize: "1.1rem", lineHeight: "1.8", color: "var(--text-primary)", position: "relative", zIndex: 1, paddingLeft: "16px", borderLeft: "4px solid var(--primary-light)" }}>
                  {result.voiceover_text}
                </p>
              </div>
            )}

            {result.character_sheets && result.character_sheets.length > 0 && (
              <div style={{ marginBottom: "64px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
                  <span style={{ fontSize: "1.5rem" }}>👤</span>
                  <h3 style={{ margin: 0 }}>Character Designs</h3>
                </div>
                <div className="grid-2">
                  {result.character_sheets.map((char, i) => (
                    <div key={i} className="card" style={{ padding: "24px", display: "flex", flexDirection: "column" }}>
                      <h4 style={{ fontSize: "1.1rem", marginBottom: "16px", color: "var(--primary-light)" }}>{char.character_name}</h4>
                      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
                        <code className="blog-code" style={{ padding: "16px", paddingRight: "48px", flex: 1, fontSize: "0.85rem", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
                          {char.prompt}
                        </code>
                        <button 
                          className="blog-code-copy" 
                          style={{ top: "8px", right: "8px", padding: "4px 8px", fontSize: "0.75rem" }}
                          onClick={(e) => {
                            navigator.clipboard.writeText(char.prompt);
                            e.target.innerText = "Copied!";
                            setTimeout(() => e.target.innerText = "Copy", 2000);
                          }}
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.shots && result.shots.length > 0 && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
                  <span style={{ fontSize: "1.5rem" }}>🎞️</span>
                  <h3 style={{ margin: 0 }}>Scene Breakdown Timeline</h3>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "24px", position: "relative" }}>
                  {/* Timeline vertical line */}
                  <div style={{ position: "absolute", left: "24px", top: "24px", bottom: "24px", width: "2px", background: "var(--border)", zIndex: 0 }}></div>
                  
                  {result.shots.map((shot, i) => (
                    <div key={i} className="card" style={{ position: "relative", zIndex: 1, display: "flex", gap: "24px", padding: "32px", overflow: "hidden" }}>
                      <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "var(--bg-dark)", border: "2px solid var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", flexShrink: 0, zIndex: 2 }}>
                        {shot.shot_id}
                      </div>
                      
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                          <h4 style={{ margin: 0, fontSize: "1.2rem" }}>Shot {shot.shot_id}</h4>
                          <span className="badge" style={{ background: "rgba(6, 182, 212, 0.15)", color: "var(--accent-light)", borderColor: "rgba(6, 182, 212, 0.2)" }}>
                            ⏱️ {shot.time_range}
                          </span>
                        </div>
                        
                        <div style={{ marginBottom: "20px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                            <span style={{ fontSize: "0.8rem", textTransform: "uppercase", color: "var(--text-secondary)", letterSpacing: "0.05em", fontWeight: "700" }}>Image Prompt (Midjourney)</span>
                          </div>
                          <div style={{ position: "relative" }}>
                            <code className="blog-code" style={{ padding: "16px", paddingRight: "48px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }}>
                              {shot.image_prompt}
                            </code>
                            <button 
                              className="blog-code-copy" 
                              style={{ top: "8px", right: "8px", padding: "4px 8px", fontSize: "0.75rem" }}
                              onClick={(e) => {
                                navigator.clipboard.writeText(shot.image_prompt);
                                e.target.innerText = "Copied!";
                                setTimeout(() => e.target.innerText = "Copy", 2000);
                              }}
                            >
                              Copy
                            </button>
                          </div>
                        </div>

                        {shot.video_prompt && (
                          <div>
                            <span style={{ fontSize: "0.8rem", textTransform: "uppercase", color: "var(--text-secondary)", letterSpacing: "0.05em", fontWeight: "700", display: "block", marginBottom: "8px" }}>Motion Prompt (Runway/VEO)</span>
                            <div style={{ position: "relative" }}>
                              <code className="blog-code" style={{ padding: "16px", paddingRight: "48px", background: "rgba(79, 70, 229, 0.05)", border: "1px solid rgba(79, 70, 229, 0.2)", borderRadius: "var(--radius-sm)", color: "var(--primary-light)" }}>
                                {shot.video_prompt}
                              </code>
                              <button 
                                className="blog-code-copy" 
                                style={{ top: "8px", right: "8px", padding: "4px 8px", fontSize: "0.75rem" }}
                                onClick={(e) => {
                                  navigator.clipboard.writeText(shot.video_prompt);
                                  e.target.innerText = "Copied!";
                                  setTimeout(() => e.target.innerText = "Copy", 2000);
                                }}
                              >
                                Copy
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
