/**
 * Early API Interceptor — MAIN world, document_start
 *
 * Patches BOTH fetch AND XMLHttpRequest BEFORE any Google code runs.
 * Intercepts generation/status endpoints and relays data to content script.
 *
 * This is self-contained — no dependency on the late INSTALL_NETWORK_SNIFFER.
 *
 * ── Two sites, two protocols ──────────────────────────────────────────────
 *
 * The four names below are tRPC procedures on labs.google. On flow.google.com
 * they do not exist: measured live, a project load makes 19 API calls and not
 * one of them matches any of the four, because the whole tRPC API was replaced
 * by /_/AiSandboxAngularFrontend/data/batchexecute with an opaque per-build id
 * for the procedure. So on the new site this filter matched nothing, the cache
 * never filled, and the panel reported "API Passive" permanently.
 *
 * Both paths are live below. The tRPC branch is untouched, for anyone still on
 * labs.google, which still resolves. The batchexecute branch is the new site,
 * and it reads the body rather than the URL because the URL no longer says
 * what the call is for — see flowBatch.ts.
 *
 * One measured detail decides the shape of this file: all 19 of those calls
 * arrived over XHR and none over fetch. Angular's HttpClient does not use
 * fetch. The fetch branch is kept because the old site uses it and it costs
 * nothing, but on the new site the XHR branch is the one that does the work.
 */

import { isBatchExecuteUrl, readStatuses, diagnostics } from './flowBatch';

