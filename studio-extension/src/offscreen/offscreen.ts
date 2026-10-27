/* ============================================================
   Offscreen Document — Media processing in an invisible DOM.
   
   Service Workers cannot access <canvas>, <video>, VideoDecoder,
   or any of the WebCodecs APIs that video cutting depends on.
   Chrome's Offscreen Document API (chrome.offscreen) creates
   this invisible page on-demand for exactly that.
   
   The service worker sends processing requests via
   chrome.runtime.sendMessage; this document performs the work
   and responds with the result.
   ============================================================ */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_CUT_VIDEO') {
    handleCutVideo(message).then(sendResponse);
    return true; // Keep message channel open for async response
  }
  
  if (message.type === 'OFFSCREEN_DECODE_FRAME') {
    handleDecodeFrame(message).then(sendResponse);
    return true; // Keep message channel open for async response
  }
  
  if (message.type === 'OFFSCREEN_PING') {
    console.log('[Offscreen] Ping received');
    sendResponse({ pong: true });
    return false; // Sync response
  }
});

async function handleCutVideo(message: any) {
  const { videoData, startSec, endSec, label } = message;
  console.log(`[Offscreen] OFFSCREEN_CUT_VIDEO received for label: ${label}, start: ${startSec}, end: ${endSec}`);
  
  // TODO: Implement actual mediabunny integration for video cutting.
  // For v1.5.0, this is just a scaffold that returns the input video.
  console.warn('[Offscreen] Video cutting not fully implemented yet. Returning passthrough.');
  
  return { resultData: videoData };
}

async function handleDecodeFrame(message: any) {
  const { videoData, timestampSec } = message;
  console.log(`[Offscreen] OFFSCREEN_DECODE_FRAME received for timestamp: ${timestampSec}`);
  
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.src = videoData;
    
    // Set a flag to track if we've successfully sought
    let hasSeeked = false;

    video.onloadedmetadata = () => {
        video.currentTime = timestampSec;
    };

    video.onseeked = () => {
      if (hasSeeked) return;
      hasSeeked = true;

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frameData = canvas.toDataURL('image/png');
        console.log('[Offscreen] Frame decoded successfully');
        resolve({ frameData });
      } else {
        console.error('[Offscreen] Failed to get canvas context');
        resolve({ frameData: null });
      }
    };
    video.onerror = (e) => {
      console.error('[Offscreen] Error loading video for frame decoding', e);
      resolve({ frameData: null });
    };
  });
}
