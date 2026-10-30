/* ============================================================
   NodeSettings — a node's controls, drawn in the side panel.

   Every setting used to live on the node itself: a Flow clip measured
   300×551px with 17 controls always open, and nodes across the templates ran
   192–809px tall (canvas harness, 2026-10-30). Zoomed out far enough to see
   a workflow, none of it could be read, and a 26-node template fitted only at
   13%. The owner chose settings in a side panel (2026-10-30), which is where
   Figma Weave and n8n put them.

   A portal, not a second copy of the form. The node keeps its own state,
   handlers and store wiring; only where its controls are DRAWN moves. So a
   setting changed in the panel is the same updateNodeData call it was on the
   card, and nothing about how a node saves or runs depends on where its
   settings are on screen.

   The card always shows `summary` — one line saying what the node will do —
   so it is the same height selected or not and readable without opening it.
   ============================================================ */

import { createContext, useContext, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStudioStore } from '../store';

/** The panel's element, provided by the canvas. Null outside it. */
export const InspectorHost = createContext<HTMLElement | null>(null);

/* A portal keeps its React parent, so events in the panel bubble through
   React to the node's wrapper as if they happened on the node. React Flow's
   wrapper moves a selected node on arrow keys and re-selects on click: an
   arrow pressed on a Ratio pill would have nudged the node across the
   canvas. Nothing in the panel needs either, so neither leaves it. */
const stop = (e: SyntheticEvent) => e.stopPropagation();

export const deselectNode = (nodeId: string) =>
  useStudioStore.getState().onNodesChange([{ type: 'select', id: nodeId, selected: false }]);

interface Props {
  nodeId: string;
  selected: boolean;
  /** The panel's heading — the node's own name. */
  title: string;
  /** One line for the card: what this node will do, at a glance. */
  summary?: ReactNode;
  /** A class for the panel's body, for settings styled under their node's
      kind (`.sn--story .sn-story__panel`): the selector is widened to
      `:is(.sn--story, .sn-story-settings)`, and this supplies the second. */
  bodyClass?: string;
  children: ReactNode;
}

export function NodeSettings({ nodeId, selected, title, summary, bodyClass, children }: Props) {
  const host = useContext(InspectorHost);
  /* One panel for one node. With several selected there is no single answer
     to "whose settings are these", so none are shown. Read from Studio's
     store, which holds React Flow's selection (every select change goes
     through onNodesChange) — React Flow's own store would tie this to a
     provider, and a node rendered without one would throw. */
  const alone = useStudioStore((s) => {
    let n = 0;
    for (const node of s.nodes) if (node.selected && ++n > 1) return false;
    return n === 1;
  });

  /* Outside a canvas that provides a panel, the controls stay on the node:
     a node rendered anywhere else must not lose its settings. */
  if (!host) return <>{children}</>;

  return (
    <>
      {summary ? <div className="sn-summary">{summary}</div> : null}
      {selected && alone && createPortal(
        <section
          className="studio-inspector__node"
          aria-label={`${title} settings`}
          onClick={stop}
          onDoubleClick={stop}
          onContextMenu={stop}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') deselectNode(nodeId);
          }}
        >
          <header className="studio-inspector__head">
            <span className="studio-inspector__title" title={title}>{title}</span>
            <button
              type="button"
              className="studio-inspector__close"
              onClick={() => deselectNode(nodeId)}
              aria-label="Close settings"
              title="Close (Esc)"
            >
              ×
            </button>
          </header>
          <div className={`studio-inspector__body ${bodyClass || ''}`}>{children}</div>
        </section>,
        host,
      )}
    </>
  );
}
