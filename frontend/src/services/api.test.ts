/**
 * API client.
 *
 * These assert the two things that break silently otherwise: that each call
 * reaches a route the backend actually serves, and that the `{ success, data,
 * error }` envelope is unwrapped into the right value or thrown as an Error.
 *
 * The route paths are checked against backend/src/api/routes.ts. They drifted
 * once already, which sent the client to endpoints that returned 404 while
 * every local check still passed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './api';
import { GraphData } from '../types';

const emptyGraph: GraphData = { nodes: [], edges: [] };

/** A fetch double returning a fixed JSON envelope, recording every call. */
function mockFetch(body: unknown, ok = true) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', spy);
  return { spy, calls };
}

/** A fetch double that returns a different envelope on each call. */
function sequenceFetch(bodies: unknown[]) {
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const body = bodies[Math.min(call++, bodies.length - 1)];
      return { ok: true, status: 200, json: async () => body } as Response;
    })
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api.fetchGraph', () => {
  it('requests the graph route and returns the nodes and edges', async () => {
    const { calls } = mockFetch({ success: true, data: emptyGraph });

    const result = await api.fetchGraph();

    expect(calls[0].url).toContain('/graph');
    expect(result).toEqual(emptyGraph);
  });

describe('api.analyzeGitHubRepository', () => {
  it('posts to the analyze route the backend serves', async () => {
    const { calls } = mockFetch({ success: true, jobId: 'job_1', repoId: 'r1' });

    const result = await api.analyzeGitHubRepository('https://github.com/o/r');

    // The backend registers /api/repositories/analyze, not /api/analyze-github.
    expect(calls[0].url).toContain('/repositories/analyze');
    expect(calls[0].url).not.toContain('analyze-github');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      repoUrl: 'https://github.com/o/r',
    });
    expect(result).toEqual({ jobId: 'job_1' });
  });

  it('sends a JSON content type', async () => {
    const { calls } = mockFetch({ success: true, jobId: 'job_1' });

    await api.analyzeGitHubRepository('https://github.com/o/r');

    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('surfaces a validation failure from the backend', async () => {
    mockFetch({ success: false, error: 'Unsupported repository host' });

    await expect(api.analyzeGitHubRepository('https://evil.example/r')).rejects.toThrow(
      'Unsupported repository host'
    );
  });
});

describe('api.getJobStatus', () => {
  it('requests the jobs route and returns the job', async () => {
    const job = { id: 'job_1', status: 'completed', progress: 100 };
    const { calls } = mockFetch({ success: true, data: job });

    const result = await api.getJobStatus('job_1');

    // The backend registers /api/jobs/:jobId, not /api/job/:jobId.
    expect(calls[0].url).toContain('/jobs/job_1');
    expect(calls[0].url).not.toMatch(/\/job\/job_1$/);
    expect(result).toEqual(job);
  });
describe('api.pollJobStatus', () => {
  it('resolves once the job completes', async () => {
    sequenceFetch([
      { success: true, data: { id: 'job_1', status: 'completed', progress: 100 } },
    ]);

    const job = await api.pollJobStatus('job_1');

    expect(job.status).toBe('completed');
  });

  it('rejects when the job fails', async () => {
    sequenceFetch([
      { success: true, data: { id: 'job_1', status: 'failed', error: 'clone failed' } },
    ]);

    await expect(api.pollJobStatus('job_1')).rejects.toThrow('clone failed');
  });

  it('reports each poll through the update callback', async () => {
    sequenceFetch([
      { success: true, data: { id: 'job_1', status: 'analyzing', progress: 50 } },
      { success: true, data: { id: 'job_1', status: 'completed', progress: 100 } },
    ]);

    const seen: string[] = [];
    await api.pollJobStatus('job_1', (job) => seen.push(job.status), 1);

    expect(seen).toEqual(['analyzing', 'completed']);
  });
});

describe('api.healthCheck', () => {
  it('returns the health payload without unwrapping an envelope', async () => {
    const payload = {
      status: 'ok',
      database: 'connected',
      languages: ['javascript'],
      version: '2.0.0',
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    const { calls } = mockFetch(payload);

    const health = await api.healthCheck();

    expect(calls[0].url).toContain('/health');
    expect(health).toEqual(payload);
  });
});

describe('api.clearGraph', () => {
  it('issues a DELETE and does not throw on success', async () => {
    const { calls } = mockFetch({ success: true });

    await expect(api.clearGraph()).resolves.toBeUndefined();
    expect(calls[0].init?.method).toBe('DELETE');
  });

  it('throws when the clear fails', async () => {
    mockFetch({ success: false, error: 'Delete failed' });

    await expect(api.clearGraph()).rejects.toThrow('Delete failed');
  });
});

  it('throws when the job is not found', async () => {
    mockFetch({ success: false, error: 'Job not found' });

    await expect(api.getJobStatus('nope')).rejects.toThrow('Job not found');
  });
});
  it('throws the server error message rather than a generic one', async () => {
    mockFetch({ success: false, error: 'Repository not found' });

    await expect(api.fetchGraph()).rejects.toThrow('Repository not found');
  });

  it('throws when the envelope reports success but carries no data', async () => {
    mockFetch({ success: true });

    await expect(api.fetchGraph()).rejects.toThrow('Failed to fetch graph data');
  });
});