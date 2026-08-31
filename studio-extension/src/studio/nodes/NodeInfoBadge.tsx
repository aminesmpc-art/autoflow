/* ============================================================
   NodeInfo — the ⓘ tooltip that every node carries.

   A single component, not eight. Each node passes its type; this
   looks up the docs from nodeInfo.ts and renders a hover card.

   Positioned absolutely against the node wrapper, so it sits above
   the canvas without being clipped by the card's overflow rules.
   ============================================================ */

import { useState, useCallback, useRef, useEffect } from 'react';
import { getNodeDoc, type NodeDoc, type PortDoc } from './nodeInfo';

interface Props {
  /** The node's `data.type` — prompt, image, generate, etc. */
  type: string;
}

export function NodeInfoBadge({ type }: Props) {
  const doc = getNodeDoc(type);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  /* Close on outside click */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((v) => !v);
  }, []);

  if (!doc) return null;

  return (
    <div className="sn-info" ref={ref}>
      <button
        type="button"
        className={`sn-info__badge nodrag ${open ? 'sn-info__badge--open' : ''}`}
        onClick={toggle}
        title="What does this node do?"
        aria-label="Node documentation"
        aria-expanded={open}
      >
        ⓘ
      </button>

      {open && <InfoCard doc={doc} />}
    </div>
  );
}

function InfoCard({ doc }: { doc: NodeDoc }) {
  return (
    <div className="sn-info__card" role="tooltip">
      <div className="sn-info__title">{doc.title}</div>
      <p className="sn-info__desc">{doc.description}</p>

      {doc.inputs.length > 0 && (
        <div className="sn-info__section">
          <div className="sn-info__section-head">Inputs</div>
          <PortList ports={doc.inputs} />
        </div>
      )}

      {doc.outputs.length > 0 && (
        <div className="sn-info__section">
          <div className="sn-info__section-head">Outputs</div>
          <PortList ports={doc.outputs} />
        </div>
      )}

      <div className="sn-info__tip">
        <span className="sn-info__tip-icon" aria-hidden="true">💡</span>
        {doc.tip}
      </div>
    </div>
  );
}

function PortList({ ports }: { ports: PortDoc[] }) {
  return (
    <ul className="sn-info__ports">
      {ports.map((p) => (
        <li key={p.id} className="sn-info__port">
          {p.label}
        </li>
      ))}
    </ul>
  );
}
