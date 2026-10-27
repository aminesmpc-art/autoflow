/** Gemini's browser protocol, observed independently of its rendered UI.
 * Field references and verification limits are recorded in gemini-background-network.md.
 * Unknown layouts fail closed so the existing DOM collector can still answer. */
export const MAX_RESPONSE_CHARS = 8 * 1024 * 1024;

export function isGeminiGeneration(url: string, method: string): boolean {
  try {
    const target = new URL(url, 'https://gemini.google.com');
    return target.origin === 'https://gemini.google.com' && method.toUpperCase() === 'POST'
      && target.pathname === '/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate';
  } catch { return false; }
}

export function generationPrompt(url: string, method: string, body: unknown): string | null {
  try {
    if (!isGeminiGeneration(url, method)) return null;
    if (typeof body !== 'string' && !(body instanceof URLSearchParams)) return null;
    const encoded = new URLSearchParams(body).get('f.req');
    if (!encoded || encoded.length > MAX_RESPONSE_CHARS) return null;
    const outer = JSON.parse(encoded);
    if (!Array.isArray(outer) || typeof outer[1] !== 'string') return null;
    const inner = JSON.parse(outer[1]);
    const prompt = inner?.[0]?.[0];
    return typeof prompt === 'string' && prompt.trim() ? prompt.trim() : null;
  } catch { return null; }
}

export interface NetworkReply { text: string; candidateId: string; conversationId?: string; }

/** Read complete array frames without trusting wire length units. Escapes,
 * Unicode and brackets inside a JSON string cannot change a frame boundary. */
export function parseGeminiTextResponse(text: string): NetworkReply | null {
  if (!text || text.length > MAX_RESPONSE_CHARS) return null;
  const wire = text.replace(/^\s*\)\]\}'/, '');
  let offset = 0;
  let latest: NetworkReply | null = null;
  let complete = false;
  while (offset < wire.length) {
    // Numeric length separators and whitespace are the only allowed framing.
    while (offset < wire.length && /\s/.test(wire[offset])) offset++;
    if (offset === wire.length) break;
    if (/\d/.test(wire[offset])) {
      while (offset < wire.length && /\d/.test(wire[offset])) offset++;
      while (offset < wire.length && /\s/.test(wire[offset])) offset++;
    }
    if (wire[offset] !== '[') return null;
    const start = offset;
    let depth = 0, quoted = false, escaped = false;
    for (; offset < wire.length; offset++) {
      const char = wire[offset];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '[') depth++;
      else if (char === ']' && --depth === 0) { offset++; break; }
    }
    if (depth !== 0 || quoted) return null;
    let rows: unknown;
    try { rows = JSON.parse(wire.slice(start, offset)); } catch { return null; }
    if (!Array.isArray(rows)) return null;
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      // An error envelope must never turn an earlier partial into success.
      // "e" is only Gemini's end-of-stream marker; like "di" and "af.httprm" it is skipped.
      if (row[0] === 'er') return null;
      if (row[0] !== 'wrb.fr' || typeof row[2] !== 'string') continue;
      let data: any;
      try { data = JSON.parse(row[2]); } catch { return null; }
      const candidate = data?.[4]?.[0];
      if (!candidate) continue; // Metadata/final bookkeeping envelope.
      const id = candidate[0];
      const value = candidate[1]?.[0];
      if (typeof id !== 'string' || !/^rc_[\w-]+$/.test(id) || typeof value !== 'string') return null;
      const cid = data?.[1]?.[0];
      latest = { text: value, candidateId: id,
        ...(typeof cid === 'string' && /^c_[\w-]+$/.test(cid) ? { conversationId: cid } : {}) };
      complete = candidate[8]?.[0] === 2;
    }
  }
  return complete && latest?.text.trim() ? latest : null;
}
