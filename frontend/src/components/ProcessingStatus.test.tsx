/**
 * Processing status screen.
 *
 * Asserts what a user actually sees: the step labels, the "n of m completed"
 * count, the repository it is working on, the failure state and its message,
 * and that onComplete fires only once every step is done.
 *
 * The onComplete path is asserted with fake timers because the component waits
 * 1.5s so the finished state is visible before it advances.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ProcessingStatus } from './ProcessingStatus';
import { ProcessingStep } from '../processingSteps';

const steps = (
  overrides: Partial<Record<string, ProcessingStep['status']>> = {}
): ProcessingStep[] =>
  (
    [
      { id: 'clone', label: 'Cloning Repository', status: 'pending', message: 'Downloading source code from GitHub...' },
      { id: 'analyze', label: 'Analyzing Code', status: 'pending', message: 'Parsing files and extracting structure...' },
      { id: 'store', label: 'Building Knowledge Graph', status: 'pending', message: 'Storing relationships in database...' },
      { id: 'complete', label: 'Complete', status: 'pending', message: 'Ready to visualize!' },
    ] as ProcessingStep[]
  ).map((s) => ({ ...s, status: overrides[s.id] ?? s.status }));

describe('ProcessingStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the repository being analysed, shortened to owner/repo', () => {
    render(<ProcessingStatus steps={steps()} repositoryUrl="https://github.com/octocat/hello" />);

    expect(screen.getByText('octocat/hello')).toBeInTheDocument();
  });

  it('lists every step label', () => {
    render(<ProcessingStatus steps={steps()} repositoryUrl="https://github.com/o/r" />);

    expect(screen.getByText('Cloning Repository')).toBeInTheDocument();
    expect(screen.getByText('Analyzing Code')).toBeInTheDocument();
    expect(screen.getByText('Building Knowledge Graph')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('counts completed steps out of the total', () => {
    render(
      <ProcessingStatus
        steps={steps({ clone: 'completed', analyze: 'active' })}
        repositoryUrl="https://github.com/o/r"
      />
    );

    expect(screen.getByText('1 of 4 steps completed')).toBeInTheDocument();
  });

  it('reports every step complete once they all are', () => {
    render(
      <ProcessingStatus
        steps={steps({ clone: 'completed', analyze: 'completed', store: 'completed', complete: 'completed' })}
        repositoryUrl="https://github.com/o/r"
      />
    );

    expect(screen.getByText('4 of 4 steps completed')).toBeInTheDocument();
  });

  it('shows the step message beneath the label', () => {
    render(<ProcessingStatus steps={steps()} repositoryUrl="https://github.com/o/r" />);

    expect(screen.getByText('Downloading source code from GitHub...')).toBeInTheDocument();
  });

  it('replaces the steps with a failure screen and the error message', () => {
    render(
      <ProcessingStatus
        steps={steps({ analyze: 'error' })}
        repositoryUrl="https://github.com/o/r"
        error="Repository not found"
      />
    );

    expect(screen.getByText('Analysis Failed')).toBeInTheDocument();
    expect(screen.getByText('Repository not found')).toBeInTheDocument();
    // The step list is gone, so the user is not left looking at a stale run.
    expect(screen.queryByText('Cloning Repository')).not.toBeInTheDocument();
  });

  it('offers a retry action on failure', () => {
    render(
      <ProcessingStatus steps={steps()} repositoryUrl="https://github.com/o/r" error="boom" />
    );

    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('calls onComplete after the delay once every step is done', () => {
    const onComplete = vi.fn();
    render(
      <ProcessingStatus
        steps={steps({ clone: 'completed', analyze: 'completed', store: 'completed', complete: 'completed' })}
        repositoryUrl="https://github.com/o/r"
        onComplete={onComplete}
      />
    );

    expect(onComplete).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not call onComplete while steps are still pending', () => {
    const onComplete = vi.fn();
    render(
      <ProcessingStatus
        steps={steps({ clone: 'completed' })}
        repositoryUrl="https://github.com/o/r"
        onComplete={onComplete}
      />
    );

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('does not throw when a step failed rather than completing', () => {
    const onComplete = vi.fn();
    render(
      <ProcessingStatus
        steps={steps({ store: 'error' })}
        repositoryUrl="https://github.com/o/r"
        onComplete={onComplete}
      />
    );

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // A failed run must not be treated as a finished one.
    expect(onComplete).not.toHaveBeenCalled();
  });
});