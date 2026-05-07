# MEMORY.md — AutoFlow Marketing Website

> **Last updated:** 2026-05-07
> **Domain:** https://auto-flow.studio
> **Vercel Project:** `aminesmpc-arts-projects/website`
> **Repo path:** `autoflow/website/`

---

## 🧭 What Is This?

Marketing website for **AutoFlow** — a Chrome extension that automates AI video generation on Google Flow. The site converts visitors into Chrome Web Store installs.

---

## ⚙️ Tech Stack

| Layer       | Technology               | Version  |
| ----------- | ------------------------ | -------- |
| Framework   | Next.js (App Router)     | 16.1.6   |
| React       | React + React DOM        | 19.2.3   |
| Styling     | Vanilla CSS (no Tailwind)| —        |
| Font        | Inter (Google Fonts)     | 400–900  |
| Images      | sharp (dev), unoptimized | 0.34.5   |
| Analytics   | Vercel Analytics         | 2.0.1    |
| Speed       | Vercel Speed Insights    | 2.0.0    |
| Tracking    | Google Analytics GA4     | gtag.js  |
| Deployment  | Vercel CLI (`vercel --prod`) | —    |

---

## 📊 Analytics & Tracking

| Service             | ID / Config                |
| ------------------- | -------------------------- |
| Google Analytics GA4 | `G-ZJ953YL6EK`           |
| Vercel Analytics     | `@vercel/analytics` (auto)|
| Vercel Speed Insights| `@vercel/speed-insights`  |
| Google Search Console| Verified via meta tag: `iifc_AkbtTDsKwsKgHHwFuW23nN_kJD2PxGXuyM8Bw8` |
| Bing Webmaster Tools | Verified via `BingSiteAuth.xml` |
| Yandex Webmaster     | Verified via `yandex_82f21e252467ea3a.html` |

---

## 🗂️ Project Structure

```
website/
├── middleware.js              # i18n locale detection & routing
├── next.config.mjs            # Static export (output: 'export')
├── package.json
├── public/
│   ├── og-image.png           # OpenGraph image (1200×630)
│   ├── robots.txt             # Allow all + sitemap reference
│   ├── sitemap.xml            # Manual sitemap (all pages + hreflang)
│   ├── screenshots/           # Product screenshots (.webp + .png)
│   │   └── blog/              # Blog post images
│   ├── google50558a0eb4f85fb5.html  # Google verification
│   ├── BingSiteAuth.xml       # Bing verification
│   └── yandex_*.html          # Yandex verification
├── scripts/                   # Build/utility scripts (7 markdown docs)
├── src/app/
│   ├── layout.js              # Root layout (Header, Footer, GA4, schemas)
│   ├── layout.css             # Header & footer styles
│   ├── globals.css            # Design system (tokens, buttons, cards, grids)
│   ├── page.css               # Homepage-specific styles
│   ├── page.js                # Homepage (Hero, Features, How It Works, CTA)
│   ├── MobileMenu.js          # Mobile hamburger menu component
│   ├── dictionaries.js        # i18n translations (en, ar, fr)
│   ├── [locale]/              # Localized pages (ar, fr, en)
│   │   ├── layout.js          # Locale-aware layout wrapper
│   │   ├── page.js            # Localized homepage
│   │   ├── blog/              # Localized blog listing
│   │   ├── faq/               # Localized FAQ
│   │   ├── pricing/           # Localized pricing
│   │   ├── privacy/           # Localized privacy policy
│   │   └── terms/             # Localized terms of service
│   ├── blog/                  # English blog
│   │   ├── page.js            # Blog listing page
│   │   ├── content.js         # Blog post metadata/content
│   │   ├── CopyBlock.js       # Code copy component
│   │   ├── how-to-batch-generate-ai-videos-google-flow/
│   │   ├── best-prompts-ai-video-generation/
│   │   ├── google-flow-tips-avoid-failed-generations/
│   │   └── construction-asmr-ai-video-complete-guide/
│   ├── faq/                   # English FAQ
│   ├── pricing/               # English pricing
│   ├── privacy/               # English privacy policy
│   └── terms/                 # English terms of service
└── blogphoto/                 # Blog source images
```

---

## 🌍 Internationalization (i18n)

