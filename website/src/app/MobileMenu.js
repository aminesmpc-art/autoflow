"use client";
import { useState } from "react";
import StoreLink from "./StoreLink";

export default function MobileMenu() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="mobile-menu-btn"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
      >
        <span className={`hamburger ${open ? "open" : ""}`}>
          <span />
          <span />
          <span />
        </span>
      </button>

      {open && (
        <div className="mobile-menu-overlay" onClick={() => setOpen(false)}>
          <nav
            className="mobile-menu"
            onClick={(e) => e.stopPropagation()}
          >
            <ul>
              <li><a href="/#features" onClick={() => setOpen(false)}>Features</a></li>
              <li><a href="/#how-it-works" onClick={() => setOpen(false)}>How It Works</a></li>
              <li><a href="/extractor" onClick={() => setOpen(false)}>Extractor</a></li>
              <li><a href="/prompts" onClick={() => setOpen(false)}>Prompts</a></li>
              <li><a href="/pricing" onClick={() => setOpen(false)}>Pricing</a></li>
              <li><a href="/blog" onClick={() => setOpen(false)}>Blog</a></li>
              <li><a href="/faq" onClick={() => setOpen(false)}>FAQ</a></li>
            </ul>
            <div className="mobile-menu-lang">
              <a href="/" className="lang-option active">EN</a>
              <a href="/ar" className="lang-option">AR</a>
              <a href="/fr" className="lang-option">FR</a>
            </div>
            <StoreLink
              className="btn btn-primary mobile-menu-cta"
              onClick={() => setOpen(false)}
            >
              Install Free
            </StoreLink>
          </nav>
        </div>
      )}
    </>
  );
}
