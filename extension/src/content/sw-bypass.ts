/**
 * Early API Interceptor — MAIN world, document_start
 *
 * Patches BOTH fetch AND XMLHttpRequest BEFORE any Google code runs.
 * Intercepts generation/status endpoints and relays data to content script.
 *
 * This is self-contained — no dependency on the late INSTALL_NETWORK_SNIFFER.
 */

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
    return _origOpen.apply(this, [method, url, ...rest] as any);
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

    return _origSend.apply(this, [body] as any);
  };

  console.log('[AutoFlow] Early API interceptor installed (fetch + XHR)');
})();
