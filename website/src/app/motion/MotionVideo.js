'use client';

/* The Motion demo video. A thumbnail and a play button until it is pressed:
   YouTube's player is ~1MB of script and a set of cookies, and neither
   should load for every visitor who only scrolls past. Pressed, it swaps in
   the youtube-nocookie player, already playing. */

import { useState } from "react";

export default function MotionVideo({ id, title }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="motion-video">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button type="button" className="motion-video-poster" onClick={() => setPlaying(true)} aria-label={`Play video: ${title}`}>
          <img src={`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`} alt="" loading="lazy" width={1280} height={720} />
          <span className="motion-video-play" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
          </span>
        </button>
      )}
    </div>
  );
}
