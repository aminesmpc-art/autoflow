"use client";

import { useEffect, useRef, useState } from "react";
import {
  STUDIO_OPTIONS,
  DEFAULT_STUDIO_OPTS,
  buildStudioWorkflow,
  downloadStudioWorkflow,
} from "./studioWorkflow";
import { studioInstalled, sendToStudio, toBuildOptions } from "./studioBridge";
import StoreLink, { STORE_URLS } from "../../StoreLink";
import { Icon } from "./ui";

/* Build an AutoFlow Studio workflow from the extraction.

   It stays mounted while the results are on screen, so the choices made here
   survive closing and reopening it. Three states for the main button: asking
   whether Studio is installed waits, installed sends straight to the canvas,
   missing offers the install. The .json download works either way. */

function Select({ label, value, options, onChange }) {
  return (
    <label className="xf-field">
      <span className="xf-label">{label}</span>
      <select className="xf-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => {
          const [v, l] = Array.isArray(o) ? o : [o, o];
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    </label>
  );
}

export default function StudioDialog({ open, onClose, result, name }) {
  const [opts, setOpts] = useState(DEFAULT_STUDIO_OPTS);
  const [hasStudio, setHasStudio] = useState(null);
  const [send, setSend] = useState({ state: "idle", message: "", notes: [] });
  const [downloaded, setDownloaded] = useState(false);
  const panel = useRef(null);

  /* Asked as soon as there is a result rather than on the click, so the
     button is right before anyone reaches for it. */
  useEffect(() => {
    if (!result?.shots?.length) return;
    let alive = true;
    studioInstalled().then((yes) => { if (alive) setHasStudio(yes); });
    return () => { alive = false; };
  }, [result]);

  useEffect(() => {
    if (!open) return;
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose]);

  // Focus goes into the dialog when it opens, and only then.
  useEffect(() => {
    if (open) panel.current?.querySelector("select, button")?.focus();
  }, [open]);

  if (!open) return null;

  const set = (key, value) => setOpts((prev) => ({ ...prev, [key]: value }));
  const preview = result?.shots?.length ? buildStudioWorkflow(result, opts) : null;
  const nodes = preview?.nodes.length ?? 0;
  const gens = preview?.nodes.filter((n) => n.data.type === "generate").length ?? 0;
  const images = opts.chain !== "videos";
  const videos = opts.chain !== "images";
  const title = name || "Extracted Workflow";

  const handOver = async () => {
    setSend({ state: "sending", message: "", notes: [] });
    const reply = await sendToStudio(result, toBuildOptions(opts, title));
    if (reply.ok) {
      setSend({
        state: "sent",
        message: `Opened in Studio — ${reply.nodes} nodes. If the canvas did not come up, open the extension and it is waiting.`,
        notes: reply.notes || [],
      });
      return;
    }
    setSend({ state: "error", message: reply.error || "Studio could not build that.", notes: [] });
  };

  return (
    <div className="xf-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="xf-dialog" role="dialog" aria-modal="true" aria-labelledby="xf-studio-title" ref={panel}>
        <div className="xf-dialog-head">
          <div>
            <h2 id="xf-studio-title"><Icon name="bolt" size={18} /> Open in AutoFlow Studio</h2>
            <p>Every shot becomes nodes on a canvas with its prompts already wired in — nothing to copy by hand.</p>
          </div>
          <button type="button" className="xf-btn xf-btn-ghost xf-btn-sm xf-btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>

        <div className="xf-fields">
          <Select
            label="Build"
            value={opts.chain}
            options={[["image_to_video", "Still → clip"], ["images", "Stills only"], ["videos", "Clips only"]]}
            onChange={(v) => set("chain", v)}
          />
          {images && <Select label="Image model" value={opts.imageModel} options={STUDIO_OPTIONS.imageModels} onChange={(v) => set("imageModel", v)} />}
          {videos && <Select label="Video model" value={opts.videoModel} options={STUDIO_OPTIONS.videoModels} onChange={(v) => set("videoModel", v)} />}
          <Select
            label="Aspect ratio"
            value={opts.aspectRatio}
            options={images ? STUDIO_OPTIONS.imageRatios : STUDIO_OPTIONS.videoRatios}
            onChange={(v) => set("aspectRatio", v)}
          />
          {videos && <Select label="Clip length" value={opts.duration} options={STUDIO_OPTIONS.durations} onChange={(v) => set("duration", v)} />}
          <Select label="Platform" value={opts.platform} options={[["flow", "Google Flow"], ["chatgpt", "ChatGPT"]]} onChange={(v) => set("platform", v)} />
        </div>

        {videos && !STUDIO_OPTIONS.videoRatios.includes(opts.aspectRatio) && (
          <p className="xf-help" style={{ marginTop: 10 }}>
            Flow only offers {STUDIO_OPTIONS.videoRatios.join(", ")} for video — clips will use 9:16.
          </p>
        )}

        <div className="xf-dialog-foot">
          {hasStudio === true && (
            <button
              type="button"
              className="xf-btn xf-btn-primary xf-btn-lg"
              disabled={!nodes || send.state === "sending"}
              onClick={handOver}
            >
              <Icon name="bolt" />
              {send.state === "sending" ? "Building…" : "Open in Studio"}
            </button>
          )}
          {hasStudio === null && (
            <button type="button" className="xf-btn xf-btn-primary xf-btn-lg" disabled>Looking for Studio…</button>
          )}
          {hasStudio === false && (
            <StoreLink product="studio" className="xf-btn xf-btn-primary xf-btn-lg">
              <Icon name="external" /> Install AutoFlow Studio
            </StoreLink>
          )}
          <button
            type="button"
            className="xf-btn xf-btn-ghost"
            disabled={!nodes}
            onClick={() => { downloadStudioWorkflow(result, opts, title); setDownloaded(true); }}
          >
            <Icon name="download" /> Download .json
          </button>
          <span className="xf-dialog-meta">{nodes} nodes · {gens} generation{gens === 1 ? "" : "s"}</span>
        </div>

        {send.state === "sent" && (
          <p className="xf-ok"><Icon name="check" /> {send.message}</p>
        )}
        {send.notes.length > 0 && (
          <ul className="xf-steps-ol">{send.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        )}
        {send.state === "error" && (
          <div className="xf-callout xf-callout-error" role="alert"><Icon name="alert" /> <span>{send.message}</span></div>
        )}

        {hasStudio === false && !downloaded && (
          <p className="xf-help" style={{ marginTop: 14 }}>
            With Studio installed this is one click: install it, reload this page, and the button above sends
            straight to the canvas. The .json works too — import it from Studio&apos;s gallery.
          </p>
        )}

        {downloaded && (
          <div className="xf-callout" style={{ borderColor: "var(--xf-accent-line)", background: "var(--xf-accent-soft)" }}>
            <Icon name="check" />
            <div>
              <strong style={{ color: "var(--text-primary)" }}>Workflow saved to your downloads</strong>
              <ol className="xf-steps-ol">
                <li>
                  Open AutoFlow Studio
                  {hasStudio === false && (
                    <> — <a href={STORE_URLS.studio} target="_blank" rel="noopener noreferrer" className="xf-link">install it first</a>, the file needs it</>
                  )}
                </li>
                <li>On the gallery screen press Import, or drag the .json onto it</li>
                <li>It lands in My Workflows, wired and ready to run</li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
