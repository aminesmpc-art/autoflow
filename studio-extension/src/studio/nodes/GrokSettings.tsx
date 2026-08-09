/* ============================================================
   Grok Imagine's settings, on their own.

   Split out of GenerateNode because Flow and Imagine turned out to share
   almost nothing. Flow has a model list, Ingredients and Start/End frames;
   Imagine has a resolution, its own clip lengths, and Extend. Held together
   in one component they read as one node doing both jobs badly, and every
   control needed a platform test to decide whether it applied.

   The values are Imagine's own, read off its toolbar. None of them overlap
   Flow's, which is why they are listed here rather than shared: a merged list
   would offer 4s or 4:3, and Imagine has no button for either — the run would
   silently keep whatever was already set.
   ============================================================ */

/** Its duration radio group. */
const DURATIONS = ['6s', '10s', '15s'];
/** Its resolution radio group. */
const RESOLUTIONS = ['480p', '720p', '1080p'];
/** Its aspect-ratio menu. */
const RATIOS = ['9:16', '16:9', '1:1'];

interface Props {
  nodeData: any;
  set: (field: string, value: unknown) => void;
}

/** One row of segmented pills — the shape every Imagine control takes. */
function Segmented({
  label, title, options, value, onPick,
}: {
  label: string;
  title: string;
  options: readonly string[];
  value: string;
  onPick: (value: string) => void;
}) {
  return (
    <div className="sn-field sn-field--wide" title={title}>
      <span className="sn-field__label">{label}</span>
      <div className="sn-seg nodrag">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`sn-seg__btn ${value === option ? 'sn-seg__btn--on' : ''}`}
            onClick={() => onPick(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GrokSettings({ nodeData, set }: Props) {
  /* No Extend here. It used to be a mode on this node, which hid what it is:
     a second generation, with its own prompt, its own result and a chain that
     can only reach 30 seconds. It is the Extend node now — see ExtendNode. */
  return (
    <>
      <Segmented
        label="Length"
        title="Clip length"
        options={DURATIONS}
        value={nodeData.duration || '10s'}
        onPick={(v) => set('duration', v)}
      />
      <Segmented
        label="Resolution"
        title="Resolution"
        options={RESOLUTIONS}
        value={nodeData.resolution || '720p'}
        onPick={(v) => set('resolution', v)}
      />
      <Segmented
        label="Ratio"
        title="Aspect ratio"
        options={RATIOS}
        value={nodeData.aspectRatio || '9:16'}
        onPick={(v) => set('aspectRatio', v)}
      />
    </>
  );
}
