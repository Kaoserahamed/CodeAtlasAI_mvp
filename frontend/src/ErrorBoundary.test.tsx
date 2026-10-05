/**
 * Error boundary.
 *
 * React logs an uncaught render error to console.error itself, so the console
 * is stubbed before each render. Without that the specs assert against React's
 * own output rather than ours.
 *
 * A component that throws is the only way to reach this code path: the
 * boundary is not reachable from a normal render.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * Throws during render, which is the only way to exercise the boundary.
 *
 * The return type is declared because a function that only throws is inferred
 * as returning void, which TypeScript rejects as a JSX component.
 */
function Boom({ error = new Error('render exploded') }: { error?: Error }): ReactNode {
  throw error;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders its children when nothing goes wrong', () => {
    render(
      <ErrorBoundary>
        <div>all good</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('all good')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('shows the fallback instead of a blank page when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('shows the error message in the details section', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom error={new Error('null is not a function')} />
      </ErrorBoundary>
    );

    // The user needs the reason, not just that something failed.
    expect(screen.getByText('null is not a function')).toBeInTheDocument();
  });

  it('offers a retry that re-renders the children', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('first render fails');
      return <div>recovered</div>;
    }

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Retrying after the cause is fixed should bring the tree back.
    shouldThrow = false;
    act(() => {
      screen.getByRole('button', { name: /try again/i }).click();
    });

    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('offers a full page reload as the escape hatch', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByRole('button', { name: /reload the page/i })).toBeInTheDocument();
  });

  it('reports the failure through the structured logger', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { logger } = await import('./services/logger');
    const logSpy = vi.spyOn(logger, 'error');

    render(
      <ErrorBoundary component="GraphCanvas">
        <Boom error={new Error('canvas exploded')} />
      </ErrorBoundary>
    );

    // The component name is what makes a line in a busy console findable.
    expect(logSpy).toHaveBeenCalledWith(
      'GraphCanvas',
      'render failed',
      expect.objectContaining({ error: expect.any(Error) })
    );
    expect(spy).toHaveBeenCalled();
  });

  it('falls back to a default component name when none is given', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { logger } = await import('./services/logger');
    const logSpy = vi.spyOn(logger, 'error');

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(logSpy).toHaveBeenCalledWith('App', 'render failed', expect.anything());
  });
});