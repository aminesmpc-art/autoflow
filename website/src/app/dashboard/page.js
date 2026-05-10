"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function DashboardPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const [extractions, setExtractions] = useState([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  const DJANGO_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    async function fetchExtractions() {
      if (!token) return;
      try {
        const res = await fetch(`${DJANGO_API_URL}/extractions/`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setExtractions(data);
        }
      } catch (err) {
        console.error("Failed to load extractions", err);
      } finally {
        setIsLoadingData(false);
      }
    }
    if (token) fetchExtractions();
  }, [token, DJANGO_API_URL]);

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this saved extraction?")) return;
    
    try {
      const res = await fetch(`${DJANGO_API_URL}/extractions/${id}/`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        setExtractions(extractions.filter(ex => ex.id !== id));
      }
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  if (loading || !user) return <div className="container" style={{ minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center" }}>Loading...</div>;

  return (
    <div className="section" style={{ minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      {/* Background Glow */}
      <div style={{ position: "absolute", top: "-20%", right: "-10%", width: "60vw", height: "60vw", background: "radial-gradient(circle, rgba(79, 70, 229, 0.05) 0%, transparent 70%)", zIndex: -1, pointerEvents: "none" }} />
      
      <div className="container" style={{ position: "relative", zIndex: 1, padding: "100px 24px" }}>
        
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "48px", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "24px" }}>
          <div>
            <h1 style={{ fontSize: "2.5rem", marginBottom: "8px" }}>Your <span className="text-gradient">Dashboard</span></h1>
            <p className="text-secondary" style={{ fontSize: "1.1rem" }}>View and manage your saved video extractions.</p>
          </div>
          <Link href="/extractor" className="btn btn-primary" style={{ borderRadius: "100px", padding: "12px 24px" }}>
            + New Extraction
          </Link>
        </div>

        {isLoadingData ? (
          <div style={{ textAlign: "center", padding: "60px" }}>
            <div style={{ fontSize: "2rem", animation: "spin 2s linear infinite", display: "inline-block" }}>⚙️</div>
            <p className="text-secondary" style={{ marginTop: "16px" }}>Loading your extractions...</p>
          </div>
        ) : extractions.length === 0 ? (
          <div className="card-glass" style={{ textAlign: "center", padding: "80px 40px", borderRadius: "24px", border: "1px dashed rgba(255,255,255,0.1)" }}>
            <div style={{ fontSize: "3rem", marginBottom: "16px", opacity: 0.5 }}>📂</div>
            <h3 style={{ marginBottom: "16px", fontSize: "1.5rem" }}>No extractions yet</h3>
            <p className="text-secondary" style={{ marginBottom: "32px", maxWidth: "400px", margin: "0 auto 32px" }}>You haven't extracted any videos yet. Extract your first video to see it saved here automatically.</p>
            <Link href="/extractor" className="btn btn-secondary" style={{ borderRadius: "100px" }}>
              Go to Extractor
            </Link>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {extractions.map((ex) => {
              const isExpanded = expandedId === ex.id;
              const date = new Date(ex.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
              
              return (
                <div key={ex.id} className="card-glass" style={{ borderRadius: "20px", overflow: "hidden", transition: "all 0.3s" }}>
                  
                  {/* Card Header (Clickable) */}
                  <div 
                    style={{ padding: "24px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: isExpanded ? "rgba(255,255,255,0.02)" : "transparent" }}
                    onClick={() => setExpandedId(isExpanded ? null : ex.id)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                      <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "rgba(79, 70, 229, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", border: "1px solid rgba(79, 70, 229, 0.2)" }}>
                        🎥
                      </div>
                      <div>
                        <h3 style={{ margin: "0 0 4px 0", fontSize: "1.2rem", display: "flex", alignItems: "center", gap: "12px" }}>
                          {ex.video_name}
                          <span className="badge" style={{ fontSize: "0.75rem", background: "rgba(255,255,255,0.05)", border: "none" }}>{date}</span>
                        </h3>
                        <p className="text-secondary" style={{ margin: 0, fontSize: "0.9rem", maxWidth: "500px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {ex.video_concept || "No concept description."}
                        </p>
                      </div>
                    </div>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                      <button 
                        onClick={(e) => handleDelete(ex.id, e)}
                        style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: "8px", fontSize: "1.2rem", transition: "color 0.2s" }}
                        onMouseEnter={(e) => e.target.style.color = "#ef4444"}
                        onMouseLeave={(e) => e.target.style.color = "var(--text-secondary)"}
                        title="Delete"
                      >
                        🗑️
                      </button>
                      <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.3s" }}>
                        ▼
                      </div>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div style={{ padding: "32px", borderTop: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.3)" }}>
                      
                      {ex.voiceover_text && (
                        <div style={{ marginBottom: "32px" }}>
                          <h4 style={{ fontSize: "0.9rem", textTransform: "uppercase", color: "var(--text-secondary)", letterSpacing: "1px", marginBottom: "12px" }}>Voiceover Script</h4>
                          <div style={{ padding: "20px", background: "rgba(0,0,0,0.5)", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)", fontFamily: "monospace", color: "var(--text-primary)" }}>
                            {ex.voiceover_text}
                          </div>
                        </div>
                      )}

                      {ex.shots && ex.shots.length > 0 && (
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                            <h4 style={{ fontSize: "0.9rem", textTransform: "uppercase", color: "var(--text-secondary)", letterSpacing: "1px", margin: 0 }}>Timeline ({ex.shots.length} shots)</h4>
                            
                            <div style={{ display: "flex", gap: "12px" }}>
                              <button 
                                className="btn btn-secondary" 
                                style={{ padding: "8px 16px", fontSize: "0.85rem" }}
                                onClick={(e) => {
                                  const prompts = ex.shots.map(s => s.image_prompt).filter(Boolean).join("\\n\\n");
                                  navigator.clipboard.writeText(prompts);
                                  e.target.innerText = "✓ Copied Images";
                                  setTimeout(() => e.target.innerText = "Copy Image Prompts", 2000);
                                }}
                              >
                                Copy Image Prompts
                              </button>
                              <button 
                                className="btn btn-secondary" 
                                style={{ padding: "8px 16px", fontSize: "0.85rem", background: "rgba(22, 163, 74, 0.1)", color: "#4ade80", borderColor: "rgba(22, 163, 74, 0.3)" }}
                                onClick={(e) => {
                                  const prompts = ex.shots.map(s => s.video_prompt).filter(Boolean).join("\\n\\n");
                                  navigator.clipboard.writeText(prompts);
                                  e.target.innerText = "✓ Copied Videos";
                                  setTimeout(() => e.target.innerText = "Copy Video Prompts", 2000);
                                }}
                              >
                                Copy Video Prompts
                              </button>
                            </div>
                          </div>

                          <div style={{ display: "grid", gap: "16px" }}>
                            {ex.shots.map((shot, i) => (
                              <div key={i} style={{ display: "flex", gap: "16px", padding: "16px", background: "rgba(255,255,255,0.02)", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
                                <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "rgba(0,0,0,0.5)", border: "1px solid var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9rem", fontWeight: "bold", flexShrink: 0 }}>
                                  {shot.shot_id}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: "0.85rem", color: "var(--accent)", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    <strong>Image:</strong> {shot.image_prompt}
                                  </div>
                                  {shot.video_prompt && (
                                    <div style={{ fontSize: "0.85rem", color: "var(--primary-light)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                      <strong>Motion:</strong> {shot.video_prompt}
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
