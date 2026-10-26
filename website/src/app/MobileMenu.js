"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { PRODUCTS } from "./products";

export default function MobileMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || '';
  const localeMatch = pathname.match(/^\/(ar|fr|es)(\/|$)/);
  const prefix = localeMatch ? `/${localeMatch[1]}` : "";
  const close = () => setOpen(false);

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
        <div className="mobile-menu-overlay" onClick={close}>
          <nav
            className="mobile-menu"
            aria-label="Menu"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mobile-menu-heading">Products</div>
            <ul>
              {PRODUCTS.map((product) => (
                <li key={product.key}>
                  <a href={product.href} onClick={close} className="mobile-menu-product">
                    <span aria-hidden="true">{product.icon}</span>
                    {product.name}
                    {product.badge && (
                      <span className={`nav-badge ${product.badge === "Free" ? "nav-badge--free" : ""}`}>
                        {product.badge}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
            <div className="mobile-menu-divider" />
            <ul>
              <li><a href={`${prefix}/pricing`} onClick={close}>Pricing</a></li>
              <li><a href={`${prefix}/blog`} onClick={close}>Guides</a></li>
              <li><a href={`${prefix}/faq`} onClick={close}>FAQ</a></li>
            </ul>
            <div className="mobile-menu-lang">
              <a href="/" className={`lang-option ${!localeMatch ? "active" : ""}`}>EN</a>
              <a href="/ar" className={`lang-option ${localeMatch && localeMatch[1] === "ar" ? "active" : ""}`}>AR</a>
              <a href="/fr" className={`lang-option ${localeMatch && localeMatch[1] === "fr" ? "active" : ""}`}>FR</a>
            </div>
            <a href="/#tools" className="btn btn-primary mobile-menu-cta" onClick={close}>
              Get started
            </a>
          </nav>
        </div>
      )}
    </>
  );
}
