/* ============================================================
   SimpleView — the open workflow as a form.

   Fill in the inputs, press Run, watch the results arrive. The graph is
   still there underneath, mounted and running exactly as it does on the
   canvas: this edits the same node data the Prompt and Image nodes edit and
   presses the same Run, so nothing about a run depends on which view
   started it. What it shows is decided in simple/simpleForm.ts.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudioStore } from '../store';
import { simpleInputs, simpleResults, type SimpleInput, type SimpleResult } from '../simple/simpleForm';
import { isRunnableType } from '../templates/validate';
import { getMedia } from '../clip/sourceStore';
import { Lightbox } from './Lightbox';
import { Icon } from './Icon';

interface Props {
  canRun: boolean;
  elapsed: string;
  onRun: () => void;
  onPause: () => void;
  onStop: () => void;
  onRetry: (ids?: string[]) => void;
  /** Switch to the canvas with this node in view. */
  onShow: (nodeId: string) => void;
}

const MAX_PROMPT = 20000;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* The shape a result will come out in, so a waiting card already has it. A
   Flow clip has only two (anything not portrait is made widescreen). */
function ratioOf(data: any, kind: SimpleResult['kind']): string {
  if (kind === 'text') return 'auto';
  const r = String(data?.aspectRatio || '9:16');
  const shape = kind === 'video' && (data?.platform || 'flow') === 'flow'
    ? (r === '9:16' || r === '3:4' ? '9:16' : '16:9')
    : r;
  const [w, h] = shape.split(':');
  return `${w || 9} / ${h || 16}`;
}

