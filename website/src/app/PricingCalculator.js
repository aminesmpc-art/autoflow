"use client";

import { useState } from "react";
import StoreLink from "./StoreLink";

const COMPARISON_ROWS = [
  { feature: "Studio Workflow Builder", category: "AutoFlow Studio" },
  { feature: "Monthly Workflow Executions", free: "10 runs / month", pro: "Unlimited" },
  { feature: "Max Nodes per Canvas Graph", free: "Unlimited", pro: "Unlimited" },
  { feature: "Story Director Character Lock", free: "1 Character", pro: "Unlimited Characters" },
  { feature: "Last Frame Chain (0 Drift)", free: "✓ Included", pro: "✓ Included" },
  { feature: "Pro Template Workflows", free: "Standard", pro: "All Pro & Cinematic Presets" },
  
  { feature: "AI Video Prompt Extractor", category: "Video Extractor" },
  { feature: "Daily Extraction Runs", free: "3 runs / day", pro: "20 runs / day" },
  { feature: "Multi-Shot Vision Breakdown", free: "✓ Included", pro: "✓ Included" },
  { feature: "Character Sheet Generation", free: "✓ Included", pro: "✓ Included" },
  { feature: "1-Click ComfyUI Graph Export", free: "✓ Included", pro: "✓ Included" },

  { feature: "Queue Manager Automation", category: "Queue Manager" },
  { feature: "Daily Text Prompts", free: "50 prompts / day", pro: "Unlimited Prompts" },
  { feature: "Image-to-Video Prompts", free: "20 / day", pro: "Unlimited" },
  { feature: "Bulk 4K Video Harvester", free: "Standard Speed", pro: "High-Speed Parallel 4K" },
  { feature: "Auto-Retry Failed Generations", free: "✓ Included", pro: "✓ Instant Retry" },
  { feature: "Support Tier", free: "Community Discord", pro: "VIP Priority Support" },
];

