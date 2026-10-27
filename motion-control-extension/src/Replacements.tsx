import { useRef, useState } from 'react';
import Icon from './Icon';
import { targetsKey, type MotionData } from './model';
import { MAX_DESCRIPTION, replacementLimit, type MotionReplacement, type MotionTarget } from '../../studio-extension/src/studio/ask/motionTargets';

/* "Same videos, we want to change 2 characters, or 1 character and the item."
   The Replace people & items list: the analysis engine names the people and
   items it sees, and each one the user picks gets a new image, words, or both
   ("SAMTAMIS WE WAN TO ADD PROMPT NOT IMAGE") — see motionTargets.ts. */

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

async function readImage(file: File): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');
  const value = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The image is damaged or unsupported.'));
    image.src = value;
  });
  return value;
}

const example = (target: MotionTarget, withImage: boolean) => withImage
  ? 'Optional: what to change, e.g. wearing a red dress'
  : target.kind === 'person' ? 'Who it becomes, e.g. an old wizard with a long beard' : 'What it becomes, e.g. a steaming bowl of ramen';

export default function Replacements({ data, patch, locked, scanning, onScan, onError }: {
  data: MotionData;
  patch: (values: Partial<MotionData>) => void;
  locked: boolean;
  scanning: boolean;
  onScan: () => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pickingFor, setPickingFor] = useState<MotionTarget | null>(null);
  const [describing, setDescribing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const chosen = data.motionReplacements || [];
  const limit = replacementLimit(!!data.placeImage, data.motionContinuity === true);
  const images = chosen.filter(r => r.image);
  const current = !!data.motionTargetList?.length && data.motionTargetsFor === targetsKey(data);
  const stale = !!data.motionTargetList?.length && !current;
  const full = images.length >= limit;

  /* Upsert one target's replacement; one with neither image nor words is dropped. */
  const save = (target: MotionTarget, values: Partial<MotionReplacement>) => {
    const at = chosen.findIndex(r => r.targetId === target.id);
    const base: MotionReplacement = at >= 0 ? chosen[at] : { targetId: target.id, kind: target.kind, label: target.label };
    const next: MotionReplacement = { ...base, ...values };
    if (!next.image) delete next.image;
    if (!next.text) delete next.text;
    const keep = !!(next.image || next.text);
    patch({ motionReplacements: at >= 0
      ? (keep ? chosen.map((r, i) => (i === at ? next : r)) : chosen.filter((_, i) => i !== at))
      : (keep ? [...chosen, next] : chosen) });
  };

  const pick = (target: MotionTarget) => {
    if (locked) return;
    setPickingFor(target);
    input.current?.click();
  };
  const onFile = async (file: File | undefined) => {
    const target = pickingFor;
    setPickingFor(null);
    if (input.current) input.current.value = '';
    if (!file || !target) return;
    try { save(target, { image: await readImage(file), name: file.name }); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  const describe = (target: MotionTarget, rep?: MotionReplacement) => {
    if (locked) return;
    setDescribing(target.id);
    setDraft(rep?.text || '');
  };
  const finish = (target: MotionTarget) => {
    save(target, { text: draft.replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION) });
    setDescribing(null);
  };
  const remove = (targetId: string) => patch({ motionReplacements: chosen.filter(r => r.targetId !== targetId) });

  return <div className="replace" aria-labelledby="replace-title">
    <div className="replace__head">
      <div><h3 id="replace-title">Replace specific people &amp; items</h3>
        <small>Find who and what is in the video, then give each one you want changed a new image, a few words, or both. Everything else stays as it is.</small></div>
      <button type="button" className="btn btn--secondary btn--sm" disabled={locked || scanning || !data.sourceKey} onClick={onScan}>
        <Icon name="sparkle" />{scanning ? 'Finding…' : current ? 'Find again' : 'Find people & items'}</button>
    </div>
    {!data.sourceKey && <p className="hint"><Icon name="info" />Add the motion video first.</p>}
    {stale && <p className="hint"><Icon name="info" />The video or trim changed since the last scan. Find again to update the list.</p>}
    {current && <>
      <ul className="replace__list">
        {data.motionTargetList!.map(target => {
          const rep = chosen.find(r => r.targetId === target.id);
          const n = rep?.image ? images.indexOf(rep) + 1 : 0;
          const editing = describing === target.id;
          return <li key={target.id} className={`replace__row${rep ? ' is-chosen' : ''}`}>
            <Icon name={target.kind === 'person' ? 'user' : 'image'} />
            <span className="replace__label"><strong>{target.label}</strong>
              <small>{target.kind === 'person' ? 'Person' : 'Item'}{target.when ? ` · ${target.when}` : ''}</small></span>
            {rep?.image && <span className="replace__chosen">
              <img src={rep.image} alt={`Replacement for ${target.label}`} />
              <span className="badge">Image {n}</span>
            </span>}
            {rep?.text && !editing && <p className="replace__text">“{rep.text}”</p>}
            {editing
              ? <form className="replace__describe" onSubmit={e => { e.preventDefault(); finish(target); }}>
                  <label className="visually-hidden" htmlFor={`describe-${target.id}`}>Describe the replacement for {target.label}</label>
                  <textarea id={`describe-${target.id}`} rows={2} maxLength={MAX_DESCRIPTION} autoFocus value={draft}
                    placeholder={example(target, !!rep?.image)} onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(target); }
                      if (e.key === 'Escape') setDescribing(null);
                    }} />
                  <span className="replace__buttons">
                    <button type="submit" className="btn btn--secondary btn--sm">Done</button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDescribing(null)}>Cancel</button>
                  </span>
                </form>
              : <span className="replace__buttons">
                  <button type="button" className="btn btn--secondary btn--sm" disabled={locked || (!rep?.image && full)}
                    title={!rep?.image && full ? 'All image slots are used. Describe it in words instead.' : undefined}
                    onClick={() => pick(target)}><Icon name="image" />{rep?.image ? 'Change image' : 'Image…'}</button>
                  <button type="button" className="btn btn--secondary btn--sm" disabled={locked} onClick={() => describe(target, rep)}>
                    <Icon name="sparkle" />{rep?.text ? 'Edit words' : rep?.image ? 'Add words' : 'Describe…'}</button>
                  {rep && <button type="button" className="icon-btn" disabled={locked} aria-label={`Keep ${target.label} as in the video`} onClick={() => remove(target.id)}><Icon name="close" /></button>}
                </span>}
          </li>;
        })}
      </ul>
      <p className="hint"><Icon name="info" />{chosen.length} {chosen.length === 1 ? 'change' : 'changes'} · {images.length} of {limit} images used{full ? ' — describe the rest in words' : ''}.</p>
    </>}
    <input ref={input} type="file" accept={IMAGE_TYPES.join(',')} hidden onChange={e => void onFile(e.target.files?.[0])} />
  </div>;
}
