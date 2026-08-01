"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";

const PLAN_ID = "plan_fxMVMOmbFPcp4";
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
  const { user, loading } = useAuth();
  const [hashEmail, setHashEmail] = useState(null);
  const [hashRead, setHashRead] = useState(false);
  const [done, setDone] = useState(false);

  // location.hash is client-only, so it cannot be read during render.
  useEffect(() => {
    setHashEmail(readHashEmail());
    setHashRead(true);
  }, []);

  useEffect(() => {
    window.afCheckoutComplete = () => setDone(true);
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
            use in AutoFlow. Open the extension and hit <strong>Refresh Usage</strong> to
            see it.
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

  // `email.disabled=1` is what the embed itself appends to its iframe URL, and
  // Whop's hosted page honours it too — so even the escape hatch below arrives
  // with the field locked rather than merely prefilled. Undocumented, hence a
  // fallback rather than the primary path: if Whop drops it the field silently
  // becomes editable again, with nothing to alert us.
  const hostedFallbackUrl =
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
          disable-email is the whole point of hosting the embed ourselves:
          Whop's hosted checkout page prefills the address but leaves it
          editable, and any address other than the AutoFlow one leaves the
          payment orphaned, since webhooks match to accounts by email.
        */}
        <div
          id="whop-checkout"
          data-whop-checkout-plan-id={PLAN_ID}
          data-whop-checkout-prefill-email={email}
          data-whop-checkout-disable-email="true"
          data-whop-checkout-theme="dark"
          data-whop-checkout-skip-redirect="true"
          data-whop-checkout-on-complete="afCheckoutComplete"
        />

        {/*
          Mounted only once the container above exists, so the loader finds it
          on its first scan.
        */}
        <Script src="https://js.whop.com/static/checkout/loader.js" strategy="afterInteractive" />

        {/* Never leave a paying customer with no way to pay if the embed fails. */}
        <p className="text-secondary" style={{ fontSize: "0.8rem", textAlign: "center", marginTop: "1.5rem" }}>
          Checkout not loading?{" "}
          <a href={hostedFallbackUrl} target="_blank" rel="noopener noreferrer nofollow">
            Pay on Whop instead
          </a>{" "}
          — keep the email as {email}.
        </p>
      </div>
    </section>
  );
}
