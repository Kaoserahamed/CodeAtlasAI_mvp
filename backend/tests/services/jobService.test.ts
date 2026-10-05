/**
 * Background job queue.
 *
 * The behaviours asserted here only show up under concurrency and
 * cancellation, where a bug is invisible in a single-job test and appears in
 * production as a stuck queue or a leaked slot:
 *
 *  - the concurrency limit is never exceeded, and a finished job releases its
 *    slot so a queued job starts;
 *  - cancelling a queued job never runs its handler;
 *  - cancelling a running job aborts its signal, and the job is reported
 *    cancelled rather than completed even if the handler ignores the flag;
 *  - a throwing listener cannot break the queue;
 *  - retention drops the oldest finished job and never a live one.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  JobService,
  Job,
  JobContext,
  JobStats,
} from '../../src/services/jobService';

const emptyStats = (): JobStats => ({
  files: 0,
  functions: 0,
  classes: 0,
  imports: 0,
  calls: 0,
});

const okHandler = async (): Promise<JobStats> => emptyStats();

/**
 * A handler that never settles, so a job can be held in the running state.
 *
 * `blockCount` is how many invocations block; later ones resolve immediately.
 * A gate that blocked every call would deadlock any test where the same
 * handler runs twice, since only the held promise is reachable.
 */
function blockingHandler(blockCount = Infinity) {
  const resolvers: ((v: JobStats) => void)[] = [];
  const seen: { job: Job; ctx: JobContext }[] = [];
  let blocked = 0;

  const handler = (job: Job, ctx: JobContext): Promise<JobStats> => {
    seen.push({ job, ctx });
    if (blocked < blockCount) {
      blocked++;
      return new Promise<JobStats>((resolve) => resolvers.push(resolve));
    }
    return Promise.resolve(emptyStats());
  };

  return {
    handler,
    seen,
    release: (stats: JobStats = emptyStats()) => {
      resolvers.splice(0).forEach((r) => r(stats));
    },
  };
}

/** Let the queue's setImmediate pump and any settled promises run. */
const flush = async (times = 4): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
};

/**
 * Wait until the queue drains, or fail rather than hang.
 *
 * `flush` only advances the microtask queue, which is not enough for
 * handlers that await a timer, so give real time and bound it.
 */
const drain = async (service: JobService, timeoutMs = 5000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (service.activeCount > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
  }
  await flush();
  if (service.activeCount > 0) {
    throw new Error(`queue did not drain within ${timeoutMs}ms`);
  }
};

describe('JobService concurrency', () => {
  it('never runs more jobs at once than the limit', async () => {
    const service = new JobService({ concurrency: 2 });
    let active = 0;
    let peak = 0;

    const handler = async (): Promise<JobStats> => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return emptyStats();
    };

    for (let i = 0; i < 6; i++) {
      service.enqueue({ repoUrl: `https://github.com/o/r${i}`, repoId: `r${i}` }, handler);
    }

    await drain(service);
    expect(peak).toBe(2);
  });

  it('starts a queued job once a running one finishes', async () => {
    const service = new JobService({ concurrency: 1 });
    const started: string[] = [];

    const handler = async (job: Job): Promise<JobStats> => {
      started.push(job.repoId);
      await new Promise((r) => setTimeout(r, 1));
      return emptyStats();
    };

    service.enqueue({ repoUrl: 'u1', repoId: 'first' }, handler);
    service.enqueue({ repoUrl: 'u2', repoId: 'second' }, handler);

    await drain(service);
    expect(started).toEqual(['first', 'second']);
  });

  it('treats a concurrency below one as one rather than deadlocking', async () => {
    const service = new JobService({ concurrency: 0 });
    const job = service.enqueue({ repoUrl: 'u', repoId: 'r' }, okHandler);

    await flush();
    expect(service.get(job.id)?.status).toBe('completed');
  });
});

describe('JobService progress', () => {
  it('scales a fraction to a 0-100 percentage', async () => {
    const service = new JobService();
    let ctx: JobContext | null = null;

    const job = service.enqueue({ repoUrl: 'u', repoId: 'r' }, async (_j, c) => {
      ctx = c;
      return emptyStats();
    });

    await flush();
    (ctx as unknown as JobContext).progress(0.42, 'Scanning');
    expect(service.get(job.id)?.progress).toBe(42);
    expect(service.get(job.id)?.message).toBe('Scanning');
  });

  it('clamps a fraction outside 0-1 instead of reporting nonsense', async () => {
    const service = new JobService();
    let ctx: JobContext | null = null;

    const job = service.enqueue({ repoUrl: 'u', repoId: 'r' }, async (_j, c) => {
      ctx = c;
      return emptyStats();
    });

    await flush();
    (ctx as unknown as JobContext).progress(5);
    expect(service.get(job.id)?.progress).toBe(100);
    (ctx as unknown as JobContext).progress(-3);
    expect(service.get(job.id)?.progress).toBe(0);
  });

  it('records the stats the handler returned', async () => {
    const service = new JobService();
    const stats = { ...emptyStats(), files: 12, functions: 34 };

    const job = service.enqueue({ repoUrl: 'u', repoId: 'r' }, async () => stats);

    await flush();
    expect(service.get(job.id)?.stats).toEqual(stats);
    expect(service.get(job.id)?.progress).toBe(100);
    expect(service.get(job.id)?.stage).toBe('done');
  });
});

