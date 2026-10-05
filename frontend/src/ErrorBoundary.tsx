/**
 * Error boundary.
 *
 * Without this, a render error unmounts the whole app and the user sees a
 * blank page, with the reason only in a console the developer has to have open
 * already. With it, the failure is logged in the same structured shape the
 * rest of the client uses, and the user gets something readable and a way to
 * retry.
 *
 * React requires this to be a class: there is no hook equivalent, because an
 * error boundary has to catch during render.
 */
import { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from './services/logger';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Shown in the fallback so the user can tell what went wrong. */
  component?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // componentStack is React's own account of where it happened, which is the
    // half of the diagnosis a bare stack trace misses.
    logger.error(this.props.component ?? 'App', 'render failed', {
      error,
      componentStack: info.componentStack,
    });
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl border border-gray-200 p-8 text-center">
          <div className="text-red-500 text-5xl mb-4">⚠</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h1>
          <p className="text-gray-600 mb-6">
            The interface hit an unexpected error and stopped. Your analysis data is
            unaffected.
          </p>

          <details className="text-left mb-6">
            <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
              Technical details
            </summary>
            <pre className="mt-2 p-3 bg-gray-100 rounded-lg text-xs text-gray-800 overflow-auto max-h-40">
              {error.message}
            </pre>
          </details>

          <div className="flex gap-3 justify-center">
            <button
              onClick={this.handleRetry}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-gray-200 text-gray-800 rounded-xl hover:bg-gray-300 transition-colors"
            >
              Reload the page
            </button>
          </div>
        </div>
      </div>
    );
  }
}