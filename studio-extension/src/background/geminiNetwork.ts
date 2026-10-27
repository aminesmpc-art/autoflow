/** Fixed-file install only, restricted to our Gemini main-frame content script. */
export function installGeminiNetwork(
  sender: chrome.runtime.MessageSender, reply: (value: { installed: boolean }) => void,
): boolean {
  let valid = false;
  try {
    valid = sender.id === chrome.runtime.id && typeof sender.tab?.id === 'number'
      && (sender.frameId === undefined || sender.frameId === 0)
      && new URL(sender.url || '').origin === 'https://gemini.google.com';
  } catch { /* Invalid sender. */ }
  if (!valid) { reply({ installed: false }); return false; }
  try {
    chrome.scripting.executeScript({ target: { tabId: sender.tab!.id! }, world: 'MAIN', files: ['gemini-network.js'] })
      .then(() => reply({ installed: true }), () => reply({ installed: false }));
  } catch { reply({ installed: false }); return false; }
  return true;
}
