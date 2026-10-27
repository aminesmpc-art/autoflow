/* ============================================================
   Offscreen Manager — Creates and destroys the offscreen
   document on-demand for media processing.
   
   Only one offscreen document can exist at a time per extension.
   This manager ensures it's created before sending work and
   cleaned up after to free memory.
   ============================================================ */

export async function ensureOffscreen(): Promise<void> {
  try {
    const hasDocument = await chrome.offscreen.hasDocument();
    if (!hasDocument) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.DOM_PARSER],
        justification: 'Video processing for workflow Clip and Cut nodes'
      });
      console.log('[OffscreenManager] Offscreen document created.');
    }
  } catch (error) {
    console.warn('[OffscreenManager] Error ensuring offscreen document:', error);
  }
}

export async function closeOffscreen(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
    console.log('[OffscreenManager] Offscreen document closed.');
  } catch (error) {
    console.warn('[OffscreenManager] Error closing offscreen document:', error);
  }
}

export async function requestCutVideo(videoData: string, startSec: number, endSec: number, label: string): Promise<string> {
  await ensureOffscreen();
  
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'OFFSCREEN_CUT_VIDEO', videoData, startSec, endSec, label },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.resultData !== undefined) {
          resolve(response.resultData);
        } else {
          reject(new Error('Invalid response from offscreen document'));
        }
      }
    );
  });
}

export async function requestDecodeFrame(videoData: string, timestampSec: number): Promise<string> {
  await ensureOffscreen();
  
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'OFFSCREEN_DECODE_FRAME', videoData, timestampSec },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.frameData !== undefined) {
          resolve(response.frameData);
        } else {
          reject(new Error('Invalid response from offscreen document'));
        }
      }
    );
  });
}

export async function pingOffscreen(): Promise<boolean> {
  await ensureOffscreen();
  
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_PING' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(false);
      } else {
        resolve(response?.pong === true);
      }
    });
  });
}
