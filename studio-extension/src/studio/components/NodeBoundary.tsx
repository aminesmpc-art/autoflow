/* ============================================================
   One broken node must not take the canvas with it.

   An Extend node returned a fresh object from a Zustand selector, which in v5
   is a changed snapshot on every store read — so selecting one spun the render
   loop and the entire Studio window went black. Not a broken node: a broken
   application, with no message, nothing to click, and a saved workflow that
   could no longer be opened.

   React unmounts the whole tree when a render throws and nothing catches it.
   A boundary around each node turns that into one card saying what happened,
   with the rest of the workflow still there and still editable.
   ============================================================ */

import { Component, type ReactNode } from 'react';

interface Props {
  /** Shown in the message, so the broken card names itself. */
  label?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class NodeBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // The canvas survives, so the console is the only record of why.
    console.error('[Studio] Node failed to render:', error);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="sn-wrap">
        <div className="sn-label">
          <span className="sn-label__icon" aria-hidden="true">⚠</span>
          <span className="sn-label__text">{this.props.label || 'Node'}</span>
        </div>
        <div className="sn sn--error">
          <div className="sn-ext">
            <div className="sn-ext__warn">
              This node could not be drawn. The rest of the workflow is fine —
              delete it, or reload Studio.
            </div>
            {/* The message, because "something went wrong" sends the next
                report back here with nothing in it. */}
            <small className="sn-ext__hint">{error.message}</small>
          </div>
        </div>
      </div>
    );
  }
}
