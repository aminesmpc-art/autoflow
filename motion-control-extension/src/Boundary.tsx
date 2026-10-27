import { Component, type ReactNode } from 'react';

/* A render error used to unmount the whole panel and leave an empty dark box,
   which looked exactly like a panel still loading. This says what failed and
   offers the one thing that helps. */
export class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="boot" role="alert">
      <p>Motion could not open: {this.state.error.message}</p>
      <button type="button" className="btn btn--secondary btn--sm" onClick={() => location.reload()}>Reload panel</button>
    </div>;
  }
}
