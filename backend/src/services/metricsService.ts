/**
 * Runtime metrics.
 *
 * Answers the question you otherwise cannot answer from logs alone when an
 * analysis is stuck or slow: is the queue backing up, how long do runs
 * actually take, and how many are failing.
 *
 * Deliberately small and in-process. The counters are cumulative since
 * process start and are reset on restart, which is the right trade-off for a
 * single-node deployment and avoids pulling in a metrics store to answer a
 * question a scrape endpoint covers.
 */
import { Job, JobStatus, jobService } from './jobService';

export interface JobMetrics {
  /** Jobs running right now. */
  running: number;
  /** Jobs waiting for a free slot. */
  queued: number;
  /** Retained jobs by terminal status, plus the ones still in flight. */
  byStatus: Record<JobStatus, number>;
  /** Total jobs ever enqueued since process start. */
  total: number;
  /** Runs that reached a completed or failed terminal state. */
  finished: number;
  /** Duration of the most recent finished run, in milliseconds. */
  lastDurationMs: number | null;
  /** Mean duration of finished runs, in milliseconds. */
  averageDurationMs: number | null;
  /** Longest run observed, in milliseconds. */
  maxDurationMs: number | null;
}

export interface MetricsSnapshot {
  uptimeSeconds: number;
  jobs: JobMetrics;
  timestamp: string;
}

const TERMINAL: JobStatus[] = ['completed', 'failed', 'cancelled'];

/** Counts a completed run's duration into the rolling statistics. */
export class MetricsCollector {
  private startedAt = Date.now();
  private total = 0;
  private finished = 0;
  private lastDurationMs: number | null = null;
  private totalDurationMs = 0;
  private maxDurationMs: number | null = null;
  /**
   * Keyed by job id and attempt. The queue re-enqueues a job on retry under
   * the same id, so keying by id alone would discard every attempt after the
   * first and under-report retries; keying by nothing would count the several
   * progress updates leading to one terminal state as separate runs.
   */
  private recorded = new Set<string>();

  /**
   * Ids already counted as enqueued, so the repeated `queued` reports the
   * pump makes do not inflate the total.
   */
  private enqueued = new Set<string>();

  /**
   * Observe a job state change.
   *
   * Called on every queue update rather than only on completion, so the
   * snapshot reflects the current queue depth without the collector having to
   * reach into the queue's internals.
   */
  observe(job: Job): void {
    if (job.status === 'queued' && !this.enqueued.has(job.id)) {
      this.enqueued.add(job.id);
      this.total += 1;
    }

    // Only a job that actually started has a meaningful duration. The attempt
    // check is also what stops a cancelled-before-start job from contributing
    // one.
    if (!TERMINAL.includes(job.status) || job.attempt === 0) return;

    const key = `${job.id}#${job.attempt}`;
    if (this.recorded.has(key)) return;
    this.recorded.add(key);

    const startedAt = job.startedAt ?? job.createdAt;
    const finishedAt = job.finishedAt ?? Date.now();
    this.recordDuration(Math.max(0, finishedAt - startedAt));
  }

  private recordDuration(duration: number): void {
    this.finished += 1;
    this.lastDurationMs = duration;
    this.totalDurationMs += duration;
    if (this.maxDurationMs === null || duration > this.maxDurationMs) {
      this.maxDurationMs = duration;
    }
  }

  /**
   * Count of jobs in each state.
   *
   * Takes the job list as an argument rather than always reading the shared
   * singleton, so the collector can be tested without depending on a global
   * queue that other specs have populated. The caller decides which queue this
   * snapshot describes.
   */
  snapshot(jobs: readonly Job[] = jobService.list()): MetricsSnapshot {
    const byStatus: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const job of jobs) {
      byStatus[job.status] += 1;
    }

    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      jobs: {
        running: jobService.activeCount,
        queued: byStatus.queued,
        byStatus,
        total: this.total,
        finished: this.finished,
        lastDurationMs: this.lastDurationMs,
        averageDurationMs:
          this.finished > 0 ? Math.round(this.totalDurationMs / this.finished) : null,
        maxDurationMs: this.maxDurationMs,
      },
      timestamp: new Date().toISOString(),
    };
  }
}

export const metrics = new MetricsCollector();