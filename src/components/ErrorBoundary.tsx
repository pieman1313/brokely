import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Catches render crashes (e.g. from corrupted persisted settings) and offers a
 *  one-click recovery that clears local settings — never any statement data. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  clearSettings = () => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("spend.")) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="splash">
        <div className="splash-card">
          <div className="brand-mark splash-mark">₿</div>
          <h1>Something went wrong</h1>
          <p className="splash-tag">
            The app hit an unexpected error — usually a saved setting (a view, group or rule) that got out of
            sync. Clearing your local settings fixes it. Your statements are never stored, so nothing is lost;
            just reload the file afterwards.
          </p>
          <button className="btn-primary" onClick={this.clearSettings}>Clear settings &amp; reload</button>
          <button className="btn-ghost" onClick={() => location.reload()}>Just reload</button>
          <p className="error">{String(this.state.error?.message ?? this.state.error)}</p>
        </div>
      </div>
    );
  }
}
