"use client";

import { useState } from "react";

export default function CopyButton({ text, label = "Copy", style }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.preventDefault();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button 
      onClick={handleCopy}
      style={{
        background: "rgba(255,255,255,0.1)",
        border: "none",
        color: "white",
        borderRadius: "6px",
        padding: "6px 12px",
        fontSize: "0.8rem",
        cursor: "pointer",
        transition: "all 0.2s",
        ...style
      }}
      onMouseEnter={(e) => {
        if (!style?.background) {
          e.currentTarget.style.background = "var(--primary)";
        } else {
          e.currentTarget.style.filter = "brightness(1.2)";
        }
      }}
      onMouseLeave={(e) => {
        if (!style?.background) {
          e.currentTarget.style.background = "rgba(255,255,255,0.1)";
        } else {
          e.currentTarget.style.filter = "brightness(1)";
        }
      }}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
