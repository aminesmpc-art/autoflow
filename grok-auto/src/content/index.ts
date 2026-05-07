/* ============================================================
   Grok Auto – Content Script Entry Point
   Injected into grok.com pages
   ============================================================ */

import { AutomationEngine, isEngineLocked } from './automation';
import { Message } from '../types';

let engine: AutomationEngine | null = null;

// ── Message listener ──
chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  switch (msg.type) {
    case 'START_QUEUE':
      if (isEngineLocked()) {
        sendResponse({ ok: false, error: 'Queue already running' });
        return;
      }
      engine = new AutomationEngine();
      engine.start(msg.payload);
      sendResponse({ ok: true });
      break;

    case 'PAUSE_QUEUE':
      engine?.pause();
      sendResponse({ ok: true });
      break;

    case 'RESUME_QUEUE':
      engine?.resume();
      sendResponse({ ok: true });
      break;

    case 'STOP_QUEUE':
      engine?.stop();
      sendResponse({ ok: true });
      break;

    case 'SKIP_CURRENT':
      engine?.skipCurrent();
      sendResponse({ ok: true });
      break;

    case 'PING':
      sendResponse({ ok: true, locked: isEngineLocked() });
      break;

    case 'SCAN_PAGE': {
      const scanEngine = new AutomationEngine();
      const result = scanEngine.scanPage();
      sendResponse({ ok: true, ...result });
      break;
    }

    default:
      sendResponse({ ok: false, error: `Unknown message: ${msg.type}` });
  }
  return true;
});

console.log('[GrokAuto] Content script loaded on', window.location.href);
