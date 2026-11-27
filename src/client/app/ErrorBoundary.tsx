import { Component, type ReactNode } from "react";

interface Props {
  name: string;
  children: ReactNode;
}

/** Keeps one broken panel (say, a WebGL failure) from blanking the whole dashboard. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error(`[${this.props.name}]`, error);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="panel panel-crashed" role="alert">
          <strong>{this.props.name} failed to render.</strong>
          <span className="muted">{this.state.error.message}</span>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