describe('JobService cancellation', () => {
  it('never runs the handler for a job cancelled while queued', async () => {
    const service = new JobService({ concurrency: 1 });
    const gate = blockingHandler();

    service.enqueue({ repoUrl: 'u1', repoId: 'r1' }, gate.handler);
    const queued = service.enqueue({ repoUrl: 'u2', repoId: 'r2' }, gate.handler);

    expect(service.cancel(queued.id)).toBe(true);
    gate.release();
    await drain(service);

    // r2 must never have reached its handler.
    expect(gate.seen.map((s) => s.job.repoId)).not.toContain('r2');
    expect(service.get(queued.id)?.status).toBe('cancelled');
  });

  it('aborts the running job signal and reports it cancelled', async () => {
    const service = new JobService();
    const gate = blockingHandler();
    const job = service.enqueue({ repoUrl: 'u', repoId: 'r' }, gate.handler);

    await flush();
    expect(service.cancel(job.id)).toBe(true);
    expect(gate.seen[0].ctx.signal.aborted).toBe(true);
    expect(gate.seen[0].ctx.isCancelled()).toBe(true);

    gate.release();
    await drain(service);

    // The handler ignored the cancellation, and the job is still cancelled
    // rather than being reported as a successful analysis.
    expect(service.get(job.id)?.status).toBe('cancelled');
  });

  it('discards the stats of a job cancelled mid-flight', async () => {
    const service = new JobService();
    const gate = blockingHandler();
    const job = service.enqueue({ repoUrl: 'u', repoId: 'r' }, gate.handler);

    await flush();
    service.cancel(job.id);
    gate.release();
    await drain(service);

    // Recording stats here would report a partial analysis as a complete one.
    expect(service.get(job.id)?.stats).toBeUndefined();
  });

  it('reports false for an unknown job', () => {
    expect(new JobService().cancel('job_does_not_exist')).toBe(false);
  });

  it('frees the slot held by a cancelled running job', async () => {
    const service = new JobService({ concurrency: 1 });
    const gate = blockingHandler();

    const first = service.enqueue({ repoUrl: 'u1', repoId: 'r1' }, gate.handler);
    await flush();
    expect(service.activeCount).toBe(1);

    expect(service.cancel(first.id)).toBe(true);
    gate.release();
    await drain(service);

    expect(service.activeCount).toBe(0);
  });
});

describe('JobService failures', () => {
  it('marks a throwing handler as failed with the error message', async () => {
    const service = new JobService();
    const job = service.enqueue({ repoUrl: 'u', repoId: 'r' }, async () => {
      throw new Error('clone failed');
    });

    await flush();
    const finished = service.get(job.id);
    expect(finished?.status).toBe('failed');
    expect(finished?.error).toBe('clone failed');
    expect(finished?.message).toBe('Analysis failed');
  });

  it('keeps the queue moving after a handler throws', async () => {
    const service = new JobService({ concurrency: 1 });
    const bad = service.enqueue({ repoUrl: 'u1', repoId: 'r1' }, async () => {
      throw new Error('boom');
    });
    const good = service.enqueue({ repoUrl: 'u2', repoId: 'r2' }, okHandler);

    await drain(service);
    expect(service.get(bad.id)?.status).toBe('failed');
    expect(service.get(good.id)?.status).toBe('completed');
  });

  it('handles a rejected non-Error value', async () => {
    const service = new JobService();
    const job = service.enqueue({ repoUrl: 'u', repoId: 'r' }, async () => {
      throw 'just a string';
    });

    await flush();
    expect(service.get(job.id)?.error).toBe('just a string');
  });

  it('truncates a very long error message', async () => {
    const service = new JobService();
    const job = service.enqueue({ repoUrl: 'u', repoId: 'r' }, async () => {
      throw new Error('x'.repeat(2000));
    });

    await flush();
    expect(service.get(job.id)?.error).toHaveLength(500);
  });
});

