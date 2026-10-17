"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/* The small parts the extractor, breakdown and dashboard pages share: one
   icon set, a copy button that says it worked, and a menu. The look lives in
   extractor.css; these only decide behaviour. */

const PATHS = {
  copy: "M8 8h11v11H8zM5 16V5h11",
  check: "M5 12.5l4.5 4.5L19 7.5",
  download: "M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14",
  upload: "M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5M5 19.5h14",
  link: "M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1",
  chevron: "M6 9l6 6 6-6",
  sparkles: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z",
  undo: "M9 7L4.5 11.5 9 16M5 11.5h9.5a5 5 0 010 10H11",
  film: "M4 5h16v14H4zM8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20a7.5 7.5 0 0115 0",
  users: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 19.5a6.5 6.5 0 0113 0M16 4.3a3.5 3.5 0 010 6.4M18.5 13.5a6.5 6.5 0 013 6",
  mic: "M12 3.5a3 3 0 013 3v5a3 3 0 01-6 0v-5a3 3 0 013-3zM6 11.5a6 6 0 0012 0M12 17.5V21",
  alert: "M12 4l9 16H3zM12 10v4.5M12 17.5v.5",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3",
  globe: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z",
  x: "M6 6l12 12M18 6L6 18",
  bolt: "M13 3L5 13.5h6L10 21l8-10.5h-6z",
  plus: "M12 5v14M5 12h14",
  clock: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7.5V12l3 2",
  paperclip: "M20 11.5l-7.8 7.8a5 5 0 01-7.1-7.1l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8",
  image: "M4 5h16v14H4zM4 16l4.5-4.5 4 4 2.5-2.5L20 18M15 9.5h.01",
  motion: "M4 6.5h10v11H4zM14 10.5l6-3.5v10l-6-3.5",
  target: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM12 11.5v1",
  script: "M7 3.5h8l4 4v13H7zM15 3.5v4h4M10 12h6M10 15.5h6",
  note: "M5 4h14v16H5zM8.5 8.5h7M8.5 12h7M8.5 15.5h4",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4",
  trash: "M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13",
  arrowRight: "M5 12h14m0 0l-5-5m5 5l-5 5",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  file: "M7 3.5h7l5 5v12H7zM14 3.5v5h5",
  play: "M8 5.5v13l10.5-6.5z",
  layers: "M12 4l8.5 4.5L12 13 3.5 8.5zM3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5",
  hook: "M15 4.5v8a4.5 4.5 0 01-9 0v-1.5M6 11l-2 2.5M6 11l2 2.5",
  scissors: "M6 6a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM6 13a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM8.2 9.8L20 18M8.2 14.2L20 6",
  trendDown: "M3.5 7l6 6 4-4 7 7M20.5 11.5V16H16",
  megaphone: "M4 10v4h3l7 4.5v-13L7 10zM17.5 9.5a3.5 3.5 0 010 5",
  checkList: "M4 6.5l1.5 1.5L8.5 5M4 12.5l1.5 1.5 3-3M4 18.5l1.5 1.5 3-3M11.5 7h8.5M11.5 13h8.5M11.5 19h8.5",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
};

/** An outline icon from the shared set, sized by the text around it. */
export function Icon({ name, size = 16, className, title }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : "true"}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name] || ""} />
    </svg>
  );
}

/** Copy `text` and say so for two seconds. `text` may be a function, so a
    long join is only built when someone presses the button. */
export function CopyButton({ text, label = "Copy", done = "Copied", className = "xf-btn xf-btn-sm", iconOnly = false, title }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async (e) => {
    e.stopPropagation();
    const value = typeof text === "function" ? text() : text;
    try {
      await navigator.clipboard.writeText(value || "");
    } catch (err) {
      return; // no clipboard (an insecure page); nothing to confirm
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      className={`${className}${copied ? " is-done" : ""}`}
      onClick={copy}
      title={title || label}
      aria-label={iconOnly ? (copied ? done : title || label) : undefined}
    >
      <Icon name={copied ? "check" : "copy"} />
      {!iconOnly && <span>{copied ? done : label}</span>}
      {iconOnly && <span className="xf-sr" aria-live="polite">{copied ? done : ""}</span>}
    </button>
  );
}

/** A button that opens a small panel under it. Closes on Escape, on a click
    outside, and — unless the panel says otherwise — on a click inside. */
export function Menu({ label, icon, className = "xf-btn", align = "right", children, keepOpen = false }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (root.current && !root.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="xf-menu" ref={root}>
      <button
        type="button"
        className={className}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {icon && <Icon name={icon} />}
        <span>{label}</span>
        <Icon name="chevron" size={14} className="xf-menu-caret" />
      </button>
      {open && (
        <div
          className={`xf-menu-pop xf-menu-${align}`}
          role="menu"
          onClick={keepOpen ? undefined : () => setOpen(false)}
        >
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

/** Measures a sticky results header into CSS variables on its parent:
    --xf-head, its height, for what sticks below it; --xf-tabs-at, where its
    tab row starts, so a phone can stick it with only the tabs showing. The
    height changes with the width as the actions wrap, so it is watched. */
export function useHeadMetrics(head) {
  useLayoutEffect(() => {
    const measure = () => {
      const el = head.current;
      const parent = el?.parentElement;
      if (!el || !parent) return;
      parent.style.setProperty("--xf-head", `${Math.ceil(el.getBoundingClientRect().height)}px`);
      const tabs = el.querySelector(".xf-tabs");
      if (tabs) parent.style.setProperty("--xf-tabs-at", `${tabs.offsetTop}px`);
    };
    measure();
    if (!head.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(head.current);
    return () => ro.disconnect();
  }, [head]);
}

/** Seconds as 0:03.4 — a shot's own clock, to a tenth. */
export function shotClock(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(1).padStart(4, "0");
  return `${m}:${rest}`;
}

/** A shot's time as "0:01.1 – 0:03.3", from its numbers when it has them. */
export function shotTime(shot) {
  if (Number.isFinite(shot?.start_sec) && Number.isFinite(shot?.end_sec)) {
    return `${shotClock(shot.start_sec)} – ${shotClock(shot.end_sec)}`;
  }
  return shot?.time_range || "";
}

/** What a video is called on screen: a file's name, or a link's site and path. */
export function displayName(source) {
  const text = String(source || "").trim();
  if (!/^https?:\/\//i.test(text)) return text || "Untitled video";
  try {
    const url = new URL(text);
    const id = url.searchParams.get("v");
    const path = id ? `/watch?v=${id}` : url.pathname.replace(/\/$/, "");
    return `${url.hostname.replace(/^www\./, "")}${path}`;
  } catch (e) {
    return text;
  }
}
