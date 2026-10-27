/**
 * The AutoFlow Motion icon — every size, from one master.
 *
 * Run with `npm run icons`. Renders through Chrome (the same Playwright the UI
 * smoke test uses) because Chrome is what will draw these, and writes RGBA
 * PNGs with transparent corners into icons/.
 *
 * ── The mark ──────────────────────────────────────────────────────────────
 *
 * The panel's own brand mark: two white chevrons on a burnt-orange tile. The
 * panel header draws the same geometry (src/BrandMark.tsx), so the toolbar
 * icon and the mark inside the panel are one thing.
 *
 * ── Why the sizes are drawn separately rather than scaled ─────────────────
 *
 *   16, 32   the toolbar (1x and 2x). The tile fills the canvas: at 16px a
 *            1.5px margin is a tenth of the icon spent on nothing.
 *   48       the extensions page.
 *   128      the Web Store and install dialog. Google asks for 96×96 artwork
 *            inside 16px of transparent padding, so that is what it gets.
 *   512      large listings; same proportions as 128.
 *
 * The tile's edges sit on whole pixels too — a 0.5px inset at 16 drew the
 * whole border as a half-transparent ring, which reads as blur.
 *
 * Chevron tops and bottoms are snapped to whole pixels at every size. A
 * chevron is two horizontal edges and four diagonals; the diagonals antialias
 * whatever happens, but a horizontal edge on a half pixel smears across two
 * rows — at 16px that is the difference between a crisp mark and a soft one.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const OUT = path.resolve(__dirname, '../icons');
const SIZES = {
  16: { inset: 0, radius: 0.235 },
  32: { inset: 1, radius: 0.235 },
  48: { inset: 2, radius: 0.235 },
  128: { inset: 16, radius: 0.235 },
  512: { inset: 64, radius: 0.235 },
};

/* Proportions of the approved concept, as fractions of the tile. */
const GLYPH = { height: 0.48, thick: 0.163, depth: 0.192, gap: 0.087, nudge: 0.0144, join: 0.031 };
/* The toolbar sizes, tuned by eye at 12× zoom rather than scaled down:
   - 16: an ODD height (9px), so each tip lands in the middle of one pixel
     row instead of smearing across two; a wider gap, because 1.3px of gap
     antialiased into a pink seam and the two chevrons read as one blob.
   - 32: a little more gap, for the same seam. */
const SMALL = { height: 0.56, thick: 0.17, depth: 0.17, gap: 0.12 };
const MID = { gap: 0.1 };

const fmt = (n) => Number(n.toFixed(3));

/** The two chevrons for a tile of side T whose top-left corner is at (o, o). */
function chevrons(o, T) {
  const g = T < 20 ? { ...GLYPH, ...SMALL } : T < 40 ? { ...GLYPH, ...MID } : GLYPH;
  const cy = o + T / 2;
  const top = Math.round(cy - (g.height * T) / 2);
  const bottom = top + Math.round(g.height * T);
  const thick = g.thick * T, depth = g.depth * T, gap = g.gap * T;
  const span = 2 * (thick + depth) + gap;
  const x0 = o + T / 2 - span / 2 + g.nudge * T;
  const one = (x) => [[x, top], [x + thick, top], [x + thick + depth, (top + bottom) / 2],
    [x + thick, bottom], [x, bottom], [x + depth, (top + bottom) / 2]]
    .map(([a, b]) => `${fmt(a)},${fmt(b)}`).join(' ');
  return { a: one(x0), b: one(x0 + thick + gap), join: fmt(g.join * T) };
}

/** The whole icon at one canvas size. */
function iconSvg(size) {
  const { inset, radius } = SIZES[size];
  const T = size - 2 * inset;
  const rx = fmt(radius * T);
  const c = chevrons(inset, T);
  /* The highlight is gentler on the toolbar sizes, where a gradient over
     fifteen pixels reads as a smudge rather than as light. */
  const lift = size <= 32 ? 0.1 : 0.18;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="geometricPrecision">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0662f"/><stop offset="1" stop-color="#b13d1e"/></linearGradient>
    <linearGradient id="lift" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${lift}"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <rect x="${inset}" y="${inset}" width="${T}" height="${T}" rx="${rx}" fill="url(#tile)"/>
  <rect x="${inset}" y="${inset}" width="${T}" height="${T}" rx="${rx}" fill="url(#lift)"/>
  <polygon points="${c.a}" fill="#fff" stroke="#fff" stroke-width="${c.join}" stroke-linejoin="round"/>
  <polygon points="${c.b}" fill="#fff" stroke="#fff" stroke-width="${c.join}" stroke-linejoin="round"/>
</svg>`;
}

module.exports = { iconSvg, chevrons, SIZES };

if (require.main === module) {
  const playwrightPath = process.env.PLAYWRIGHT_PATH
    || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const { chromium } = require(playwrightPath);
  const executablePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

  (async () => {
    fs.mkdirSync(path.join(OUT, 'source'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'source', 'motion-icon.svg'), iconSvg(512));
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      for (const size of Object.keys(SIZES).map(Number)) {
        const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
        await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${iconSvg(size)}`);
        await page.screenshot({ path: path.join(OUT, `icon${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
        await page.close();
        console.log(`icons/icon${size}.png`);
      }
    } finally {
      await browser.close();
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
