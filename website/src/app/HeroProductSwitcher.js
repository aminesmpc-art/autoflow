"use client";

import { useState } from "react";
import StoreLink from "./StoreLink";

export default function HeroProductSwitcher() {
  const [activeTab, setActiveTab] = useState("studio");

  return (
    <div className="animate-in delay-4" style={{ marginTop: "40px" }}>
      {/* ── Product Switcher Tabs ── */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "8px",
          marginBottom: "24px",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className={`product-tab-btn ${activeTab === "studio" ? "active" : ""}`}
          onClick={() => setActiveTab("studio")}
        >
          <span style={{ color: "var(--primary)" }}>✨</span> AutoFlow Studio (Canvas)
        </button>
        <button
          type="button"
          className={`product-tab-btn ${activeTab === "extractor" ? "active" : ""}`}
          onClick={() => setActiveTab("extractor")}
        >
          <span style={{ color: "#10B981" }}>🔍</span> Video Prompt Extractor
        </button>
        <button
          type="button"
          className={`product-tab-btn ${activeTab === "queue" ? "active" : ""}`}
          onClick={() => setActiveTab("queue")}
        >
          <span style={{ color: "#818CF8" }}>⚡</span> Queue Manager (Batch Runner)
        </button>
      </div>

      {/* ── Tab Panels ── */}
      <div
        className="glass-panel"
        style={{
          borderRadius: "var(--radius-xl)",
          overflow: "hidden",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          boxShadow: "0 40px 100px -20px rgba(255, 92, 0, 0.25), 0 20px 40px rgba(0,0,0,0.9)",
          backgroundColor: "#08090a",
          minHeight: "440px",
          position: "relative",
        }}
      >
        {/* TAB 1: AUTOFLOW STUDIO */}
        {activeTab === "studio" && (
          <div style={{ padding: "32px", textAlign: "left" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <span className="badge" style={{ background: "rgba(255, 92, 0, 0.15)", borderColor: "var(--primary)", color: "#FFF", marginRight: "10px" }}>
                  ✨ VISUAL NODE CANVAS
                </span>
                <span style={{ fontSize: "0.88rem", color: "var(--text-muted)" }}>
                  Multi-Shot Movie Pipeline • Veo 3.1 &amp; Grok Orchestration
                </span>
              </div>
              <a href="/studio" className="btn btn-primary" style={{ padding: "6px 16px", fontSize: "0.85rem" }}>
                Launch Studio Canvas →
              </a>
            </div>

            {/* Interactive Visual Graph Preview */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "16px",
                padding: "24px",
                background: "radial-gradient(circle at 50% 50%, rgba(255, 92, 0, 0.05) 0%, rgba(5,5,5,0.9) 100%)",
                borderRadius: "12px",
                border: "1px dashed rgba(255, 255, 255, 0.15)",
                position: "relative",
              }}
            >
              {/* Node 1 */}
              <div style={{ background: "#111317", padding: "16px", borderRadius: "10px", border: "1px solid rgba(255, 92, 0, 0.4)" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--primary)", fontWeight: "700", marginBottom: "6px" }}>01 • STORY DIRECTOR</div>
                <div style={{ fontSize: "0.9rem", fontWeight: "600", color: "#FFF", marginBottom: "4px" }}>Character Lock</div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>Cyberpunk Ronin in neon rain</div>
                <div style={{ marginTop: "10px", fontSize: "0.7rem", color: "#10B981" }}>● Seed: 849204 (Locked)</div>
              </div>

              {/* Node 2 */}
              <div style={{ background: "#111317", padding: "16px", borderRadius: "10px", border: "1px solid rgba(255, 255, 255, 0.15)" }}>
                <div style={{ fontSize: "0.75rem", color: "#818CF8", fontWeight: "700", marginBottom: "6px" }}>02 • GENERATE VEO 3.1</div>
                <div style={{ fontSize: "0.9rem", fontWeight: "600", color: "#FFF", marginBottom: "4px" }}>Shot 1: Wide Angle</div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>Camera tracking Ronin katana draw</div>
                <div style={{ marginTop: "10px", fontSize: "0.7rem", color: "var(--primary)" }}>⚡ Render: 5s 1080p</div>
              </div>

              {/* Node 3 */}
              <div style={{ background: "#111317", padding: "16px", borderRadius: "10px", border: "1px solid rgba(255, 255, 255, 0.15)" }}>
                <div style={{ fontSize: "0.75rem", color: "#F59E0B", fontWeight: "700", marginBottom: "6px" }}>03 • LAST FRAME CHAIN</div>
                <div style={{ fontSize: "0.9rem", fontWeight: "600", color: "#FFF", marginBottom: "4px" }}>Shot 2: Close-Up</div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>Seamless frame-matched transition</div>
                <div style={{ marginTop: "10px", fontSize: "0.7rem", color: "#10B981" }}>● 0 Frame Drift</div>
              </div>

              {/* Node 4 */}
              <div style={{ background: "#111317", padding: "16px", borderRadius: "10px", border: "1px solid rgba(16, 185, 129, 0.4)" }}>
                <div style={{ fontSize: "0.75rem", color: "#10B981", fontWeight: "700", marginBottom: "6px" }}>04 • 4K EXPORTER</div>
                <div style={{ fontSize: "0.9rem", fontWeight: "600", color: "#FFF", marginBottom: "4px" }}>Final Timeline</div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>Upscaled 4K ProRes Video</div>
                <div style={{ marginTop: "10px", fontSize: "0.7rem", color: "#10B981" }}>✓ Ready to Download</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "24px", marginTop: "20px", color: "var(--text-secondary)", fontSize: "0.85rem", flexWrap: "wrap" }}>
              <div>⚡ <strong>No Python Required:</strong> 100% In-Browser Graph Canvas</div>
              <div>🔒 <strong>Identity Persistence:</strong> Keep faces &amp; clothes identical across shots</div>
            </div>
          </div>
        )}

        {/* TAB 2: AI VIDEO EXTRACTOR */}
        {activeTab === "extractor" && (
          <div style={{ padding: "32px", textAlign: "left" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <span className="badge" style={{ background: "rgba(16, 185, 129, 0.15)", borderColor: "#10B981", color: "#FFF", marginRight: "10px" }}>
                  🔍 VISION REVERSE-ENGINEERING
                </span>
                <span style={{ fontSize: "0.88rem", color: "var(--text-muted)" }}>
                  Turn Any AI Video into Full Prompts &amp; Studio Graphs (Free)
                </span>
              </div>
              <a href="/extractor" className="btn btn-primary" style={{ padding: "6px 16px", fontSize: "0.85rem", background: "#10B981", borderColor: "#10B981", color: "#000" }}>
                Try Extractor Live →
              </a>
            </div>

            {/* Extractor Simulation View */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
              <div style={{ background: "#0c0d10", padding: "20px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontSize: "0.8rem", color: "#10B981", fontWeight: "700", marginBottom: "8px" }}>INPUT VIDEO (SORA / RUNWAY)</div>
                <div style={{ background: "#000", height: "140px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed rgba(255,255,255,0.2)" }}>
                  <span style={{ fontSize: "2rem" }}>🎬</span>
                </div>
                <div style={{ marginTop: "12px", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  Extracted: 3 Key Shots • 24fps Motion Vector • Voiceover Script
                </div>
              </div>

              <div style={{ background: "#0c0d10", padding: "20px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontSize: "0.8rem", color: "var(--primary)", fontWeight: "700", marginBottom: "8px" }}>RECONSTRUCTED PROMPTS</div>
                <div style={{ background: "#050507", padding: "12px", borderRadius: "6px", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.75rem", color: "#E4E4E7", lineHeight: 1.5 }}>
                  &quot;Hyper-realistic cinematic slow-motion drone flyover above ancient neon temple, volumetric atmospheric fog, anamorphic lens flare, 8k render...&quot;
                </div>
                <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                  <span className="sample-chip" style={{ fontSize: "0.72rem" }}>📋 Copy Prompt</span>
                  <span className="sample-chip" style={{ fontSize: "0.72rem" }}>⚡ Export to Studio Graph</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: QUEUE MANAGER */}
        {activeTab === "queue" && (
          <div style={{ padding: "32px", textAlign: "left" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <span className="badge" style={{ background: "rgba(129, 140, 248, 0.15)", borderColor: "#818CF8", color: "#FFF", marginRight: "10px" }}>
                  ⚡ BATCH QUEUE AUTOMATION
                </span>
                <span style={{ fontSize: "0.88rem", color: "var(--text-muted)" }}>
                  Paste 500+ Prompts • Auto-Retry Failures • 1-Click 4K Bulk Harvester
                </span>
              </div>
              <StoreLink product="queue" className="btn btn-primary" style={{ padding: "6px 16px", fontSize: "0.85rem" }}>
                Install Queue Extension →
              </StoreLink>
            </div>

            {/* Queue Batch Run Simulation */}
            <div style={{ background: "#0c0d10", padding: "20px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px", fontSize: "0.85rem" }}>
                <span><strong>Batch Queue #1</strong> (TikTok Shorts Series)</span>
                <span style={{ color: "#10B981", fontWeight: "700" }}>48 / 50 Generated (96%)</span>
              </div>
              <div style={{ background: "#222", height: "8px", borderRadius: "4px", overflow: "hidden", marginBottom: "16px" }}>
                <div style={{ width: "96%", height: "100%", background: "var(--gradient-primary)" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                <div>⏱️ <strong>Time Saved:</strong> ~6.5 hours</div>
                <div>🔄 <strong>Auto-Retries:</strong> 3 failed jobs fixed</div>
                <div>📥 <strong>Bulk Harvester:</strong> 4K Zip Export Ready</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
