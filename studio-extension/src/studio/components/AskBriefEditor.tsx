import { useState } from 'react';
import { useStudioStore } from '../store';
import { composeAskRequest } from '../presets';

export function AskBriefEditor({ id, data, hasImage }: { id: string; data: any; hasImage: boolean }) {
  const update = useStudioStore((state) => state.updateNodeData);
  const running = useStudioStore((state) => state.isRunning);
  const source = useStudioStore((state) => {
    const edge = state.edges.find((e) => e.target === id && e.targetHandle === 'text');
    return edge ? state.nodes.find((node) => node.id === edge.source) : undefined;
  });
  const [copyStatus, setCopyStatus] = useState('');
  const sourceData = source?.data as any;
  const incoming = String(sourceData?.text || sourceData?.resultText || '');
  const draft = composeAskRequest(data.preset, incoming, hasImage, String(data.askBrief || ''), String(data.placePromptNotes || ''));
  return <div className="sn-ask__brief sn-field--wide">
    <label className="sn-ask__field">
      <span>Your brief</span>
      <textarea className="nodrag nowheel" rows={4} value={data.askBrief || ''} disabled={running}
        placeholder="Describe what you want. Include the subject, style, framing, lighting, and anything to avoid."
        onChange={(event) => update(id, { askBrief: event.target.value })} />
    </label>
    <p className="sn-ask__hint">{source ? 'Added to your connected T input.' : 'Write here directly—no Prompt node required.'} {hasImage ? 'An image is connected; its availability is checked at run time.' : 'Optional: connect an image to I for reference-based prompting.'}</p>
    <details className="sn-ask__preview nodrag nowheel">
      <summary>Preview instructions <span>{draft.length.toLocaleString()} characters</span></summary>
      <p className="sn-ask__hint">Draft based on currently saved inputs. Upstream output and available references may change when the workflow runs.</p>
      <pre>{draft || 'Add a brief or choose a preset.'}</pre>
      <button type="button" disabled={!draft} onClick={async () => {
        try { await navigator.clipboard.writeText(draft); setCopyStatus('Copied'); }
        catch { setCopyStatus('Could not copy. Select the preview text to copy it.'); }
      }}>Copy instructions</button>
      <span role="status">{copyStatus}</span>
    </details>
  </div>;
}
