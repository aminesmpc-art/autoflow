import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { SELECTION_KEY, socialLink } from './social/policy';
import { readServerVideo, readVideo, requestMediaAccess, resolveVideo, saveVideo } from './social/importVideo';

export default function SocialImport({ disabled, onBusy, onFile }: {
  disabled: boolean; onBusy: (value: boolean) => void; onFile: (file: File, signal?: AbortSignal) => Promise<void>;
}) {
  const [open, setOpen] = useState(false), [url, setUrl] = useState(''), [rights, setRights] = useState(false);
  const [status, setStatus] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<'server' | 'browser'>('server');
  const selectedTab = useRef<number | undefined>(undefined);
  const operation = useRef<AbortController | null>(null);
  const currentWindow = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!globalThis.chrome?.runtime?.id) return;
    let alive = true;
    const take = (selection: any) => {
      const link = socialLink(String(selection?.url || ''));
      if (!alive || !link || Date.now() - Number(selection.selectedAt) > 10 * 60_000 || selection.windowId !== currentWindow.current || operation.current) return;
      setUrl(link.url); setRights(false); selectedTab.current = selection.tabId; setOpen(true); setError(''); setStatus('Video selected. Confirm permission, then import.');
    };
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'session' && changes[SELECTION_KEY]) take(changes[SELECTION_KEY].newValue); };
    chrome.storage.onChanged.addListener(changed);
    void chrome.windows.getCurrent().then(async window => {
      currentWindow.current = window.id;
      const saved = await chrome.storage.session.get(SELECTION_KEY); take(saved[SELECTION_KEY]);
    }).catch(() => {});
    return () => { alive = false; chrome.storage.onChanged.removeListener(changed); operation.current?.abort(); };
  }, []);

  const importVideo = async () => {
    if (disabled || operation.current || !rights) return;
    const link = socialLink(url);
    setError(''); setStatus('');
    if (!link) { setError('Paste a TikTok video, Instagram Reel/post, or YouTube watch/Shorts link.'); return; }
    if (!globalThis.chrome?.runtime?.id) { setError('Load AutoFlow Motion in Chrome to import a link.'); return; }
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); onBusy(true);
    const timer = setTimeout(() => controller.abort('timeout'), method === 'server' ? 180_000 : 120_000);
    try {
      let file: File;
      if (method === 'server') {
        setStatus('AutoFlow is downloading your selected video…');
        file = await readServerVideo(link, controller.signal, bytes => setStatus(`Receiving video · ${(bytes / 1024 / 1024).toFixed(1)} MB`));
      } else {
      // Must remain the first API call in the click: permission dialogs need
      // the gesture, and are limited to the selected platform's media hosts.
      const allowed = await requestMediaAccess(link);
      if (!allowed) throw new Error('Media access was not granted. You can still use Upload file.');
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      setStatus('Opening the video and finding its downloadable file…');
      const media = await resolveVideo(link, controller.signal, selectedTab.current);
      setStatus('Downloading in your browser…');
      file = await readVideo(media, controller.signal, bytes => setStatus(`Downloading · ${(bytes / 1024 / 1024).toFixed(1)} MB`));
      }
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      setStatus('Checking the video…');
      await onFile(file, controller.signal);
      clearTimeout(timer);
      try { await saveVideo(file); setStatus('Imported into Motion. A copy is saving to Downloads / AutoFlow Motion.'); }
      catch { setStatus('Imported into Motion, but Chrome could not save the Downloads copy. Your source is still available here.'); }
      await chrome.storage.session.remove(SELECTION_KEY).catch(() => {});
    } catch (e) {
      if (controller.signal.aborted) setStatus(controller.signal.reason === 'timeout' ? 'Import timed out. Open the video tab and try again, or upload a local file.' : 'Import cancelled. Your previous source is unchanged.');
      else { setStatus(''); setError(e instanceof Error ? e.message : 'Could not import this video. Use Upload file instead.'); }
    } finally {
      clearTimeout(timer); operation.current = null; setBusy(false); onBusy(false);
    }
  };
  return <div className="social-import" aria-busy={busy}>
    <button type="button" className="social-import__toggle" aria-expanded={open} aria-controls="social-import-body" onClick={() => setOpen(!open)}>
      <Icon name="link" /><span>Import a video link<small>TikTok · Instagram · YouTube</small></span><Icon name="arrow" />
    </button>
    {open && <div id="social-import-body" className="social-import__body">
      <label htmlFor="social-video-url">Video link</label>
      <input id="social-video-url" type="url" inputMode="url" autoComplete="off" placeholder="Paste a video link" value={url} disabled={disabled || busy} aria-describedby="social-import-help"
        onChange={e => { setUrl(e.target.value); setRights(false); selectedTab.current = undefined; setError(''); setStatus(''); }} />
      <label htmlFor="social-import-method">Download method</label>
      <select id="social-import-method" value={method} disabled={disabled || busy} onChange={e => { setMethod(e.target.value as typeof method); setRights(false); setError(''); setStatus(''); }}>
        <option value="server">AutoFlow server · yt-dlp</option><option value="browser">Browser only</option>
      </select>
      <p id="social-import-help" className="hint">{method === 'server' ? 'Requires AutoFlow sign-in. Sends the selected link to our extractor server. Up to 100 MB and 10 minutes.' : 'Browser only · up to 100 MB. A video tab opens if needed.'} Downloads a copy and uses it as your motion source.</p>
      <label className="social-import__consent"><input type="checkbox" checked={rights} disabled={disabled || busy} onChange={e => setRights(e.target.checked)} /><span>I own this video or have permission to download and reuse it.</span></label>
      <div className="social-import__actions">
        <button type="button" className="btn btn--secondary" disabled={disabled || busy || !rights || !url.trim()} onClick={() => void importVideo()}><Icon name="download" />{busy ? 'Importing…' : 'Import & download'}</button>
        {busy && <button type="button" className="btn btn--ghost" onClick={() => operation.current?.abort()}><Icon name="close" />Cancel</button>}
      </div>
      {status && <p className="hint" role="status">{status}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <p className="hint">{method === 'server' ? 'The server temporarily downloads the video and removes its copy after delivery. No AI analysis or generation is started.' : 'No video goes to an AutoFlow server during browser-only import.'} Your site cookies stay in the browser. Restricted videos may require a local file.</p>
    </div>}
  </div>;
}
