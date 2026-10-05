/**
 * Metrics collector.
 *
 * The collector is fed the queue's update stream, which emits on every state
 * change rather than once per job. So the assertions here are mostly about
 * not counting the same run more than once: a job updates several times on its
 * way to completed, and folding each of those into the timings would produce
 * an average several times too small.
 */
import { describe, it, expect } from 'vitest';
import { MetricsCollector } from '../../src/services/metricsService';
import { Job, JobStatus } from '../../src/services/jobService';

const job = (over: Partial<Job> = {}): Job =>
  ({
    id: 'job_1',
    repoId: 'r1',
    repoUrl: 'https://github.com/o/r',
    status: 'queued',
    stage: 'cloning',
    progress: 0,
    message: '',
    createdAt: 1000,
    attempt: 0,
    ...over,
  }) as Job;

describe('MetricsCollector totals', () => {
  it('counts a job once when it is first enqueued', () => {
    const metrics = new MetricsCollector();

    metrics.observe(job({ status: 'queued', attempt: 0 }));

    expect(metrics.snapshot().jobs.total).toBe(1);
  });

  it('does not recount a job the queue re-reports as queued', () => {
    const metrics = new MetricsCollector();

    metrics.observe(job({ status: 'queued', attempt: 0 }));
    metrics.observe(job({ status: 'queued', attempt: 0 }));
    metrics.observe(job({ status: 'queued', attempt: 0 }));

    // The pump reports the queued state more than once; each report is not a
    // distinct analysis.
    expect(metrics.snapshot().jobs.total).toBe(1);
  });

  it('starts with no completed runs and null timings', () => {
    const { jobs } = new MetricsCollector().snapshot();

    expect(jobs.finished).toBe(0);
    expect(jobs.lastDurationMs).toBeNull();
    expect(jobs.averageDurationMs).toBeNull();
    expect(jobs.maxDurationMs).toBeNull();
  });

  it('reports a non-negative uptime', () => {
    const { uptimeSeconds } = new MetricsCollector().snapshot();
    expect(uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('includes an ISO timestamp', () => {
    const { timestamp } = new MetricsCollector().snapshot();
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
  });
});

describe('MetricsCollector durations', () => {
  it('records the elapsed time of a finished run', () => {
    const metrics = new MetricsCollector();

    metrics.observe(
      job({ status: 'completed', attempt: 1, startedAt: 1000, finishedAt: 4000 })
    );

    const { jobs } = metrics.snapshot();
    expect(jobs.finished).toBe(1);
    expect(jobs.lastDurationMs).toBe(3000);
    expect(jobs.averageDurationMs).toBe(3000);
    expect(jobs.maxDurationMs).toBe(3000);
  });

  it('counts a finished job once even as the queue reports it repeatedly', () => {
    const metrics = new MetricsCollector();
    const finished = job({ status: 'completed', attempt: 1, startedAt: 0, finishedAt: 500 });

    metrics.observe(finished);
    metrics.observe(finished);
    metrics.observe(finished);

    // Without this guard the average would be divided by three.
    expect(metrics.snapshot().jobs.finished).toBe(1);
    expect(metrics.snapshot().jobs.averageDurationMs).toBe(500);
  });

  it('averages across runs and keeps the slowest', () => {
    const metrics = new MetricsCollector();

    metrics.observe(job({ id: 'a', status: 'completed', attempt: 1, startedAt: 0, finishedAt: 100 }));
    metrics.observe(job({ id: 'b', status: 'completed', attempt: 1, startedAt: 0, finishedAt: 300 }));

    const { jobs } = metrics.snapshot();
    expect(jobs.finished).toBe(2);
    expect(jobs.averageDurationMs).toBe(200);
    expect(jobs.maxDurationMs).toBe(300);
    expect(jobs.lastDurationMs).toBe(300);
  });

  it('records a cancelled run that had started', () => {
    const metrics = new MetricsCollector();

    metrics.observe(
      job({ status: 'cancelled', attempt: 1, startedAt: 1000, finishedAt: 2000 })
    );

    expect(metrics.snapshot().jobs.finished).toBe(1);
  });

  it('ignores a job cancelled before it ever started', () => {
    const metrics = new MetricsCollector();

    // attempt 0 means the handler never ran, so there is no duration to report
    // and folding one in would understate the real average.
    metrics.observe(
      job({ status: 'cancelled', attempt: 0, startedAt: undefined, finishedAt: 1500 })
    );

    expect(metrics.snapshot().jobs.finished).toBe(0);
  });

  it('ignores a job that is still running', () => {
    const metrics = new MetricsCollector();

    metrics.observe(job({ status: 'running', attempt: 1, startedAt: 1000 }));

    expect(metrics.snapshot().jobs.finished).toBe(0);
  });

  it('never records a negative duration when the clock is inconsistent', () => {
    const metrics = new MetricsCollector();

    metrics.observe(
      job({ status: 'completed', attempt: 1, startedAt: 5000, finishedAt: 1000 })
    );

    expect(metrics.snapshot().jobs.lastDurationMs).toBe(0);
  });

  it('treats each retried run as its own measurement', () => {
    const metrics = new MetricsCollector();

    metrics.observe(
      job({ status: 'failed', attempt: 1, startedAt: 0, finishedAt: 100 })
    );
    metrics.observe(
      job({ status: 'completed', attempt: 2, startedAt: 200, finishedAt: 700 })
    );

    // A retry is a second real attempt and belongs in the statistics.
    const { jobs } = metrics.snapshot();
    expect(jobs.finished).toBe(2);
    expect(jobs.lastDurationMs).toBe(500);
  });
});

describe('MetricsCollector status breakdown', () => {
  it('exposes a count for every terminal status even at zero', () => {
    // An empty job list, passed explicitly: the shared queue singleton may
    // hold jobs left behind by other specs.
    const { jobs } = new MetricsCollector().snapshot([]);

    // A consumer reading byStatus.failed must get 0, not undefined.
    for (const status of ['queued', 'running', 'completed', 'failed', 'cancelled'] as JobStatus[]) {
      expect(jobs.byStatus[status]).toBe(0);
    }
  });

  it('counts each state in the job list it is given', () => {
    const jobs = [
      job({ id: 'a', status: 'completed' }),
      job({ id: 'b', status: 'completed' }),
      job({ id: 'c', status: 'failed' }),
      job({ id: 'd', status: 'queued' }),
    ];

    const { jobs: snapshot } = new MetricsCollector().snapshot(jobs);

    expect(snapshot.byStatus.completed).toBe(2);
    expect(snapshot.byStatus.failed).toBe(1);
    expect(snapshot.byStatus.queued).toBe(1);
    expect(snapshot.byStatus.cancelled).toBe(0);
  });
});