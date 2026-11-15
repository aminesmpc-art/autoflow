"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadActions } from "./DownloadButtons";
import RefinePanel from "./RefinePanel";
import StudioDialog from "./StudioDialog";
import { clock } from "./timeFields";
import { CopyButton, Icon, Menu, shotTime, useHeadMetrics } from "./ui";

/* An extraction as a place to work in rather than a page to scroll.

   A header that stays put says what the video is and holds every action;
   tabs split the result into the parts people go looking for; each shot is
   one compact row that opens in place. Refine sits beside the shots on a
   wide screen and slides up as a sheet on a narrow one. */

const PROMPT_VIEWS = [
  ["image", "Image", "image"],
  ["video", "Motion", "motion"],
];

function promptOf(shot, view) {
  return (view === "video" ? shot.video_prompt : shot.image_prompt) || "";
}

/** Shot numbers each character appears in, by the names the shots carry. */
function appearances(shots, name) {
  const key = String(name || "").trim().toLowerCase();
  return shots
    .filter((s) => (s.characters || []).some((c) => String(c).trim().toLowerCase() === key))
    .map((s) => s.shot_id);
}

export function ShotRow({ shot, view }) {
  const [open, setOpen] = useState(false);
  const camera = [shot.camera?.shot_size, shot.camera?.lens, shot.camera?.movement].filter(Boolean).join(" · ");
  const cast = Array.isArray(shot.characters) ? shot.characters : [];
  const prompt = promptOf(shot, view);
  const time = shotTime(shot);
  const kind = view === "video" ? "motion" : "image";

  return (
    <li className={`xf-shot${open ? " is-open" : ""}`} id={`shot-${shot.shot_id}`}>
      {shot.thumbnail_url && (
        // A plain img: the frame comes from the extractor's own host, and a
        // broken one hides itself rather than leaving an empty box.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="xf-shot-thumb"
          src={shot.thumbnail_url}
          alt={`Frame from shot ${shot.shot_id}`}
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
      )}
      <div className="xf-shot-body">
        <div className="xf-shot-meta">
          <span className="xf-shot-no">Shot {shot.shot_id}</span>
          {time && <span className="xf-tc">{time}</span>}
          {camera && <span className="xf-shot-cam">{camera}</span>}
          {cast.length > 0 && (
            <span className="xf-cast">
              {cast.map((name) => (
                <span key={name} className="xf-person"><Icon name="user" size={11} />{name}</span>
              ))}
            </span>
          )}
        </div>

        <p className={`xf-shot-prompt${prompt ? "" : " is-empty"}`}>
          {prompt || `No ${kind} prompt for this shot.`}
        </p>

        {open && (
          <div className="xf-shot-full">
            {PROMPT_VIEWS.map(([v, label, icon]) => promptOf(shot, v) && (
              <div className="xf-block" key={v}>
                <div className="xf-block-head">
                  <span><Icon name={icon} size={14} /> {label} prompt</span>
                  <CopyButton text={promptOf(shot, v)} className="xf-btn xf-btn-ghost xf-btn-sm" />
                </div>
                <p>{promptOf(shot, v)}</p>
              </div>
            ))}
            {shot.dialogue && (
              <div className="xf-block">
                <div className="xf-block-head"><span><Icon name="mic" size={14} /> Dialogue</span></div>
                <p>{shot.dialogue}</p>
              </div>
            )}
            {shot.sound && (
              <div className="xf-block">
                <div className="xf-block-head"><span><Icon name="script" size={14} /> Sound</span></div>
                <p className="xf-quiet">{shot.sound}</p>
              </div>
            )}
          </div>
        )}

        <div className="xf-shot-foot">
          <button type="button" className="xf-link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Show less" : "Show everything"}
          </button>
          {!open && shot.dialogue && <span className="xf-shot-hint"><Icon name="mic" size={12} /> Dialogue</span>}
          {!open && shot.sound && <span className="xf-shot-hint"><Icon name="script" size={12} /> Sound</span>}
        </div>
      </div>

      <div className="xf-shot-side">
        <CopyButton
          text={prompt}
          iconOnly
          title={`Copy the ${kind} prompt`}
          className="xf-btn xf-btn-sm xf-btn-icon"
        />
      </div>
    </li>
  );
}

