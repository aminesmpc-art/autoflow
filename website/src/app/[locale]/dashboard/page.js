"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../../context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DownloadButtons from "../extractor/DownloadButtons";
import BreakdownView from "../breakdown/BreakdownView";
import { ShotRow } from "../extractor/Workspace";
import { CopyButton, Icon } from "../extractor/ui";
import { OPEN_KEY } from "../extractor/saved";
import "../extractor/extractor.css";

/* Everything a person has saved, newest first: extractions and breakdowns in
   one list, each a compact row that opens in place. An extraction's main
   action is to open it in the extractor's workspace, where it can be refined;
   a breakdown reads right here. */

const KINDS = [
  ["all", "All"],
  ["prompts", "Extractions"],
  ["breakdown", "Breakdowns"],
];

function kindOf(ex) {
  return ex.kind === "breakdown" ? "breakdown" : "prompts";
}

function ExtractionBody({ ex }) {
  const [view, setView] = useState("image");
  const [all, setAll] = useState(false);
  const shots = ex.shots || [];
  const shown = all ? shots : shots.slice(0, 5);

  return (
    <>
      {shots.length > 0 && (
        <div>
          <div className="xf-label" style={{ marginBottom: 8 }}>Download</div>
          <DownloadButtons
            result={{ ...ex, source_fps: ex.details?.source_fps }}
            sourceName={ex.video_name}
            buttonClassName="xf-btn xf-btn-sm"
          />
        </div>
      )}

      {ex.master_prompt && (
        <div className="xf-block">
          <div className="xf-block-head">
            <span><Icon name="target" size={14} /> Master prompt</span>
            <span style={{ display: "flex", gap: 6 }}>
              <CopyButton text={ex.master_prompt} className="xf-btn xf-btn-ghost xf-btn-sm" />
              {ex.master_prompt_json && (
                <CopyButton text={() => JSON.stringify(ex.master_prompt_json, null, 2)} label="Copy JSON" className="xf-btn xf-btn-ghost xf-btn-sm" />
              )}
            </span>
          </div>
          <p>{ex.master_prompt}</p>
        </div>
      )}

      {ex.voiceover_text && (
        <div className="xf-block">
          <div className="xf-block-head">
            <span><Icon name="mic" size={14} /> Script</span>
            <CopyButton text={ex.voiceover_text} className="xf-btn xf-btn-ghost xf-btn-sm" />
          </div>
          <p className="xf-quiet">{ex.voiceover_text}</p>
        </div>
      )}

      {shots.length > 0 && (
        <div>
          <div className="xf-toolbar">
            <div className="xf-seg" role="group" aria-label="Prompt to show">
              {[["image", "Image", "image"], ["video", "Motion", "motion"]].map(([v, l, icon]) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
                  <Icon name={icon} size={14} /> {l}
                </button>
              ))}
            </div>
            <CopyButton
              text={() => shots.map((s) => (view === "video" ? s.video_prompt : s.image_prompt)).filter(Boolean).join("\n\n")}
              label={`Copy all ${view === "video" ? "motion" : "image"} prompts`}
            />
          </div>
          <ol className="xf-shots">
            {shown.map((shot, i) => <ShotRow key={`${shot.shot_id}-${i}`} shot={shot} view={view} />)}
          </ol>
          {shots.length > shown.length && (
            <button type="button" className="xf-btn xf-btn-ghost xf-btn-sm" style={{ marginTop: 8 }} onClick={() => setAll(true)}>
              Show all {shots.length} shots
            </button>
          )}
        </div>
      )}
    </>
  );
}

