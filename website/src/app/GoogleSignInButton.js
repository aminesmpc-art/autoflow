"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import { afterAuthPath } from "./afterAuth";

const GSI_SRC = "https://accounts.google.com/gsi/client";

/* Where the client id comes from, in order.
 *
 * The API endpoint is the primary source: the extension already reads it from
 * there, so there is one place to rotate the id, and the site deploys without
 * anyone having to remember a new Vercel variable.
 *
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID overrides it when set, which is what makes the
 * button testable off the deployed origin — the API only sends CORS headers to
 * origins in CORS_ALLOWED_ORIGINS, so a browser on localhost cannot read the
 * config endpoint at all. A client id is public by design (it ships to every
 * visitor in the page), so holding one in a public env var costs nothing. */
const ENV_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

function useGoogleClientId(apiUrl) {
  const [clientId, setClientId] = useState(ENV_CLIENT_ID || null);
  const [checked, setChecked] = useState(Boolean(ENV_CLIENT_ID));

  useEffect(() => {
    if (ENV_CLIENT_ID) return;

    let live = true;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/auth/google/config`);
        const data = await res.json();
        if (live) setClientId(data.client_id || null);
      } catch {
        /* Unreachable or blocked by CORS. There is no id to render a button
           with either way, so this lands in the same place as "not
           configured" — but it is worth a console line, because the two have
           very different fixes. */
        console.warn("[GoogleSignInButton] could not read the Google config from the API");
        if (live) setClientId(null);
      } finally {
        if (live) setChecked(true);
      }
    })();
    return () => { live = false; };
  }, [apiUrl]);

  return { clientId, checked };
}

/** Load the Google Identity Services script once per page. */
function loadGsi() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();

    const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("gsi failed")));
      return;
    }

    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("gsi failed"));
    document.head.appendChild(script);
  });
}

/**
 * Sign in — or sign up — with Google.
 *
 * The backend creates the account when the address is new, so one button
 * serves both pages: there is no separate "sign up with Google" call.
 */
export default function GoogleSignInButton({ onError }) {
  const { loginWithGoogle } = useAuth();
  const router = useRouter();
  const holderRef = useRef(null);

  /* Left to itself the button follows the BROWSER's language, so the English
     page renders "Continuer avec Google" for a visitor whose Chrome is set to
     French. The site already decides its own language from the route, and the
     button is inside that page — so it follows the page.

     The default locale reaches this page by a middleware REWRITE (/login is
     served by [locale]/login), so useParams can hand back nothing here while
     /fr/login fills it in. No param means the site's default, English. */
  const params = useParams();
  const pageLocale = typeof params?.locale === "string" ? params.locale : "en";

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.auto-flow.studio/api";
  const { clientId, checked } = useGoogleClientId(API_URL);

  /* The callback is held in a ref because google.accounts.id.initialize keeps
     the function it was given: re-rendering must not leave it calling a stale
     closure over loginWithGoogle. */
  const handleCredential = useRef(null);
  handleCredential.current = async (response) => {
    const result = await loginWithGoogle(response.credential);
    if (result.success) {
      /* Same destination rule as the password form on this page — including
         its open-redirect guard. Read at this moment rather than with
         useSearchParams, which would cost the page its static prerender. */
      router.push(afterAuthPath(window.location.search));
    } else {
      onError?.(result.error || "Google sign-in failed.");
    }
  };

  useEffect(() => {
    if (!clientId || !holderRef.current) return;
    let live = true;

    (async () => {
      try {
        await loadGsi();
        if (!live || !holderRef.current) return;

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => handleCredential.current?.(response),
        });

        /* renderButton APPENDS. Without this, a second run of this effect
           leaves two Google buttons stacked in the card. */
        holderRef.current.innerHTML = "";

        window.google.accounts.id.renderButton(holderRef.current, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "continue_with",
          logo_alignment: "center",
          width: 320,
          ...(pageLocale ? { locale: pageLocale } : {}),
        });
      } catch {
        if (live) onError?.("Could not reach Google sign-in. Check your connection and try again.");
      }
    })();

    return () => { live = false; };
  }, [clientId, pageLocale, onError]);

  /* No client id configured on the API means Google sign-in is not set up for
     this environment. Render nothing rather than a button that cannot work. */
  if (checked && !clientId) return null;

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          margin: "0 0 1.25rem",
          color: "var(--text-secondary)",
          fontSize: "0.85rem",
        }}
      >
        <span style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.1)" }} />
        or
        <span style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.1)" }} />
      </div>
      <div ref={holderRef} style={{ display: "flex", justifyContent: "center", minHeight: "44px" }} />
    </div>
  );
}
