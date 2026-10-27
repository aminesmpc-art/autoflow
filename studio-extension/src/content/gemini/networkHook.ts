import { generationPrompt, isGeminiGeneration, MAX_RESPONSE_CHARS, parseGeminiTextResponse } from './networkProtocol';

/** MAIN world, document_start. Observes the existing POST; never sends one. */
(() => {
  const page = window as Window & { __af_gemini_network_v1?: boolean };
  if (page.__af_gemini_network_v1) return;
  page.__af_gemini_network_v1 = true;
  type Turn = { token: string; prompt: string; claimed: boolean };
  let active: Turn | null = null;
  const emit = (turn: Turn, type: string, extra: Record<string, unknown> = {}) => {
    if (active !== turn) return;
    window.postMessage({ source: 'autoflow-gemini-network', token: turn.token, type, ...extra }, location.origin);
  };
  window.addEventListener('message', event => {
    const msg = event.data;
    if (event.source !== window || event.origin !== location.origin || msg?.source !== 'autoflow-gemini-control') return;
    if (typeof msg.token !== 'string' || !/^[\w-]{16,100}$/.test(msg.token)) return;
    if (msg.type === 'ARM' && typeof msg.prompt === 'string' && msg.prompt.length <= MAX_RESPONSE_CHARS) {
      active = { token: msg.token, prompt: msg.prompt.trim(), claimed: false };
      emit(active, 'ARMED');
    } else if (msg.type === 'RELEASE' && active?.token === msg.token) active = null;
  });
  const claim = (url: string, method: string, body: unknown): Turn | null => {
    const turn = active;
    if (!turn || turn.claimed || generationPrompt(url, method, body) !== turn.prompt) return null;
    turn.claimed = true;
    emit(turn, 'STARTED');
    return turn;
  };
  const finish = (turn: Turn, status: number, text: string) => {
    if (active !== turn) return;
    const reply = status >= 200 && status < 300 ? parseGeminiTextResponse(text) : null;
    emit(turn, reply ? 'COMPLETE' : 'UNREADABLE', reply ? { reply } : {});
  };

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
      const url = request ? request.url : String(input);
      const method = init?.method || request?.method || 'GET';
      // Never delay or consume Gemini's request/response. Only our clone is read.
      const turn = init?.body !== undefined ? claim(url, method, init.body) : null;
      const owner = active;
      let pending: Promise<Turn | null> = Promise.resolve(turn);
      if (!turn && init?.body === undefined && request && !owner?.claimed && owner && isGeminiGeneration(url, method)) {
        try {
          pending = request.clone().text()
            .then(body => active === owner ? claim(url, method, body) : null).catch(() => null);
        } catch { /* A consumed Request must retain native fetch behavior. */ }
      }
      const response = nativeFetch.apply(this, [input, init]);
      void response.then(async result => {
        const matched = await pending;
        if (!matched || active !== matched) return;
        const reader = result.clone().body?.getReader();
        if (!reader) { emit(matched, 'UNREADABLE'); return; }
        const decoder = new TextDecoder();
        let wire = '';
        try {
          while (active === matched) {
            const chunk = await reader.read();
            if (chunk.done) { wire += decoder.decode(); finish(matched, result.status, wire); return; }
            wire += decoder.decode(chunk.value, { stream: true });
            if (wire.length > MAX_RESPONSE_CHARS) break;
          }
          void reader.cancel().catch(() => {});
          emit(matched, 'UNREADABLE');
        } catch { emit(matched, 'UNREADABLE'); }
      }).catch(async () => { const matched = await pending; if (matched) emit(matched, 'UNREADABLE'); });
      return response;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const requests = new WeakMap<XMLHttpRequest, { url: string; method: string }>();
  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...args: any[]) {
    requests.set(this, { url: String(url), method });
    return originalOpen.apply(this, [method, url, ...args] as any);
  };
  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    const request = requests.get(this);
    const turn = request ? claim(request.url, request.method, body) : null;
    if (turn) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType && this.responseType !== 'text') { emit(turn, 'UNREADABLE'); return; }
          finish(turn, this.status, this.responseText);
        } catch { emit(turn, 'UNREADABLE'); }
      }, { once: true });
      for (const event of ['abort', 'error', 'timeout']) {
        this.addEventListener(event, () => emit(turn, 'UNREADABLE'), { once: true });
      }
    }
    return originalSend.call(this, body);
  };
})();
