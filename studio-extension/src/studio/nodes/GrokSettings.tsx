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
/** Its aspect-ratio menu, as a clip offers it. */
const RATIOS = ['9:16', '16:9', '1:1'];

/* ── Stills ──
   Imagine's toolbar carries three controls for an image, and until now a Grok
   image node rendered none of them: GenerateNode gated this whole component on
   `isVideo`, so the one platform with the most settings showed the fewest.
   Every value below is read off the live menus. */

/** The full aspect-ratio menu — a still gets five, not the clip's three. */
const IMAGE_RATIOS = ['2:3', '3:2', '1:1', '9:16', '16:9'];
/** button[aria-label="Image Count"] — how many renders per press. */
const COUNTS = ['Auto', '2', '4', '8', '12'];
/** Its speed/quality radio pair. Labelled "Quality (2.0)" on the page; the
    adapter matches on the leading word, so the version can move without
    breaking the match. */
const QUALITIES = ['Speed', 'Quality'];

interface Props {
  nodeData: any;
  set: (field: string, value: unknown) => void;
  /** Stills and clips share almost no controls, so the split is explicit. */
  isVideo: boolean;
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

export function GrokSettings({ nodeData, set, isVideo }: Props) {
  /* No Extend here. It used to be a mode on this node, which hid what it is:
     a second generation, with its own prompt, its own result and a chain that
     can only reach 30 seconds. It is the Extend node now — see ExtendNode. */
  if (!isVideo) {
    return (
      <>
        <Segmented
          label="Ratio"
          title="Aspect ratio"
          options={IMAGE_RATIOS}
          value={nodeData.aspectRatio || '1:1'}
          onPick={(v) => set('aspectRatio', v)}
        />
        <Segmented
          label="Count"
          title="How many images Imagine renders per press"
          options={COUNTS}
          value={nodeData.imageCount || 'Auto'}
          onPick={(v) => set('imageCount', v)}
        />
        <Segmented
          label="Speed"
          title="Imagine's speed/quality trade-off"
          options={QUALITIES}
          value={nodeData.quality || 'Quality'}
          onPick={(v) => set('quality', v)}
        />
      </>
    );
  }

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
