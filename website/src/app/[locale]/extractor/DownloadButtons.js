"use client";

import {
  downloadText,
  exportsAvailable,
  openStoryboard,
  safeName,
  toCsv,
  toEdl,
  toSrt,
} from "./exports";

/* Why a format is unavailable, said on the button instead of a dead file. */
const WHY_NOT = {
  srt: "No timed dialogue in this extraction",
  edl: "No shot timings in this extraction",
};

/* A file name from what the video was called. A pasted link names the file
   after its site and video id — "youtube_com-jNQXAC9IVRw" — rather than
   after the whole URL with its punctuation turned into underscores. */
export function baseName(source) {
  const text = String(source || "");
  if (!/^https?:\/\//i.test(text)) return safeName(text || "extraction");
  try {
    const url = new URL(text);
    const last = url.pathname.split("/").filter(Boolean).pop() || "";
    const id = (url.searchParams.get("v") || last).replace(/\.[^/.]+$/, "");
    const host = url.hostname.replace(/^www\./, "").replace(/\./g, "_");
    return safeName(id ? `${host}-${id}` : host);
  } catch (e) {
    return safeName(text);
  }
}

/**
 * The four downloads as a row of buttons. Styling comes from the page that
 * hosts it — the extractor's terminal look, the dashboard's glass — so this
 * only decides what each button makes and whether it can.
 */
export default function DownloadButtons({ result, sourceName, buttonClassName, buttonStyle }) {
  const can = exportsAvailable(result);
  const base = baseName(sourceName);
  const clipName = (() => {
    const name = String(sourceName || "");
    try { return name.startsWith("http") ? new URL(name).pathname.split("/").pop() || "source.mp4" : name; }
    catch (e) { return name || "source.mp4"; }
  })();

  const buttons = [
    {
      key: "storyboard",
      label: "Storyboard PDF",
      title: "Opens a print view: choose “Save as PDF”",
      run: () => openStoryboard(result, { title: base }),
    },
    {
      key: "csv",
      label: "Spreadsheet CSV",
      title: "One row per shot",
      run: () => downloadText(`${base}-shots.csv`, toCsv(result), "text/csv"),
    },
    {
      key: "srt",
      label: "Subtitles SRT",
      title: "Each shot’s dialogue on its timing",
      run: () => downloadText(`${base}.srt`, toSrt(result), "application/x-subrip"),
    },
    {
      key: "edl",
      label: "Cut list EDL",
      title: "Import into Premiere or DaVinci to cut the source at every shot",
      run: () => downloadText(`${base}.edl`, toEdl(result, { title: base, sourceName: clipName }), "text/plain"),
    },
  ];

  return (
    <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
      {buttons.map((b) => (
        <button
          key={b.key}
          type="button"
          className={buttonClassName}
          style={{ ...buttonStyle, opacity: can[b.key] ? 1 : 0.45, cursor: can[b.key] ? "pointer" : "not-allowed" }}
          disabled={!can[b.key]}
          title={can[b.key] ? b.title : WHY_NOT[b.key]}
          onClick={b.run}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
