/**
 * Background job queue.
 *
 * Scans run here rather than inside the request handler. Previously a scan
 * executed synchronously on the event loop, so one large repository blocked
 * every other request until it finished, with no way to cancel or retry it.
 *
 * The queue is in-process and bounded. It is deliberately not Redis-backed: a
 * single-node deployment needs no extra dependency, and moving to BullMQ later
 * only changes how jobs are enqueued, since the contract a handler sees is
 * just a progress callback plus a cancellation signal.
 */

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type JobStage = 'cloning' | 'scanning' | 'resolving' | 'storing' | 'done';

export interface JobStats {
  files: number;
  functions: number;
  classes: number;
  imports: number;
  calls: number;
  resolvedCalls?: number;
  inferredCalls?: number;
  unknownCalls?: number;
  externalModules?: number;
}

export interface Job {
  id: string;
  repoId: string;
  repoUrl: string;
  ref?: string;
  status: JobStatus;
  stage: JobStage;
  /** 0-100, coarse progress for the UI. */
  progress: number;
  message: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  attempt: number;
  error?: string;
  stats?: JobStats;
  commitSha?: string;
}

export interface JobContext {
  /** Report progress; `fraction` is 0-1 within the current stage. */
  progress(fraction: number, message?: string): void;
  /** True once the caller has asked for cancellation. */
  isCancelled(): boolean;
  signal: AbortSignal;
}

export type JobHandler = (job: Job, ctx: JobContext) => Promise<JobStats>;

interface QueueEntry {
  job: Job;
  handler: JobHandler;
  controller: AbortController;
  cancelled: boolean;
}

export interface JobServiceOptions {
  /** How many jobs may run at once. */
  concurrency?: number;
  /** Jobs retained in memory before the oldest finished ones are dropped. */
  maxRetained?: number;
}

export class JobService {
  private jobs = new Map<string, Job>();
  private queue: QueueEntry[] = [];
  private running = new Map<string, QueueEntry>();
  private controllers = new Map<string, AbortController>();
  private concurrency: number;
  private maxRetained: number;
  private listeners = new Set<(job: Job) => void>();

  constructor(options: JobServiceOptions = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? 2);
    this.maxRetained = Math.max(10, options.maxRetained ?? 200);
  }

  /** Subscribe to job updates, for logging or streaming to the client. */
  onUpdate(listener: (job: Job) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(job: Job): void {
    for (const listener of this.listeners) {
      try {
        listener({ ...job });
      } catch {
        // A misbehaving listener must not break the queue.
      }
    }
  }

  enqueue(
    input: { repoUrl: string; repoId: string; ref?: string },
    handler: JobHandler
  ): Job {
    const job: Job = {
      id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      repoId: input.repoId,
      repoUrl: input.repoUrl,
      ref: input.ref,
      status: 'queued',
      stage: 'cloning',
      progress: 0,
      message: 'Queued',
      createdAt: Date.now(),
      attempt: 0,
    };

    const controller = new AbortController();
    this.jobs.set(job.id, job);
    this.controllers.set(job.id, controller);
    this.queue.push({ job, handler, controller, cancelled: false });

    this.prune();
    // Kick the pump on the next tick so the caller receives the id first.
    setImmediate(() => this.pump());

    return job;
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const entry = this.queue.shift()!;

      if (entry.cancelled) {
        this.markFinished(entry, 'cancelled', 'Cancelled before it started');
        continue;
      }

      this.running.set(entry.job.id, entry);
      void this.execute(entry);
    }
  }

  private async execute(entry: QueueEntry): Promise<void> {
    const { job, handler, controller } = entry;
    job.status = 'running';
    job.stage = 'cloning';
    job.attempt += 1;
    job.startedAt = Date.now();
    job.progress = 0;
    job.message = 'Starting';
    this.emit(job);

    const ctx: JobContext = {
      progress: (fraction, message) => {
        job.progress = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
        if (message) job.message = message;
        this.emit(job);
      },
      isCancelled: () => entry.cancelled,
      signal: controller.signal,
    };

    try {
      const stats = await handler(job, ctx);

      if (entry.cancelled) {
        this.markFinished(entry, 'cancelled', 'Cancelled');
        return;
      }

      job.stats = stats;
      job.progress = 100;
      job.stage = 'done';
      job.status = 'completed';
      job.message = 'Analysis complete';
      job.finishedAt = Date.now();
      this.emit(job);
    } catch (err: unknown) {
      if (entry.cancelled) {
        this.markFinished(entry, 'cancelled', 'Cancelled');
        return;
      }
      const detail = err instanceof Error ? err.message : String(err);
      job.status = 'failed';
      job.message = 'Analysis failed';
      job.error = detail.slice(0, 500) || 'Unknown error';
      job.finishedAt = Date.now();
      this.emit(job);
    } finally {
      this.running.delete(job.id);
      this.controllers.delete(job.id);
      this.pump();
    }
  }

  private markFinished(entry: QueueEntry, status: JobStatus, message: string): void {
    entry.job.status = status;
    entry.job.message = message;
    entry.job.finishedAt = Date.now();
    this.emit(entry.job);
  }

  /**
   * Request cancellation. A queued job is dropped before it starts; a running
   * job observes it through ctx.isCancelled and should return early.
   */
  cancel(jobId: string): boolean {
    const queuedIndex = this.queue.findIndex((e) => e.job.id === jobId);
    if (queuedIndex >= 0) {
      const [entry] = this.queue.splice(queuedIndex, 1);
      entry.cancelled = true;
      this.markFinished(entry, 'cancelled', 'Cancelled before it started');
      this.pump();
      return true;
    }

    const controller = this.controllers.get(jobId);
    if (controller) {
      controller.abort();
      const entry = this.running.get(jobId);
      if (entry) entry.cancelled = true;
      return true;
    }
    return false;
  }

  /** Retry a finished job with a handler. */
  retry(jobId: string, handler: JobHandler): Job | null {
    const existing = this.jobs.get(jobId);
    if (!existing) return null;
    if (existing.status === 'running' || existing.status === 'queued') return existing;

    const controller = new AbortController();
    existing.status = 'queued';
    existing.stage = 'cloning';
    existing.progress = 0;
    existing.message = 'Requeued';
    existing.error = undefined;
    existing.finishedAt = undefined;

    this.controllers.set(jobId, controller);
    this.queue.push({ job: existing, handler, controller, cancelled: false });
    setImmediate(() => this.pump());
    this.emit(existing);

    return existing;
  }

  get(jobId: string): Job | null {
    return this.jobs.get(jobId) ?? null;
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get activeCount(): number {
    return this.running.size + this.queue.length;
  }

  /** Drop the oldest finished jobs once retention is exceeded. */
  private prune(): void {
    if (this.jobs.size <= this.maxRetained) return;
    const finished = [...this.jobs.values()]
      .filter((j) => j.status !== 'running' && j.status !== 'queued')
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));

    while (this.jobs.size > this.maxRetained && finished.length > 0) {
      this.jobs.delete(finished.shift()!.id);
    }
  }
}

export const jobService = new JobService();