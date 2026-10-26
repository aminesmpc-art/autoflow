"use client";

import { useState } from "react";

/* The questions come from the page that shows them; the home page passes its
   own. Each question is a real button, so the list also works from the
   keyboard. */
export default function FaqAccordion({ items }) {
  const [openIndex, setOpenIndex] = useState(0);

  const toggle = (idx) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "12px" }}>
      {items.map((item, idx) => {
        const isOpen = openIndex === idx;
        return (
          <div
            key={item.q}
            className="glass-panel"
            style={{
              padding: "20px 24px",
              borderColor: isOpen ? "rgba(255, 92, 0, 0.4)" : "rgba(255, 255, 255, 0.08)",
              background: isOpen ? "rgba(255, 92, 0, 0.04)" : "rgba(14, 15, 18, 0.7)",
            }}
          >
            <button
              type="button"
              onClick={() => toggle(idx)}
              aria-expanded={isOpen}
              style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", padding: 0, border: "none", background: "none", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}
            >
              <h3 style={{ fontSize: "1.08rem", fontWeight: "600", color: isOpen ? "var(--primary-light)" : "#FFF", margin: 0 }}>
                {item.q}
              </h3>
              <span aria-hidden="true" style={{ fontSize: "1.25rem", color: "var(--primary)", fontWeight: "700", transition: "transform 0.2s", transform: isOpen ? "rotate(45deg)" : "none", display: "inline-block" }}>
                +
              </span>
            </button>
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
