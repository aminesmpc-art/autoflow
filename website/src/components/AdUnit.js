"use client";

import { useEffect, useRef } from "react";

/* Google AdSense units. The loader script is in app/layout.js <head>.
   The slot ids come from AdSense → Ads → By ad unit; a unit with no id
   renders nothing, so a page can carry <AdUnit /> before the id exists.

   Ads run only on content pages: blog, prompts, FAQ, changelog (decided
   2026-10-30). Keep them off the home, product, pricing, checkout, login
   and dashboard pages — and exclude those pages from Auto ads in AdSense. */
export const AD_CLIENT = "ca-pub-8099080279263284";
export const AD_SLOTS = {
  display: "",
  inArticle: "",
};

export default function AdUnit({ kind = "display" }) {
  const slot = AD_SLOTS[kind];
  const ref = useRef(null);

  useEffect(() => {
    const ins = ref.current;
    /* React's dev double-mount would push twice; AdSense marks an <ins>
       it has filled with data-adsbygoogle-status. */
    if (!slot || !ins || ins.getAttribute("data-adsbygoogle-status")) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* Ad blockers and "no fill" throw here; the page is fine without. */
    }
  }, [slot]);

  if (!slot) return null;

  const format = kind === "inArticle"
    ? { "data-ad-layout": "in-article", "data-ad-format": "fluid" }
    : { "data-ad-format": "auto", "data-full-width-responsive": "true" };

  return (
    <aside className="ad-unit" aria-label="Advertisement">
      <span className="ad-unit-label">Advertisement</span>
      <ins
        ref={ref}
        className="adsbygoogle"
        style={{ display: "block", textAlign: kind === "inArticle" ? "center" : undefined }}
        data-ad-client={AD_CLIENT}
        data-ad-slot={slot}
        {...format}
      />
    </aside>
  );
}
