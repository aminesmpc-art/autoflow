import { sameVideo, SELECTION_KEY, socialLink, socialPagePlatform } from './policy';

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.type !== 'MOTION_SOCIAL_OPEN') return false;
  const current = socialLink(sender.url || ''), selected = socialLink(String(msg.url || ''));
  const platform = socialPagePlatform(sender.url || '');
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || sender.frameId !== 0 || !selected?.id || platform !== selected.platform || (current?.id && !sameVideo(selected, current))) {
    respond({ error: 'Open a supported video page before using it in Motion.' }); return false;
  }
  // Call immediately in the content-script click's user gesture, not after storage.
  let opened: Promise<void>;
  try { opened = chrome.sidePanel.open({ windowId: sender.tab.windowId }); }
  catch { opened = Promise.reject(new Error('Panel unavailable')); }
  // Retain the selection even if this browser needs a toolbar click to open
  // its side panel. The user never has to re-copy the URL for that fallback.
  const queued = chrome.storage.session.set({ [SELECTION_KEY]: { url: selected.url, tabId: sender.tab.id, windowId: sender.tab.windowId, selectedAt: Date.now() } });
  void Promise.allSettled([opened, queued]).then(([panel, selection]) => {
    if (selection.status === 'rejected') respond({ error: 'Could not select this video. Reopen Motion and paste its link.' });
    else if (panel.status === 'rejected') respond({ error: 'Video selected. Click the AutoFlow Motion toolbar icon to open the panel.' });
    else respond({ ok: true });
  });
  return true;
});
