/* ============================================================
   Exports: an extraction as files other tools open.

   Everything here is built in the browser from the result the
   page already holds, so an export costs no request and works on
   a saved extraction exactly as on a fresh one.

     storyboard  a print-ready page — the browser saves it as PDF
     csv         one row per shot, for a spreadsheet or a shot list
     srt         each shot's dialogue as a subtitle, on its timing
     edl         a CMX 3600 cut list: Premiere and DaVinci import it
                 and cut the source video at every shot

   Older extractions lack timings and frame rates; each export
   says what it needs (exportsAvailable) instead of producing an
   empty file.
   ============================================================ */

const timedShots = (result) =>
  (result?.shots || []).filter(
    (s) => Number.isFinite(s?.start_sec) && Number.isFinite(s?.end_sec) && s.end_sec > s.start_sec
  );

/** Which exports have something to put in them. */
export function exportsAvailable(result) {
  const shots = result?.shots || [];
  const timed = timedShots(result);
  return {
    storyboard: shots.length > 0,
    csv: shots.length > 0,
    srt: timed.some((s) => (s.dialogue || "").trim()),
    edl: timed.length > 0,
  };
}

/* ── Download ─────────────────────────────────────────────── */

export function safeName(name) {
  return (String(name || "extraction").replace(/\.[^/.]+$/, "").replace(/[^\w\-]+/g, "_").slice(0, 60)) || "extraction";
}

export function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── CSV ──────────────────────────────────────────────────── */

/* A cell starting with = + - @ is a formula to Excel and Sheets, and these
   cells hold model-written text. The leading apostrophe makes it text. */
function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(result) {
  const header = [
    "Shot", "Start (s)", "End (s)", "Time", "Characters", "Shot size", "Lens",
    "Camera move", "Dialogue", "Sound", "Image prompt", "Video prompt",
  ];
  const rows = (result?.shots || []).map((s) => [
    s.shot_id,
    Number.isFinite(s.start_sec) ? s.start_sec : "",
    Number.isFinite(s.end_sec) ? s.end_sec : "",
    s.time_range || "",
    (s.characters || []).join(", "),
    s.camera?.shot_size || "",
    s.camera?.lens || "",
    s.camera?.movement || "",
    s.dialogue || "",
    s.sound || "",
    s.image_prompt || "",
    s.video_prompt || "",
  ]);
  // The byte-order mark is what makes Excel read the file as UTF-8 rather
  // than mangling every accent and emoji in the prompts.
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/* ── SRT ──────────────────────────────────────────────────── */

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/** Each timed shot's dialogue as one cue. Quotes around the spoken words
    read as noise on screen, so they come off; the speaker label stays. */
export function toSrt(result) {
  const cues = timedShots(result)
    .filter((s) => (s.dialogue || "").trim())
    .map((s, i) => {
      const text = s.dialogue.trim().replace(/"([^"]*)"/g, "$1");
      return `${i + 1}\n${srtTime(s.start_sec)} --> ${srtTime(s.end_sec)}\n${text}\n`;
    });
  return cues.join("\n");
}

/* ── EDL (CMX 3600) ───────────────────────────────────────── */

/* Timecode counts frames in whole numbers per second: 29.97 footage is
   labelled at 30, 23.976 at 24. Frames are counted from the real rate and
   only LABELLED at the rounded one, which is what non-drop-frame timecode
   is — so every cut lands on the right frame however long the video. */
