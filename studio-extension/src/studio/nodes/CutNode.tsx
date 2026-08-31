/**
 * One cut from the source video, as its own node.
 *
 * Emitted by the Clipping director, ten or so at a time. Each one holds the
 * two lines its clip runs between and finds the seconds itself when it runs —
 * see clip/emitPlan.ts for why the seconds are deliberately not baked in.
 *
 * ── This node is where the output finally became visible ──────────────────
 *
 * The pipeline produced a finished clip for weeks and nothing ever showed it.
 * getMedia() had no callers outside its own file: the runner encoded a Blob,
 * put it in a Map, and every way of looking at it went through a console log.
 * The player below is the fix, and it is the reason the node has a body at all
 * — a cut with no preview is a node you have to take on faith.
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import { Icon } from '../components/Icon';
import { useStudioStore } from '../store';
import { NodeInfoBadge } from './NodeInfoBadge';
import { getMedia, hasSource } from '../clip/sourceStore';
import { sheetAsText, type EditOp } from '../clip/editSheet';
import { partFileName } from '../../content/flow/uploadVideo';

/** A timecode a person can find in CapCut's timeline. */
function stamp(sec: number): string {
  const s = Math.max(0, Number(sec) || 0);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function CutNodeInner({ id, data, selected }: NodeProps) {
  const d = data as any;
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  const removeNode = useStudioStore((s) => s.removeNode);
  const duplicateNode = useStudioStore((s) => s.duplicateNode);

  const mediaKey: string = d.mediaKey || '';
  const sourceKey: string = d.sourceKey || '';
  const [url, setUrl] = useState('');

  /* An object URL is a document-lifetime handle to a Blob. Left unrevoked,
     every re-run of every cut node leaks its clip for as long as the tab
     lives, and these are megabytes each. */
  useEffect(() => {
    const blob = mediaKey ? getMedia(mediaKey) : undefined;
    if (!blob) { setUrl(''); return undefined; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [mediaKey, d.cutReport]);

  const save = useCallback(() => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    /* The whole cut is one piece, so it takes the plain name — same helper
       as the split pieces, so a clip saved whole and a clip saved in parts
       are recognisably the same thing in Flow. */
    a.download = partFileName(String(d.label || 'clip'), 1, 1);
    a.click();
  }, [url, d.label]);

  /* The bytes live in memory for the life of the tab. After a reload the run
     is still on the node and the source is not, which used to present as a
     node that simply failed on Run with nothing explaining why. */
  const sourceMissing = !!sourceKey && !hasSource(sourceKey);

  /* Planned once when the cut was made and kept on the node, so it survives a
     reopen with everything else the run produced. */
  const sheet: any[] = Array.isArray(d.editSheet) ? d.editSheet : [];
  const gaps: string[] = Array.isArray(d.editGaps) ? d.editGaps : [];
  /* Built by the same function that formats it anywhere else, so the text
     on the clipboard and the text in a log cannot drift apart. */
  const sheetText = sheetAsText(sheet as EditOp[], d.title);
  const brollCount: number = typeof d.brollCount === 'number' ? d.brollCount : 0;
  /* Inherited from the director that laid this cut out. */
  const campaign: boolean = d.clipMode !== 'explainer';

  /* The clip in pieces Flow will accept. Saving them is the point: Flow's own
     file input is `multiple`, so however many parts there are it is still ONE
     pick — which is what makes chunking bearable given that the upload itself
     cannot be automated. */
  const parts: any[] = Array.isArray(d.omniParts) ? d.omniParts : [];
  const omniSplit: string = typeof d.omniSplit === 'string' ? d.omniSplit : '';

  /* ── Letting AutoFlow do the upload ──────────────────────────────────
     Flow ignores every synthetic file event, so the only way to hand it a
     file is to intercept the file chooser through Chrome's debugger. That
     works, and it costs something visible: Chrome puts a banner across the
     top of the Flow tab for as long as the debugger is attached.

     Which is why the switch is here and not in a settings screen. Nobody
     goes looking for a permission they have not been asked for yet, and a
     banner appearing unannounced on somebody's Flow tab is the kind of
     surprise that gets an extension uninstalled. The offer is made where the
     files are, at the moment it would help, and it explains itself first.

     `null` means we have not read the flag yet — distinct from false, so the
     button does not flicker from "Upload" to "Turn on" on first paint. */
  const [uploadOn, setUploadOn] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  const [upload, setUpload] = useState<{ state: string; message: string }>(
    { state: 'idle', message: '' },
  );

  useEffect(() => {
    let alive = true;
    chrome.storage.local.get(['af_debug_upload'])
      .then((got) => { if (alive) setUploadOn(got?.af_debug_upload === true); })
      .catch(() => { if (alive) setUploadOn(false); });
    return () => { alive = false; };
  }, []);

  /* Base64 is a third larger than the bytes it carries, and all of it travels
     through one runtime message. Nine parts of a long clip can pass what the
     channel will take, and the failure is not a clean error — so it is
     checked here, where "use Save all instead" is still useful advice.

     The cap is on the ENCODED size, not the raw bytes. Capping the raw bytes
     at 32MB let a ~43MB message through, which is the size that was supposed
     to be refused. */
  const MAX_MESSAGE_BYTES = 24 * 1024 * 1024;
  const encodedSize = (bytes: number) => Math.ceil(bytes / 3) * 4;

  const asDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('could not read the clip'));
    reader.readAsDataURL(blob);
  });

  const sendToFlow = useCallback(async () => {
    setAsking(false);
    setUpload({ state: 'working', message: 'Preparing…' });

    const blobs = parts
      .map((part) => ({ part, blob: getMedia(part.mediaKey) }))
      .filter((x) => x.blob) as Array<{ part: any; blob: Blob }>;

    if (!blobs.length) {
      setUpload({ state: 'error', message: 'The pieces are no longer in memory — re-run the cut.' });
      return;
    }

    const total = blobs.reduce((sum, x) => sum + x.blob.size, 0);
    if (encodedSize(total) > MAX_MESSAGE_BYTES) {
      setUpload({
        state: 'error',
        message: `These pieces total ${(total / 1024 / 1024).toFixed(0)}MB, too much to send in one go. Use Save all and pick them in Flow.`,
      });
      return;
    }

    try {
      /* partFileName rather than a local sanitiser: Flow shows the asset under
         its file name, and folds accents away instead of translating them —
         "telechargement (7).mp4" became "tlchargement_7" in the library. One
         helper does that folding properly, and both this and Save all use it
         so a piece has the same name whichever way it reaches Flow. */
      const files = await Promise.all(blobs.map(async ({ part, blob }) => ({
        dataUrl: await asDataUrl(blob),
        filename: partFileName(String(d.label || 'clip'), part.index, part.of),
      })));

      setUpload({ state: 'working', message: 'Uploading — Chrome will show a debugging banner.' });
      const reply = await chrome.runtime.sendMessage({ type: 'DEBUG_UPLOAD_TO_FLOW', files });

      if (reply?.ok) {
        setUpload({ state: 'done', message: `${files.length} piece${files.length === 1 ? '' : 's'} sent to Flow.` });
      } else {
        setUpload({ state: 'error', message: reply?.error || 'The upload did not go through.' });
      }
    } catch (e: any) {
      setUpload({ state: 'error', message: e?.message || 'The upload did not go through.' });
    }
  }, [parts, d.label]);

  /** Say yes to the banner, then upload — one press, not two. */
  const enableAndSend = useCallback(async () => {
    try {
      await chrome.storage.local.set({ af_debug_upload: true });
      setUploadOn(true);
      await sendToFlow();
    } catch {
      setUpload({ state: 'error', message: 'Could not save that choice.' });
    }
  }, [sendToFlow]);

  const turnOff = useCallback(async () => {
    try {
      await chrome.storage.local.set({ af_debug_upload: false });
      setUploadOn(false);
      setUpload({ state: 'idle', message: '' });
    } catch { /* leave it as it was */ }
  }, []);

  const saveParts = useCallback(() => {
    parts.forEach((part, i) => {
      const blob = getMedia(part.mediaKey);
      if (!blob) return;
      /* Staggered. Chrome throttles a burst of downloads from one gesture and
         silently drops the tail, which would leave the pick short of pieces
         with nothing saying so. */
      setTimeout(() => {
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = partFileName(String(d.label || 'clip'), part.index, part.of);
        a.click();
        setTimeout(() => URL.revokeObjectURL(href), 10000);
      }, i * 400);
    });
  }, [parts, d.label]);

  return (
    <div className={`sn-wrap sn-wrap--kind-cut ${selected ? 'sn-wrap--selected' : ''}`}>
      <div className="sn-actions">
        <button className="sn-actions__btn" onClick={() => duplicateNode(id)} title="Duplicate node">⧉</button>
        <button className="sn-actions__btn sn-actions__btn--danger" onClick={() => removeNode(id)} title="Delete node">🗑</button>
      </div>

      <div className="sn sn--cut">
        <Handle type="target" position={Position.Left} id="text" className="sn-port sn-port--text" style={{ top: 72 }}>
          <span className="sn-port__glyph">T</span>
        </Handle>

        <div className="sn-bar">
          <Icon name="story" kind="video" className="sn-label__icon" />
          <input
            className="sn-label__name nodrag"
            value={d.label || 'Cut'}
            onChange={(e) => updateNodeData(id, { label: e.target.value })}
            placeholder="Cut"
          />
          <NodeInfoBadge type="cut" />
          {typeof d.score === 'number' && (
            <span className="sn-cut__score" title="hook 30 · delivers 40 · stands alone 20 · worth sharing 10">
              {d.score}
            </span>
          )}
          {d.status === 'running' ? (
            <span className="sn-count sn-count--running">
              {d.statusNote || 'Working…'}
            </span>
          ) : (
            <span className="sn-story__badge">{url ? 'Ready' : '9:16'}</span>
          )}
        </div>

        <div className="sn-cut__body">
          {sourceMissing && (
            <div className="sn-cut__warn">
              The video is not loaded. Drop it on the Clipping node again — the
              cut keeps its lines, only the bytes are gone.
            </div>
          )}

          {/* The pair of lines IS the clip's definition, so it is the body of
              the node rather than something behind a tab. */}
          <div className="sn-cut__line sn-cut__line--in">
            &ldquo;{d.hookLine || 'no opening line'}&rdquo;
          </div>
          <div className="sn-cut__line sn-cut__line--out">
            &ldquo;{d.closingLine || 'no closing line'}&rdquo;
          </div>

          {d.why && <p className="sn-cut__why">{d.why}</p>}

          {/* What to write when posting it, decided by the same reply that
              judged the clip. Copyable, because it is going into another app
              and retyping it is where hashtags creep back in. */}
          {d.title && (
            <div className="sn-cut__post">
              <span className="sn-cut__post-text">{d.title}</span>
              <button
                type="button"
                className="sn-cut__copy nodrag"
                title="Copy the post text"
                onClick={() => navigator.clipboard?.writeText(String(d.title))}
              >
                Copy
              </button>
            </div>
          )}

          {/* What to ADD, and when. Nothing here is rendered onto the clip —
              the finishing happens in CapCut, so this is a list of timecoded
              instructions to follow there, copyable in one go because it is
              going into another app. */}
          {sheet.length > 0 && (
            <div className="sn-cut__sheet">
              <div className="sn-cut__sheet-head">
                <span>Edit plan</span>
                <button
                  type="button"
                  className="sn-cut__copy nodrag"
                  title="Copy the whole sheet"
                  onClick={() => navigator.clipboard?.writeText(sheetText)}
                >
                  Copy
                </button>
              </div>
              <ol className="sn-cut__ops">
                {sheet.map((op: any, i: number) => (
                  <li key={i} className={`sn-cut__op sn-cut__op--${op.kind}`}>
                    <span className="sn-cut__op-at">{stamp(op.atSec)}</span>
                    <span className="sn-cut__op-kind">{op.kind}</span>
                    <span className="sn-cut__op-what">{op.what}</span>
                  </li>
                ))}
              </ol>
              {/* Legal but flat. A sheet can pass every check and still leave
                  the middle of a clip empty, which is the difference between
                  one that was followed and one that worked. */}
              {gaps.length > 0 && (
                <p className="sn-cut__sheet-gap">{gaps.join(' · ')}</p>
              )}
              {/* Said plainly, because the numbers disagree on purpose. A
                  cutaway wants one to two seconds and the shortest clip Flow
                  makes is four, so every generated asset arrives longer than
                  the line above asks for. It is a trim, not a fault. */}
              {/* Why there is no cutaway on the sheet.
                  Campaign work forbids footage that is not the creator's own,
                  so the director is never OFFERED broll and nothing is refused
                  — which means the absence is silent, and a clipper wondering
                  where the generated shots went has nothing to read. */}
              {campaign && (
                <p className="sn-cut__sheet-note">
                  Campaign mode — no generated footage, so no cutaways are
                  planned. Switch the Clipping node to Explainer for those.
                </p>
              )}
              {brollCount > 0 && (
                <p className="sn-cut__sheet-note">
                  {brollCount} cutaway{brollCount === 1 ? '' : 's'} generated beside this
                  node — each is at least 4s, so trim to the hold above.
                </p>
              )}
            </div>
          )}

          {/* The pieces, and the one button that gets them all onto disk.
              Flow's picker takes several files at once, so N parts is still a
              single pick — see saveParts for why they are staggered. */}
          {parts.length > 1 && (
            <div className="sn-cut__parts">
              <div className="sn-cut__parts-head">
                <span>{omniSplit || `${parts.length} parts for Omni`}</span>
                <span style={{ display: 'flex', gap: '6px' }}>
                  <button type="button" className="sn-cut__copy nodrag" onClick={saveParts}>
                    Save all
                  </button>
                  {/* Offered even when the switch is off — pressing it is how
                      somebody finds out the option exists. It explains itself
                      before it does anything. */}
                  <button
                    type="button"
                    className="sn-cut__copy nodrag"
                    disabled={uploadOn === null || upload.state === 'working'}
                    onClick={() => (uploadOn ? sendToFlow() : setAsking(true))}
                    title="Let AutoFlow put these into Flow for you"
                  >
                    {upload.state === 'working' ? 'Uploading…' : 'Upload to Flow'}
                  </button>
                </span>
              </div>

              {asking ? (
                /* The whole cost, before anything happens. Written out rather
                   than summarised, because "allow debugging?" means nothing
                   until you have seen the banner it puts on your tab. */
                <div className="sn-cut__parts-note" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span>
                    To upload for you, AutoFlow attaches Chrome&apos;s debugger to your Flow
                    tab. Chrome shows a banner across the top while it does, and it will
                    not work if you have DevTools open on that tab. Nothing else uses it.
                  </span>
                  <span style={{ display: 'flex', gap: '6px' }}>
                    <button type="button" className="sn-cut__copy nodrag" onClick={enableAndSend}>
                      Turn on and upload
                    </button>
                    <button type="button" className="sn-cut__copy nodrag" onClick={() => setAsking(false)}>
                      Not now
                    </button>
                  </span>
                </div>
              ) : (
                <p className="sn-cut__parts-note">
                  Flow edits 10s at a time. Save these, then pick them together in
                  Flow — the file dialog takes them all at once.
                  {uploadOn && (
                    /* However it was turned on, it can be turned off from the
                       same place. A switch with no way back is a trap. */
                    <>
                      {' '}Automatic upload is on.{' '}
                      <button
                        type="button"
                        className="nodrag"
                        onClick={turnOff}
                        style={{
                          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                          font: 'inherit', color: 'inherit', textDecoration: 'underline',
                        }}
                      >
                        Turn it off
                      </button>.
                    </>
                  )}
                </p>
              )}

              {upload.state !== 'idle' && upload.state !== 'working' && (
                <p
                  className="sn-cut__parts-note"
                  style={{ color: upload.state === 'error' ? 'var(--danger, #ff6b6b)' : 'var(--n-video)' }}
                >
                  {upload.message}
                </p>
              )}
            </div>
          )}

          {url ? (
            <div className="sn-cut__result">
              <video className="sn-cut__video nodrag" src={url} controls preload="metadata" />
              <div className="sn-cut__meta">
                <span>{d.cutReport || ''}</span>
                <button type="button" className="sn-cut__save nodrag" onClick={save}>
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="sn-cut__pending">
              Run this node to find the two lines in the audio and cut between them.
            </div>
          )}
        </div>

        <Handle type="source" position={Position.Right} id="result" className="sn-port sn-port--out" style={{ top: '50%' }}>
          <span className="sn-port__glyph">→</span>
        </Handle>
      </div>
    </div>
  );
}

export const CutNode = memo(CutNodeInner);
export default CutNode;
