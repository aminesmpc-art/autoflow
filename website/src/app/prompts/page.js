"use client";

import { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";

export default function PromptsPage() {
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
            <p className="text-secondary" style={{ fontSize: "1.2rem" }}>No prompts extracted yet. Be the first to use the <Link href="/extractor" style={{ color: "var(--primary-light)", textDecoration: "underline" }}>Video Extractor</Link>!</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "24px", alignItems: "start" }}>
            {prompts.map((extraction) => (
              <Link href={`/prompts/${extraction.id}`} key={extraction.id} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                <div 
                  className="card-glass" 
                  style={{ 
                    padding: "24px", 
                    borderRadius: "20px", 
                    background: "rgba(10, 10, 10, 0.8)", 
                    transition: "transform 0.3s ease, box-shadow 0.3s ease", 
                    border: "1px solid rgba(255,255,255,0.05)", 
                    position: "relative", 
                    overflow: "hidden",
                    cursor: "pointer",
                    height: "100%"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-4px)";
                    e.currentTarget.style.boxShadow = "0 10px 30px rgba(16, 185, 129, 0.1)";
                    e.currentTarget.style.borderColor = "rgba(16, 185, 129, 0.3)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)";
                  }}
                >
                  <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "4px", background: "linear-gradient(90deg, var(--primary) 0%, var(--success) 100%)", opacity: 0.8 }}></div>
                  
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", marginTop: "8px" }}>
                    <h3 style={{ fontSize: "1.2rem", margin: 0, color: "white", lineHeight: "1.4", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                      {extraction.video_name.replace(/\.[^/.]+$/, "")}
                    </h3>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", whiteSpace: "nowrap", marginLeft: "12px" }}>
                      {new Date(extraction.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <p style={{ fontSize: "0.95rem", color: "var(--text-secondary)", marginBottom: "24px", lineHeight: "1.6", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                    {extraction.video_concept}
                  </p>

                  <div style={{ marginTop: "auto", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", display: "flex", gap: "12px" }}>
                      <span>🖼️ {extraction.shots ? extraction.shots.length : 0} shots</span>
                      <span>👤 {extraction.character_sheets ? extraction.character_sheets.length : 0} characters</span>
                    </span>
                    <span style={{ fontSize: "0.85rem", color: "var(--success)", fontWeight: "500", display: "flex", alignItems: "center" }}>
                      View Prompts <span style={{ marginLeft: "4px", fontSize: "1rem" }}>→</span>
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
