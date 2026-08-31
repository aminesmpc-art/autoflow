/* ============================================================
   Talking to the AutoFlow Studio extension from the page.

   The Extractor used to build a workflow itself, offer it as a .json, and ask
   the user to download it and import it by hand. Four steps where there should
   be none — and worse, it meant the website carried its own copy of Studio's
   node schema, with a comment in studioWorkflow.js admitting the problem: "the
   website can't import from the extension bundle, so they are duplicated here;
   if the node schema changes there, change it here." Two copies of a schema
   drift, and the drift shows up as a workflow that imports but will not run.

   So the page no longer builds anything. It sends the EXTRACTION — the raw
   analysis, the Extractor's own output — and the extension compiles it with
   the compiler that ships beside the code that reads it. One schema again.

   The transport is window.postMessage to a content script, not
   chrome.runtime.sendMessage. The latter needs the extension's id hardcoded
   here, which is fine for the published build and wrong for every other kind:
   an unpacked install has a different id per machine, so the feature would
   work in production and be untestable anywhere else.
   ============================================================ */

const FROM_PAGE = 'autoflow-web';
const FROM_EXTENSION = 'autoflow-extension';

/* Long enough for a slow machine to answer, short enough that a visitor
   without the extension is not left watching a spinner. The answer is a
   postMessage round trip inside one tab, so it is microseconds when it comes
   at all. */
const PING_TIMEOUT_MS = 600;

/* A build compiles a plan and lays out a canvas. Generous, because it is doing
   real work; bounded, because a promise that never settles leaves a button
   spinning for ever. */
const BUILD_TIMEOUT_MS = 15000;

let nextId = 0;
const newId = () => `afx-${Date.now()}-${nextId++}`;

/**
 * Ask the extension a question and wait for its answer.
 *
 * Every exchange is matched by id. Without that, two builds started close
 * together resolve each other's promises — and the visible symptom is one
 * workflow opening twice while the other silently never does.
 */
function ask(message, timeoutMs) {
  return new Promise((resolve) => {
    const id = newId();
    let done = false;

    const onMessage = (event) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || typeof d !== 'object') return;
      if (d.source !== FROM_EXTENSION || d.id !== id) return;
      finish(d);
    };

    const finish = (value) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ source: FROM_PAGE, id, ...message }, window.location.origin);
  });
}

/**
 * Whether Studio is installed in this browser.
 *
 * Returns false rather than throwing when it is not, because "not installed"
 * is the ordinary case for a visitor and not an error worth a console entry.
 */
export async function studioInstalled() {
  if (typeof window === 'undefined') return false;
  const reply = await ask({ type: 'PING' }, PING_TIMEOUT_MS);
  return Boolean(reply && reply.installed);
}

/**
 * Send an extraction to Studio and open it as a workflow.
 *
 * The options are the ones fromExtraction understands — mode, characters,
 * maxShots, aspectRatio, sourceName — and they are passed through rather than
 * interpreted here, so adding one to the extension does not need a change on
 * this side.
 */
export async function sendToStudio(extraction, options = {}) {
  if (typeof window === 'undefined') {
    return { ok: false, error: 'Not in a browser.' };
  }
  if (!extraction || !Array.isArray(extraction.shots) || !extraction.shots.length) {
    return { ok: false, error: 'There is nothing to send yet — run an extraction first.' };
  }

  const reply = await ask({ type: 'BUILD_FROM_EXTRACTION', extraction, options }, BUILD_TIMEOUT_MS);

  /* No answer means no content script, which means no extension — the same
     conclusion as a failed ping, and worth saying in those words rather than
     as a timeout. */
  if (!reply) {
    return {
      ok: false,
      error: 'Studio did not answer. Install the AutoFlow Studio extension, then reload this page.',
      missing: true,
    };
  }
  return reply;
}

/**
 * What building this would produce, counted by the thing that will build it.
 *
 * The page can count for itself — it has its own builder for the download
 * fallback — and the two answers drift the moment either side changes what
 * counts as a shot worth building. The number under a button should be the
 * number the button produces.
 *
 * Returns null when Studio is not installed; the caller falls back to its own
 * count, which is then the right one, because its own builder is what will run.
 */
export async function estimateInStudio(extraction, options = {}) {
  if (typeof window === "undefined") return null;
  if (!extraction || !Array.isArray(extraction.shots) || !extraction.shots.length) return null;
  const reply = await ask({ type: "ESTIMATE", extraction, options }, PING_TIMEOUT_MS);
  return reply && reply.ok ? reply.cost : null;
}

/* The page's option names, in the extension's words.

   They differ because they grew apart: the page called the choice a "chain"
   because it once described how nodes were wired, and the extension calls it a
   "mode" because it describes what gets built. Translating in one named place
   is better than either renaming a UI people already know or letting two
   vocabularies leak into each other. */
const MODE_FOR_CHAIN = {
  image_to_video: 'both',
  images: 'stills',
  videos: 'clips',
};

export function toBuildOptions(studioOpts, sourceName) {
  return {
    mode: MODE_FOR_CHAIN[studioOpts.chain] || 'both',
    platform: studioOpts.platform,
    aspectRatio: studioOpts.aspectRatio,
    imageModel: studioOpts.imageModel,
    videoModel: studioOpts.videoModel,
    duration: studioOpts.duration,
    sourceName,
  };
}
