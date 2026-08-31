/**
 * Upload video to Flow using Chrome Debugger Protocol (file chooser interception).
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Flow ignores every synthetic file event a content script can produce.
 * See uploadVideo.ts for the five routes tried and the evidence they are dead.
 *
 * ── The approach ──────────────────────────────────────────────────────────
 *
 * This uses the same method as Puppeteer's page.waitForFileChooser():
 *
 *   1. Attach the debugger (briefly — banner shows for a few seconds)
 *   2. Enable file chooser interception via CDP
 *   3. Content script clicks Flow's upload button, which WOULD open a native
 *      file picker — but CDP intercepts it before the dialog appears
 *   4. CDP responds to the intercepted chooser with the temp file paths
 *   5. Flow receives the files exactly as if the user picked them
 *   6. Detach debugger, clean up temp files
 *
 * This works because the browser treats intercepted file choosers identically
 * to real user selections — isTrusted is true, accept filters are respected,
 * and React sees a normal onChange.
 *
 * ── The file-on-disk requirement ──────────────────────────────────────────
 *
 * CDP file chooser handling needs absolute paths. The clips are saved to a
 * temp directory under Downloads, the paths read back, and the files cleaned
 * up after upload.
 */

import { FLOW_STRINGS } from '../content/flow/flowStrings';

/**
 * Words that mean "media" beside the upload verb.
 *
 * Only used to PREFER one candidate over another, never to require one, so a
 * language missing from this list still finds its button by the verb alone.
 */
const MEDIA_WORDS = [
  'media', 'média', 'medios', 'mídia', 'medien', 'multimedia',
  'multimédia', 'メディア', '미디어', '媒体', 'وسائط',
];

/** What the caller gets back. */
export interface DebugUploadResult {
  ok: boolean;
  error?: string;
}

const TEMP_DIR = 'autoflow-omni-temp';

/* ──────────────────────────────────────────────────────────────────────── */
/* Saving blobs to disk                                                    */
/* ──────────────────────────────────────────────────────────────────────── */

export async function saveToDisk(
  dataUrl: string,
  filename: string,
): Promise<{ path: string; downloadId: number } | { error: string }> {
  try {
    const downloadId: number = await new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url: dataUrl,
          filename: `${TEMP_DIR}/${filename}`,
          conflictAction: 'overwrite',
          saveAs: false,
        },
        (id) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (id == null) reject(new Error('download returned no id'));
          else resolve(id);
        },
      );
    });
    const path = await waitForDownload(downloadId, 15_000);
    return { path, downloadId };
  } catch (e: any) {
    return { error: `save to disk failed: ${e?.message || e}` };
  }
}

