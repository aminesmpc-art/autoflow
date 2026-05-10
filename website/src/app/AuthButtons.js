"use client";

import { useAuth } from "../context/AuthContext";
import Link from "next/link";

export default function AuthButtons() {
  const { user, loading, logout } = useAuth();

  if (loading) return null;

  if (user) {
    return (
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <Link href="/extractor" className="btn btn-secondary" style={{ padding: "0.5rem 1rem", borderRadius: "8px", textDecoration: "none", color: "var(--text-primary)", background: "rgba(255, 255, 255, 0.1)" }}>
          Extractor
        </Link>
        <button onClick={logout} className="btn btn-secondary" style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "white", padding: "0.5rem 1rem", borderRadius: "8px", cursor: "pointer" }}>
          Log Out
        </button>
      </div>
    );
  }

  return (
    <Link href="/login" className="btn btn-secondary" style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "white", padding: "0.5rem 1rem", borderRadius: "8px", textDecoration: "none" }}>
      Log In
    </Link>
  );
}
