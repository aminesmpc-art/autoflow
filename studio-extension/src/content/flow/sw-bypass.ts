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
  if ((window as any).__af_early_fetch_installed) return;
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

  /** Cheap enough to run on every response: no UUID, no generation record. */
  const HAS_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  /* A name for what this interceptor understands, readable from the page.
     Two rounds of debugging were spent on "is the rebuilt extension actually
     loaded?" — a MAIN-world script only injects at document_start, so an
     already-open tab keeps the old one for its whole life and looks identical.
     Checking window.__af_interceptor_build in the Flow console answers it. */
  /* -2 adds mediaKind and ownMedia to every relayed status. A -1 interceptor
     still resident in an open tab sends neither, and the completion door
     treats an absent kind as "cannot judge, let it through" — the pre-fix
     behaviour, where a Frames run's uploaded start frame read as a finished
     video. Read it from the Flow console to tell which is running. */
  (window as any).__af_interceptor_build = 'batchexecute-2';

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
  /* Every generation id this page has described, and whether the response
     just seen introduced one.
     A STATUS poll re-describes ids already known. A SUBMIT is the only thing
     that introduces one. That is the difference between a request which is
     safe to replay and a request which, replayed, generates again — and the
     capture below cannot tell them apart any other way: on batchexecute the
     rpc name is an opaque code, and this fork has no pending-prompt check. */
  const seenMediaIds = new Set<string>();
  let lastBatchIntroducedNewId = true;

  function relayBatch(url: string, text: string): number {
    if (!text) return 0;

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

    if (!HAS_UUID.test(text)) return 0;
    try {
      const statuses = readStatuses(text);
      lastBatchIntroducedNewId = statuses.some(
        (st: any) => st?.mediaId && !seenMediaIds.has(st.mediaId));
      for (const st of statuses as any[]) {
        if (st?.mediaId) seenMediaIds.add(st.mediaId);
      }
      if (statuses.length) relay('STATUS_UPDATE_V2', { statuses });
      return statuses.length;
    } catch (err) {
      /* Never let a malformed response break Flow's own request handling —
         we are inside the page's XHR, and throwing here would surface as a
         fault in their app rather than ours. */
      relay('INTERCEPTOR_ERROR', { message: String((err as Error)?.message || err) });
    }
    return 0;
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
      return relayBatch(req.url, await res.text()) > 0;
    } catch {
      return false;
    }
  };

  /** Relay data to content script */
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
          const found = relayBatch(url, this.responseText || '');
          /* Keep the request that produced statuses — that is the one worth
             replaying. Requests on this path serve the whole app, so keeping
             the most recent of ANY of them would usually replay something
             that reports nothing. */
          /* Never keep a request that introduced a generation.
             The template is replayed verbatim, with credentials, whenever
             observation has to be recovered — so keeping the SUBMIT here
             would make recovery generate a second video and charge for it.
             A response describing only ids already seen cannot have been a
             submit, and the first status poll after one supplies the template
             a moment later anyway. */
          if (found > 0 && !lastBatchIntroducedNewId && typeof reqBody === 'string') {
            lastStatusRequest = { url, body: reqBody, headers: reqHeaders };
          }
        } catch {}
      });
    }

    return _origSend.apply(this, [body] as any);
  };

  console.log('[AutoFlow] Early API interceptor installed (fetch + XHR)');
})();