export default function PricingCalculator() {
  const [billingCycle, setBillingCycle] = useState("monthly"); // 'monthly' | 'annual'

  const proPrice = billingCycle === "monthly" ? "$9.99" : "$7.99";
  const proPeriod = billingCycle === "monthly" ? "/ month" : "/ month (billed annually)";

  return (
    <div>
      {/* ── Billing Switcher ── */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "16px", marginBottom: "48px" }}>
        <button
          type="button"
          onClick={() => setBillingCycle("monthly")}
          style={{
            padding: "8px 20px",
            borderRadius: "9999px",
            fontSize: "0.92rem",
            fontWeight: "600",
            cursor: "pointer",
            background: billingCycle === "monthly" ? "rgba(255, 92, 0, 0.18)" : "transparent",
            color: billingCycle === "monthly" ? "#FFF" : "var(--text-secondary)",
            border: billingCycle === "monthly" ? "1px solid var(--primary)" : "1px solid transparent",
            transition: "all 0.2s ease",
          }}
        >
          Monthly Billing
        </button>

        <button
          type="button"
          onClick={() => setBillingCycle("annual")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 20px",
            borderRadius: "9999px",
            fontSize: "0.92rem",
            fontWeight: "600",
            cursor: "pointer",
            background: billingCycle === "annual" ? "rgba(255, 92, 0, 0.18)" : "transparent",
            color: billingCycle === "annual" ? "#FFF" : "var(--text-secondary)",
            border: billingCycle === "annual" ? "1px solid var(--primary)" : "1px solid transparent",
            transition: "all 0.2s ease",
          }}
        >
          Annual Billing
          <span style={{ fontSize: "0.75rem", background: "var(--gradient-primary)", color: "#FFF", padding: "2px 8px", borderRadius: "99px", fontWeight: "800" }}>
            SAVE 20%
          </span>
        </button>
      </div>

      {/* ── Pricing Cards Grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "32px", maxWidth: "960px", margin: "0 auto 80px" }}>
        {/* Free Plan */}
        <div className="glass-panel" style={{ padding: "40px 32px", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: "1.2rem", fontWeight: "700", color: "var(--text-secondary)", marginBottom: "8px" }}>Free Tier</div>
          <div style={{ fontSize: "2.8rem", fontWeight: "800", color: "#FFF", marginBottom: "8px" }}>
            $0 <span style={{ fontSize: "1rem", color: "var(--text-muted)", fontWeight: "500" }}>/ forever</span>
          </div>
          <p className="text-secondary" style={{ fontSize: "0.95rem", marginBottom: "28px" }}>
            Everything you need to test the workflow canvas and automate batch queues.
          </p>

          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "12px", marginBottom: "36px", flex: 1, color: "var(--text-secondary)", fontSize: "0.92rem" }}>
            <li style={{ display: "flex", gap: "10px" }}><span style={{ color: "var(--primary)" }}>✓</span> 10 Studio workflow runs / month</li>
            <li style={{ display: "flex", gap: "10px" }}><span style={{ color: "var(--primary)" }}>✓</span> 3 Video Prompt Extractions / day</li>
            <li style={{ display: "flex", gap: "10px" }}><span style={{ color: "var(--primary)" }}>✓</span> 50 Google Flow prompts / day</li>
            <li style={{ display: "flex", gap: "10px" }}><span style={{ color: "var(--primary)" }}>✓</span> Unlimited nodes per canvas graph</li>
            <li style={{ display: "flex", gap: "10px" }}><span style={{ color: "var(--primary)" }}>✓</span> 1 Character face continuity lock</li>
          </ul>

          <StoreLink className="btn btn-secondary" style={{ textAlign: "center", width: "100%" }}>
            Install Free
          </StoreLink>
        </div>

        {/* Pro Plan */}
        <div
          className="glass-panel"
          style={{
            padding: "40px 32px",
            display: "flex",
            flexDirection: "column",
            border: "1px solid var(--primary)",
            background: "linear-gradient(160deg, rgba(255, 92, 0, 0.12) 0%, rgba(12, 12, 14, 0.95) 100%)",
            boxShadow: "0 20px 60px -10px rgba(255, 92, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.2)",
            position: "relative",
          }}
        >
          <div style={{ position: "absolute", top: "-12px", right: "24px", background: "var(--gradient-primary)", color: "#FFF", fontSize: "0.75rem", fontWeight: "800", padding: "3px 12px", borderRadius: "99px", letterSpacing: "0.5px" }}>
            MOST POPULAR
          </div>

          <div style={{ fontSize: "1.2rem", fontWeight: "700", color: "var(--primary-light)", marginBottom: "8px" }}>Pro Creator</div>
          <div style={{ fontSize: "2.8rem", fontWeight: "800", color: "#FFF", marginBottom: "8px" }}>
            {proPrice} <span style={{ fontSize: "0.95rem", color: "rgba(255,255,255,0.7)", fontWeight: "500" }}>{proPeriod}</span>
          </div>
          <p className="text-secondary" style={{ fontSize: "0.95rem", marginBottom: "28px" }}>
            Unlimited creation across Studio, Video Extractor, and Queue Manager.
          </p>

          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "12px", marginBottom: "36px", flex: 1, color: "#FFF", fontSize: "0.92rem" }}>
            <li style={{ display: "flex", gap: "10px" }}><span style={{ color: "#10B981", fontWeight: "700" }}>✓</span> <strong>Unlimited</strong> Studio workflow runs</li>
            <li style={{ display: "flex", gap: "10px" }}><span style={{ color: "#10B981", fontWeight: "700" }}>✓</span> <strong>20</strong> Video Prompt Extractions / day</li>
            <li style={{ display: "flex", gap: "10px" }}><span style={{ color: "#10B981", fontWeight: "700" }}>✓</span> <strong>Unlimited</strong> prompt automation</li>
            <li style={{ display: "flex", gap: "10px" }}><span style={{ color: "#10B981", fontWeight: "700" }}>✓</span> <strong>Unlimited</strong> character continuity locks</li>
            <li style={{ display: "flex", gap: "10px" }}><span style={{ color: "#10B981", fontWeight: "700" }}>✓</span> High-speed bulk 4K video harvester</li>
            <li style={{ display: "flex", gap: "10px" }}><span style={{ color: "#10B981", fontWeight: "700" }}>✓</span> VIP Priority support &amp; early model access</li>
          </ul>

          <a
            href="/checkout"
            className="btn btn-primary"
            style={{ textAlign: "center", width: "100%", padding: "14px", fontWeight: "700", fontSize: "1rem" }}
          >
            Upgrade to Pro Now →
          </a>
        </div>
      </div>

      {/* ── Feature Comparison Matrix Table ── */}
      <div style={{ maxWidth: "960px", margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <h2 style={{ fontSize: "2rem", marginBottom: "10px" }}>Plan <span className="text-gradient">Feature Comparison</span></h2>
          <p className="text-secondary">Detailed breakdown of everything included in Free vs Pro.</p>
        </div>

        <div
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-xl)",
            overflow: "hidden",
            border: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.92rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.1)", background: "rgba(255,255,255,0.02)" }}>
                <th style={{ padding: "18px 24px", color: "var(--text-secondary)", fontWeight: "600", width: "45%" }}>Feature</th>
                <th style={{ padding: "18px 24px", color: "var(--text-secondary)", fontWeight: "600", width: "27.5%" }}>Free</th>
                <th style={{ padding: "18px 24px", color: "var(--primary-light)", fontWeight: "700", width: "27.5%" }}>Pro ($9.99)</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row, idx) => {
                if (row.category) {
                  return (
                    <tr key={idx} style={{ background: "rgba(255, 92, 0, 0.06)", borderTop: "1px solid rgba(255,255,255,0.08)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      <td colSpan={3} style={{ padding: "12px 24px", fontWeight: "700", color: "var(--primary-light)", fontSize: "0.85rem", letterSpacing: "0.5px", textTransform: "uppercase" }}>
                        ⚡ {row.category}
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={idx} style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.05)" }}>
                    <td style={{ padding: "14px 24px", color: "rgba(255,255,255,0.9)" }}>{row.feature}</td>
                    <td style={{ padding: "14px 24px", color: "var(--text-secondary)" }}>{row.free}</td>
                    <td style={{ padding: "14px 24px", color: "#10B981", fontWeight: "600" }}>{row.pro}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
