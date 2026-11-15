/* Times a person types ("1:20") and times the engine returns (seconds),
   shared by every page that analyses part of a video. */

/** "1:20", "1:02:05" or "95" as seconds. null when empty, NaN when it is neither. */
export function parseClock(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return NaN;
  return t.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/** Seconds as 1:05, or 1:02:05 past an hour. */
export function clock(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

/* Checked in the page rather than left to the engine, because the engine
   treats a time it cannot read as "not given" — and a typo would silently
   become an analysis of the whole video, charged as one. */
export function sectionProblem({ sectionStart, sectionEnd }) {
  const start = parseClock(sectionStart);
  const end = parseClock(sectionEnd);
  if (Number.isNaN(start)) return "Start time should look like 1:20, or stay empty for the beginning.";
  if (Number.isNaN(end)) return "End time should look like 2:45, or stay empty for the end.";
  if (start != null && end != null && end <= start) return "The end time has to be after the start time.";
  return null;
}

/** The section as the engine's options, or nothing when it is the whole video. */
export function sectionOptions({ sectionStart, sectionEnd }) {
  const body = {};
  const start = parseClock(sectionStart);
  const end = parseClock(sectionEnd);
  if (Number.isFinite(start) && start > 0) body.start_sec = start;
  if (Number.isFinite(end)) body.end_sec = end;
  return body;
}
