import { useState } from 'react';
import { useStudioStore } from '../store';
import { composeAskRequest, normalizeAskWritingOptions, AskWritingOptions, getAskPresets, findPreset, DEFAULT_PRESET_ID } from '../presets';
import { ASK_STARTERS } from '../presets/askStarters';

export function AskBriefEditor({ id, data, hasImage }: { id: string; data: any; hasImage: boolean }) {
  const update = useStudioStore((state) => state.updateNodeData);
  const running = useStudioStore((state) => state.isRunning);
  const source = useStudioStore((state) => {
    const edge = state.edges.find((e) => e.target === id && e.targetHandle === 'text');
    return edge ? state.nodes.find((node) => node.id === edge.source) : undefined;
  });
  const [copyStatus, setCopyStatus] = useState('');
  const [copiedDraft, setCopiedDraft] = useState('');
  const [presetSearch, setPresetSearch] = useState('');
  const sourceData = source?.data as any;
  const incoming = String(sourceData?.text || sourceData?.resultText || '');
  const options = normalizeAskWritingOptions(data.askWritingOptions);
  const activeCount = Object.values(options).filter(Boolean).length;
  const changeOption = (key: keyof AskWritingOptions, value: string) => update(id, {
    askWritingOptions: { ...data.askWritingOptions, [key]: value },
  });
  const draft = composeAskRequest(data.preset, incoming, hasImage, String(data.askBrief || ''), String(data.placePromptNotes || ''), options);
  const preset = findPreset(data.preset);
  return <div className="sn-ask__brief sn-field--wide">
    <label className="sn-ask__field">
      <span>What do you need?</span>
      <textarea className="nodrag nowheel" rows={4} value={data.askBrief || ''} disabled={running}
        placeholder="Ask for ideas, a script, a better prompt, or anything else…"
        onChange={(event) => update(id, { askBrief: event.target.value })} />
    </label>
    {!String(data.askBrief || '').trim() && preset.id === DEFAULT_PRESET_ID && <div className="sn-ask__starters nodrag" aria-label="Prompt starters">
      {ASK_STARTERS.map((starter) => <button type="button" key={starter.label} disabled={running}
        title="Fill the prompt — does not run AI" onClick={() => update(id, { askBrief: starter.prompt })}>{starter.label}</button>)}
    </div>}
    <p className="sn-ask__hint">{source ? 'Uses connected text. ' : ''}{hasImage ? 'Uses connected image. ' : ''}{data.resultText ? 'Run again to update your result.' : 'Use Run workflow when ready.'}</p>
    <details className="sn-ask__preview nodrag nowheel">
      <summary>Advanced <span>{[preset.id !== DEFAULT_PRESET_ID && preset.name, activeCount > 0 && `${activeCount} preferences`].filter(Boolean).join(' · ')}</span></summary>
      <div className="sn-ask__advanced-body">
      <label className="sn-ask__field"><span>Find a preset</span>
        <input className="sn-bar__sel" type="search" value={presetSearch} placeholder="Search presets…" onChange={(event) => setPresetSearch(event.target.value)} />
      </label>
      <label className="sn-ask__field"><span>Preset</span>
        <select className="sn-bar__sel" disabled={running} value={preset.id} onChange={(event) => update(id, { preset: event.target.value })}>
          {getAskPresets().filter((item) => item.id === preset.id || `${item.name} ${item.hint}`.toLowerCase().includes(presetSearch.toLowerCase())).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <p className="sn-ask__hint">{preset.hint}</p>
      {preset.id === 'place_environment' && <label className="sn-ask__field"><span>Place notes (optional)</span>
        <textarea rows={3} disabled={running} value={data.placePromptNotes || ''} placeholder="Location, lighting, camera…" onChange={(event) => update(id, { placePromptNotes: event.target.value })} />
      </label>}
      <fieldset className="sn-ask__options" disabled={running}>
        <legend className="sn-ask__legend">Writing preferences</legend>
        <label className="sn-ask__field"><span>Detail level</span>
          <select value={options.detail} onChange={(event) => changeOption('detail', event.target.value)}>
            <option value="">Preset default</option><option value="concise">Concise & focused</option><option value="detailed">Detailed & specific</option>
          </select>
        </label>
        <label className="sn-ask__field"><span>Output language</span>
          <input maxLength={80} value={typeof data.askWritingOptions?.language === 'string' ? data.askWritingOptions.language : ''} placeholder="Auto / follow brief" onChange={(event) => changeOption('language', event.target.value)} />
        </label>
        <label className="sn-ask__field sn-ask__option-wide"><span>Writing style</span>
          <input maxLength={160} value={typeof data.askWritingOptions?.tone === 'string' ? data.askWritingOptions.tone : ''} placeholder="e.g. cinematic, playful, natural" onChange={(event) => changeOption('tone', event.target.value)} />
        </label>
        {(['include', 'avoid'] as const).map((key) => <label key={key} className="sn-ask__field sn-ask__option-wide">
          <span>{key === 'include' ? 'Must include' : 'Avoid'}</span>
          <textarea rows={2} maxLength={2000} value={typeof data.askWritingOptions?.[key] === 'string' ? data.askWritingOptions[key] : ''}
            placeholder={key === 'include' ? 'e.g. fixed camera, same room layout, warm light' : 'e.g. camera shake, extra people, text overlays'}
            onChange={(event) => changeOption(key, event.target.value)} />
        </label>)}
        <button type="button" disabled={!activeCount} onClick={() => update(id, { askWritingOptions: {} })}>Reset writing preferences</button>
      </fieldset>
    <details className="sn-ask__preview nodrag nowheel">
      <summary>Preview instructions <span>{draft.length.toLocaleString()} characters</span></summary>
      <p className="sn-ask__hint">Draft based on currently saved inputs. Upstream output and available references may change when the workflow runs.</p>
      <pre>{draft || 'Add a brief or choose a preset.'}</pre>
      <button type="button" disabled={!draft} onClick={async () => {
        setCopiedDraft(draft);
        try { await navigator.clipboard.writeText(draft); setCopyStatus('Copied'); }
        catch { setCopyStatus('Could not copy. Select the preview text to copy it.'); }
      }}>Copy instructions</button>
      <span role="status">{copiedDraft === draft ? copyStatus : ''}</span>
    </details>
      </div>
    </details>
  </div>;
}
