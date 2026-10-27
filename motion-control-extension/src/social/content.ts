import { pageMedia } from './pageMedia';
import { socialLink } from './policy';
import { BRAND_CHEVRONS } from '../brandGeometry';
import { activeVideoPost, actionRail, iconPosition } from './pageAction';

const host = document.createElement('div');
host.id = 'autoflow-motion-import';
// Shadow DOM keeps platform styles from breaking the control, and vice versa.
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `<style>
:host{position:fixed;z-index:2147483000;display:block;width:48px;height:48px;color:#fff;font:13px/1.4 system-ui,sans-serif}
button{display:grid;place-items:center;width:48px;height:48px;padding:0;border:1px solid #ef9c7d;border-radius:50%;background:#b94322;color:#fff;box-shadow:0 3px 14px #0005;cursor:pointer;transition:background .15s,box-shadow .15s}
button:hover{background:#a3381b;box-shadow:0 4px 18px #0007}button:focus-visible{outline:3px solid #fff;outline-offset:3px}button:disabled{opacity:.7;cursor:wait}
svg{width:36px;height:36px;pointer-events:none}
.tooltip{position:absolute;right:calc(100% + 10px);top:50%;transform:translateY(-50%);padding:7px 10px;border:1px solid #ffffff30;border-radius:8px;background:#191c22;color:#fff;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .15s}
:host(:hover) .tooltip,:host(:focus-within) .tooltip{opacity:1}
p{position:absolute;right:0;bottom:calc(100% + 12px);width:230px;max-width:calc(100vw - 24px);padding:10px;margin:0;border:1px solid #ffffff30;border-radius:8px;background:#191c22;color:#fff;font:12px/1.4 system-ui,sans-serif}
@media(prefers-reduced-motion:reduce){button,.tooltip{transition:none}}
</style><button type="button" aria-label="Use this video in AutoFlow Motion" aria-describedby="motion-action-tooltip"><svg viewBox="12 12 104 104" aria-hidden="true">${BRAND_CHEVRONS.map(points => `<polygon points="${points}" fill="currentColor" stroke="currentColor" stroke-width="3.224" stroke-linejoin="round"/>`).join('')}</svg></button><span id="motion-action-tooltip" class="tooltip" role="tooltip">Use in Motion Control</span><p role="status" hidden></p>`;
const button = root.querySelector('button')!, note = root.querySelector('p')!;
let opening = false;
button.addEventListener('click', () => {
  // Read again at the click: scrolling a feed must never select an old video.
  const selected = activeVideoPost(document, location.href)?.link;
  if (!selected?.id || opening) return;
  opening = true; button.disabled = true; note.hidden = true;
  void chrome.runtime.sendMessage({ type: 'MOTION_SOCIAL_OPEN', url: selected.url }).then(reply => {
    if (!reply?.ok) throw new Error(reply?.error || 'Reopen Motion from the extension toolbar.');
  }).catch(error => { note.textContent = error.message; note.hidden = false; })
    .finally(() => { opening = false; button.disabled = false; });
});

function refresh() {
  const post = activeVideoPost(document, location.href);
  if (!post) { host.remove(); return; }
  const viewport = { width: innerWidth, height: innerHeight };
  const video = post.video.getBoundingClientRect();
  const position = iconPosition(video, viewport, actionRail(document, video, viewport));
  host.style.left = `${position.left}px`; host.style.top = `${position.top}px`;
  host.dataset.placement = position.placement;
  host.dataset.videoId = post.link.id;
  if (!host.isConnected) document.documentElement.append(host);
}
let queued = false;
const schedule = () => {
  if (queued) return;
  queued = true;
  setTimeout(() => { queued = false; refresh(); }, 300);
};
const observer = new MutationObserver(schedule);
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href'] });
window.addEventListener('popstate', schedule);
window.addEventListener('resize', schedule);
document.addEventListener('scroll', schedule, { capture: true, passive: true });
document.addEventListener('playing', schedule, true);
document.addEventListener('yt-navigate-finish', schedule);
refresh();

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.type !== 'MOTION_SOCIAL_READ') return false;
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('sidepanel.html'))) return false;
  try {
    const link = socialLink(String(msg.url || ''));
    if (!link) throw new Error('Paste a supported video link.');
    respond({ media: pageMedia(document, location.href, link) });
  } catch (error) { respond({ error: error instanceof Error ? error.message : String(error) }); }
  return false;
});