function timecode(frame, base) {
  const f = frame % base;
  const totalSeconds = Math.floor(frame / base);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}:${pad(f)}`;
}

export function toEdl(result, { title = "Extraction", sourceName = "source.mp4", fps } = {}) {
  const rate = Number(fps || result?.source_fps) || 30;
  const base = Math.max(1, Math.round(rate));
  const clip = String(sourceName || "source.mp4").replace(/[\r\n]+/g, " ");
  const lines = [`TITLE: ${String(title).replace(/[\r\n]+/g, " ").slice(0, 70)}`, "FCM: NON-DROP FRAME", ""];

  // The cut list starts at one hour, the editing convention, so nothing ever
  // sits at negative timecode when an editor trims the head.
  let record = 3600 * base;
  timedShots(result).forEach((s, i) => {
    const srcIn = Math.round(s.start_sec * rate);
    const srcOut = Math.max(srcIn + 1, Math.round(s.end_sec * rate));
    const length = srcOut - srcIn;
    const event = String(i + 1).padStart(3, "0");
    lines.push(
      `${event}  AX       V     C        ${timecode(srcIn, base)} ${timecode(srcOut, base)} ${timecode(record, base)} ${timecode(record + length, base)}`,
      `* FROM CLIP NAME: ${clip}`,
      `* COMMENT: SHOT ${s.shot_id}${s.camera?.shot_size ? ` - ${String(s.camera.shot_size).toUpperCase()}` : ""}`,
      ""
    );
    record += length;
  });
  return lines.join("\r\n");
}

/* ── Storyboard ───────────────────────────────────────────── */

/* Every string on the page came from a model. It goes into a document this
   site opens, so it is escaped — an image prompt that happened to contain
   markup must print as text, never run. */
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const safeImage = (url) => (/^https:\/\//i.test(url || "") ? esc(url) : "");

export function storyboardHtml(result, { title = "Storyboard" } = {}) {
  const shots = result?.shots || [];
  const cards = shots.map((s) => {
    const camera = [s.camera?.shot_size, s.camera?.lens, s.camera?.movement].filter(Boolean).join(" · ");
    const img = safeImage(s.thumbnail_url);
    return `
      <article class="shot">
        <div class="frame">${img ? `<img src="${img}" alt="">` : `<span>No frame</span>`}</div>
        <div class="text">
          <h2>Shot ${esc(s.shot_id)} <small>${esc(s.time_range)}</small></h2>
          ${camera ? `<p class="meta">${esc(camera)}</p>` : ""}
          ${(s.characters || []).length ? `<p class="meta">${esc(s.characters.join(", "))}</p>` : ""}
          ${s.dialogue ? `<p class="say">${esc(s.dialogue)}</p>` : ""}
          ${s.image_prompt ? `<p><b>Image</b> ${esc(s.image_prompt)}</p>` : ""}
          ${s.video_prompt ? `<p><b>Motion</b> ${esc(s.video_prompt)}</p>` : ""}
        </div>
      </article>`;
  }).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { margin: 14mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; background: #fff; margin: 0; }
  header { margin-bottom: 14pt; border-bottom: 2px solid #111; padding-bottom: 8pt; }
  h1 { font-size: 18pt; margin: 0 0 4pt; }
  header p { margin: 4pt 0; color: #333; }
  .master { background: #f4f4f4; padding: 8pt 10pt; border-radius: 4pt; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12pt; }
  .shot { display: flex; gap: 10pt; break-inside: avoid; page-break-inside: avoid; border: 1px solid #ddd; border-radius: 4pt; padding: 8pt; }
  .frame { flex: 0 0 34%; display: flex; align-items: flex-start; justify-content: center; }
  .frame img { max-width: 100%; max-height: 150pt; border-radius: 2pt; }
  .frame span { color: #999; font-size: 9pt; padding-top: 20pt; }
  .text { min-width: 0; }
  h2 { font-size: 11pt; margin: 0 0 3pt; }
  h2 small { font-weight: normal; color: #666; margin-left: 4pt; }
  .meta { margin: 0 0 3pt; color: #555; font-size: 9pt; }
  .say { font-style: italic; margin: 3pt 0; }
  .text p { margin: 3pt 0; font-size: 9pt; }
  @media screen { body { padding: 24px; max-width: 1100px; margin: auto; } }
</style></head>
<body>
  <header>
    <h1>${esc(title)}</h1>
    ${result?.video_concept ? `<p>${esc(result.video_concept)}</p>` : ""}
    ${result?.master_prompt ? `<p class="master"><b>Master prompt</b> ${esc(result.master_prompt)}</p>` : ""}
  </header>
  <main class="grid">${cards}</main>
  <script>
    // Print once the frames have loaded, or the PDF has empty boxes in it.
    var imgs = Array.prototype.slice.call(document.images);
    Promise.all(imgs.map(function (i) {
      return i.complete ? 0 : new Promise(function (r) { i.onload = i.onerror = r; });
    })).then(function () { setTimeout(function () { window.print(); }, 150); });
  </script>
</body></html>`;
}

/** Open the storyboard in a new tab and bring up the print dialog, where
    "Save as PDF" is one of the printers. Called from a click, so popup
    blockers let it through. */
export function openStoryboard(result, options) {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.open();
  win.document.write(storyboardHtml(result, options));
  win.document.close();
  return true;
}
