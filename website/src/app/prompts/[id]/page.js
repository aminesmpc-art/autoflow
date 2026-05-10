"use client";

import { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function PromptDetailPage() {
  const { id } = useParams();
  const [extraction, setExtraction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const DJANGO_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";

  useEffect(() => {
    if (!id) return;
    
    async function fetchExtraction() {
      try {
        const res = await fetch(`${DJANGO_API_URL}/extractions/public/${id}/`);
        if (!res.ok) throw new Error("Failed to load this extraction. It may have been deleted.");
        const data = await res.json();
        setExtraction(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchExtraction();
  }, [id, DJANGO_API_URL]);

  const copyToClipboard = (text, e) => {
    navigator.clipboard.writeText(text);
    const originalText = e.currentTarget.innerText;
    e.currentTarget.innerText = "Copied!";
    setTimeout(() => {
      e.currentTarget.innerText = originalText;
    }, 2000);
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "black" }}>
        <div style={{ width: "40px", height: "40px", border: "3px solid rgba(16, 185, 129, 0.2)", borderTopColor: "var(--success)", borderRadius: "50%", animation: "spin 1s linear infinite" }}></div>
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !extraction) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "black" }}>
        <div className="card-glass" style={{ textAlign: "center", padding: "40px", borderColor: "rgba(239, 68, 68, 0.3)" }}>
          <p style={{ color: "#ef4444", marginBottom: "16px" }}>{error || "Extraction not found"}</p>
          <Link href="/prompts" className="btn btn-secondary">← Back to Gallery</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="section" style={{ minHeight: "100vh", position: "relative", overflow: "hidden", padding: "120px 0 60px" }}>
      <Head>
        <title>{extraction.video_name} | AutoFlow Prompts</title>
        <meta name="description" content={extraction.video_concept.substring(0, 160)} />
      </Head>

      {/* Absolute Ambient Backgrounds */}
      <div style={{ position: "absolute", top: "-10%", left: "50%", transform: "translateX(-50%)", width: "80vw", height: "80vw", background: "radial-gradient(circle, rgba(16, 185, 129, 0.08) 0%, rgba(0,0,0,0) 70%)", zIndex: -1, pointerEvents: "none" }} />
      
      <div className="container" style={{ position: "relative", zIndex: 1, maxWidth: "900px" }}>
        <Link href="/prompts" style={{ display: "inline-flex", alignItems: "center", color: "var(--text-secondary)", textDecoration: "none", marginBottom: "32px", fontSize: "0.95rem", transition: "color 0.2s" }} onMouseEnter={(e) => e.target.style.color = "white"} onMouseLeave={(e) => e.target.style.color = "var(--text-secondary)"}>
          ← Back to Prompts Gallery
        </Link>

        {/* Header / Master Concept */}
        <div className="card-glass" style={{ padding: "40px", borderRadius: "24px", marginBottom: "32px", border: "1px solid rgba(16, 185, 129, 0.2)", background: "linear-gradient(180deg, rgba(16, 185, 129, 0.05) 0%, rgba(0,0,0,0.8) 100%)", position: "relative" }}>
          <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "4px", background: "linear-gradient(90deg, var(--primary) 0%, var(--success) 100%)", opacity: 0.8 }}></div>
          
          <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "20px" }}>
            <span className="badge" style={{ background: "rgba(16, 185, 129, 0.1)", color: "var(--success)", border: "1px solid rgba(16, 185, 129, 0.3)", padding: "4px 12px", borderRadius: "100px", fontSize: "0.75rem", letterSpacing: "1px", textTransform: "uppercase" }}>Master Extraction</span>
            <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{new Date(extraction.created_at).toLocaleDateString()}</span>
          </div>

          <h1 style={{ fontSize: "clamp(2rem, 3vw, 2.5rem)", letterSpacing: "-0.02em", marginBottom: "24px", color: "white", lineHeight: "1.2" }}>
            {extraction.video_name.replace(/\.[^/.]+$/, "")}
          </h1>

          <div style={{ background: "rgba(255,255,255,0.03)", padding: "24px", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.05)" }}>
            <h3 style={{ fontSize: "1rem", color: "white", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "1.2rem" }}>🧠</span> Video Concept Breakdown
            </h3>
            <p style={{ fontSize: "1.05rem", color: "var(--text-secondary)", lineHeight: "1.7", whiteSpace: "pre-wrap", margin: 0 }}>
              {extraction.video_concept}
            </p>
          </div>
        </div>

        <div style={{ display: "grid", gap: "32px", gridTemplateColumns: "minmax(0, 1fr)" }}>
          {/* Shots Timeline */}
          {extraction.shots && extraction.shots.length > 0 && (
            <div>
              <h2 style={{ fontSize: "1.8rem", marginBottom: "24px", color: "white", display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ background: "rgba(79, 70, 229, 0.1)", color: "var(--primary-light)", width: "40px", height: "40px", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center" }}>🎬</span>
                Shot Timeline
              </h2>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {extraction.shots.map((shot, i) => (
                  <div key={i} className="card-glass" style={{ padding: "24px", borderRadius: "16px", borderLeft: "4px solid var(--primary-light)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                      <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: "white" }}>Shot {shot.shot_id}</span>
                      {shot.timestamp && <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: "4px" }}>{shot.timestamp}</span>}
                    </div>

                    {shot.image_prompt && (
                      <div style={{ marginBottom: "16px" }}>
                        <div style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "1px", color: "var(--text-muted)", marginBottom: "8px", fontWeight: "600" }}>Midjourney Prompt</div>
                        <div style={{ background: "rgba(0,0,0,0.4)", padding: "16px", borderRadius: "12px", fontSize: "0.95rem", color: "rgba(255,255,255,0.9)", position: "relative", border: "1px solid rgba(255,255,255,0.05)" }}>
                          <div style={{ paddingRight: "70px", lineHeight: "1.6" }}>{shot.image_prompt}</div>
                          <button 
                            onClick={(e) => copyToClipboard(shot.image_prompt, e)}
                            style={{ position: "absolute", top: "12px", right: "12px", background: "rgba(255,255,255,0.1)", border: "none", color: "white", borderRadius: "6px", padding: "6px 12px", fontSize: "0.8rem", cursor: "pointer", transition: "all 0.2s" }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "var(--primary)"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    )}

                    {shot.video_prompt && (
                      <div>
                        <div style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "1px", color: "var(--text-muted)", marginBottom: "8px", fontWeight: "600" }}>Motion Prompt (Runway/Sora/Veo)</div>
                        <div style={{ background: "rgba(16, 185, 129, 0.05)", padding: "16px", borderRadius: "12px", fontSize: "0.95rem", color: "rgba(255,255,255,0.9)", position: "relative", border: "1px solid rgba(16, 185, 129, 0.1)" }}>
                          <div style={{ paddingRight: "70px", lineHeight: "1.6" }}>{shot.video_prompt}</div>
                          <button 
                            onClick={(e) => copyToClipboard(shot.video_prompt, e)}
                            style={{ position: "absolute", top: "12px", right: "12px", background: "rgba(16, 185, 129, 0.2)", border: "none", color: "white", borderRadius: "6px", padding: "6px 12px", fontSize: "0.8rem", cursor: "pointer", transition: "all 0.2s" }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "var(--success)"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "rgba(16, 185, 129, 0.2)"}
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Character Sheets */}
          {extraction.character_sheets && extraction.character_sheets.length > 0 && (
            <div>
              <h2 style={{ fontSize: "1.8rem", marginBottom: "24px", color: "white", display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ background: "rgba(236, 72, 153, 0.1)", color: "#ec4899", width: "40px", height: "40px", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center" }}>👤</span>
                Character Sheets
              </h2>
              
              <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
                {extraction.character_sheets.map((char, i) => (
                  <div key={i} className="card-glass" style={{ padding: "20px", borderRadius: "16px", border: "1px solid rgba(236, 72, 153, 0.2)" }}>
                    <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "white", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
                      {char.character_name}
                    </div>
                    <div style={{ background: "rgba(0,0,0,0.3)", padding: "16px", borderRadius: "12px", position: "relative" }}>
                      <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.6", paddingRight: "40px" }}>
                        {char.prompt}
                      </div>
                      <button 
                        onClick={(e) => copyToClipboard(char.prompt, e)}
                        style={{ position: "absolute", top: "12px", right: "12px", background: "rgba(255,255,255,0.1)", border: "none", color: "white", borderRadius: "6px", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s" }}
                        title="Copy Character Prompt"
                        onMouseEnter={(e) => e.currentTarget.style.background = "#ec4899"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                      >
                        📋
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Voiceover */}
          {extraction.voiceover_text && (
            <div>
              <h2 style={{ fontSize: "1.8rem", marginBottom: "24px", color: "white", display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ background: "rgba(245, 158, 11, 0.1)", color: "#f59e0b", width: "40px", height: "40px", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center" }}>🎙️</span>
                Voiceover Script
              </h2>
              <div className="card-glass" style={{ padding: "24px", borderRadius: "16px", position: "relative" }}>
                <p style={{ fontSize: "1.05rem", color: "var(--text-secondary)", lineHeight: "1.7", margin: 0, paddingRight: "60px", whiteSpace: "pre-wrap" }}>
                  {extraction.voiceover_text}
                </p>
                <button 
                  onClick={(e) => copyToClipboard(extraction.voiceover_text, e)}
                  style={{ position: "absolute", top: "24px", right: "24px", background: "rgba(255,255,255,0.1)", border: "none", color: "white", borderRadius: "6px", padding: "8px 16px", fontSize: "0.85rem", cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#f59e0b"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                >
                  Copy Script
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
