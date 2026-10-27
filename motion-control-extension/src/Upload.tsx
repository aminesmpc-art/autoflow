import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

/** Open an upload's file chooser by its id — the checklist's one-click fixes use it. */
export function pickFile(id: string): void {
  document.querySelector<HTMLInputElement>(`#${id} input[type="file"]`)?.click();
}

/**
 * A file input whose drop area IS the button.
 *
 * `label` names the hidden input and the preview image, so it stays the
 * accessible name tests and screen readers hold on to. `cta` is what the drop
 * area says — shorter, for a 140px tile.
 */
export default function Upload({ id, label, cta, hint, accept, icon, preview, name, meta, variant = 'stage', disabled, onFile, onRemove, previewRange }: {
  id: string; label: string; cta?: string; hint: string; accept: string; icon: string;
  preview?: string; name?: string; meta?: string; variant?: 'stage' | 'tile';
  disabled: boolean; onFile: (file: File) => Promise<void>; onRemove?: () => void;
  previewRange?: { start: number; end: number };
}) {
  const input = useRef<HTMLInputElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!player.current) return;
    player.current.pause();
    if (previewRange) player.current.currentTime = previewRange.start;
  }, [previewRange?.start, previewRange?.end]);
  const [drag, setDrag] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const take = async (file?: File) => {
    if (!file || disabled || busy) return;
    setError(''); setBusy(true);
    try { await onFile(file); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const choose = () => input.current?.click();
  const video = accept.startsWith('video');
  return <div id={id} className={['upload', `upload--${variant}`, drag && 'is-drag', preview && 'has-preview', expanded && 'is-expanded'].filter(Boolean).join(' ')}
    onDragOver={e => { e.preventDefault(); if (!disabled) setDrag(true); }}
    /* Leaving a child is not leaving the area; only a real exit clears it. */
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false); }}
    onDrop={e => { e.preventDefault(); setDrag(false); void take(e.dataTransfer.files[0]); }}>
    <input ref={input} hidden type="file" accept={accept} aria-label={label} tabIndex={-1} disabled={disabled || busy}
      onChange={e => { void take(e.target.files?.[0]); e.target.value = ''; }} />
    {preview ? <>
      <div className="upload__preview">{video
        ? <video ref={player} src={preview} controls playsInline preload="metadata" aria-label="Source motion preview"
          onSeeked={e => { const v = e.currentTarget; if (previewRange && v.currentTime < previewRange.start) v.currentTime = previewRange.start; else if (previewRange && v.currentTime > previewRange.end) v.currentTime = previewRange.end; }}
          onPlay={e => { const v = e.currentTarget; if (previewRange && (v.currentTime < previewRange.start || v.currentTime >= previewRange.end)) v.currentTime = previewRange.start; }}
          onTimeUpdate={e => { const v = e.currentTarget; if (previewRange && !v.paused && v.currentTime >= previewRange.end) { v.pause(); v.currentTime = previewRange.end; } }} />
        : <img src={preview} alt={label} />}</div>
      <div className="upload__bar">
        <span className="upload__name" title={name}>{name}</span>
        {meta && <span className="upload__meta">{meta}</span>}
        {video && <button type="button" className="icon-btn icon-btn--sm" aria-label={expanded ? 'Compact video preview' : 'Expand video preview'} aria-pressed={expanded} title={expanded ? 'Compact preview' : 'Expand preview'} onClick={() => setExpanded(!expanded)}><Icon name={expanded ? 'minimize' : 'expand'} /></button>}
        {variant === 'tile'
          ? <button type="button" className="icon-btn icon-btn--sm" disabled={disabled || busy} onClick={choose} aria-label={`Replace ${label}`} title="Replace"><Icon name="retry" /></button>
          : <button type="button" className="btn btn--secondary btn--sm" disabled={disabled || busy} onClick={choose}><Icon name="retry" />{busy ? 'Reading…' : 'Replace'}</button>}
        {onRemove && <button type="button" className="icon-btn icon-btn--sm" disabled={disabled} onClick={onRemove} aria-label={`Remove ${label}`} title="Remove"><Icon name="close" /></button>}
      </div>
    </> : <button type="button" className="upload__drop" disabled={disabled || busy} onClick={choose}>
      <span className="upload__symbol"><Icon name={icon} /></span>
      <strong>{busy ? 'Reading…' : cta || label}</strong>
      <span>{hint}</span>
    </button>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}
