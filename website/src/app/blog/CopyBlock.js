"use client";
import { useState } from "react";

export default function CopyBlock({ children }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="blog-code-wrap">
      <button className="blog-code-copy" onClick={handleCopy}>
        {copied ? "✅ Copied!" : "📋 Copy Prompt"}
      </button>
      <pre className="blog-code">{children}</pre>
    </div>
  );
}