| Locale | Path     | Direction | Status |
| ------ | -------- | --------- | ------ |
| English| `/` (default) | LTR  | ✅ Full |
| Arabic | `/ar/`   | RTL       | ✅ Full |
| French | `/fr/`   | LTR       | ✅ Full |
| Spanish| `/es/`   | LTR       | ⚠️ In middleware, no pages yet |

**How it works:**
- `middleware.js` detects browser `Accept-Language` header
- English users → rewritten to `/en` internally (URL stays clean as `/`)
- Non-English users → redirected to `/{locale}/` path
- Translations stored in `src/app/dictionaries.js` (single file, all locales)

---

## 📄 Pages

| Page       | English Path | Localized | Description |
| ---------- | ------------ | --------- | ----------- |
| Homepage   | `/`          | ✅ en/ar/fr | Hero, features (6), how-it-works, CTA |
| Pricing    | `/pricing`   | ✅ en/ar/fr | Free vs Pro tiers |
| Blog       | `/blog`      | ✅ en/ar/fr (listing) | 4 blog articles (English only) |
| FAQ        | `/faq`       | ✅ en/ar/fr | Common questions |
| Privacy    | `/privacy`   | ✅ en/ar/fr | Privacy policy |
| Terms      | `/terms`     | ✅ en/ar/fr | Terms of service |

### Blog Articles (English only)
1. `how-to-batch-generate-ai-videos-google-flow`
2. `best-prompts-ai-video-generation`
3. `google-flow-tips-avoid-failed-generations`
4. `construction-asmr-ai-video-complete-guide`

---

## 🎨 Design System

Defined in `globals.css` with CSS custom properties:

| Token               | Value                              |
| -------------------- | --------------------------------- |
| `--primary`          | `#4F46E5` (Indigo)                |
| `--primary-light`    | `#6366F1`                         |
| `--primary-dark`     | `#4338CA`                         |
| `--accent`           | `#06B6D4` (Cyan)                  |
| `--bg-dark`          | `#0F172A` (Dark navy)             |
| `--bg-card`          | `#1E293B`                         |
| `--text-primary`     | `#F8FAFC`                         |
| `--text-secondary`   | `#94A3B8`                         |
| `--gradient-primary` | `135deg, indigo → cyan`           |
| `--container`        | `1200px`                          |
| Font                 | Inter (400–900)                   |

**Theme:** Dark mode only. Navy background, indigo/cyan gradient accents, glassmorphism cards.

**Components:** `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-lg`, `.card`, `.card-glass`, `.badge`, `.section`, `.grid-2/3/4`

**Animations:** `fadeInUp`, `float`, `pulse-glow` with `.animate-in` and `.delay-1` through `.delay-4`

---

## 🔍 SEO Setup

- **Structured Data (JSON-LD):**
  - `Organization` schema (in layout.js)
  - `WebSite` schema with SearchAction (in layout.js)
  - `SoftwareApplication` schema with pricing offers (in page.js)
  - `BreadcrumbList` schema (in page.js)
- **Meta:** Full OpenGraph + Twitter Card tags
- **Sitemap:** Manual XML with hreflang alternate links for all locales
- **Robots:** Allow all, sitemap reference
- **Canonical:** `https://auto-flow.studio`
- **Search Engine Verification:** Google, Bing, Yandex

---

## 🚀 Build & Deploy

```bash
# Local development
npm run dev

# Build (static export)
npm run build          # outputs to /out

# Deploy to production via Vercel CLI
vercel --prod
```

**Build mode:** `output: 'export'` (fully static HTML). No server-side features. `trailingSlash: true`. Images unoptimized.

---

## 📌 Key Details to Remember

1. **Static export only** — no API routes, no SSR, no ISR. Pure static HTML.
2. **No Tailwind** — all styling is vanilla CSS with custom properties.
3. **Single dictionaries file** — all i18n translations live in `dictionaries.js`, not separate JSON files.
4. **Middleware runs on Vercel edge** — handles locale detection even with static export.
5. **Blog articles are English-only** — blog listing page is localized, but individual posts are not.
6. **Spanish (`/es/`) locale** is defined in middleware but has no pages built yet.
7. **Google Analytics** loads via `next/script` with `afterInteractive` strategy to avoid blocking page render.
8. **OG image** is at `/og-image.png` (387KB, referenced in metadata).
9. **Product screenshots** come in dual format: `.webp` (used on site) + `.png` (fallback/source).
10. **Chrome Web Store link** currently points to generic `https://chromewebstore.google.com` — needs updating with actual extension URL once published.
