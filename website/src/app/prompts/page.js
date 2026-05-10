"use client";

import { useState, useEffect } from "react";
import Head from "next/head";

export default function PromptsPage() {
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const DJANGO_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";

  useEffect(() => {
    async function fetchPrompts() {
      try {
        const res = await fetch(`${DJANGO_API_URL}/extractions/public/`);
        if (!res.ok) throw new Error("Failed to load prompts");
        const data = await res.json();
        setPrompts(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchPrompts();
  }, [DJANGO_API_URL]);

  const copyToClipboard = (text, e) => {
    navigator.clipboard.writeText(text);
    const originalText = e.currentTarget.innerText;
    e.currentTarget.innerText = "Copied!";
    setTimeout(() => {
      e.currentTarget.innerText = originalText;
    }, 2000);
  };

  return (
    <div className="section" style={{ minHeight: "100vh", position: "relative", overflow: "hidden", padding: "120px 0" }}>
      {/* Absolute Ambient Backgrounds */}
      <div style={{ position: "absolute", top: "-10%", left: "50%", transform: "translateX(-50%)", width: "80vw", height: "80vw", background: "radial-gradient(circle, rgba(16, 185, 129, 0.08) 0%, rgba(0,0,0,0) 70%)", zIndex: -1, pointerEvents: "none" }} />
      
      <div className="container" style={{ position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", marginBottom: "60px" }}>
          <span className="badge" style={{ background: "rgba(16, 185, 129, 0.1)", color: "var(--success)", border: "1px solid rgba(16, 185, 129, 0.2)", padding: "6px 16px", borderRadius: "100px", fontSize: "0.85rem", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "24px", display: "inline-block" }}>Community Library</span>
          <h1 style={{ fontSize: "clamp(2.5rem, 4vw, 4rem)", letterSpacing: "-0.04em", marginBottom: "24px", background: "linear-gradient(135deg, #FFF 0%, #A1A1AA 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            The <span style={{ color: "var(--success)" }}>Prompts</span> Gallery
          </h1>
          <p className="text-secondary" style={{ fontSize: "1.2rem", maxWidth: "650px", margin: "0 auto", lineHeight: "1.6" }}>
            Explore the best AI video prompts reverse-engineered by the AutoFlow community using our Video Extractor.
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "100px 0" }}>
            <div style={{ width: "40px", height: "40px", border: "3px solid rgba(16, 185, 129, 0.2)", borderTopColor: "var(--success)", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }}></div>
            <p style={{ marginTop: "16px", color: "var(--text-secondary)" }}>Loading community prompts...</p>
          </div>
        ) : error ? (
          <div className="card-glass" style={{ textAlign: "center", padding: "40px", borderColor: "rgba(239, 68, 68, 0.3)" }}>
            <p style={{ color: "#ef4444" }}>{error}</p>
          </div>
        ) : prompts.length === 0 ? (
          <div className="card-glass" style={{ textAlign: "center", padding: "80px 20px" }}>
            <p className="text-secondary" style={{ fontSize: "1.2rem" }}>No prompts extracted yet. Be the first to use the <a href="/extractor" style={{ color: "var(--primary-light)", textDecoration: "underline" }}>Video Extractor</a>!</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "24px", alignItems: "start" }}>
            {prompts.map((extraction) => {
              const isExpanded = expandedId === extraction.id;
              const firstShot = extraction.shots && extraction.shots.length > 0 ? extraction.shots[0] : null;

              return (
                <div 
                  key={extraction.id} 
                  className="card-glass" 
                  onClick={() => setExpandedId(isExpanded ? null : extraction.id)}
                  style={{ 
                    padding: "24px", 
                    borderRadius: "20px", 
                    background: "rgba(10, 10, 10, 0.8)", 
                    transition: "all 0.3s ease", 
                    border: "1px solid rgba(255,255,255,0.05)", 
                    position: "relative", 
                    overflow: "hidden",
                    cursor: "pointer",
                    gridRowEnd: isExpanded ? "span 2" : "auto",
                    boxShadow: isExpanded ? "0 0 30px rgba(16, 185, 129, 0.2)" : "none"
                  }}
                >
                  <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "4px", background: "linear-gradient(90deg, var(--primary) 0%, var(--success) 100%)", opacity: 0.8 }}></div>
                  
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", marginTop: "8px" }}>
                    <h3 style={{ fontSize: "1.2rem", margin: 0, color: "white", lineHeight: "1.4", overflow: "hidden", textOverflow: "ellipsis", display: isExpanded ? "block" : "-webkit-box", WebkitLineClamp: isExpanded ? "unset" : 2, WebkitBoxOrient: "vertical" }}>
                      {extraction.video_name.replace(/\.[^/.]+$/, "")}
                    </h3>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", whiteSpace: "nowrap", marginLeft: "12px" }}>
                      {new Date(extraction.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <p style={{ fontSize: "0.95rem", color: "var(--text-secondary)", marginBottom: "24px", lineHeight: "1.6", overflow: "hidden", textOverflow: "ellipsis", display: isExpanded ? "block" : "-webkit-box", WebkitLineClamp: isExpanded ? "unset" : 3, WebkitBoxOrient: "vertical" }}>
                    {extraction.video_concept}
                  </p>

                  <div onClick={(e) => e.stopPropagation()}>
                    {(isExpanded ? extraction.shots : [firstShot]).map((shot, i) => {
                      if (!shot) return null;
                      return (
                        <div key={i} style={{ marginBottom: isExpanded ? "24px" : "16px", borderBottom: isExpanded ? "1px solid rgba(255,255,255,0.05)" : "none", paddingBottom: isExpanded ? "16px" : "0" }}>
                          {isExpanded && <h4 style={{ color: "white", fontSize: "1rem", marginBottom: "12px" }}>Shot {shot.shot_id}</h4>}
                          
                          {shot.image_prompt && (
                            <div style={{ marginBottom: "16px" }}>
                              <div style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "1px", color: "var(--text-muted)", marginBottom: "8px", fontWeight: "600" }}>Midjourney Prompt</div>
                              <div style={{ background: "rgba(0,0,0,0.4)", padding: "12px", borderRadius: "8px", fontSize: "0.85rem", color: "rgba(255,255,255,0.9)", position: "relative" }}>
                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", display: isExpanded ? "block" : "-webkit-box", WebkitLineClamp: isExpanded ? "unset" : 3, WebkitBoxOrient: "vertical", paddingRight: "50px", wordBreak: "break-word" }}>
                                  {shot.image_prompt}
                                </div>
                                <button 
                                  onClick={(e) => copyToClipboard(shot.image_prompt, e)}
                                  style={{ position: "absolute", top: "8px", right: "8px", background: "rgba(255,255,255,0.1)", border: "none", color: "white", borderRadius: "4px", padding: "6px 12px", fontSize: "0.75rem", cursor: "pointer", transition: "all 0.2s" }}
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
                              <div style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "1px", color: "var(--text-muted)", marginBottom: "8px", fontWeight: "600" }}>Motion Prompt (Runway/Sora)</div>
                              <div style={{ background: "rgba(16, 185, 129, 0.05)", border: "1px solid rgba(16, 185, 129, 0.1)", padding: "12px", borderRadius: "8px", fontSize: "0.85rem", color: "rgba(255,255,255,0.9)", position: "relative" }}>
                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", display: isExpanded ? "block" : "-webkit-box", WebkitLineClamp: isExpanded ? "unset" : 3, WebkitBoxOrient: "vertical", paddingRight: "50px", wordBreak: "break-word" }}>
                                  {shot.video_prompt}
                                </div>
                                <button 
                                  onClick={(e) => copyToClipboard(shot.video_prompt, e)}
                                  style={{ position: "absolute", top: "8px", right: "8px", background: "rgba(16, 185, 129, 0.2)", border: "none", color: "white", borderRadius: "4px", padding: "6px 12px", fontSize: "0.75rem", cursor: "pointer", transition: "all 0.2s" }}
                                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--success)"}
                                  onMouseLeave={(e) => e.currentTarget.style.background = "rgba(16, 185, 129, 0.2)"}
                                >
                                  Copy
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {isExpanded && extraction.character_sheets && extraction.character_sheets.length > 0 && (
                      <div style={{ marginTop: "24px" }}>
                        <h4 style={{ color: "white", fontSize: "1.1rem", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "1.2rem" }}>👤</span> Characters
                        </h4>
                        {extraction.character_sheets.map((char, i) => (
                          <div key={i} style={{ marginBottom: "16px", background: "rgba(79, 70, 229, 0.05)", border: "1px solid rgba(79, 70, 229, 0.1)", padding: "12px", borderRadius: "8px", position: "relative" }}>
                            <div style={{ fontSize: "0.85rem", fontWeight: "bold", color: "white", marginBottom: "8px" }}>{char.character_name}</div>
                            <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", paddingRight: "50px", wordBreak: "break-word" }}>{char.prompt}</div>
                            <button 
                              onClick={(e) => copyToClipboard(char.prompt, e)}
                              style={{ position: "absolute", top: "12px", right: "12px", background: "rgba(79, 70, 229, 0.2)", border: "none", color: "white", borderRadius: "4px", padding: "6px 12px", fontSize: "0.75rem", cursor: "pointer", transition: "all 0.2s" }}
                              onMouseEnter={(e) => e.currentTarget.style.background = "var(--primary)"}
                              onMouseLeave={(e) => e.currentTarget.style.background = "rgba(79, 70, 229, 0.2)"}
                            >
                              Copy
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", display: "flex", gap: "12px" }}>
                      <span>🖼️ {extraction.shots ? extraction.shots.length : 0} shots</span>
                      <span>👤 {extraction.character_sheets ? extraction.character_sheets.length : 0} characters</span>
                    </span>
                    <span style={{ fontSize: "0.85rem", color: "var(--primary-light)", fontWeight: "500" }}>
                      {isExpanded ? "Show Less ↑" : "View All Prompts ↓"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
