/* ============================================================
   Lightbox — full-size viewer for a node's image or video.

   Portaled to document.body: React Flow applies a CSS transform to every
   node, and position:fixed inside a transformed ancestor is positioned
   against that ancestor rather than the viewport, so an in-node overlay
   would be clipped and mis-scaled at anything but 100% zoom.
   ============================================================ */

import { createPortal } from 'react-dom';
import { useEffect } from 'react';

interface Props {
  src: string;
  kind: 'image' | 'video';
  alt?: string;
  onClose: () => void;
}

export function Lightbox({ src, kind, alt, onClose }: Props) {
  // Escape to close, and stop the canvas from scrolling behind the overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div className="studio-lightbox" onClick={onClose} role="dialog" aria-modal="true">
      {kind === 'video' ? (
        <video
          src={src}
          controls
          autoPlay
          loop
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <img src={src} alt={alt || 'Full size preview'} onClick={(e) => e.stopPropagation()} />
      )}
      <button className="studio-lightbox__close" onClick={onClose} aria-label="Close">×</button>
    </div>,
    document.body
  );
}
