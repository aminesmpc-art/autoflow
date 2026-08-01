/* ============================================================
   Turn an extraction into an AutoFlow Studio workflow file.

   Studio already imports its own export format (store.ts
   importWorkflow), so the handoff is a plain .json download the user
   drops into Studio — no extension permissions, no manifest change,
   nothing gated behind a Web Store review.

   The shapes below must match extension/src/studio/templates/index.ts.
   The website can't import from the extension bundle, so they are
   duplicated here; if the node schema changes there, change it here.
   ============================================================ */

/* Mirrors AVAILABLE_IMAGE_MODELS / AVAILABLE_MODELS in
   extension/src/types/index.ts, and the ratio and duration lists in
   extension/src/studio/nodes/GenerateNode.tsx. Values must be exact —
   Studio matches these strings against what Flow renders on the page. */
export const STUDIO_OPTIONS = {
  imageModels: ["Nano Banana Pro", "Nano Banana 2", "Imagen 4"],
  videoModels: [
    "Omni Flash",
    "Veo 3.1 - Lite",
    "Veo 3.1 - Fast",
    "Veo 3.1 - Quality",
    "Veo 3.1 - Lite [Lower Priority]",
  ],
  imageRatios: ["9:16", "16:9", "1:1", "4:3", "3:4"],
  videoRatios: ["9:16", "16:9", "1:1"],
  durations: ["4s", "6s", "8s", "10s"],
};

export const DEFAULT_STUDIO_OPTS = {
  chain: "image_to_video", // image_to_video | images | videos
  imageModel: "Nano Banana Pro",
  videoModel: "Omni Flash",
  aspectRatio: "9:16",
  duration: "6s",
  platform: "flow", // flow | chatgpt
};

const promptNode = (id, label, text, x, y) => ({
  id,
  type: "prompt",
  position: { x, y },
  data: { type: "prompt", label, text: text || "" },
});

const genNode = (id, o, x, y) => ({
  id,
  type: "generate",
  position: { x, y },
  data: {
    type: "generate",
    label: o.label,
    platform: o.platform || "flow",
    mediaType: o.mediaType || "image",
    model: o.model || (o.mediaType === "video" ? "Omni Flash" : "Nano Banana Pro"),
    aspectRatio: o.aspectRatio || "9:16",
    duration: o.duration || "6s",
    creationType: "ingredients",
    enabled: true,
    status: "idle",
    resultUrl: null,
    previewUrl: "",
    resultTileId: null,
    progress: 0,
    errorMessage: null,
  },
});

/** text edge — prompt into a generation */
const tEdge = (source, target) => ({
  id: `e_${source}_${target}_t`,
  source,
  target,
  sourceHandle: "text",
  targetHandle: "text",
  type: "default",
  animated: true,
  style: { stroke: "#8b5cf6", strokeWidth: 2.5 },
});

/** image-reference edge — a generated still feeding the clip that animates it */
const iEdge = (source, target, from = "result") => ({
  id: `e_${source}_${target}_i`,
  source,
  target,
  sourceHandle: from,
  targetHandle: "image_ref",
  type: "default",
  animated: true,
  style: { stroke: "#3b82f6", strokeWidth: 2.5 },
});

/** Studio's layout convention: inputs at x=40, first generation at 520, second at 1000. */
const COL_INPUT = 40;
const COL_GEN_1 = 520;
const COL_GEN_2 = 1000;

/**
 * Build a Studio workflow from an extraction result.
 *
 * Shots without the prompt a mode needs are skipped rather than emitted
 * empty — Studio refuses to run a generation with no prompt, so a blank
 * node would just be a dead end on the canvas.
 */
export function buildStudioWorkflow(result, opts = {}, name = "Extracted Workflow") {
  const o = { ...DEFAULT_STUDIO_OPTS, ...opts };
  const shots = Array.isArray(result?.shots) ? result.shots : [];

  const nodes = [];
  const edges = [];
  let row = 0;

  shots.forEach((shot, i) => {
    const n = i + 1;
    const imageText = (shot?.image_prompt || "").trim();
    const videoText = (shot?.video_prompt || "").trim();
    const shotLabel = shot?.shot_id ? `Shot ${shot.shot_id}` : `Shot ${n}`;

    const wantsImage = o.chain === "images" || o.chain === "image_to_video";
    const wantsVideo = o.chain === "videos" || o.chain === "image_to_video";

    const hasImage = wantsImage && !!imageText;
    // In a chain the still is what gets animated, so a clip with no image
    // prompt still needs its own text; standalone video mode needs it too.
    const hasVideo = wantsVideo && !!videoText;

    if (!hasImage && !hasVideo) return;

    const y = row * (o.chain === "image_to_video" ? 560 : 420);
    row += 1;

    let imageGenId = null;

    if (hasImage) {
      const pid = `p_img_${n}`;
      imageGenId = `g_img_${n}`;
      nodes.push(promptNode(pid, `${shotLabel} — Image`, imageText, COL_INPUT, y));
      nodes.push(
        genNode(
          imageGenId,
          {
            label: `${shotLabel} — Still`,
            mediaType: "image",
            model: o.imageModel,
            aspectRatio: o.aspectRatio,
            platform: o.platform,
          },
          COL_GEN_1,
          y
        )
      );
      edges.push(tEdge(pid, imageGenId));
    }

    if (hasVideo) {
      const pid = `p_vid_${n}`;
      const gid = `g_vid_${n}`;
      // Standalone clips sit in the first generation column; chained ones
      // move right to leave room for the still they animate.
      const genX = imageGenId ? COL_GEN_2 : COL_GEN_1;
      const promptY = imageGenId ? y + 200 : y;

      nodes.push(promptNode(pid, `${shotLabel} — Motion`, videoText, COL_INPUT, promptY));
      nodes.push(
        genNode(
          gid,
          {
            label: `${shotLabel} — Clip`,
            mediaType: "video",
            model: o.videoModel,
            // Video supports fewer ratios than image; fall back rather than
            // emit one Studio's dropdown can't represent.
            aspectRatio: STUDIO_OPTIONS.videoRatios.includes(o.aspectRatio)
              ? o.aspectRatio
              : "9:16",
            duration: o.duration,
            platform: o.platform,
          },
          genX,
          y
        )
      );
      edges.push(tEdge(pid, gid));
      if (imageGenId) edges.push(iEdge(imageGenId, gid, "result"));
    }
  });

  return {
    autoflowStudio: 1,
    name,
    exportedAt: new Date().toISOString(),
    nodes,
    edges,
  };
}

/** How many nodes a given set of options would produce, for the UI to preview. */
export function countStudioNodes(result, opts = {}) {
  return buildStudioWorkflow(result, opts).nodes.length;
}

export function downloadStudioWorkflow(result, opts = {}, name = "Extracted Workflow") {
  const payload = buildStudioWorkflow(result, opts, name);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(name || "workflow").replace(/[^\w\-]+/g, "_")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return payload;
}
