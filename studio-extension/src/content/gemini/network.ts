import type { NetworkReply } from './networkProtocol';
import { MAX_RESPONSE_CHARS } from './networkProtocol';
import { sleep } from './wait';

export interface NetworkTurn {
  started: boolean;
  reply: NetworkReply | null;
  unreadable: boolean;
  release(): void;
}

export async function beginNetworkTurn(prompt: string): Promise<NetworkTurn | null> {
  try {
    const ready = await chrome.runtime.sendMessage({ type: 'GEMINI_NETWORK_INSTALL' });
    if (ready?.installed !== true) return null;
  } catch { return null; }
  const token = crypto.randomUUID();
  let armed = false;
  let released = false;
  const turn: NetworkTurn = {
    started: false, reply: null, unreadable: false,
    release() {
      if (released) return;
      released = true;
      window.removeEventListener('message', listener);
      window.postMessage({ source: 'autoflow-gemini-control', type: 'RELEASE', token }, location.origin);
    },
  };
  const listener = (event: MessageEvent) => {
    const data = event.data;
    if (released || event.source !== window || event.origin !== location.origin
        || data?.source !== 'autoflow-gemini-network' || data.token !== token) return;
    if (data.type === 'ARMED') armed = true;
    if (data.type === 'STARTED') turn.started = true;
    if (data.type === 'UNREADABLE') turn.unreadable = true;
    if (data.type === 'COMPLETE' && turn.started && typeof data.reply?.text === 'string'
        && data.reply.text.length <= MAX_RESPONSE_CHARS && /^rc_[\w-]+$/.test(data.reply.candidateId)) {
      turn.reply = { text: data.reply.text, candidateId: data.reply.candidateId,
        ...(typeof data.reply.conversationId === 'string' && /^c_[\w-]+$/.test(data.reply.conversationId)
          ? { conversationId: data.reply.conversationId } : {}) };
    }
  };
  window.addEventListener('message', listener);
  window.postMessage({ source: 'autoflow-gemini-control', type: 'ARM', token, prompt }, location.origin);
  // Worker-backed wait also permits the MAIN-world handshake in a hidden tab.
  for (let i = 0; !armed && i < 5; i++) await sleep(200);
  if (!armed) { turn.release(); return null; }
  return turn;
}
