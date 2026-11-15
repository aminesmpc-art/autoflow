"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { clock } from "../extractor/timeFields";

/* Cuts per ten seconds, as columns over the video's time.

   One series, so one colour and no legend — the heading names it. The
   numbers were measured from the file, not judged, which is why this is the
   only chart in a breakdown. Every bar has its own hover and focus tooltip,
   and the same numbers are one click away as a table, so nothing is gated
   behind a pointer. */

const HEIGHT = 160;
const PAD = { top: 12, right: 8, bottom: 28, left: 32 };
const MAX_BAR = 24;
const GAP = 2;

function niceMax(n) {
  if (n <= 4) return Math.max(1, n);
  const step = n <= 10 ? 2 : 5;
  return Math.ceil(n / step) * step;
}

export default function PacingChart({ pacing }) {
  const [active, setActive] = useState(null);
  const [asTable, setAsTable] = useState(false);
  /* Drawn at the width it is shown at, so a short video's few bars are not
     blown up — labels and all — to fill the panel. */
  const box = useRef(null);
  const [boxW, setBoxW] = useState(0);
  useLayoutEffect(() => {
    const measure = () => { if (box.current) setBoxW(Math.floor(box.current.clientWidth)); };
    measure();
    if (!box.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const buckets = pacing?.buckets || [];
  if (!buckets.length) return null;

  const size = pacing.bucket_sec || 10;
  const top = niceMax(Math.max(...buckets.map((b) => b.cuts)));
  const ticks = [0, top / 2, top].filter((t, i, a) => Number.isInteger(t) && a.indexOf(t) === i);
  // A long video's bars are more than fit: they are squeezed to the panel.
  const width = Math.max(boxW || 640, buckets.length * (MAX_BAR + 8) + PAD.left + PAD.right);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / buckets.length;
  const barW = Math.max(2, Math.min(MAX_BAR, slot - GAP));
  const y = (v) => PAD.top + plotH - (v / top) * plotH;
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));

  const tip = active == null ? null : buckets[active];

  return (
    <div>
      <div ref={box} style={{ position: "relative", overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width="100%"
          style={{ minWidth: Math.min(width, 640), display: "block" }}
          role="img"
          aria-label={`Cuts per ${size} seconds over the video, ${pacing.cut_count} cuts in total`}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
              <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">{t}</text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const x = PAD.left + i * slot + (slot - barW) / 2;
            const h = Math.max(0, y(0) - y(b.cuts));
            const r = Math.min(4, barW / 2, h);
            // Rounded at the data end, square at the baseline.
            const path = h <= 0 ? "" :
              `M${x},${y(0)} V${y(b.cuts) + r} Q${x},${y(b.cuts)} ${x + r},${y(b.cuts)} ` +
              `H${x + barW - r} Q${x + barW},${y(b.cuts)} ${x + barW},${y(b.cuts) + r} V${y(0)} Z`;
            return (
              <g key={b.start_sec}>
                {path && (
                  <path d={path} fill="var(--primary)" opacity={active == null || active === i ? 1 : 0.45} />
                )}
                {/* The hit target is the whole slot, not just the bar. */}
                <rect
                  x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH}
                  fill="transparent" tabIndex={0}
                  aria-label={`${clock(b.start_sec)} to ${clock(b.start_sec + size)}: ${b.cuts} cuts`}
                  onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                  style={{ outline: "none", cursor: "default" }}
                />
                {i % labelEvery === 0 && (
                  <text x={PAD.left + i * slot + slot / 2} y={HEIGHT - 8} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
                    {clock(b.start_sec)}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
        </svg>
        {tip && (
          <div
            role="status"
            style={{
              position: "absolute", top: 0, right: 0, padding: "6px 10px", background: "#000",
              border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", fontSize: "0.8rem", pointerEvents: "none",
            }}
          >
            <strong style={{ color: "white" }}>{tip.cuts} cut{tip.cuts === 1 ? "" : "s"}</strong>
            <span style={{ color: "var(--text-secondary)" }}> · {clock(tip.start_sec)}–{clock(tip.start_sec + size)}</span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setAsTable((v) => !v)}
        className="xf-link xf-link-muted"
        style={{ marginTop: "8px", fontSize: "0.8rem" }}
        aria-expanded={asTable}
      >
        {asTable ? "Hide table" : "Show as table"}
      </button>
      {asTable && (
        <table style={{ marginTop: "8px", borderCollapse: "collapse", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "4px 16px 4px 0" }}>From</th>
              <th style={{ textAlign: "left", padding: "4px 16px 4px 0" }}>To</th>
              <th style={{ textAlign: "right", padding: "4px 0" }}>Cuts</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.start_sec}>
                <td style={{ padding: "2px 16px 2px 0" }}>{clock(b.start_sec)}</td>
                <td style={{ padding: "2px 16px 2px 0" }}>{clock(b.start_sec + size)}</td>
                <td style={{ padding: "2px 0", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{b.cuts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
