/* The AutoFlow tools, in the order the site presents them. The header menu,
   the phone menu, the footer and the home page all read this one list, so a
   tool is added or renamed in one place.

   A plain module, not 'use client': server pages and client components can
   both import it and get the values. (StoreLink's STORE_URLS lives in a client
   module, which a server page receives as a reference, not as the URLs.) */

/* The Chrome Web Store listing for AutoFlow Motion, once it is published.
   While it is null, the site says the extension is coming instead of linking
   to a listing that does not exist yet. */
export const MOTION_STORE_URL = null;

export const PRODUCTS = [
  {
    key: "queue",
    name: "Queue Manager",
    fullName: "AutoFlow Queue Manager",
    href: "/queue",
    icon: "⚡",
    kind: "Chrome extension",
    badge: null,
    blurb: "Batch-generate hundreds of prompts in Google Flow",
  },
  {
    key: "studio",
    name: "Studio",
    fullName: "AutoFlow Studio",
    href: "/studio",
    icon: "✨",
    kind: "Chrome extension",
    badge: null,
    blurb: "Plan multi-shot videos on a visual node canvas",
  },
  {
    key: "motion",
    name: "Motion",
    fullName: "AutoFlow Motion",
    href: "/motion",
    icon: "🕺",
    kind: "Chrome extension",
    badge: "New",
    blurb: "Give any video's motion to your own character",
  },
  {
    key: "extractor",
    name: "Extractor",
    fullName: "AI Video Prompt Extractor",
    href: "/extractor",
    icon: "🔍",
    kind: "Web app",
    badge: "Free",
    blurb: "Get the prompts behind any AI video",
  },
  {
    key: "clipping",
    name: "Clipping",
    fullName: "AI Clip Maker",
    href: "/clipping",
    icon: "✂️",
    kind: "Web app",
    badge: "Free",
    blurb: "Turn a long video into short clips",
  },
];
