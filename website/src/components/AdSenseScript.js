"use client";

import Script from "next/script";
import { AD_CLIENT } from "./AdUnit";

/* The AdSense loader, on the pages that carry ads and nowhere else.

   Ads run only on the Extractor and Clipping pages (owner's decision,
   2026-11-15). With the loader in the site-wide <head>, Auto ads could put an
   ad on any page — login, dashboard and checkout included, which AdSense's
   own policy forbids ("ads on screens without publisher content"). The site
   stays verified through the google-adsense-account meta tag in app/layout.js. */
export default function AdSenseScript() {
  return (
    <Script
      id="adsbygoogle-loader"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD_CLIENT}`}
      crossOrigin="anonymous"
      strategy="afterInteractive"
    />
  );
}
