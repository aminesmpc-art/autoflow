/* A dialog over the feed: Escape and the backdrop close it, focus starts inside. */

import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export default function Modal({ title, onClose, children, footer, wide }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    box.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="cf-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`cf-modal__box ${wide ? 'cf-modal__box--wide' : ''}`} role="dialog" aria-modal="true"
        aria-label={title} ref={box}>
        <div className="cf-modal__head">
          <h2>{title}</h2>
          <button className="cf-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="cf-modal__body">{children}</div>
        {footer && <div className="cf-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}