(() => {
  /** This interceptor's protocol version. Bumped when the relay changes. */
  const BUILD = 'batchexecute-3';

  /* Install once per build, not once per page.
   *
   * A MAIN-world script only injects at document_start, so a Flow tab that is
   * open when the extension updates keeps the interceptor it started with —
   * for the rest of that tab's life. The isolated side does not: the worker
   * re-injects content.js into existing tabs, so the engine is new while the
   * interceptor is old, and nothing looks wrong. The badge still reads "API
   * Active" because both builds report alive.
   *
   * That combination cost two runs. An older interceptor decided a generation
   * had failed whenever any string in the record contained FAIL, SAFETY,
   * BLOCK, REJECT or CANCEL — and the record carries the user's own prompt.
   * "a blue crane lifting a safety barrier" and "orange autumn leaves
   * rejected by the wind" were both reported as policy refusals, with the
   * prompt itself printed as the reason, while the videos sat finished in the
   * grid.
   *
   * So the worker now re-injects this file alongside content.js, and a build
   * that differs from the one already running is allowed to take over.
   * Patching over the old patch is safe: both relay the same records, the
   * cache is keyed by media id, and it already refuses to let a thinner
   * record downgrade a finished one. */
  const runningBuild = (window as any).__af_interceptor_build;
  if ((window as any).__af_early_fetch_installed && runningBuild === BUILD) return;
  if ((window as any).__af_early_fetch_installed) {
    console.warn(`[AutoFlow] Replacing interceptor ${runningBuild || 'unknown'} with ${BUILD}.`);
  }
  (window as any).__af_early_fetch_installed = true;

  // Endpoints we care about
  const STATUS_CHECK = 'batchCheckAsyncVideoGenerationStatus';
  const GENERATE = 'batchAsyncGenerateVideoText';
  const IMAGE_GENERATE = 'batchGenerateImages';
  const VIDEO_IMAGE_GENERATE = 'batchAsyncGenerateVideoImage';

  function isTargetUrl(url: string): { isStatus: boolean; isGenerate: boolean } {
    const isStatus = url.includes(STATUS_CHECK);
    const isGenerate = url.includes(GENERATE) || url.includes(VIDEO_IMAGE_GENERATE) || url.includes(IMAGE_GENERATE);
    return { isStatus, isGenerate };
  }

  /** A media file Flow is fetching — the only playable URL it ever issues. */
  const MEDIA_FETCH = /flow-content\.google\/(?:video|image)\//;

  /** Cheap enough to run on every response: no UUID, no generation record. */
  const HAS_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  /* A name for what this interceptor understands, readable from the page.
     Two rounds of debugging were spent on "is the rebuilt extension actually
     loaded?" — a MAIN-world script only injects at document_start, so an
     already-open tab keeps the old one for its whole life and looks identical.
     Checking window.__af_interceptor_build in the Flow console answers it. */
  /* Bumped when the relay protocol changes. A MAIN-world script only injects
     at document_start, so a Flow tab left open keeps running the previous
     build — and -2 added GENERATION_BOUND. Without a bump, a stale tab
     silently sends no bindings and the engine quietly falls back to guessing
     which generation belongs to which prompt. __afReport() prints this.

     -3 adds mediaKind and ownMedia to every relayed status. A -2 interceptor
     sends neither, and the completion door treats an absent kind as "cannot
     judge, let it through" — which is exactly the pre-fix behaviour, where a
     Frames run's uploaded start frame read as a finished video. So this bump
     is what makes the fix reach a tab that was already open when it landed. */
  (window as any).__af_interceptor_build = BUILD;

  /* The tracker, reachable from the Flow page console as __afReport().
     Defined here rather than in the content script because only the MAIN
     world shares a window with the console; anything the isolated content
     script defines is invisible from there.

     It reports structure, never content — see flowBatch.ts — so its output
     is safe to paste anywhere. */
  (window as any).__afReport = () => diagnostics();

  /* Say we are alive at most this often. The panel only needs to know the
     interception works; it does not need one message per response. */
  const ALIVE_EVERY_MS = 5000;
  let lastAliveAt = 0;

  /**
   * Read a batchexecute response and relay whatever generations it describes.
   *
   * This path serves the entire app, so most responses describe none. Those
   * cost one regex over the text and return without parsing anything, and
   * nothing is relayed — an empty relay would refresh the cache timestamp and
   * tell a waiting caller that fresh data had arrived when none had.
   */
  function relayBatch(url: string, text: string): string[] {
    if (!text) return [];

    /* Seeing one of these at all means the interception is working, whether
       or not it describes a generation. That is reported separately from the
       data, because "nothing is generating" is not "not working" — the panel
       rendered both as "API Passive", which reads as broken, and status
       records only exist while a video is actually in flight. */
    const now = Date.now();
    if (now - lastAliveAt > ALIVE_EVERY_MS) {
      lastAliveAt = now;
      relay('INTERCEPTOR_ALIVE', { build: (window as any).__af_interceptor_build });
    }

    if (!HAS_UUID.test(text)) return [];
    try {
      const statuses = readStatuses(text);
      if (statuses.length) relay('STATUS_UPDATE_V2', { statuses });
      return statuses.map((st) => st.mediaId).filter(Boolean);
    } catch (err) {
      /* Never let a malformed response break Flow's own request handling —
         we are inside the page's XHR, and throwing here would surface as a
         fault in their app rather than ours. */
      relay('INTERCEPTOR_ERROR', { message: String((err as Error)?.message || err) });
    }
    return [];
  }

  /* ── The active check ─────────────────────────────────────────────────────
   *
   * Everything above is passive: it reads what Flow's own page already asked
   * for. That is enough while Flow is polling, and Flow stops polling when the
   * tab is backgrounded — exactly when a long queue is running unattended.
   * The engine's answer is activeStatusCheck(), which asks the page to fetch
   * a fresh status once, on demand.
   *
   * That path has been dead on this site. It calls window.__af_activeCheck,
   * which the old sniffer defined by capturing a tRPC status request off
   * window.fetch — and this site makes no tRPC calls and no fetch calls, so
   * nothing was ever captured and the check returned false every time.
   *
   * Rather than construct a batchexecute request — which would mean guessing
   * the rpcid, the f.req encoding and the session tokens, and re-guessing
   * them at every Flow deploy — the last status request Flow itself made is
   * kept and replayed verbatim. We already see every one of them.
   *
   * This is the one place that talks to Google, and it sends a request Flow
   * itself sent, once, when a caller asks. It is not a poll.
   */
  interface StatusRequest { url: string; body: any; headers: Record<string, string>; }
  let lastStatusRequest: StatusRequest | null = null;

  /** Headers the Fetch API refuses to let a page set; sending them throws. */
  const FORBIDDEN_HEADER =
    /^(host|origin|referer|cookie|connection|content-length|user-agent|accept-encoding|sec-)/i;

  function safeHeaders(h: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of Object.keys(h || {})) if (!FORBIDDEN_HEADER.test(k)) out[k] = h[k];
    return out;
  }

  (window as any).__af_activeCheck = async function (): Promise<boolean> {
    const req = lastStatusRequest;
    if (!req) return false;
    try {
      /* The real fetch, not our patched one: going through the patch would
         run relayBatch twice on the same body and double every count. */
      const realFetch: typeof fetch = (window as any).__af_real_fetch || window.fetch;
      const res = await realFetch(req.url, {
        method: 'POST',
        body: req.body,
        headers: safeHeaders(req.headers),
        credentials: 'include',
      });
      if (!res.ok) return false;
      /* Report success only when the reply actually described a generation.
         Returning true on an empty body would tell a waiting caller that
         fresh data had arrived when none had — the same lie the empty-relay
         guard above exists to prevent. */
      return relayBatch(req.url, await res.text()).length > 0;
    } catch {
      return false;
    }
  };

  /** Relay data to content script */

  /* ── Binding a generation to the prompt that asked for it ────────────────
   *
   * The engine used to take "the first status record that appeared after I
   * clicked Generate" and call that the prompt's media id. Nothing in that
   * compares the record to the prompt, and this one channel carries the whole
   * application's traffic — a project load alone makes 19 calls and describes
   * 58 generations. A library scroll, a background refresh, or the previous
   * prompt's record arriving late all land in that window, and whichever
   * happened to be seen first became this prompt's id. Everything downstream
   * — the completion check, the URL verification, the download list — then
   * reported another generation's state as this one's, confidently.
   *
   * It can be settled exactly here, and only here: this is the one place that
   * holds a request and its own response together. If the body Flow posted
   * contains the prompt, then the generations described in the reply to that
   * body are that prompt's. No shape knowledge is needed — no rpcid, no field
   * offsets, nothing that moves when Flow redeploys.
   *
   * The engine says what it is about to submit just before it clicks, and the
   * answer goes back the same way status updates do.
   */

  /** The prompt the engine is submitting right now, normalised for matching. */
  let pendingNeedle = '';
  let pendingText = '';

  /**
   * A form of the text that survives the trip through the request body.
   *
   * The prompt reaches the wire URL-encoded, inside JSON, inside a form
   * field, so its punctuation and whitespace are escaped in ways that differ
   * from the original. Letters and digits survive all of it, so the
   * comparison is made on those alone.
   */
  function needleOf(text: string): string {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== 'autoflow-engine') return;
    if (d.type === 'PENDING_PROMPT') {
      pendingText = String(d.payload?.text || '');
      pendingNeedle = needleOf(pendingText).slice(0, 120);
    }
  });

  /**
   * Did this request carry the prompt we are waiting on?
   *
   * Short prompts are refused rather than matched loosely: "a cat" appears in
   * plenty of bodies that have nothing to do with this submission, and a
   * wrong binding here is exactly the failure being fixed. Below the floor
   * the engine keeps its old heuristic, which is no worse than before.
   */
  function requestCarriesPendingPrompt(body: unknown): boolean {
    if (!pendingNeedle || pendingNeedle.length < 12) return false;
    if (typeof body !== 'string' || !body) return false;

    let decoded = body;
    try { decoded = decodeURIComponent(body.replace(/\+/g, ' ')); } catch { /* keep raw */ }
    return needleOf(decoded).includes(pendingNeedle);
  }

  function relay(type: string, payload: any): void {
    window.postMessage({ source: 'autoflow-api-interceptor', type, payload }, '*');
  }

  // ═══════════════════════════════════════════
  // 1. FETCH INTERCEPT
  // ═══════════════════════════════════════════
  const _realFetch = window.fetch;
  (window as any).__af_real_fetch = _realFetch;

  const interceptedFetch = async function (this: any, ...args: any[]) {
    let url = '';
    if (typeof args[0] === 'string') {
      url = args[0];
    } else if (args[0] && typeof args[0] === 'object' && 'href' in args[0]) {
      url = (args[0] as any).href;
    } else if (args[0] && typeof args[0] === 'object') {
      url = (args[0] as Request).url || '';
    }

    const { isStatus, isGenerate } = isTargetUrl(url);

    const response = await _realFetch.apply(this || window, args as [RequestInfo | URL, RequestInit?]);

    // Intercept responses from target endpoints
    if ((isStatus || isGenerate) && response.ok) {
      response.clone().json().then((data: any) => {
        relay(isStatus ? 'STATUS_UPDATE' : 'GENERATION_SUBMITTED', data);
      }).catch(() => {});
    }

    /* The new site, if it ever routes one of these through fetch. Read as
       text: a batchexecute body is not JSON — it opens with a )]}' guard and
       is a sequence of length-prefixed chunks — so .json() rejects on it. */
    if (isBatchExecuteUrl(url) && response.ok) {
      response.clone().text().then((t: string) => relayBatch(url, t)).catch(() => {});
    }

    /* A media file going past. This is how the panel gets something to play:
       Flow's download menu fetches the signed URL here, turns it into a blob
       and saves that with an <a download>. Watching chrome.downloads was the
       wrong place to stand — the download it reports carries the blob: URL,
       not this one, so nothing ever matched and the file simply saved. */
    if (MEDIA_FETCH.test(url)) relay('MEDIA_URL_SEEN', { url });

    return response;
  };

  // Stealth: make it look like native fetch
  try {
    const origToString = _realFetch.toString.bind(_realFetch);
    interceptedFetch.toString = origToString;
    Object.defineProperty(interceptedFetch, 'name', { value: 'fetch' });
    Object.defineProperty(interceptedFetch, 'length', { value: _realFetch.length });
  } catch {}

  (window as any).fetch = interceptedFetch;
  // Also store it so late INSTALL_NETWORK_SNIFFER can use real fetch
  (window as any).__af_patched_fetch = interceptedFetch;

  // ═══════════════════════════════════════════
  // 2. XHR INTERCEPT (backup — in case images use XHR)
  // ═══════════════════════════════════════════
  const _origOpen = XMLHttpRequest.prototype.open;
  const _origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: any[]
  ) {
    (this as any).__af_url = String(url);
    (this as any).__af_headers = {};
    return _origOpen.apply(this, [method, url, ...rest] as any);
  };

  /* Record the headers Flow sets, so a replay can send the same ones.
     batchexecute needs at least the form content-type; the rest are kept
     because copying what worked is more durable than deciding what matters. */
  const _origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (
    this: XMLHttpRequest,
    name: string,
    value: string,
  ) {
    try {
      const bag = (this as any).__af_headers || ((this as any).__af_headers = {});
      bag[name] = value;
    } catch {}
    return _origSetHeader.apply(this, [name, value] as any);
  };

  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: any) {
    const url: string = (this as any).__af_url || '';
    const { isStatus, isGenerate } = isTargetUrl(url);

    if (isStatus || isGenerate) {
      this.addEventListener('load', function () {
        try {
          if (this.responseText) {
            const data = JSON.parse(this.responseText);
            relay(isStatus ? 'STATUS_UPDATE' : 'GENERATION_SUBMITTED', data);
          }
        } catch {}
      });
    }

    /* The new site. This is the branch that actually carries the traffic:
       every one of the 19 calls a project load makes is an XHR. */
    if (isBatchExecuteUrl(url)) {
      const reqBody = body;
      const reqHeaders = ((this as any).__af_headers || {}) as Record<string, string>;
      this.addEventListener('load', function () {
        /* responseText throws on a responseType of blob or arraybuffer, and
           Flow uses those for media. Ask before reading. */
        try {
          if (this.responseType && this.responseType !== 'text') return;
          const mediaIds = relayBatch(url, this.responseText || '');
          /* Keep the request that produced statuses — that is the one worth
             replaying. Requests on this path serve the whole app, so keeping
             the most recent of ANY of them would usually replay something
             that reports nothing. */
          if (mediaIds.length > 0 && typeof reqBody === 'string') {
            lastStatusRequest = { url, body: reqBody, headers: reqHeaders };
          }

          /* The exact binding: this reply answers a request that carried the
             prompt, so these generations are that prompt's. */
          if (mediaIds.length > 0 && requestCarriesPendingPrompt(reqBody)) {
            relay('GENERATION_BOUND', { promptText: pendingText, mediaIds });
            /* One binding per submission. Flow polls the same generation for
               as long as it runs, and every one of those replies answers a
               request that still quotes the prompt — without this, a later
               poll would rebind the prompt to whatever that reply described,
               which for a batch is not the tile this prompt started. */
            pendingNeedle = '';
          }
        } catch {}
      });
    }

    return _origSend.apply(this, [body] as any);
  };

  /* Swallow one save, when the panel is only after the URL.
     Flow saves by clicking an <a download> pointing at a blob, so this is the
     one place the file can be stopped from reaching the disk — cancelling the
     Chrome download afterwards was both too late and aimed at the wrong URL.
     One shot: the flag clears itself, so a real download the user asked for
     is never swallowed by a stale arm. */
  const origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if ((window as any).__af_swallow_next_save && this.hasAttribute('download')) {
      (window as any).__af_swallow_next_save = false;
      relay('SAVE_SWALLOWED', { href: (this.getAttribute('href') || '').slice(0, 12) });
      return;
    }
    return origAnchorClick.apply(this, arguments as any);
  };

  /* The content script arms that, since it cannot touch this world directly. */
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d: any = event.data;
    if (d?.source === 'autoflow-content-script' && d.type === 'ARM_PREVIEW_CAPTURE') {
      (window as any).__af_swallow_next_save = true;
    }
  });

  console.log('[AutoFlow] Early API interceptor installed (fetch + XHR)');
})();
