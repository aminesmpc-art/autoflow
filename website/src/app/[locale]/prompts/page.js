"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function PromptsPage() {
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState("All");
  const [copiedId, setCopiedId] = useState(null);
  const params = useParams();
  const locale = params?.locale;
  const prefix = locale && locale !== 'en' ? `/${locale}` : '';

  const DJANGO_API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.auto-flow.studio/api";

  const CURATED_PROMPTS = [
    {
      id: "curated-1",
      video_name: "Cyberpunk Neo-Tokyo Rain.mp4",
      video_concept: "Hyper-realistic slow motion tracking shot of a robotic samurai walking down a neon-lit alleyway in heavy rain with atmospheric fog.",
      platform: "OpenAI Sora",
      created_at: new Date().toISOString(),
      shots: [
        { prompt: "Cinematic wide angle shot of a cybernetic ronin walking in rainy Neo-Tokyo, neon reflections on asphalt, 8k resolution, volumetric fog, anamorphic lens flare" }
      ],
      character_sheets: [{ name: "Cyber Ronin", description: "Weathered carbon fiber armor, glowing orange visor, katana on back" }]
    },
    {
      id: "curated-2",
      video_name: "Cinematic FPV Drone Canyon.mp4",
      video_concept: "Breathtaking high-speed FPV drone dive down a dramatic sandstone canyon at golden hour with dust particles caught in sunlight.",
      platform: "Runway Gen-3",
      created_at: new Date().toISOString(),
      shots: [
        { prompt: "Dynamic FPV drone racing through red rock canyon arches, golden hour lighting, cinematic motion blur, photorealistic textures, 4k 60fps" }
      ],
      character_sheets: []
    },
    {
      id: "curated-3",
      video_name: "Anime Mech Launch Sequence.mp4",
      video_concept: "Studio Ghibli meets Makoto Shinkai style animated giant mech launching from an underground hangar with vapor exhaust and dramatic lighting.",
      platform: "Kling AI",
      created_at: new Date().toISOString(),
      shots: [
        { prompt: "Anime aesthetic detailed mech launch sequence, steam venting from thrusters, emotional lighting, hand-drawn anime lineart, vibrant colors" }
      ],
      character_sheets: [{ name: "Pilot Yuri", description: "Young female pilot with white hair in plugsuit" }]
    }
  ];

  useEffect(() => {
    async function fetchPrompts() {
      try {
        const res = await fetch(`${DJANGO_API_URL}/extractions/public/`);
        if (!res.ok) throw new Error("Failed to load prompts");
        const data = await res.json();
        setPrompts(data && data.length > 0 ? data : CURATED_PROMPTS);
      } catch (err) {
        setPrompts(CURATED_PROMPTS);
      } finally {
        setLoading(false);
      }
    }
    fetchPrompts();
  }, [DJANGO_API_URL]);

  const displayedPrompts = prompts.filter((p) => {
    const matchesSearch =
      searchQuery === "" ||
      p.video_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.video_concept?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesPlatform =
      selectedPlatform === "All" ||
      p.platform?.toLowerCase() === selectedPlatform.toLowerCase() ||
      p.video_concept?.toLowerCase().includes(selectedPlatform.toLowerCase());

    return matchesSearch && matchesPlatform;
  });

  const handleCopyPrompt = (e, promptText, id) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard?.writeText(promptText);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="section" style={{ minHeight: "100vh", position: "relative", overflow: "hidden", padding: "120px 0" }}>
      {/* Ambient Background */}
      <div style={{ position: "absolute", top: "-10%", left: "50%", transform: "translateX(-50%)", width: "80vw", height: "80vw", background: "radial-gradient(circle, rgba(255, 92, 0, 0.08) 0%, rgba(0,0,0,0) 70%)", zIndex: -1, pointerEvents: "none" }} />
      
      <div className="container" style={{ position: "relative", zIndex: 1 }}>
        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: "48px" }}>
          <div style={{ display: "inline-block", padding: "6px 16px", border: "1px solid var(--primary)", borderRadius: "20px", fontSize: "0.85rem", color: "var(--primary)", marginBottom: "20px", background: "rgba(255,92,0,0.05)", letterSpacing: "1px", textTransform: "uppercase" }}>
            Community Library
          </div>
          <h1 style={{ fontSize: "clamp(2.4rem, 4vw, 3.6rem)", letterSpacing: "-0.03em", marginBottom: "16px" }}>
            AI Video <span className="text-gradient">Prompts</span> Gallery
          </h1>
          <p className="text-secondary" style={{ fontSize: "1.15rem", maxWidth: "650px", margin: "0 auto 32px", lineHeight: "1.6" }}>
            Explore viral AI video prompts reverse-engineered by the community. 1-click copy or import straight into AutoFlow Studio.
          </p>

          {/* Search Bar */}
          <div style={{ maxWidth: "560px", margin: "0 auto 24px", position: "relative" }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search prompts by keyword, mood, or subject..."
              style={{
                width: "100%",
                padding: "14px 20px 14px 44px",
                background: "rgba(14, 15, 18, 0.8)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "9999px",
                color: "#FFF",
                fontSize: "0.95rem",
                outline: "none",
                boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
              }}
            />
            <span style={{ position: "absolute", left: "16px", top: "50%", transform: "translateY(-50%)", fontSize: "1.1rem", opacity: 0.5 }}>
              🔍
            </span>
          </div>

          {/* Platform Filter Tabs */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
            {["All", "OpenAI Sora", "Google Veo", "Runway Gen-3", "Kling AI", "Midjourney"].map((platform) => (
              <button
                key={platform}
                type="button"
                onClick={() => setSelectedPlatform(platform)}
                style={{
                  padding: "6px 16px",
                  border: "1px solid",
                  borderColor: selectedPlatform === platform ? "var(--primary)" : "rgba(255,255,255,0.08)",
                  borderRadius: "20px",
                  fontSize: "0.82rem",
                  fontWeight: selectedPlatform === platform ? "700" : "500",
                  color: selectedPlatform === platform ? "#FFF" : "var(--text-secondary)",
                  background: selectedPlatform === platform ? "rgba(255,92,0,0.18)" : "rgba(255,255,255,0.03)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {platform}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "100px 0" }}>
            <div style={{ width: "40px", height: "40px", border: "3px solid rgba(255,92,0,0.2)", borderTopColor: "var(--primary)", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }}></div>
            <p style={{ marginTop: "16px", color: "var(--text-secondary)" }}>Loading community prompts...</p>
          </div>
        ) : displayedPrompts.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: "center", padding: "80px 20px" }}>
            <p className="text-secondary" style={{ fontSize: "1.2rem" }}>
              No prompts found matching &quot;{searchQuery}&quot;. Try another search term!
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "24px", alignItems: "stretch" }}>
            {displayedPrompts.map((extraction) => {
              const firstPrompt = extraction.shots?.[0]?.prompt || extraction.shots?.[0]?.visual_prompt || extraction.video_concept;
              return (
                <div 
                  key={extraction.id}
                  className="glass-panel" 
                  style={{ 
                    padding: "24px", 
                    borderRadius: "16px", 
                    display: "flex",
                    flexDirection: "column",
                    position: "relative",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                    <h3 style={{ fontSize: "1.15rem", margin: 0, color: "white", lineHeight: "1.4", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" }}>
                      {extraction.video_name.replace(/\.[^/.]+$/, "")}
                    </h3>
                    <span className="badge" style={{ fontSize: "0.72rem", padding: "2px 8px", background: "rgba(255,92,0,0.1)", borderColor: "rgba(255,92,0,0.3)", color: "var(--primary-light)", whiteSpace: "nowrap", marginLeft: "8px" }}>
                      {extraction.platform || "Vision AI"}
                    </span>
                  </div>

                  <p style={{ fontSize: "0.88rem", color: "rgba(255,255,255,0.75)", marginBottom: "20px", lineHeight: "1.6", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", flex: 1 }}>
                    {firstPrompt}
                  </p>

                  <div style={{ marginTop: "auto", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                    <button
                      type="button"
                      className="sample-chip"
                      onClick={(e) => handleCopyPrompt(e, firstPrompt, extraction.id)}
                      style={{ fontSize: "0.78rem" }}
                    >
                      {copiedId === extraction.id ? "✓ Copied!" : "📋 Copy Prompt"}
                    </button>
                    
                    <a
                      href="/studio"
                      style={{ fontSize: "0.82rem", color: "var(--primary-light)", fontWeight: "600", textDecoration: "none" }}
                    >
                      Open in Studio →
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* SEO Content Section */}
        {!loading && (
          <div style={{ marginTop: "120px", position: "relative" }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "1px", background: "linear-gradient(90deg, transparent, var(--primary), transparent)", opacity: 0.3 }}></div>
            
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "60px", paddingTop: "80px", textAlign: "left" }}>
              <div>
                <h2 style={{ fontSize: "2rem", marginBottom: "20px", letterSpacing: "-0.02em" }}>Free AI Video <span className="text-gradient">Prompt Library</span></h2>
                <p className="text-secondary" style={{ fontSize: "1.05rem", lineHeight: 1.8 }}>
                  Our prompt gallery is a growing collection of <strong>reverse-engineered AI video prompts</strong> shared by the AutoFlow community. Every prompt in this library was extracted from a real AI-generated video using our <Link href={`${prefix}/extractor`} style={{ color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: "4px" }}>Video Prompt Extractor</Link>.
                </p>
                <p className="text-secondary" style={{ fontSize: "1.05rem", lineHeight: 1.8, marginTop: "12px" }}>
                  Browse prompts from videos made with <strong>Runway Gen-3, OpenAI Sora, Kling AI, Midjourney, Luma Dream Machine</strong>, and more. Each extraction includes scene-by-scene image prompts, motion prompts, character designs, and voiceover scripts — all free to copy and use.
                </p>
              </div>
              <div className="card-glass" style={{ padding: "36px", borderRadius: "var(--radius-xl)", background: "rgba(10,10,10,0.5)" }}>
                <h3 style={{ fontSize: "1.3rem", margin: "0 0 20px 0", color: "white" }}>How to Use These Prompts:</h3>
                <ol style={{ gap: "16px", listStyle: "none", display: "flex", flexDirection: "column", padding: 0, counterReset: "step" }}>
                  {[
                    { title: "Browse & pick a video", desc: "Find a prompt set that matches the style you want to recreate." },
                    { title: "Copy the prompts", desc: "Use the copy buttons to grab image prompts, motion prompts, or both." },
                    { title: "Generate with AutoFlow", desc: "Paste into the AutoFlow extension to batch-generate all scenes at once on Google Flow." },
                  ].map((step, i) => (
                    <li key={i} style={{ display: "flex", gap: "16px", alignItems: "flex-start", color: "var(--text-secondary)" }}>
                      <span style={{ color: "var(--primary)", fontSize: "1.1rem", fontWeight: 700, background: "rgba(255,92,0,0.1)", width: "32px", height: "32px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
                      <div>
                        <strong style={{ color: "white", display: "block", marginBottom: "2px" }}>{step.title}</strong>
                        {step.desc}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "CollectionPage",
              name: "AI Video Prompts Gallery",
              description: "Community library of reverse-engineered AI video prompts for Runway, Sora, Midjourney, Kling, Luma, and Google Veo.",
              url: "https://www.auto-flow.studio/prompts",
              isPartOf: { "@type": "WebSite", name: "AutoFlow", url: "https://www.auto-flow.studio" },
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
                { "@type": "ListItem", position: 2, name: "Prompts Gallery", item: "https://www.auto-flow.studio/prompts" },
              ],
            }),
          }}
        />
      </div>
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
