/* An extraction as the engine returns it, and as Django keeps it.

   Django has columns for the original fields and the master prompt, and one
   JSON bag (`details`) for everything else about the whole video, so the
   next thing the engine reports does not need a migration to be kept. These
   two functions are the only place that mapping is written down. */

/** The fields to save, beyond video_name and the original five. */
export function savedExtras(result) {
  return {
    master_prompt: result.master_prompt || "",
    master_prompt_json: result.master_prompt_json || null,
    details: {
      characters_description: result.characters_description || "",
      aspect_ratio: result.aspect_ratio || "",
      duration_sec: result.duration_sec ?? null,
      section: result.section || null,
      warnings: result.warnings || [],
      thumbnails_id: result.thumbnails_id || null,
      model: result.model || "",
      // The cut-list export counts frames at this rate.
      source_fps: result.source_fps ?? null,
      read_from: result.read_from || "file",
      cover_url: result.cover_url || null,
    },
  };
}

/** Everything a version changes, for saving it onto the same row. */
export function savedVersion(result) {
  return {
    video_concept: result.video_concept || "",
    voiceover_text: result.voiceover_text || "",
    character_sheets: result.character_sheets || [],
    shots: result.shots || [],
    ...savedExtras(result),
  };
}

/** A saved row back into the engine's shape, to show and to edit. */
export function asResult(row) {
  const d = row.details || {};
  return {
    video_concept: row.video_concept || "",
    voiceover_text: row.voiceover_text || "",
    characters_description: d.characters_description || "",
    character_sheets: row.character_sheets || [],
    shots: row.shots || [],
    master_prompt: row.master_prompt || "",
    master_prompt_json: row.master_prompt_json || null,
    duration_sec: d.duration_sec ?? 0,
    section: d.section || null,
    aspect_ratio: d.aspect_ratio || "",
    warnings: [],
    model: d.model || "",
    thumbnails_id: d.thumbnails_id || null,
    source_fps: d.source_fps ?? null,
    read_from: d.read_from || "file",
    cover_url: d.cover_url || null,
    // A saved extraction's video is long gone; edits work from the text.
    refine_until: null,
  };
}

/* The hand-off from the dashboard to the extractor page. */
export const OPEN_KEY = "autoflow-open-extraction";