export default function DashboardPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const [extractions, setExtractions] = useState([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [kind, setKind] = useState("all");
  const [query, setQuery] = useState("");

  const DJANGO_API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.auto-flow.studio/api";
  /* Shot thumbnails live on the extractor, not on Django. */
  const EXTRACTOR_API_URL = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL || "https://autoflow-extractor-production.up.railway.app/api/videos";

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login?next=/dashboard");
    }
  }, [user, loading, router]);

  useEffect(() => {
    async function fetchExtractions() {
      if (!token) return;
      try {
        const res = await fetch(`${DJANGO_API_URL}/extractions/`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setExtractions(data);
        } else {
          setLoadError(true);
        }
      } catch (err) {
        console.error("Failed to load extractions", err);
        setLoadError(true);
      } finally {
        setIsLoadingData(false);
      }
    }
    if (token) fetchExtractions();
  }, [token, DJANGO_API_URL]);

  const handleDelete = async (extraction) => {
    if (!confirm(`Delete “${extraction.video_name}”? This cannot be undone.`)) return;
    const id = extraction.id;

    try {
      const res = await fetch(`${DJANGO_API_URL}/extractions/${id}/`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        setExtractions((list) => list.filter((ex) => ex.id !== id));
        // Its shot thumbnails go with it. Best effort: the extraction is
        // already gone, and a thumbnail left behind is unlisted and unlinked.
        const thumbs = extraction.details?.thumbnails_id;
        if (thumbs) {
          fetch(`${EXTRACTOR_API_URL}/thumbs/${thumbs}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  const openInWorkspace = (ex) => {
    // The extractor page picks this up and opens it ready to edit.
    try { sessionStorage.setItem(OPEN_KEY, JSON.stringify(ex)); } catch (e) { return; }
    router.push("/extractor?open=1");
  };

  if (loading || !user) return <div className="container" style={{ minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center" }}>Loading...</div>;

  const counts = {
    all: extractions.length,
    prompts: extractions.filter((ex) => kindOf(ex) === "prompts").length,
    breakdown: extractions.filter((ex) => kindOf(ex) === "breakdown").length,
  };
  const q = query.trim().toLowerCase();
  const shown = extractions.filter((ex) =>
    (kind === "all" || kindOf(ex) === kind)
    && (!q || `${ex.video_name} ${ex.video_concept}`.toLowerCase().includes(q)));

  return (
    <div className="xf">
      <div className="container xf-dash">
        <div className="xf-dash-head">
          <div>
            <h1>Your <span className="text-gradient">dashboard</span></h1>
            <p>Every extraction and breakdown you have saved. Only you can see them unless you publish one.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/breakdown" className="xf-btn">
              <Icon name="layers" /> Break one down
            </Link>
            <Link href="/extractor" className="xf-btn xf-btn-primary">
              <Icon name="plus" /> Extract a video
            </Link>
          </div>
        </div>

        {isLoadingData ? (
          <div className="xf-empty" role="status"><span className="xf-spinner" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 8 }} /> Loading your extractions…</div>
        ) : loadError ? (
          <div className="xf-callout xf-callout-error" role="alert">
            <Icon name="alert" />
            <span>Your extractions could not be loaded. Check your connection and reload the page.</span>
          </div>
        ) : extractions.length === 0 ? (
          <div className="xf-empty" style={{ padding: "48px 24px" }}>
            <Icon name="film" size={28} />
            <h3 style={{ margin: "12px 0 6px", fontSize: "1.15rem", color: "var(--text-primary)" }}>Nothing saved yet</h3>
            <p style={{ margin: "0 auto 18px", maxWidth: 420 }}>Extract a video and it is saved here automatically, ready to copy, download or refine later.</p>
            <Link href="/extractor" className="xf-btn xf-btn-primary">Extract your first video</Link>
          </div>
        ) : (
          <>
            <div className="xf-dash-bar">
              <div className="xf-seg" role="group" aria-label="Show">
                {KINDS.map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={kind === v} onClick={() => setKind(v)}>
                    {l} <span className="xf-tab-n">{counts[v]}</span>
                  </button>
                ))}
              </div>
              <label className="xf-search">
                <Icon name="search" />
                <input className="xf-input" type="search" placeholder="Search by name or concept" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search your extractions" />
              </label>
            </div>

            {shown.length === 0 ? (
              <div className="xf-empty">Nothing matches “{query}”.</div>
            ) : (
              <ul className="xf-rows">
                {shown.map((ex) => {
                  const open = expandedId === ex.id;
                  const isBreakdown = kindOf(ex) === "breakdown";
                  const date = new Date(ex.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
                  const thumb = ex.details?.cover_url || ex.breakdown?.cover_url || ex.shots?.find((s) => s.thumbnail_url)?.thumbnail_url;
                  const shots = ex.shots?.length || 0;

                  return (
                    <li key={ex.id} className={`xf-row${open ? " is-open" : ""}`}>
                      <div className="xf-row-main">
                        <button
                          type="button"
                          className="xf-row-toggle"
                          onClick={() => setExpandedId(open ? null : ex.id)}
                          aria-expanded={open}
                        >
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="xf-row-thumb" src={thumb} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                          ) : (
                            <span className="xf-row-thumb"><Icon name={isBreakdown ? "layers" : "film"} size={20} /></span>
                          )}
                          <span className="xf-row-text">
                            <span className="xf-row-title">
                              <span>{ex.video_name}</span>
                              {isBreakdown && <span className="xf-tag xf-tag-accent">Why it works</span>}
                              {ex.is_public && <span className="xf-tag"><Icon name="globe" size={11} /> Public</span>}
                            </span>
                            <span className="xf-row-sub">
                              <span>{date}</span>
                              {!isBreakdown && shots > 0 && <span>{shots} shot{shots === 1 ? "" : "s"}</span>}
                              {ex.character_sheets?.length > 0 && <span>{ex.character_sheets.length} character{ex.character_sheets.length === 1 ? "" : "s"}</span>}
                            </span>
                            {ex.video_concept && <span className="xf-row-concept" style={{ display: "block" }}>{ex.video_concept}</span>}
                          </span>
                          <Icon name="chevron" className="xf-row-caret" />
                        </button>
                        <span className="xf-row-actions">
                          {!isBreakdown && shots > 0 && (
                            <button type="button" className="xf-btn xf-btn-sm" onClick={() => openInWorkspace(ex)}>
                              <Icon name="sparkles" /> Open &amp; refine
                            </button>
                          )}
                          <button
                            type="button"
                            className="xf-btn xf-btn-ghost xf-btn-sm xf-btn-icon xf-btn-danger"
                            onClick={() => handleDelete(ex)}
                            aria-label={`Delete ${ex.video_name}`}
                            title="Delete"
                          >
                            <Icon name="trash" />
                          </button>
                        </span>
                      </div>

                      {open && (
                        <div className="xf-row-body">
                          {isBreakdown ? <BreakdownView breakdown={ex.breakdown} /> : <ExtractionBody ex={ex} />}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
