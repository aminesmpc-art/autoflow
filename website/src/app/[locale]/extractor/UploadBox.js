"use client";

import { useRef, useState } from "react";
import { Icon } from "./ui";

/* One box for both ways in: drop or pick a file, or paste a link. Whichever
   the person does last is the one that runs — choosing a file replaces the
   link, and typing a link after removing the file brings the field back —
   so there is no tab to get wrong. The extractor and the breakdown share it;
   their options go underneath as children. */

/* The extractor refuses anything larger (max_video_size_mb), and it is
   kinder to say so before a 600 MB upload than after it. */
export const MAX_UPLOAD_MB = 500;

function megabytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

export default function UploadBox({ file, onFile, url, onUrl, onStart, ready, busy, goLabel, children }) {
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState(null);
  const picker = useRef(null);
  const field = useRef(null);

  const take = (picked) => {
    if (!picked) return;
    if (picked.type && !picked.type.startsWith("video/")) {
      setProblem(`${picked.name} is not a video. Use an MP4, MOV or WebM file.`);
      return;
    }
    if (picked.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setProblem(`${picked.name} is ${megabytes(picked.size)}; the limit is ${MAX_UPLOAD_MB} MB. Trim it, or paste a link instead.`);
      return;
    }
    setProblem(null);
    onFile(picked);
  };

  const drop = (e) => {
    e.preventDefault();
    setOver(false);
    const dropped = e.dataTransfer?.files?.[0];
    if (dropped) {
      take(dropped);
      return;
    }
    // A link dragged from another tab arrives as text.
    const text = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain");
    if (text && /^https?:\/\//i.test(text.trim())) {
      onFile(null);
      onUrl(text.trim().split(/\s+/)[0]);
    }
  };

  const clearFile = () => {
    onFile(null);
    if (picker.current) picker.current.value = "";
    // Back to the link field, ready to type in.
    setTimeout(() => field.current?.focus(), 0);
  };

  return (
    <div className="xf-start">
      <div
        className={`xf-box${over ? " is-over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); if (!over) setOver(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
        onDrop={drop}
      >
        <div className="xf-box-row">
          <button
            type="button"
            className="xf-btn xf-box-attach"
            onClick={() => picker.current?.click()}
            disabled={busy}
            title="Choose a video file"
            aria-label="Choose a video file"
          >
            <Icon name="upload" size={20} />
          </button>
          <input
            ref={picker}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/*"
            hidden
            onChange={(e) => take(e.target.files?.[0])}
          />

          {file ? (
            <div className="xf-file">
              <Icon name="film" size={18} />
              <span className="xf-file-name" title={file.name}>{file.name}</span>
              <span className="xf-file-size">{megabytes(file.size)}</span>
              <button type="button" className="xf-btn xf-btn-ghost xf-btn-sm xf-btn-icon" onClick={clearFile} disabled={busy} aria-label="Remove this file" title="Remove">
                <Icon name="x" />
              </button>
            </div>
          ) : (
            <input
              ref={field}
              className="xf-box-input"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={over ? "Drop it here" : "Paste a video link, or drop a file"}
              aria-label="Video link"
              value={url}
              disabled={busy}
              onChange={(e) => { setProblem(null); onUrl(e.target.value); }}
              onKeyDown={(e) => { if (e.key === "Enter" && ready) onStart(); }}
              onPaste={(e) => {
                // A file copied in the file manager pastes as a file.
                const pasted = e.clipboardData?.files?.[0];
                if (pasted) { e.preventDefault(); take(pasted); }
              }}
            />
          )}

          <button
            type="button"
            className="xf-btn xf-btn-primary xf-btn-lg xf-go"
            onClick={onStart}
            disabled={!ready || busy}
          >
            {goLabel}
            <Icon name="arrowRight" />
          </button>
        </div>

        {problem ? (
          <div className="xf-box-error" role="alert">{problem}</div>
        ) : (
          <div className="xf-box-hint">
            <span>Files: MP4, MOV or WebM, up to {MAX_UPLOAD_MB} MB</span>
            <span className="xf-dot">·</span>
            <span>Links: YouTube, TikTok, Instagram, X</span>
            <span className="xf-dot">·</span>
            <span>Videos up to 2 hours</span>
          </div>
        )}
      </div>

      {children}
    </div>
  );
}

/** A chip that is a native select underneath: the chosen label shows, the
    platform's own picker opens. Lit when it differs from the default. */
export function SelectChip({ name, value, options, fallback, onChange }) {
  const chosen = options.find(([v]) => String(v) === String(value));
  return (
    <label className={`xf-chip${String(value) !== String(fallback) ? " is-set" : ""}`}>
      <span className="xf-chip-k">{name}</span>
      <span className="xf-chip-v">{chosen ? chosen[1] : value}</span>
      <Icon name="chevron" size={13} />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={name}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** A chip that opens or toggles something rather than choosing from a list. */
export function ToggleChip({ name, value, on, pressed, expanded, onClick, icon }) {
  return (
    <button
      type="button"
      className={`xf-chip${on ? " is-set" : ""}`}
      onClick={onClick}
      aria-pressed={pressed}
      aria-expanded={expanded}
    >
      {icon && <Icon name={icon} size={14} />}
      <span className="xf-chip-k">{name}</span>
      {value && <span className="xf-chip-v">{value}</span>}
    </button>
  );
}
