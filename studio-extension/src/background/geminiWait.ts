/** Only an extension content script on the Gemini main frame may request
 * these bounded delays. No navigation, focus, generation, or page mutation. */
export function answerGeminiWait(
  ms: unknown, sender: chrome.runtime.MessageSender, reply: (result: { elapsed: boolean }) => void,
): boolean {
  let allowed = false;
  try {
    allowed = sender.id === chrome.runtime.id && typeof sender.tab?.id === 'number'
      && (sender.frameId === undefined || sender.frameId === 0)
      && new URL(sender.url || '').origin === 'https://gemini.google.com';
  } catch { /* Missing or invalid sender URL. */ }
  if (!allowed || typeof ms !== 'number' || !Number.isFinite(ms) || ms < 50 || ms > 2000) {
    reply({ elapsed: false });
    return false;
  }
  setTimeout(() => reply({ elapsed: true }), ms);
  return true;
}
