import { createRoot } from 'react-dom/client';
import App from './App';
import { hydrate } from './clip/sourceStore';

const container = document.getElementById('root');

/**
 * Put back what previous sessions produced, THEN render.
 *
 * Before this, reopening a finished workflow showed eight Cut nodes all saying
 * "the video is not loaded" — the clips had been made, and were sitting in a
 * Map belonging to a tab that had since been closed.
 *
 * Awaited rather than left to a useEffect so a node mounts with its clip
 * already in hand, instead of mounting broken and repairing itself a frame
 * later. It is a handful of IndexedDB reads and no blob is decoded here.
 *
 * Rendering happens even if it fails. A vault that will not open means the old
 * behaviour — drop the file in again — which is a worse day, not a broken one,
 * and refusing to open Studio over it would be far worse than both.
 */
function start(): void {
  if (!container) return;
  createRoot(container).render(<App />);
}

hydrate()
  .then(({ sources, media }) => {
    if (sources || media) {
      console.log(`[AutoFlow] Restored ${media} clip(s) and ${sources} video(s) from last time`);
    }
  })
  .catch((error) => {
    console.warn('[AutoFlow] Could not restore previous clips:', error);
  })
  .finally(start);
