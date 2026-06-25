import { Component, ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: string | null;
}

/**
 * Catches render-time errors so the renderer never silently white-screens.
 * Shows the message + stack with a reload action instead of a blank page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("Relay render error:", error, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
  }

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="crash-screen" role="alert">
        <div className="crash-card">
          <h2>Relay hit a render error</h2>
          <p>{error.message || String(error)}</p>
          {error.stack && <pre>{error.stack}</pre>}
          {info && <pre className="crash-component-stack">{info}</pre>}
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
