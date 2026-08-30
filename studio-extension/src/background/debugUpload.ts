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

    /* ── 2. Enable the Page domain — required for CDP to fire events ── */
    await sendCDP(target, 'Page.enable', {});

    /* Small wait for the debug banner to render and layout to settle */
    await new Promise((r) => setTimeout(r, 500));

    /* ── 3. Get FRESH button coordinates ──
       The debug banner shifts the page, so coordinates from before
       the debugger attached are now wrong. Query the DOM directly
       via CDP Runtime.evaluate to get the current position. */
    const coordResult: any = await sendCDP(target, 'Runtime.evaluate', {
      expression: `
        (function() {
          var dialog = document.querySelector('[role="dialog"], mat-dialog-container');
          if (!dialog) return JSON.stringify({ error: 'no dialog found' });
          var btns = Array.from(dialog.querySelectorAll('button'));
          var btn = btns.find(function(b) {
            return /upload\\s*medi/i.test((b.textContent || '').trim());
          });
          if (!btn) {
            btn = btns.find(function(b) {
              var t = (b.textContent || '').trim();
              return /^(upload|télécharger|importer)/i.test(t) && t.length < 30;
            });
          }
          if (!btn) return JSON.stringify({ error: 'Upload media button not found' });
          var r = btn.getBoundingClientRect();
          return JSON.stringify({
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
            w: Math.round(r.width),
            h: Math.round(r.height)
          });
        })()
      `,
      returnByValue: true,
    });

    let btnCoords: any;
    try {
      btnCoords = JSON.parse(coordResult?.result?.value || '{}');
    } catch {
      return { ok: false, error: 'failed to parse button coordinates' };
    }
    if (btnCoords.error) {
      return { ok: false, error: `Button lookup: ${btnCoords.error}` };
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
        reject(new Error(
          `file chooser did not open within 15s (clicked at ${btnCoords.x},${btnCoords.y} btn ${btnCoords.w}x${btnCoords.h})`,
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
      if ('error' in result) return { ok: false, error: result.error };
      saved.push(result);
    }

    /* ── Step 3: Intercept file chooser and provide files ── */
    const paths = saved.map((s) => s.path);
    const result = await uploadViaFileChooser(tabId, paths);

    /* ── Step 4: Delayed cleanup ──
       Flow needs time to READ the file from disk and UPLOAD it to their
       servers. Deleting immediately (in finally) would delete the file
       while Flow is still reading it → "Something went wrong".
       Clean up after 60 seconds in the background instead. */
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

function sendCDP(target: chrome.debugger.Debuggee, method: string, params?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}