export default function SimpleView({ canRun, elapsed, onRun, onPause, onStop, onRetry, onShow }: Props) {
  const nodes = useStudioStore((s) => s.nodes);
  const edges = useStudioStore((s) => s.edges);
  const workflowName = useStudioStore((s) => s.workflow.name);
  const isRunning = useStudioStore((s) => s.isRunning);
  const isPaused = useStudioStore((s) => s.isPaused);
  const runProgress = useStudioStore((s) => s.runProgress);
  const currentNodeId = useStudioStore((s) => s.currentNodeId);
  const setWorkMode = useStudioStore((s) => s.setWorkMode);

  const inputs = useMemo(() => simpleInputs(nodes, edges), [nodes, edges]);
  const results = useMemo(() => simpleResults(nodes, edges), [nodes, edges]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const dataOf = (id: string) => (byId.get(id)?.data as any) || {};

  const prompts = inputs.filter((i) => i.kind === 'prompt');
  const images = inputs.filter((i) => i.kind === 'image');
  const emptyImages = images.filter((i) => !dataOf(i.id).imageData).length;
  const ready = results.filter((r) => dataOf(r.id).status === 'done').length;
  const makes = (['image', 'video', 'text'] as const)
    .map((k) => [k, results.filter((r) => r.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => plural(n, k === 'image' ? 'image' : k === 'video' ? 'clip' : 'written answer'));

  /* A step that failed but makes nothing you see here — a Director, a Chief
     — still stops what comes after it, so it is named in the run block. */
  const failedSteps = nodes.filter((n) => {
    const d = n.data as any;
    return isRunnableType(d?.type) && d?.status === 'error' && !results.some((r) => r.id === n.id);
  });
  const failedCount = nodes.filter((n) => isRunnableType((n.data as any)?.type) && (n.data as any)?.status === 'error').length;
  const runningLabel = String((byId.get(currentNodeId || '')?.data as any)?.label || 'Starting…');

  return (
    <div className="studio-simple" role="region" aria-label="Simple view">
      <div className="studio-simple__col">
        <header className="studio-simple__head">
          <h1 className="studio-simple__title">{workflowName}</h1>
          <p className="studio-simple__lede">
            {inputs.length
              ? 'Fill in what this workflow starts from, then run it.'
              : 'Nothing to fill in — this workflow runs as it is.'}
            {' '}
            <button type="button" className="studio-simple__link" onClick={() => setWorkMode('canvas')}>
              See how it works on the canvas
            </button>
          </p>
        </header>

        {inputs.length > 0 && (
          <section className="studio-simple__section" aria-labelledby="simple-inputs">
            <h2 className="studio-simple__h2" id="simple-inputs">Your inputs</h2>
            {prompts.map((input) => <PromptField key={input.id} input={input} text={dataOf(input.id).text || ''} />)}
            {images.length > 0 && (
              <div className="studio-simple__images">
                {images.map((input) => (
                  <ImageField key={input.id} input={input} data={dataOf(input.id)} />
                ))}
              </div>
            )}
          </section>
        )}

        <section className="studio-simple__run" aria-live="polite">
          {isRunning ? (
            <>
              <span className={`studio-simple__pulse ${isPaused ? 'is-paused' : ''}`} aria-hidden="true" />
              <div className="studio-simple__status">
                <strong>{isPaused ? 'Paused' : 'Running'}: {runningLabel}</strong>
                <span>{runProgress.current} of {runProgress.total} steps · {elapsed}</span>
              </div>
              <button type="button" className="studio-simple__btn" onClick={onPause}>{isPaused ? 'Resume' : 'Pause'}</button>
              <button type="button" className="studio-simple__btn studio-simple__btn--stop" onClick={onStop}>Stop</button>
            </>
          ) : (
            <>
              <button type="button" className="studio-simple__go" onClick={onRun} disabled={!canRun}>
                <Icon name="play" /> Run
              </button>
              <div className="studio-simple__status">
                <strong>{makes.length ? `Makes ${makes.join(' and ')}` : 'Nothing to make yet'}</strong>
                {emptyImages > 0 && (
                  <span className="studio-simple__warn">
                    {emptyImages === 1 ? 'One image is still empty' : `${emptyImages} images are still empty`} — add
                    {emptyImages === 1 ? ' it' : ' them'} above, or the steps that use {emptyImages === 1 ? 'it' : 'them'} run without.
                  </span>
                )}
              </div>
              {failedCount > 0 && (
                <button type="button" className="studio-simple__btn" onClick={() => onRetry()}>
                  <Icon name="retry" /> Retry {failedCount} failed
                </button>
              )}
            </>
          )}
          {failedSteps.map((n) => (
            <p key={n.id} className="studio-simple__fail">
              <strong>{String((n.data as any)?.label || 'A step')} failed.</strong>{' '}
              {String((n.data as any)?.errorMessage || '')}{' '}
              <button type="button" className="studio-simple__link" onClick={() => onShow(n.id)}>Show it on the canvas</button>
            </p>
          ))}
        </section>

        {results.length > 0 && (
          <section className="studio-simple__section" aria-labelledby="simple-results">
            <h2 className="studio-simple__h2" id="simple-results">
              Results <span className="studio-simple__count">{ready} of {results.length} ready</span>
            </h2>
            <div className="studio-simple__grid">
              {results.map((r) => (
                <ResultCard key={r.id} result={r} data={dataOf(r.id)} onRetry={onRetry} onShow={onShow} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function PromptField({ input, text }: { input: SimpleInput; text: string }) {
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  /* As tall as what is in it, within reason: a one-line idea gets three
     rows, a template's 900-character brief gets room to be read. */
  const rows = Math.min(14, Math.max(3, text.split('\n').length + Math.ceil(text.length / 90)));
  return (
    <label className="studio-simple__field">
      <span className="studio-simple__field-head">
        <span className="studio-simple__label">{input.label}</span>
        {input.feeds.length > 0 && (
          <span className="studio-simple__feeds">Used by {input.feeds.slice(0, 3).join(', ')}{input.feeds.length > 3 ? ` and ${input.feeds.length - 3} more` : ''}</span>
        )}
      </span>
      <textarea
        className="studio-simple__text"
        value={text}
        rows={rows}
        maxLength={MAX_PROMPT}
        placeholder="Describe your character or scene…"
        onChange={(e) => updateNodeData(input.id, { text: e.target.value })}
      />
    </label>
  );
}

function ImageField({ input, data }: { input: SimpleInput; data: any }) {
  const updateNodeData = useStudioStore((s) => s.updateNodeData);
  const pick = useRef<HTMLInputElement>(null);
  /* The same write the Image node makes, so the node and the form agree. */
  const onFile = useCallback((file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateNodeData(input.id, {
      imageData: reader.result as string,
      imageName: data.imageName || file.name.replace(/\.[^.]+$/, ''),
    });
    reader.readAsDataURL(file);
  }, [input.id, data.imageName, updateNodeData]);
  const has = !!data.imageData;
  return (
    <div className={`studio-simple__image ${has ? '' : 'studio-simple__image--empty'}`}>
      <button type="button" className="studio-simple__image-pick" onClick={() => pick.current?.click()}
        aria-label={has ? `Change ${input.label}` : `Add ${input.label}`}>
        {has
          ? <img src={data.imageData} alt="" />
          : <span className="studio-simple__image-add"><Icon name="image" /> Add a photo</span>}
      </button>
      <span className="studio-simple__label">{input.label}</span>
      {input.feeds.length > 0 && <span className="studio-simple__feeds">Used by {input.feeds.slice(0, 2).join(', ')}{input.feeds.length > 2 ? ` +${input.feeds.length - 2}` : ''}</span>}
      <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

/* A Cut node's clip lives in the media store as a Blob, not as a URL on the
   node — the same object-URL dance the Cut node does, revoked on the way out. */
function useCutUrl(mediaKey: string, version: unknown): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const blob = mediaKey ? getMedia(mediaKey) : undefined;
    if (!blob) { setUrl(''); return undefined; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [mediaKey, version]);
  return url;
}

const STATE_WORD: Record<string, string> = { idle: 'Waiting', running: 'Making…', done: 'Ready', error: 'Failed' };

function ResultCard({ result, data, onRetry, onShow }: {
  result: SimpleResult; data: any; onRetry: (ids?: string[]) => void; onShow: (id: string) => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const cutUrl = useCutUrl(data.mediaKey || '', data.cutReport);
  const status: string = data.enabled === false ? 'skipped' : (data.status || 'idle');
  const video: string = data.previewVideoUrl || cutUrl;
  const still: string = data.previewUrl || '';
  const done = status === 'done';
  return (
    <article className={`studio-simple__result studio-simple__result--${status}`}>
      <div className="studio-simple__media" style={{ aspectRatio: ratioOf(data, result.kind) }}>
        {done && result.kind === 'text' && <div className="studio-simple__answer">{String(data.resultText || '')}</div>}
        {done && result.kind !== 'text' && video && (
          <video src={video} poster={still || undefined} controls muted loop playsInline preload="metadata" />
        )}
        {done && result.kind !== 'text' && !video && still && (
          <button type="button" className="studio-simple__zoom" onClick={() => setZoomed(true)} aria-label={`View ${result.label} full size`}>
            <img src={still} alt={result.label} />
          </button>
        )}
        {done && result.kind !== 'text' && !video && !still && <span className="studio-simple__state">Made — open the site's tab to see it</span>}
        {status === 'running' && (
          <span className="studio-simple__state">
            <span className="sn-spinner" aria-hidden="true" />
            {data.progress > 0 ? `${Math.round(data.progress)}%` : 'Starting'}
          </span>
        )}
        {status === 'error' && <span className="studio-simple__state studio-simple__state--bad" title={data.errorMessage}>{data.errorMessage || 'It failed without saying why.'}</span>}
        {status === 'idle' && <span className="studio-simple__state"><Icon name={result.kind === 'video' ? 'clip' : result.kind === 'text' ? 'chat' : 'image'} /></span>}
        {status === 'skipped' && <span className="studio-simple__state">Switched off on the canvas</span>}
      </div>
      <div className="studio-simple__foot">
        <span className="studio-simple__name" title={result.label}>{result.label}</span>
        <span className={`studio-simple__badge studio-simple__badge--${status}`}>{STATE_WORD[status] || 'Skipped'}</span>
        {status === 'error' && (
          <button type="button" className="studio-simple__icon" onClick={() => onRetry([result.id])} title="Make this one again" aria-label={`Retry ${result.label}`}>
            <Icon name="retry" />
          </button>
        )}
        {done && (video || still) && (
          <a className="studio-simple__icon" href={video || still} download={`${result.label}.${video ? 'mp4' : 'png'}`} title="Download" aria-label={`Download ${result.label}`}>
            <Icon name="import" />
          </a>
        )}
        <button type="button" className="studio-simple__icon" onClick={() => onShow(result.id)} title="Show on the canvas" aria-label={`Show ${result.label} on the canvas`}>
          <Icon name="nodes" />
        </button>
      </div>
      {zoomed && still && <Lightbox src={still} kind="image" alt={result.label} onClose={() => setZoomed(false)} />}
    </article>
  );
}
