import { OMNI_MAX_SEC } from '../../studio-extension/src/studio/clip/omniChunks';
import { planMotionVideo, preciseSeconds, suggestedTrim, trimProblem, type MotionRange } from '../../studio-extension/src/studio/ask/motionRange';
import Icon from './Icon';

export default function VideoRange({ duration, range, disabled, onChange, onPreview }: {
  duration: number; range: MotionRange; disabled: boolean; onChange: (range: MotionRange) => void; onPreview?: () => void;
}) {
  const trimming = range.motionVideoMode === 'trim';
  const problem = trimProblem(duration, range);
  const fullPieces = Math.ceil(duration / OMNI_MAX_SEC);
  const start = range.motionTrimStart ?? 0, end = range.motionTrimEnd ?? 0;
  const chunks = problem ? [] : planMotionVideo(duration, range);
  const selectedClips = chunks.length;
  const suggestion = suggestedTrim(duration);
  const quickLength = suggestion.motionTrimEnd! - suggestion.motionTrimStart!;
  const percent = (t: number) => Math.max(0, Math.min(100, t / duration * 100));
  const gap = Math.min(1, Math.floor(duration * 1000) / 1000);
  const savedClips = fullPieces - selectedClips;
  return <div className="video-range" id="video-range">
    <fieldset className="video-range__choices" disabled={disabled}>
      <legend className="visually-hidden">Video length</legend>
      <label className={!trimming ? 'is-selected' : ''}>
        <input type="radio" name="video-length" checked={!trimming} onChange={() => onChange({ motionVideoMode: 'full' })} />
        <span><strong>Keep full video</strong><small>{fullPieces === 1 ? '1 clip · no split' : `${fullPieces} separate clips`}</small></span>
      </label>
      <label className={trimming ? 'is-selected' : ''}>
        <input type="radio" name="video-length" checked={trimming} onChange={() => onChange({ ...suggestedTrim(duration), ...(range.motionTrimEnd != null ? { motionTrimStart: start, motionTrimEnd: end } : {}) })} />
        <span><strong>Trim start &amp; end</strong><small>Choose what to keep</small></span>
      </label>
    </fieldset>
    {trimming ? <div className="video-range__editor">
      <div className="video-range__head">
        <div><span className="video-range__eyebrow">YOUR SELECTION</span>
          <strong className="video-range__duration">{problem ? 'Adjust range' : preciseSeconds(end - start)}<span> / {preciseSeconds(duration)}</span></strong></div>
        <div className="video-range__outcome"><strong><Icon name="video" />{problem ? '—' : selectedClips} {selectedClips === 1 ? 'clip' : 'clips'}</strong>
          {!problem && savedClips > 0 && <small>{savedClips} fewer to generate</small>}</div>
      </div>
      <div className={`trim-timeline ${problem ? 'is-invalid' : ''}`}>
        <div className="trim-timeline__track" aria-hidden="true">
          {!problem && <div className="trim-timeline__kept" style={{ left: `${percent(start)}%`, width: `${percent(end) - percent(start)}%` }}>
            {chunks.length > 12 ? <span>{selectedClips} clips</span> : chunks.map(c => <span key={c.index} style={{ flex: c.seconds }} title={`Clip ${c.index}: ${preciseSeconds(c.seconds)}`}>{selectedClips <= 6 ? String(c.index).padStart(2, '0') : ''}</span>)}
          </div>}
        </div>
        {(['start', 'end'] as const).map(point => <input key={point} className={`trim-timeline__handle trim-timeline__handle--${point}`}
          type="range" aria-label={`Trim ${point} position`} aria-valuetext={preciseSeconds(point === 'start' ? start : end)} aria-describedby="trim-summary"
          min={0} max={duration} step={0.001} value={point === 'start' ? start : end} disabled={disabled}
          onChange={e => onChange(point === 'start'
            ? { motionTrimStart: Math.max(0, Math.min(Number(e.target.value), end - gap)) }
            : { motionTrimEnd: Math.min(duration, Math.max(Number(e.target.value), start + gap)) })} />)}
      </div>
      <div className="trim-timeline__scale" aria-hidden="true"><span>0s</span><span>Drag edges to trim</span><span>{preciseSeconds(duration)}</span></div>
      <div className="video-range__points">
        {(['start', 'end'] as const).map(point => <div key={point} className="field">
          <label className="field__label" htmlFor={`trim-${point}`}>{point === 'start' ? 'Start' : 'End'} (seconds)</label>
          <input id={`trim-${point}`} type="number" min={0} max={duration} step={0.001} value={point === 'start' ? start : end}
            disabled={disabled} aria-invalid={!!problem} aria-describedby="trim-summary"
            onChange={e => onChange(point === 'start' ? { motionTrimStart: Number(e.target.value) } : { motionTrimEnd: Number(e.target.value) })} />
        </div>)}
      </div>
      <div className="video-range__presets">
        <span>Fit {preciseSeconds(quickLength)}</span>
        <div className="video-range__shortcuts" aria-label="Quick trim selections">
          {(['start', 'center', 'end'] as const).map((anchor, i) => {
            const preset = suggestedTrim(duration, anchor);
            const active = !problem && Math.abs(start - preset.motionTrimStart!) < 0.0005 && Math.abs(end - preset.motionTrimEnd!) < 0.0005;
            return <button type="button" disabled={disabled} key={anchor} aria-pressed={active}
              onClick={() => onChange(preset)}>{['Keep start', 'Keep middle', 'Keep end'][i]}</button>;
          })}
        </div>
      </div>
      <p id="trim-summary" className={problem ? 'field-error' : 'visually-hidden'} role={problem ? 'alert' : 'status'}>
        {problem || `${preciseSeconds(end - start)} selected · ${selectedClips} clip${selectedClips === 1 ? '' : 's'}. Removes ${preciseSeconds(start)} from the start and ${preciseSeconds(duration - end)} from the end.`}
      </p>
      <div className="video-range__footer">
        <button type="button" className="btn btn--secondary btn--sm" disabled={disabled || !!problem || !onPreview} onClick={onPreview}><Icon name="play" />Preview</button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={disabled || (start === 0 && end === duration)} onClick={() => onChange({ motionTrimStart: 0, motionTrimEnd: duration })}><Icon name="retry" />Reset trim</button>
      </div>
      <p className="video-range__note">Up to {OMNI_MAX_SEC}s per clip · original video unchanged</p>
    </div> : <p className="hint">{fullPieces > 1
      ? `The source is ${preciseSeconds(duration)}. Keep it all as ${fullPieces} clips (up to ${OMNI_MAX_SEC}s each), or trim the edges first.`
      : `${preciseSeconds(duration)} fits in one clip. No split needed.`}</p>}
  </div>;
}
