import { useState } from 'react';
import { Icon } from './Icon';

/** Mount keyed by the media URLs so a new result clears playback errors. */
export function MotionPreview({ videoUrl, posterUrl, index }: { videoUrl?: string; posterUrl?: string; index: number }) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const playable = !!videoUrl && !videoFailed;
  return (
    <div className="sn-motion__preview nodrag nowheel">
      <div className="sn-motion__viewport">
        {playable ? (
          <video key={attempt} className="sn-motion__media" src={videoUrl} poster={posterFailed ? undefined : posterUrl}
            controls preload="metadata" playsInline aria-label={`Play clip ${index}`}
            onError={() => setVideoFailed(true)} />
        ) : posterUrl && !posterFailed ? (
          <img className="sn-motion__media" src={posterUrl} alt={`Preview frame for clip ${index}`}
            onError={() => setPosterFailed(true)} />
        ) : (
          <div className="sn-motion__no-preview"><Icon name="clip" /><span>Preview unavailable</span></div>
        )}
      </div>
      {!playable && <div className="sn-motion__preview-note" role="status">
        <strong>{videoFailed ? 'Video could not be loaded' : 'Video preview not received'}</strong>
        <span>Generation completed. Check the clip in Flow; you do not need to regenerate it to resolve a preview issue.</span>
        {videoFailed && <button type="button" className="sn-motion__reload" onClick={() => {
          setVideoFailed(false); setAttempt((n) => n + 1);
        }}>Reload preview</button>}
      </div>}
    </div>
  );
}
