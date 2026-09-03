"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";

const LANGUAGES = [
  { code: "en", label: "English", flag: "🇺🇸", path: "/" },
  { code: "es", label: "Español", flag: "🇪🇸", path: "/es" },
  { code: "de", label: "Deutsch", flag: "🇩🇪", path: "/de" },
  { code: "ar", label: "العربية", flag: "🇸🇦", path: "/ar" },
  { code: "fr", label: "Français", flag: "🇫🇷", path: "/fr" },
  { code: "it", label: "Italiano", flag: "🇮🇹", path: "/it" },
];

export default function LangDropdown({ currentLocale = "en" }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);
  const pathname = usePathname() || "/";

  // Auto-detect current active language from URL if not provided
  const activeLang =
    LANGUAGES.find((l) => {
      if (l.code === "en") {
        return !LANGUAGES.some((other) => other.code !== "en" && pathname.startsWith(`/${other.code}`));
      }
      return pathname.startsWith(`/${l.code}`);
    }) || LANGUAGES[0];

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="lang-dropdown-wrapper" ref={dropdownRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="lang-dropdown-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label="Select language"
      >
        <span className="lang-globe">🌐</span>
        <span className="lang-current">{activeLang.code.toUpperCase()}</span>
        <span className={`lang-chevron ${open ? "open" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="lang-dropdown-menu animate-in">
          {LANGUAGES.map((lang) => (
            <a
              key={lang.code}
              href={lang.path}
              className={`lang-dropdown-item ${activeLang.code === lang.code ? "active" : ""}`}
              onClick={() => setOpen(false)}
            >
              <span className="lang-item-flag">{lang.flag}</span>
              <span className="lang-item-label">{lang.label}</span>
              {activeLang.code === lang.code && <span className="lang-item-check">✓</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
