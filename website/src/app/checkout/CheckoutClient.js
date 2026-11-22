"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import BinancePay from "./BinancePay";

const PLAN_ID = "plan_C5eboY2bFqzUn";
const HOSTED_FALLBACK = `https://whop.com/checkout/${PLAN_ID}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The extension passes the account email in the URL *fragment*, not the query
 * string. Fragments are never sent to the server, so the address stays out of
 * request logs, analytics, and Referer headers on the way to Whop.
 */
function readHashEmail() {
  try {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return null;
    const raw = new URLSearchParams(hash).get("email");
    if (!raw) return null;
    const email = raw.trim().toLowerCase();
    return EMAIL_RE.test(email) ? email : null;
  } catch {
    return null;
  }
}

export default function CheckoutClient() {
  const { user, token, loading } = useAuth();
  const [hashEmail, setHashEmail] = useState(null);
  const [hashRead, setHashRead] = useState(false);
  /* Card through Whop, or USDT through Binance Pay (2026-11-22). ?method=binance opens the second. */
  const [method, setMethod] = useState("card");
  const [done, setDone] = useState(false);

  // location.hash is client-only, so it cannot be read during render.
  useEffect(() => {
    setHashEmail(readHashEmail());
    setHashRead(true);
    try {
      if (new URLSearchParams(window.location.search).get("method") === "binance") setMethod("binance");
    } catch { /* */ }
  }, []);

  useEffect(() => {
    window.afCheckoutComplete = () => {
      setDone(true);
      // Which button sold it is the session's utm_content: the extensions tag
      // every Upgrade link. No email or receipt goes to analytics.
      window.gtag?.("event", "pro_checkout_complete", { plan_id: PLAN_ID });
    };
    return () => {
      delete window.afCheckoutComplete;
    };
  }, []);

  // The extension knows which account is upgrading; a website session is only
  // a fallback for people who land here directly.
  const email = hashEmail || user?.email || null;
  const ready = hashRead && !loading;

  if (!ready) {
    return (
      <section className="section">
        <div className="container" style={{ textAlign: "center", padding: "4rem 0" }}>
          <p className="text-secondary">Loading checkout…</p>
        </div>
      </section>
    );
  }

  if (done) {
    return (
      <section className="section">
        <div className="container" style={{ maxWidth: 560, textAlign: "center", padding: "3rem 0" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🎉</div>
          <h1>You&apos;re Pro</h1>
          <p className="text-secondary" style={{ marginTop: "0.75rem" }}>
            Your payment went through on <strong>{email}</strong> — the same account you
            use in AutoFlow. Go back to the extension: AutoFlow Motion switches to Pro by
            itself within a minute, and in Queue Manager, press <strong>Refresh Usage</strong>.
          </p>
        </div>
      </section>
    );
  }

  // No account = nothing for the Whop webhook to attach the subscription to.
  // Paying from here would strand the subscription, so don't offer checkout.
  if (!email) {
    return (
      <section className="section">
        <div className="container" style={{ maxWidth: 560, textAlign: "center", padding: "3rem 0" }}>
          <div className="badge">Upgrade</div>
          <h1 style={{ marginTop: "1rem" }}>Sign in first</h1>
          <p className="text-secondary" style={{ marginTop: "0.75rem" }}>
            Pro is tied to your AutoFlow account. Sign in so we know which account to
            upgrade — otherwise your payment can&apos;t be matched to you.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", marginTop: "1.5rem" }}>
            <Link href="/login" className="btn btn-primary">Log In</Link>
            <Link href="/register" className="btn btn-secondary">Create Account</Link>
          </div>
        </div>
      </section>
    );
  }

  // `email.disabled=1` locks the field on Whop's hosted page (checked live
  // 2026-11-22 for a buyer not signed in to Whop). Undocumented: if Whop drops
  // it the field silently becomes editable again.
  const hostedUrl =
    `${HOSTED_FALLBACK}?email=${encodeURIComponent(email)}&email.disabled=1`;

  return (
    <section className="section">
      <div className="container" style={{ maxWidth: 560, padding: "2rem 0" }}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <div className="badge">Upgrade</div>
          <h1 style={{ marginTop: "1rem" }}>
            AutoFlow <span className="text-gradient">Pro</span>
          </h1>
          <p className="text-secondary" style={{ marginTop: "0.75rem" }}>
            Upgrading <strong style={{ color: "var(--text-primary)" }}>{email}</strong>
          </p>
          <p className="text-secondary" style={{ fontSize: "0.85rem", marginTop: "0.35rem" }}>
            Pro activates on this account automatically.{" "}
            <Link href="/login">Not you?</Link>
          </p>
        </div>

        {/*
          Whop's embedded checkout stopped opening (2026-11-22): its iframe,
          /embedded/checkout/<plan>, answered "This checkout is no longer
          available" for both the $4.99 and the $10 plan, while the hosted page
          sold the same plan. Every Upgrade button in the extensions lands here,
          so buyers met a dead box and left. They now go to the hosted page,
          which keeps our email filled in and locked (email.disabled=1).

          One gap, measured on the live page: a buyer already signed in to Whop
          sees their Whop email instead of ours, with a "Use a different email"
          link. Webhooks match accounts by email, so the note below asks them to
          check it. A later fix is Whop's newer Checkout element.
        */}
        <div role="tablist" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, padding: 4, borderRadius: 14, border: "1px solid rgba(255,255,255,.1)", marginBottom: "1.25rem" }}>
          {[["card", "Card · PayPal", "Monthly, renews"], ["binance", "Binance Pay · USDT", "One month, prepaid"]].map(([key, label, sub]) => (
            <button key={key} type="button" role="tab" aria-selected={method === key} onClick={() => setMethod(key)}
              style={{ padding: "0.7rem 0.5rem", borderRadius: 10, border: 0, cursor: "pointer", color: "inherit",
                background: method === key ? (key === "binance" ? "rgba(240,185,11,.16)" : "rgba(255,92,0,.18)") : "transparent" }}>
              <strong style={{ display: "block", fontSize: "0.92rem" }}>{label}</strong>
              <span className="text-secondary" style={{ fontSize: "0.75rem" }}>{sub}</span>
            </button>
          ))}
        </div>

        {method === "binance" ? (
          <BinancePay user={user} token={token} extensionEmail={hashEmail} />
        ) : (
          <>
            <a
              href={hostedUrl}
              className="btn btn-primary"
              style={{ display: "block", textAlign: "center", fontSize: "1.05rem", padding: "0.95rem 1.25rem" }}
              onClick={() => window.gtag?.("event", "pro_checkout_start", { plan_id: PLAN_ID })}
            >
              Continue to secure checkout · $4.99/month
            </a>
            <p className="text-secondary" style={{ fontSize: "0.85rem", textAlign: "center", marginTop: "1rem" }}>
              Payment is handled by Whop. Make sure the email there is{" "}
              <strong style={{ color: "var(--text-primary)" }}>{email}</strong>. If Whop shows a
              different one, press <em>Use a different email</em> and enter this one, or Pro
              won&apos;t reach your AutoFlow account.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
