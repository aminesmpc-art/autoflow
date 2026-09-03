"use client";

import { useAuth } from "../context/AuthContext";
import Link from "next/link";

export default function AuthButtons() {
  const { user, loading, logout } = useAuth();

  if (loading) return null;

  if (user) {
    return (
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <Link
          href="/dashboard"
          style={{
            padding: "5px 12px",
            borderRadius: "9999px",
            fontSize: "0.82rem",
            fontWeight: "500",
            textDecoration: "none",
            color: "rgba(255, 255, 255, 0.85)",
            background: "rgba(255, 255, 255, 0.06)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            transition: "all 0.15s ease",
          }}
        >
          Dashboard
        </Link>
        <button
          onClick={logout}
          style={{
            background: "transparent",
            border: "none",
            color: "rgba(255, 255, 255, 0.6)",
            padding: "5px 10px",
            borderRadius: "9999px",
            fontSize: "0.82rem",
            fontWeight: "500",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#FFF")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255, 255, 255, 0.6)")}
        >
          Log Out
        </button>
      </div>
    );
  }

  return (
    <Link
      href="/login"
      style={{
        background: "transparent",
        color: "rgba(255, 255, 255, 0.8)",
        padding: "6px 12px",
        borderRadius: "9999px",
        fontSize: "0.84rem",
        fontWeight: "500",
        textDecoration: "none",
        transition: "all 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "#FFFFFF";
        e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "rgba(255, 255, 255, 0.8)";
        e.currentTarget.style.background = "transparent";
      }}
    >
      Log In
    </Link>
  );
}
