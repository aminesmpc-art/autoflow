import Link from "next/link";
import CopyButton from "./CopyButton";

const DJANGO_API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.auto-flow.studio/api";

async function getExtraction(id) {
  try {
    const res = await fetch(`${DJANGO_API_URL}/extractions/public/${id}/`, {
      next: { revalidate: 60 } // Cache for 60 seconds
    });
    if (!res.ok) {
      return null;
    }
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }) {
  const resolvedParams = await params;
  const extraction = await getExtraction(resolvedParams.id);
  
  if (!extraction) {
    return { title: "Prompt Not Found | AutoFlow" };
  }
  
  return {
    title: `${extraction.video_name.replace(/\.[^/.]+$/, "")} AI Prompts | AutoFlow`,
    description: `Get exact Midjourney and Runway motion prompts used to create the AI video for ${extraction.video_name}. Reverse engineered by AutoFlow.`,
    openGraph: {
      title: `${extraction.video_name} AI Video Prompts`,
      description: extraction.video_concept.substring(0, 160),
    }
  };
}

export default async function PromptDetailPage({ params }) {
  const resolvedParams = await params;
  const extraction = await getExtraction(resolvedParams.id);
  const locale = resolvedParams.locale;
  const prefix = locale && locale !== 'en' ? `/${locale}` : '';

  if (!extraction) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "black" }}>
        <div className="card-glass" style={{ textAlign: "center", padding: "40px", borderColor: "rgba(239, 68, 68, 0.3)" }}>
          <p style={{ color: "#ef4444", marginBottom: "16px" }}>Extraction not found</p>
          <Link href={`${prefix}/prompts`} className="btn btn-secondary">← Back to Gallery</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="section" style={{ minHeight: "100vh", position: "relative", overflow: "hidden", padding: "120px 0 60px" }}>
      {/* Absolute Ambient Backgrounds */}
      <div style={{ position: "absolute", top: "-10%", left: "50%", transform: "translateX(-50%)", width: "80vw", height: "80vw", background: "radial-gradient(circle, rgba(16, 185, 129, 0.08) 0%, rgba(0,0,0,0) 70%)", zIndex: -1, pointerEvents: "none" }} />
      
      <div className="container" style={{ position: "relative", zIndex: 1, maxWidth: "900px" }}>
        <Link href={`${prefix}/prompts`} style={{ display: "inline-flex", alignItems: "center", color: "var(--text-secondary)", textDecoration: "none", marginBottom: "32px", fontSize: "0.95rem" }}>
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
                          <CopyButton text={shot.image_prompt} style={{ position: "absolute", top: "12px", right: "12px" }} />
                        </div>
                      </div>
                    )}

                    {shot.video_prompt && (
                      <div>
                        <div style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "1px", color: "var(--text-muted)", marginBottom: "8px", fontWeight: "600" }}>Motion Prompt (Runway/Sora/Veo)</div>
                        <div style={{ background: "rgba(16, 185, 129, 0.05)", padding: "16px", borderRadius: "12px", fontSize: "0.95rem", color: "rgba(255,255,255,0.9)", position: "relative", border: "1px solid rgba(16, 185, 129, 0.1)" }}>
                          <div style={{ paddingRight: "70px", lineHeight: "1.6" }}>{shot.video_prompt}</div>
                          <CopyButton text={shot.video_prompt} style={{ position: "absolute", top: "12px", right: "12px", background: "rgba(16, 185, 129, 0.2)" }} />
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
                      <CopyButton 
                        text={char.prompt} 
                        label="📋"
                        style={{ position: "absolute", top: "12px", right: "12px", background: "rgba(255,255,255,0.1)", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }} 
                      />
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
                <p style={{ fontSize: "1.05rem", color: "var(--text-secondary)", lineHeight: "1.7", margin: 0, paddingRight: "100px", whiteSpace: "pre-wrap" }}>
                  {extraction.voiceover_text}
                </p>
                <CopyButton 
                  text={extraction.voiceover_text} 
                  label="Copy Script"
                  style={{ position: "absolute", top: "24px", right: "24px" }} 
                />
              </div>
            </div>
          )}
          {/* Export for AutoFlow */}
          {extraction.shots && extraction.shots.length > 0 && (
            <div style={{ marginTop: "32px", padding: "48px", borderRadius: "32px", border: "1px solid rgba(22, 163, 74, 0.3)", background: "linear-gradient(145deg, rgba(22, 163, 74, 0.05) 0%, rgba(0,0,0,0.8) 100%)", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, right: 0, width: "300px", height: "300px", background: "radial-gradient(circle, rgba(22, 163, 74, 0.1) 0%, transparent 70%)", pointerEvents: "none" }}></div>
              
              <div style={{ position: "relative", zIndex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "16px" }}>
                  <div style={{ width: "56px", height: "56px", borderRadius: "16px", background: "rgba(22, 163, 74, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.8rem", border: "1px solid rgba(22, 163, 74, 0.2)", boxShadow: "0 0 20px rgba(22, 163, 74, 0.2)" }}>🚀</div>
                  <h3 style={{ margin: 0, fontSize: "1.8rem", color: "white" }}>Export for <span style={{ color: "#4ade80" }}>AutoFlow Extension</span></h3>
                </div>
                <p className="text-secondary" style={{ marginBottom: "40px", fontSize: "1.1rem", maxWidth: "600px" }}>
                  Skip the manual copy-pasting. Batch generate these exact scenes simultaneously using the <a href="https://chromewebstore.google.com/detail/autoflow-video-task-man/egplmjhmcicjkojopeoaohofckgeoipc" target="_blank" rel="noopener noreferrer" style={{ color: "#4ade80", textDecoration: "underline", textUnderlineOffset: "4px" }}>AutoFlow Chrome Extension</a>. Not sure how? <a href="/blog/how-to-recreate-ai-videos-with-extractor-and-autoflow" style={{ color: "var(--text-primary)", textDecoration: "underline", textUnderlineOffset: "4px" }}>Read the step-by-step tutorial</a>.
                </p>

                <div style={{ display: "grid", gap: "32px", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
                  <div style={{ padding: "24px", background: "rgba(0,0,0,0.4)", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <h4 style={{ fontSize: "1.1rem", marginBottom: "8px", color: "white" }}>1. Image Prompts</h4>
                    <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "20px" }}>Generates the Midjourney style references.</p>
                    <CopyButton 
                      text={extraction.shots.map(s => s.image_prompt).filter(Boolean).join("\n\n")} 
                      label="📋 Copy Image Prompts"
                      style={{ width: "100%", padding: "16px", borderRadius: "12px", background: "white", color: "black", fontWeight: "600", fontSize: "1.05rem" }} 
                    />
                  </div>

                  <div style={{ padding: "24px", background: "rgba(0,0,0,0.4)", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <h4 style={{ fontSize: "1.1rem", marginBottom: "8px", color: "white" }}>2. Video Prompts</h4>
                    <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "20px" }}>Generates the Runway/Sora motion generation.</p>
                    <CopyButton 
                      text={extraction.shots.map(s => s.video_prompt).filter(Boolean).join("\n\n")} 
                      label="📋 Copy Video Prompts"
                      style={{ width: "100%", padding: "16px", borderRadius: "12px", background: "linear-gradient(135deg, #16a34a 0%, #22c55e 100%)", color: "white", fontWeight: "600", fontSize: "1.05rem", boxShadow: "0 10px 20px rgba(22, 163, 74, 0.2)" }} 
                    />
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
      </div>
    </div>
  );
}
