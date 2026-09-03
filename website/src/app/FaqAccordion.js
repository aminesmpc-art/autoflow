"use client";

import { useState } from "react";

const FAQ_ITEMS = [
  {
    q: "How does AutoFlow Studio differ from the Queue Manager?",
    a: "AutoFlow Studio is a visual node-based canvas (like ComfyUI) designed for multi-shot cinematic storytelling, character consistency, and chaining shots. AutoFlow Queue Manager is our high-speed batch automation extension for queuing 500+ prompts in Google Flow and auto-downloading videos in 4K."
  },
  {
    q: "What is the AI Video Prompt Extractor?",
    a: "The Video Prompt Extractor uses vision AI to analyze any AI-generated video (Sora, Runway, Kling, Veo) and extracts the exact scene prompts, camera motion descriptors, lighting cues, and character design sheets. You can copy prompts or export them directly as an AutoFlow Studio workflow."
  },
  {
    q: "Do I need technical skills or Python to use AutoFlow Studio?",
    a: "No! AutoFlow Studio runs 100% in your browser. You can connect nodes, lock character faces, and orchestrate Google Flow and Grok with simple drag-and-drop or plain English AI prompts."
  },
  {
    q: "Is there a free trial or free tier available?",
    a: "Yes! Both the AutoFlow Chrome Extension and the Video Prompt Extractor have free tiers. You can install the extension for free with standard batching, and extract up to 3 video prompts daily without a paid subscription."
  },
  {
    q: "What AI video platforms are supported?",
    a: "AutoFlow supports Google Flow (Veo 2 & 3.1), Grok 3 AI Video, ChatGPT / DALL-E, Sora, Runway Gen-3, Kling AI, and Midjourney."
  }
];

export default function FaqAccordion() {
  const [openIndex, setOpenIndex] = useState(0);

  const toggle = (idx) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "12px" }}>
      {FAQ_ITEMS.map((item, idx) => {
        const isOpen = openIndex === idx;
        return (
          <div
            key={idx}
            className="glass-panel"
            style={{
              padding: "20px 24px",
              cursor: "pointer",
              borderColor: isOpen ? "rgba(255, 92, 0, 0.4)" : "rgba(255, 255, 255, 0.08)",
              background: isOpen ? "rgba(255, 92, 0, 0.04)" : "rgba(14, 15, 18, 0.7)",
            }}
            onClick={() => toggle(idx)}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px" }}>
              <h3 style={{ fontSize: "1.08rem", fontWeight: "600", color: isOpen ? "var(--primary-light)" : "#FFF", margin: 0 }}>
                {item.q}
              </h3>
              <span style={{ fontSize: "1.25rem", color: "var(--primary)", fontWeight: "700", transition: "transform 0.2s", transform: isOpen ? "rotate(45deg)" : "none", display: "inline-block" }}>
                +
              </span>
            </div>
            {isOpen && (
              <p className="text-secondary" style={{ marginTop: "14px", fontSize: "0.95rem", lineHeight: 1.6, color: "rgba(255,255,255,0.75)" }}>
                {item.a}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