async function waitForDownload(id: number, timeoutMs: number): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [item] = await chrome.downloads.search({ id });
    if (item?.state === 'complete' && item.filename) return item.filename;
    if (item?.state === 'interrupted') throw new Error(`interrupted: ${item.error}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('timed out waiting for download');
}

/* ──────────────────────────────────────────────────────────────────────── */
/* CDP: file chooser interception                                          */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * The core upload. Attaches debugger, intercepts the file chooser that Flow
 * opens when its upload button is clicked, and provides our files.
 *
 * The critical insight: browsers block file pickers from untrusted clicks
 * (simulateClick, element.click()). CDP Input.dispatchMouseEvent produces
 * TRUSTED clicks that the browser treats as real user clicks.
 *
 * We also get FRESH button coordinates via Runtime.evaluate AFTER the
 * debugger attaches, because the debug banner shifts the page layout.
 */
export async function uploadViaFileChooser(
  tabId: number,
  filePaths: string[],
): Promise<DebugUploadResult> {
  const target = { tabId };
  let attached = false;

  try {
    /* ── 1. Attach debugger ── */
    await new Promise<void>((resolve, reject) => {
      chrome.debugger.attach(target, '1.3', () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
    attached = true;

    /* ── 2. Enable the domains this needs ──
       Page for the fileChooserOpened event, and DOM because
       DOM.setFileInputFiles resolves the backendNodeId through the DOM agent.
       Only Page was enabled here, which is the kind of omission that fails at
       the very last step — after the banner, the click and the intercept all
       looked like they worked. */
    await sendCDP(target, 'Page.enable', {});
    await sendCDP(target, 'DOM.enable', {});

    /* Small wait for the debug banner to render and layout to settle */
    await new Promise((r) => setTimeout(r, 500));

    /* ── 2b. The direct route: set the files on the input itself ──
       This whole file was built around intercepting a file chooser, because
       uploadVideo.ts established that Flow ignores everything a content script
       can produce. That is true and still is — a content script's change event
       is isTrusted:false and Flow drops it.

       DOM.setFileInputFiles is not that. It sets the files in the browser, at
       the same level a real pick does, and the change event it fires IS
       trusted. It is what Puppeteer's elementHandle.uploadFile() calls, and it
       needs no chooser, no coordinates and no click — so it cannot be defeated
       by the debug banner shifting the layout, by the button being renamed in
       a language we do not know, or by the 15s chooser timeout.

       Tried first, and silently skipped when there is no input to be found:
       some dialogs only create one when the picker is actually invoked, and
       for those the click-and-intercept path below is still the answer. */
    const direct = await trySetFilesDirectly(target, filePaths);
    if (direct.ok) {
      try {
        await sendCDP(target, 'Page.setInterceptFileChooserDialog', { enabled: false });
      } catch { /* never enabled on this path */ }
      return { ok: true };
    }

    /* ── 3. Get FRESH button coordinates ──
       The debug banner shifts the page, so coordinates from before
       the debugger attached are now wrong. Query the DOM directly
       via CDP Runtime.evaluate to get the current position. */
    /* Built from FLOW_STRINGS.upload rather than a hard-coded English word.
       This looked for /upload\s*medi/i first and fell back to three French
       words — so on a French, German or Japanese Flow the primary match could
       not hit, and the failure was "Upload media button not found", which
       reads as "Flow changed" rather than "we only speak English".

       Substring matching also picks up Material's icon ligature: the glyph
       renders as the text "upload_file" NEXT TO the translated word, and the
       ligature name is identical in every language. So the verb list finds
       the button even in a language nobody added yet. */
    const UPLOAD_WORDS = FLOW_STRINGS.upload.map((w) => w.toLowerCase());

    const coordResult: any = await sendCDP(target, 'Runtime.evaluate', {
      expression: `(function () {
        var UP = ${JSON.stringify(UPLOAD_WORDS)};
        var MED = ${JSON.stringify(MEDIA_WORDS)};
        var dialog = document.querySelector('[role="dialog"], mat-dialog-container');
        if (!dialog) return JSON.stringify({ error: 'no dialog found' });

        var seen = [], cands = [];
        var btns = Array.prototype.slice.call(dialog.querySelectorAll('button'));
        for (var i = 0; i < btns.length; i++) {
          var b = btns[i], r = b.getBoundingClientRect();
          var t = (b.textContent || '').trim();
          if (t) seen.push(t.slice(0, 40));
          /* A hidden duplicate is clickable to CDP and does nothing. */
          if (!r.width || !r.height) continue;
          var low = t.toLowerCase(), isUp = false, isMed = false;
          for (var j = 0; j < UP.length; j++) {
            if (low.indexOf(UP[j]) !== -1) { isUp = true; break; }
          }
          if (!isUp) continue;
          for (var k = 0; k < MED.length; k++) {
            if (low.indexOf(MED[k]) !== -1) { isMed = true; break; }
          }
          cands.push({
            label: t, med: isMed, len: t.length,
            x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
            w: Math.round(r.width), h: Math.round(r.height)
          });
        }

        if (!cands.length) {
          return JSON.stringify({ error: 'no upload button in the dialog', seen: seen });
        }
        /* Prefer one that names media, then the shortest label: "Upload media"
           beats "Upload media from your computer to use as a reference". */
        cands.sort(function (a, c) {
          if (a.med !== c.med) return a.med ? -1 : 1;
          return a.len - c.len;
        });
        var p = cands[0];
        return JSON.stringify({
          x: p.x, y: p.y, w: p.w, h: p.h, label: p.label,
          alternatives: cands.length - 1
        });
      })()`,
      returnByValue: true,
    });

    let btnCoords: any;
    try {
      btnCoords = JSON.parse(coordResult?.result?.value || '{}');
    } catch {
      return { ok: false, error: 'failed to parse button coordinates' };
    }
    if (btnCoords.error) {
      /* Naming the buttons that WERE there turns "Flow changed" into a fact
         somebody can act on without opening devtools on the tab. */
      const seen = Array.isArray(btnCoords.seen) && btnCoords.seen.length
        ? ` Buttons on the dialog: ${btnCoords.seen.join(' | ')}`
        : '';
      return { ok: false, error: `Button lookup: ${btnCoords.error}.${seen}` };
    }
    if (!btnCoords.x || !btnCoords.y) {
      return { ok: false, error: 'button coordinates are zero — button may be off-screen' };
    }

    /* ── 4. Enable file chooser interception ── */
    await sendCDP(target, 'Page.setInterceptFileChooserDialog', { enabled: true });

    /* ── 5. Set up a promise that resolves when the file chooser fires ── */
    const chooserFired = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.debugger.onEvent.removeListener(handler);
        /* Everything known at the moment it gave up. Without the label and
           the direct-route reason this said only "did not open within 15s",
           which is true of a missed click, a renamed button and a Flow that
           never opens a chooser at all — three different problems wearing the
           same sentence. */
        reject(new Error(
          `file chooser did not open within 15s. Clicked "${btnCoords.label || '?'}" `
          + `at ${btnCoords.x},${btnCoords.y} (${btnCoords.w}x${btnCoords.h})`
          + `${btnCoords.alternatives ? `, ${btnCoords.alternatives} other upload button(s) on the dialog` : ''}`
          + `. Direct route was skipped: ${direct.why || 'unknown'}`,
        ));
      }, 15_000);

      function handler(
        source: chrome.debugger.Debuggee,
        method: string,
        params?: any,
      ) {
        if (source.tabId !== tabId || method !== 'Page.fileChooserOpened') return;
        clearTimeout(timeout);
        chrome.debugger.onEvent.removeListener(handler);

        /* ── 6. Set files on the input element ──
           Page.fileChooserOpened gives us backendNodeId of the <input>.
           DOM.setFileInputFiles sets files on that input — exactly what
           Puppeteer uses internally. Page.handleFileChooser doesn't exist. */
        const nodeId = params?.backendNodeId;
        sendCDP(target, 'DOM.setFileInputFiles', {
          files: filePaths,
          ...(nodeId ? { backendNodeId: nodeId } : {}),
        }).then(() => resolve()).catch(reject);
      }

      chrome.debugger.onEvent.addListener(handler);
    });

    /* ── 7. Click the "Upload media" button using CDP trusted mouse events ── */
    await sendCDP(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: btnCoords.x,
      y: btnCoords.y,
      button: 'left',
      clickCount: 1,
    });
    await sendCDP(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: btnCoords.x,
      y: btnCoords.y,
      button: 'left',
      clickCount: 1,
    });

    /* ── 8. Wait for the interception to complete ── */
    await chooserFired;

    /* ── 9. Disable interception ── */
    try {
      await sendCDP(target, 'Page.setInterceptFileChooserDialog', { enabled: false });
    } catch { /* non-fatal */ }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  } finally {
    if (attached) {
      try {
        await new Promise<void>((resolve) => {
          chrome.debugger.detach(target, () => {
            void chrome.runtime.lastError;
            resolve();
          });
        });
      } catch { /* swallow */ }
    }
  }
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Clean-up                                                                */
/* ──────────────────────────────────────────────────────────────────────── */

export async function cleanupTempFile(downloadId: number): Promise<void> {
  try { await chrome.downloads.removeFile(downloadId); } catch {}
  try { await chrome.downloads.erase({ id: downloadId }); } catch {}
}

/**
 * Remove anything an earlier upload left behind.
 *
 * The delayed cleanup below runs on setTimeout, and a service worker is
 * terminated when it goes idle — so once the upload returns and the reply is
 * sent, there is nothing keeping the worker alive for a further sixty seconds
 * and that timer usually never fires. Every piece of every clip stays in
 * Downloads/autoflow-omni-temp for ever, which for somebody clipping daily is
 * a folder that grows without bound and that nobody put there deliberately.
 *
 * Sweeping at the START of the next upload needs no timer and no alarm: by
 * then Flow has long finished reading whatever the last run wrote, so there is
 * nothing to be careful about.
 */
export async function sweepTempFiles(): Promise<number> {
  try {
    const stale = await chrome.downloads.search({ filenameRegex: TEMP_DIR });
    await Promise.all(stale.map((item) => cleanupTempFile(item.id)));
    return stale.length;
  } catch {
    /* Best effort. A sweep that fails must never stop an upload. */
    return 0;
  }
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Full pipeline                                                           */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * The end-to-end upload:
 *
 *   1. Tell the content script to open the right dialog in Flow
 *   2. Save the blobs to disk (temp files)
 *   3. CDP attaches, finds button, intercepts file chooser, clicks button
 *   4. CDP provides the temp file paths to the intercepted file chooser
 *   5. Clean up temp files
 */
export async function uploadToFlow(
  tabId: number,
  files: Array<{ dataUrl: string; filename: string }>,
): Promise<DebugUploadResult> {
  const saved: Array<{ path: string; downloadId: number }> = [];

  /* Whatever the last run could not clean up, before this one adds more. */
  const swept = await sweepTempFiles();
  if (swept) console.log(`[AutoFlow] swept ${swept} leftover temp file(s)`);

  try {
    /* ── Step 1: Have the content script open the upload dialog ── */
    const prepareDialog = async (): Promise<any> => {
      return chrome.tabs.sendMessage(tabId, { type: 'PREPARE_VIDEO_UPLOAD' });
    };

    let prepResult: any;
    try {
      prepResult = await prepareDialog();
    } catch (e: any) {
      const msg = e?.message || String(e);
      /* "Receiving end does not exist" = content script not loaded.
         This happens after extension reload — existing tabs still have the
         old (dead) content script. Reload the tab to inject the new one. */
      if (/receiving end|could not establish/i.test(msg)) {
        try {
          await chrome.tabs.reload(tabId);
          await waitForContentScript(tabId, 25_000);
          prepResult = await prepareDialog();
        } catch (retryErr: any) {
          return { ok: false, error: `After reload: ${retryErr?.message || retryErr}` };
        }
      } else {
        return { ok: false, error: `Content script error: ${msg}` };
      }
    }

    if (prepResult?.error) {
      return { ok: false, error: `Flow dialog: ${prepResult.error}` };
    }
    /* We only check that the dialog opened. Coordinates are fetched fresh
       inside uploadViaFileChooser after the debugger attaches. */

    /* ── Step 2: Save all blobs to disk ── */
    for (const file of files) {
      const result = await saveToDisk(file.dataUrl, file.filename);
      if ('error' in result) {
        /* Returning here used to walk away from the files already written.
           Nothing is uploading yet, so they can go immediately. */
        for (const s of saved) cleanupTempFile(s.downloadId).catch(() => {});
        return { ok: false, error: result.error };
      }
      saved.push(result);
    }

    /* ── Step 3: Intercept file chooser and provide files ── */
    const paths = saved.map((s) => s.path);
    const result = await uploadViaFileChooser(tabId, paths);

    /* ── Step 4: Delayed cleanup ──
       Flow needs time to READ the file from disk and UPLOAD it to their
       servers. Deleting immediately (in finally) would delete the file
       while Flow is still reading it → "Something went wrong".

       So it waits — and this timer is OPPORTUNISTIC, not the guarantee. A
       service worker is terminated once it goes idle, and after the reply is
       sent nothing here keeps it alive for a minute, so more often than not
       this never runs. sweepTempFiles() at the top of the next upload is what
       actually stops the folder growing; this only tidies sooner when the
       worker happens to still be around. */
    if (saved.length > 0) {
      setTimeout(() => {
        for (const s of saved) {
          cleanupTempFile(s.downloadId).catch(() => {});
        }
      }, 60_000);
    }

    return result;
  } catch (e: any) {
    /* If we failed, clean up immediately — no upload is in progress */
    for (const s of saved) {
      cleanupTempFile(s.downloadId).catch(() => {});
    }
    return { ok: false, error: e?.message || String(e) };
  }
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                 */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Wait for a tab to finish loading AND its content script to respond to PING.
 * Used after reloading a tab to ensure the content script is ready.
 */
async function waitForContentScript(tabId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  /* Wait for tab.status === 'complete' */
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') break;
    } catch {
      throw new Error('tab closed');
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  /* Wait for content script to respond to PING */
  while (Date.now() < deadline) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return; // success
    } catch {
      /* content script not ready yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('content script did not respond after reload');
}

/**
 * Put the files straight onto Flow's file input, with no chooser involved.
 *
 * Returns why it could not rather than throwing, because every reason here is
 * a reason to fall back rather than to fail: the input may not exist until the
 * picker is opened, and that is normal rather than broken.
 */
async function trySetFilesDirectly(
  target: chrome.debugger.Debuggee,
  filePaths: string[],
): Promise<{ ok: boolean; why?: string }> {
  try {
    const doc: any = await sendCDP(target, 'DOM.getDocument', { depth: -1, pierce: true });
    const rootId = doc?.root?.nodeId;
    if (!rootId) return { ok: false, why: 'no document' };

    /* pierce:true above walks shadow roots, which Flow's dialog uses. */
    const found: any = await sendCDP(target, 'DOM.querySelector', {
      nodeId: rootId,
      selector: 'input[type="file"]',
    });
    const nodeId = found?.nodeId;
    if (!nodeId) return { ok: false, why: 'no file input on the page yet' };

    await sendCDP(target, 'DOM.setFileInputFiles', { nodeId, files: filePaths });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, why: e?.message || String(e) };
  }
}

function sendCDP(target: chrome.debugger.Debuggee, method: string, params?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}
