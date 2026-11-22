"use client";

/* Pay for Pro with Binance Pay (the owner, 2026-11-22: "A, 1 month $4.99,
   USDT only"). The buyer sends USDT to our Binance Pay ID, pastes the Order ID
   from their Binance receipt, and the server checks it against our own Pay
   history and gives a month of Pro (backend apps/plans/binance.py). The claim
   needs a signed-in account: the order is credited to it, so the page says
   which one, and a visitor who is not signed in is asked to sign in first. */

import { useEffect, useState } from "react";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.auto-flow.studio/api";

export default function BinancePay({ user, token, extensionEmail }) {
  const [info, setInfo] = useState(null);
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/billing/binance`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo({ enabled: false }));
  }, []);

  if (!info) return <p className="text-secondary" style={{ textAlign: "center" }}>Loading…</p>;
  if (!info.enabled) {
    return <p className="text-secondary" style={{ textAlign: "center" }}>Paying with Binance opens soon. Use the card checkout for now.</p>;
  }

  if (!user || !token) {
    return (
      <div style={{ textAlign: "center" }}>
        <p className="text-secondary">Sign in to pay with Binance: the month of Pro goes to the account you are signed in with.</p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", marginTop: "1rem" }}>
          <Link href="/login?next=/checkout%3Fmethod%3Dbinance" className="btn btn-primary">Log In</Link>
          <Link href="/register" className="btn btn-secondary">Create Account</Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={{ textAlign: "center", padding: "1rem 0" }}>
        <div style={{ fontSize: "2.5rem" }}>🎉</div>
        <h2 style={{ marginTop: "0.5rem" }}>You&apos;re Pro</h2>
        <p className="text-secondary" style={{ marginTop: "0.5rem" }}>
          {user.email} is Pro until <strong>{new Date(done.pro_until).toLocaleDateString()}</strong>.
          In the extension, press <strong>Refresh usage</strong>.
        </p>
      </div>
    );
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(info.pay_id); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
  };

  const check = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/billing/binance/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ order_id: orderId.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setDone(data);
        window.gtag?.("event", "pro_checkout_complete", { method: "binance" });
      } else {
        setError(data.detail || (res.status === 429 ? "Too many tries. Wait a little and try again." : "That order could not be checked."));
      }
    } catch {
      setError("Could not reach AutoFlow. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const step = { display: "flex", gap: "0.75rem", alignItems: "flex-start", marginTop: "1.1rem" };
  const num = { flex: "0 0 auto", width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: "0.8rem", fontWeight: 700, background: "rgba(240,185,11,.15)", color: "#f0b90b" };
  const box = { width: "100%", marginTop: "0.5rem", padding: "0.8rem 0.9rem", borderRadius: 12, border: "1px solid var(--border, rgba(255,255,255,.12))", background: "rgba(255,255,255,.03)", color: "inherit", fontSize: "1rem", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };

  return (
    <form onSubmit={check}>
      <h3 style={{ margin: 0 }}>Pay {info.amount} {info.currency} with Binance Pay</h3>
      <p className="text-secondary" style={{ fontSize: "0.85rem", marginTop: "0.35rem" }}>
        One month of Pro for <strong style={{ color: "var(--text-primary)" }}>{user.email}</strong>. It does not renew by itself; pay again for another month.
      </p>
      {extensionEmail && extensionEmail !== user.email && (
        <p style={{ fontSize: "0.85rem", marginTop: "0.5rem", color: "#f59e0b" }}>
          The extension is signed in as {extensionEmail}, but this page as {user.email}. Pro goes to {user.email}. <Link href="/login">Switch account</Link>
        </p>
      )}

      <div style={step}>
        <span style={num}>1</span>
        <div style={{ flex: 1 }}>
          <strong>Send {info.amount} {info.currency} to this Binance Pay ID</strong>
          <button type="button" onClick={copy} style={{ ...box, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", textAlign: "left" }}>
            <span>{info.pay_id}</span><span style={{ fontSize: "0.8rem", opacity: 0.7, fontFamily: "inherit" }}>{copied ? "Copied" : "Copy"}</span>
          </button>
          <p className="text-secondary" style={{ fontSize: "0.78rem", marginTop: "0.35rem" }}>In Binance: Pay → Send → Pay ID. Send {info.currency} only.</p>
        </div>
      </div>

      <div style={step}>
        <span style={num}>2</span>
        <div style={{ flex: 1 }}>
          <strong>Paste the Order ID from your receipt</strong>
          <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="1234567890123456789" inputMode="numeric" autoComplete="off" style={box} required />
          <p className="text-secondary" style={{ fontSize: "0.78rem", marginTop: "0.35rem" }}>
            The payment must be from the last {Math.round(info.window_hours / 24)} days and at least {info.amount} {info.currency}.
          </p>
        </div>
      </div>

      {error && <p style={{ color: "#ef4444", fontSize: "0.85rem", marginTop: "0.9rem" }}>{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy || !orderId.trim()}
        style={{ display: "block", width: "100%", marginTop: "1.25rem", padding: "0.95rem 1.25rem", fontSize: "1.05rem" }}>
        {busy ? "Checking…" : "I've paid — check it"}
      </button>
      <p className="text-secondary" style={{ fontSize: "0.75rem", marginTop: "0.75rem", textAlign: "center" }}>
        Paid to AutoFlow&apos;s Binance account. This page never asks for a password or your Binance keys.
      </p>
    </form>
  );
}
