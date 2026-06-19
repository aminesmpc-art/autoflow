"use client";

import { useState, useEffect } from "react";

export default function MobileBanner() {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Only show on mobile devices
    const isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(
      navigator.userAgent
    );
    if (!isMobile) return;

    // Don't re-show if dismissed in this session
    const dismissed = sessionStorage.getItem("mobile-banner-dismissed");
    if (dismissed) return;

    // Show after a short delay so it doesn't feel aggressive
    const timer = setTimeout(() => setVisible(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    sessionStorage.setItem("mobile-banner-dismissed", "1");
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText("https://www.auto-flow.studio");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement("input");
      input.value = "https://www.auto-flow.studio";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "AutoFlow — AI Video Automation",
          text: "Check out AutoFlow — automate Google Flow AI video generation with batch prompts, smart queues, and 4K download.",
          url: "https://www.auto-flow.studio",
        });
      } catch {
        // User cancelled share
      }
    }
  };

  if (!visible) return null;

  return (
    <div className="mobile-banner" role="dialog" aria-label="Desktop extension notice">
      <button
        className="mobile-banner-close"
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        ✕
      </button>

      <div className="mobile-banner-icon">💻</div>

      <p className="mobile-banner-title">
        AutoFlow is a <strong>desktop Chrome</strong> extension
      </p>
      <p className="mobile-banner-subtitle">
        Send the link to your computer to install it
      </p>

      <div className="mobile-banner-actions">
        <button className="btn btn-primary btn-sm" onClick={handleCopyLink}>
          {copied ? "✓ Copied!" : "📋 Copy Link"}
        </button>
        {typeof navigator !== "undefined" && navigator.share && (
          <button className="btn btn-secondary btn-sm" onClick={handleShare}>
            📤 Share
          </button>
        )}
      </div>
    </div>
  );
}