function ShotsPanel({ shots, view, onView, flash }) {
  if (!shots.length) return <div className="xf-empty">No shots were found in this video.</div>;
  const all = () => shots.map((s) => promptOf(s, view)).filter(Boolean).join("\n\n");
  const label = view === "video" ? "motion" : "image";

  return (
    <>
      <div className="xf-toolbar">
        <div className="xf-seg" role="group" aria-label="Prompt to show">
          {PROMPT_VIEWS.map(([v, l, icon]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => onView(v)}>
              <Icon name={icon} size={14} /> {l} prompts
            </button>
          ))}
        </div>
        <button
          type="button"
          className="xf-btn xf-btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(all());
              flash(`Copied ${shots.length} ${label} prompts`);
            } catch (e) { /* no clipboard */ }
          }}
        >
          <Icon name="copy" /> Copy all {label} prompts
        </button>
      </div>
      <ol className="xf-shots">
        {shots.map((shot, i) => <ShotRow key={`${shot.shot_id}-${i}`} shot={shot} view={view} />)}
      </ol>
    </>
  );
}

function CharactersPanel({ sheets, shots, onJump }) {
  if (!sheets.length) return <div className="xf-empty">No characters were found in this video.</div>;
  return (
    <>
      <div className="xf-cards">
        {sheets.map((c, i) => {
          const seen = appearances(shots, c.character_name);
          return (
            <article className="xf-card" key={`${c.character_name}-${i}`}>
              <div className="xf-card-head">
                <h3 className="xf-card-name">
                  <span className="xf-avatar" aria-hidden="true">{String(c.character_name || "?").trim().charAt(0).toUpperCase()}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.character_name}</span>
                </h3>
                <CopyButton text={c.prompt} />
              </div>
              <p className="xf-card-body">{c.prompt}</p>
              {seen.length > 0 && (
                <div className="xf-card-foot">
                  In shot{seen.length === 1 ? "" : "s"}{" "}
                  {seen.map((n, j) => (
                    <span key={n}>
                      {j > 0 && ", "}
                      <button type="button" className="xf-link xf-link-muted" onClick={() => onJump(n)}>{n}</button>
                    </span>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
      <p className="xf-tip">
        <Icon name="sparkles" />
        <span>For AutoFlow&apos;s character mapping, use reference images that match these descriptions.</span>
      </p>
    </>
  );
}

function MasterPanel({ result }) {
  const [view, setView] = useState("text");
  const json = result.master_prompt_json;
  const showJson = view === "json" && json;
  return (
    <div className="xf-panel">
      <div className="xf-panel-head">
        <h3 className="xf-panel-title"><Icon name="target" /> One prompt for the whole video</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {json && (
            <div className="xf-seg" role="tablist" aria-label="Format">
              {[["text", "Paragraph"], ["json", "JSON"]].map(([v, l]) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}>{l}</button>
              ))}
            </div>
          )}
          <CopyButton text={() => (showJson ? JSON.stringify(json, null, 2) : result.master_prompt)} />
        </div>
      </div>
      {showJson
        ? <pre className="xf-pre">{JSON.stringify(json, null, 2)}</pre>
        : <p className="xf-prose">{result.master_prompt}</p>}
    </div>
  );
}

function ScriptPanel({ text }) {
  return (
    <div className="xf-panel">
      <div className="xf-panel-head">
        <h3 className="xf-panel-title"><Icon name="mic" /> Voiceover and dialogue</h3>
        <CopyButton text={text} label="Copy script" />
      </div>
      <p className="xf-prose">{text}</p>
    </div>
  );
}

function NotesPanel({ warnings }) {
  return (
    <div className="xf-callout" role="status">
      <Icon name="alert" />
      <div>
        <strong style={{ color: "var(--text-primary)", display: "block", marginBottom: 6 }}>
          What the extractor changed or could not be sure of
        </strong>
        <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      </div>
    </div>
  );
}

function ShareMenu({ savedId, saveStatus, isPublished, busy, onToggle }) {
  const label = isPublished ? "Public" : "Private";
  return (
    <Menu label={<span className="xf-btn-label">{label}</span>} icon={isPublished ? "globe" : "lock"} keepOpen>
      {(close) => (
        <>
          <div className="xf-menu-note">
            <strong><Icon name={isPublished ? "globe" : "lock"} size={14} /> {isPublished ? "Listed in the public gallery" : "Private to your account"}</strong>
            {isPublished
              ? "Anyone can view these prompts on the Prompts page, and search engines may index them."
              : "Only you can see this extraction. Publishing lists its prompts on the public Prompts page, where search engines may index them."}
          </div>
          {savedId ? (
            <button
              type="button"
              className="xf-menu-item"
              role="menuitem"
              disabled={busy}
              onClick={async () => { await onToggle(); close(); }}
            >
              <Icon name={isPublished ? "lock" : "globe"} />
              <span>{busy ? "Updating…" : isPublished ? "Make private" : "Publish to the gallery"}</span>
            </button>
          ) : (
            <div className="xf-menu-head">
              {saveStatus === "saving" ? "Saving… publishing is available once it is saved."
                : saveStatus === "error" ? "This extraction could not be saved, so it cannot be published."
                : "Publishing is available once the extraction is saved."}
            </div>
          )}
        </>
      )}
    </Menu>
  );
}

export default function Workspace({
  result,
  name,
  sourceName,
  saveStatus,
  savedId,
  isPublished,
  publishBusy,
  onTogglePublished,
  onReset,
  resetLabel = "Extract another",
  refine,
}) {
  const shots = result.shots || [];
  const sheets = result.character_sheets || [];
  const warnings = result.warnings || [];
  const [tab, setTab] = useState("shots");
  const [view, setView] = useState("image");
  const [studioOpen, setStudioOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const head = useRef(null);
  const body = useRef(null);
  const toastTimer = useRef(null);

  const tabs = [
    { id: "shots", label: "Shots", icon: "film", n: shots.length },
    sheets.length > 0 && { id: "characters", label: "Characters", icon: "users", n: sheets.length },
    result.master_prompt && { id: "master", label: "Master prompt", icon: "target" },
    result.voiceover_text && { id: "script", label: "Script", icon: "mic" },
    warnings.length > 0 && { id: "notes", label: "Notes", icon: "alert", n: warnings.length, warn: true },
  ].filter(Boolean);

  // A refine can remove what the open tab shows, the characters say.
  const tabIds = tabs.map((t) => t.id).join(" ");
  useEffect(() => {
    if (!tabIds.split(" ").includes(tab)) setTab("shots");
  }, [tabIds, tab]);

  const closeStudio = useCallback(() => setStudioOpen(false), []);
  const closeRefine = useCallback(() => setRefineOpen(false), []);

  // The refine panel sticks below the header, so the header is measured.
  useHeadMetrics(head);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const flash = (message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  /* Switching tabs from far down the shot list starts the new tab at its
     top, just under the header, instead of somewhere in the middle. */
  const scrollToBody = () => {
    if (!body.current || !head.current) return;
    const stuck = head.current.getBoundingClientRect().bottom;
    const top = body.current.getBoundingClientRect().top;
    if (top < stuck) window.scrollBy({ top: top - stuck - 12 });
  };

  const choose = (id) => {
    setTab(id);
    requestAnimationFrame(scrollToBody);
  };

  const jumpToShot = (id) => {
    setTab("shots");
    requestAnimationFrame(() => {
      const row = document.getElementById(`shot-${id}`);
      if (!row || !head.current) return;
      const offset = row.getBoundingClientRect().top - head.current.getBoundingClientRect().bottom - 12;
      window.scrollBy({ top: offset, behavior: "smooth" });
      row.classList.add("is-flash");
      setTimeout(() => row.classList.remove("is-flash"), 1400);
    });
  };

  const onTabKey = (e) => {
    const i = tabs.findIndex((t) => t.id === tab);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (next == null) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length];
    choose(t.id);
    document.getElementById(`xf-tab-${t.id}`)?.focus();
  };

  const duration = result.section
    ? result.section.end_sec - result.section.start_sec
    : result.duration_sec;
  const cover = result.cover_url || shots.find((s) => s.thumbnail_url)?.thumbnail_url;
  const hasSide = !!refine;

  const copyAll = async (kind) => {
    const text = shots.map((s) => promptOf(s, kind)).filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      flash(`Copied ${shots.length} ${kind === "video" ? "motion" : "image"} prompts`);
    } catch (e) { /* no clipboard */ }
  };

  return (
    <div className="xf-ws">
      <header className="xf-ws-head" ref={head}>
        <div className="xf-ws-top">
          <div className="xf-ws-id">
            {cover && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="xf-ws-cover" src={cover} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            )}
            <div style={{ minWidth: 0 }}>
              <h1 className="xf-ws-name" title={name}>{name}</h1>
              <div className="xf-ws-stats">
                <span><Icon name="film" size={13} />{shots.length} shot{shots.length === 1 ? "" : "s"}</span>
                {duration > 0 && <span><Icon name="clock" size={13} /><span className="xf-tc">{clock(duration)}</span></span>}
                {result.aspect_ratio && <span>{result.aspect_ratio}</span>}
                {sheets.length > 0 && <span><Icon name="users" size={13} />{sheets.length} character{sheets.length === 1 ? "" : "s"}</span>}
                {result.section && (
                  <span>part <span className="xf-tc">{clock(result.section.start_sec)}–{clock(result.section.end_sec)}</span> of <span className="xf-tc">{clock(result.duration_sec)}</span></span>
                )}
                {saveStatus === "saving" && <span className="xf-save">Saving…</span>}
                {saveStatus === "saved" && <span className="xf-save is-saved"><Icon name="check" size={13} />Saved</span>}
                {saveStatus === "error" && <span className="xf-save is-error">Not saved</span>}
              </div>
            </div>
          </div>

          <div className="xf-ws-actions">
            {shots.length > 0 && (
              <Menu label={<span className="xf-btn-label">Download</span>} icon="download" className="xf-btn">
                <div className="xf-menu-head">Files</div>
                {downloadActions(result, sourceName).map((d) => (
                  <button key={d.key} type="button" className="xf-menu-item" role="menuitem" disabled={!d.ok} onClick={d.run} title={d.why}>
                    <Icon name={d.key === "storyboard" ? "grid" : d.key === "csv" ? "file" : d.key === "srt" ? "script" : "scissors"} />
                    <span>{d.label}<small>{d.why}</small></span>
                  </button>
                ))}
                <div className="xf-menu-sep" />
                <div className="xf-menu-head">Copy for the AutoFlow extension</div>
                <button type="button" className="xf-menu-item" role="menuitem" onClick={() => copyAll("image")}>
                  <Icon name="image" /><span>All image prompts</span>
                </button>
                <button type="button" className="xf-menu-item" role="menuitem" onClick={() => copyAll("video")}>
                  <Icon name="motion" /><span>All motion prompts</span>
                </button>
              </Menu>
            )}
            {shots.length > 0 && (
              <button type="button" className="xf-btn" onClick={() => setStudioOpen(true)}>
                <Icon name="bolt" /><span className="xf-btn-label">Studio</span>
              </button>
            )}
            {onTogglePublished && (
              <ShareMenu
                savedId={savedId}
                saveStatus={saveStatus}
                isPublished={isPublished}
                busy={publishBusy}
                onToggle={onTogglePublished}
              />
            )}
            <button type="button" className="xf-btn xf-btn-primary xf-ws-another" onClick={onReset}>
              <Icon name="plus" /><span className="xf-btn-label">{resetLabel}</span>
            </button>
          </div>
        </div>

        <div className="xf-tabs" role="tablist" aria-label="Result" onKeyDown={onTabKey}>
          {tabs.map((t) => (
            <button
              key={t.id}
              id={`xf-tab-${t.id}`}
              type="button"
              role="tab"
              className="xf-tab"
              aria-selected={tab === t.id}
              aria-controls="xf-panel"
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => choose(t.id)}
            >
              {t.label}
              {t.n != null && <span className={`xf-tab-n${t.warn ? " is-warn" : ""}`}>{t.n}</span>}
            </button>
          ))}
        </div>
      </header>

      <div className={`xf-ws-body${hasSide ? " has-side" : ""}`} ref={body}>
        <div id="xf-panel" role="tabpanel" aria-labelledby={`xf-tab-${tab}`} style={{ minWidth: 0 }}>
          {result.video_concept && tab === "shots" && <p className="xf-concept" style={{ margin: "0 0 14px" }}>{result.video_concept}</p>}

          {warnings.length > 0 && tab !== "notes" && (
            <div className="xf-callout" style={{ marginBottom: 14, padding: "10px 14px" }}>
              <Icon name="alert" />
              <span>
                {warnings.length === 1 ? "There is a note" : `There are ${warnings.length} notes`} on this extraction.{" "}
                <button type="button" className="xf-link" onClick={() => choose("notes")}>Read {warnings.length === 1 ? "it" : "them"}</button>
              </span>
            </div>
          )}

          {tab === "shots" && <ShotsPanel shots={shots} view={view} onView={setView} flash={flash} />}
          {tab === "characters" && <CharactersPanel sheets={sheets} shots={shots} onJump={jumpToShot} />}
          {tab === "master" && <MasterPanel result={result} />}
          {tab === "script" && <ScriptPanel text={result.voiceover_text} />}
          {tab === "notes" && <NotesPanel warnings={warnings} />}
        </div>

        {hasSide && (
          <>
            {refineOpen && <div className="xf-scrim" onClick={closeRefine} />}
            <aside className={`xf-side${refineOpen ? " is-open" : ""}`} aria-label="Refine">
              <RefinePanel {...refine} onClose={closeRefine} />
            </aside>
            <button type="button" className="xf-btn xf-btn-primary xf-btn-lg xf-fab" onClick={() => setRefineOpen(true)}>
              <Icon name="sparkles" /> Refine
            </button>
          </>
        )}
      </div>

      <StudioDialog open={studioOpen} onClose={closeStudio} result={result} name={name} />

      {toast && <div className="xf-toast" role="status">{toast}</div>}
    </div>
  );
}