describe('JobService updates', () => {
  it('hands each listener a copy so it cannot mutate the stored job', async () => {
    const service = new JobService();
    const seen: Job[] = [];
    service.onUpdate((job) => seen.push(job));

    const job = service.enqueue({ repoUrl: 'u', repoId: 'r' }, okHandler);
    await flush();

    seen[0].repoId = 'tampered';
    expect(service.get(job.id)?.repoId).toBe('r');
  });

  it('stops notifying after unsubscribe', async () => {
    const service = new JobService();
    const listener = vi.fn();
    const off = service.onUpdate(listener);

    const job = service.enqueue({ repoUrl: 'u', repoId: 'r' }, okHandler);
    await flush();
    const before = listener.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    off();
    service.retry(job.id, okHandler);
    await drain(service);
    expect(listener.mock.calls.length).toBe(before);
  });

  it('is not broken by a listener that throws', async () => {
    const service = new JobService({ concurrency: 1 });
    service.onUpdate(() => {
      throw new Error('bad listener');
    });

    const job = service.enqueue({ repoUrl: 'u', repoId: 'r' }, okHandler);
    await drain(service);

    // The queue must still have completed the job despite the listener.
    expect(service.get(job.id)?.status).toBe('completed');
  });
});

describe('JobService retry', () => {
  it('requeues a failed job and clears the previous error', async () => {
    const service = new JobService({ concurrency: 1 });
    let shouldFail = true;
    const flaky = async (): Promise<JobStats> => {
      if (shouldFail) throw new Error('transient');
      return emptyStats();
    };

    const job = service.enqueue({ repoUrl: 'u', repoId: 'r' }, flaky);
    await flush();
    expect(service.get(job.id)?.status).toBe('failed');

    shouldFail = false;
    expect(service.retry(job.id, flaky)).not.toBeNull();
    await drain(service);

    const finished = service.get(job.id);
    expect(finished?.status).toBe('completed');
    expect(finished?.error).toBeUndefined();
    expect(finished?.attempt).toBe(2);
  });

  it('returns null for an unknown job', () => {
    expect(new JobService().retry('nope', okHandler)).toBeNull();
  });

  it('returns a still-queued job unchanged rather than duplicating it', async () => {
    const service = new JobService({ concurrency: 1 });
    // Only the first invocation blocks, so releasing it lets the second run.
    const gate = blockingHandler(1);
    const running = service.enqueue({ repoUrl: 'u1', repoId: 'r1' }, gate.handler);
    const queued = service.enqueue({ repoUrl: 'u2', repoId: 'r2' }, gate.handler);
    await flush();

    const again = service.retry(queued.id, okHandler);
    expect(again?.id).toBe(queued.id);
    expect(service.list().filter((j) => j.id === queued.id)).toHaveLength(1);

    gate.release();
    await drain(service);
    expect(service.get(running.id)?.status).toBe('completed');
  });
});

describe('JobService listing and retention', () => {
  it('returns null for an unknown job', () => {
    expect(new JobService().get('nope')).toBeNull();
  });

  it('lists newest first', async () => {
    const service = new JobService();
    // createdAt is the sort key, so pin the clock: two jobs enqueued inside
    // the same millisecond would otherwise tie and the order is undefined.
    let now = 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);

    try {
      const first = service.enqueue({ repoUrl: 'u1', repoId: 'r1' }, okHandler);
      await flush();
      now = 2000;
      const second = service.enqueue({ repoUrl: 'u2', repoId: 'r2' }, okHandler);
      await flush();

      const list = service.list();
      expect(list[0].id).toBe(second.id);
      expect(list[list.length - 1].id).toBe(first.id);
    } finally {
      clock.mockRestore();
    }
  });

  it('drops the oldest finished job past the retention limit', async () => {
    const service = new JobService({ maxRetained: 10 });

    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const job = service.enqueue({ repoUrl: `u${i}`, repoId: `r${i}` }, okHandler);
      ids.push(job.id);
      await flush();
    }

    expect(service.list().length).toBeLessThanOrEqual(10);
    // The oldest jobs are the ones that should have gone.
    expect(service.get(ids[0])).toBeNull();
    expect(service.get(ids[ids.length - 1])).not.toBeNull();
  });

  it('never prunes a job that is still running', async () => {
    const service = new JobService({ maxRetained: 10, concurrency: 1 });
    const gate = blockingHandler();
    const held = service.enqueue({ repoUrl: 'u', repoId: 'held' }, gate.handler);
    await flush();

    for (let i = 0; i < 15; i++) {
      service.enqueue({ repoUrl: `u${i}`, repoId: `done${i}` }, okHandler);
      await flush();
    }

    expect(service.get(held.id)).not.toBeNull();

    gate.release();
    await drain(service);
  });
});