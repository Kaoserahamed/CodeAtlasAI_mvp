/**
 * API Service for communicating with backend
 */

import { GraphData, ApiResponse, HealthResponse, AnalyzeResponse } from '../types';
import { logger } from './logger';

// Use environment variable for production, fallback to /api for development
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * Issue a request and return the response envelope.
 *
 * Every call funnels through here so a failed request is logged in one place,
 * carrying the route, the method and the reason. Without it a failure in the
 * transport and one the server rejected look identical in the console, and
 * neither says which route failed.
 *
 * `T` is the payload type carried in `data`, not the envelope. Unwrapping is
 * left to each caller because they differ: most need `data`, but the analyze
 * route returns its job id at the top level and health returns no envelope at
 * all.
 */
async function request<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (cause) {
    // A network failure never produced a response, so the server cannot be
    // asked what went wrong. Logged with the route, then rethrown so the
    // caller still handles it.
    logger.error('api', `request to ${path} failed before reaching the server`, {
      path,
      cause,
    });
    throw cause;
  }

  const json = (await response.json()) as ApiResponse<T>;

  if (!json.success) {
    logger.error('api', `${init?.method ?? 'GET'} ${path} returned ${response.status}`, {
      path,
      method: init?.method ?? 'GET',
      status: response.status,
      error: json.error,
    });
  }

  return json;
}

export interface Job {
  id: string;
  repoUrl: string;
  status: 'pending' | 'cloning' | 'analyzing' | 'storing' | 'completed' | 'failed';
  progress: number;
  message: string;
  startTime: number;
  endTime?: number;
  error?: string;
  stats?: {
    files: number;
    functions: number;
    imports: number;
    calls: number;
  };
}

export const api = {
  /**
   * Fetch graph data from backend
   */
  async fetchGraph(): Promise<GraphData> {
    const json = await request<GraphData>('/graph');

    if (!json.success || !json.data) {
      throw new Error(json.error || 'Failed to fetch graph data');
    }

    return json.data;
  },

  /**
   * Clear graph data
   */
  async clearGraph(): Promise<void> {
    const json = await request<void>('/graph', { method: 'DELETE' });

    if (!json.success) {
      throw new Error(json.error || 'Failed to clear graph');
    }
  },

  /**
   * Check backend health
   */
  async healthCheck(): Promise<HealthResponse> {
    // Health answers with a bare payload rather than the envelope, so it is
    // fetched directly rather than through `request`.
    const response = await fetch(`${API_BASE}/health`);
    return (await response.json()) as HealthResponse;
  },

  /**
   * Queue an analysis run.
   *
   * The route is /api/repositories/analyze; the backend answers 202 with the
   * job id at the top level of the body rather than inside `data`.
   */
  async analyzeGitHubRepository(repoUrl: string): Promise<{ jobId: string }> {
    // AnalyzeResponse is the shape the server actually returns; the cast is
    // where the request helper's envelope return meets a body that is not one.
    const json = (await request('/repositories/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl }),
    })) as unknown as AnalyzeResponse;

    if (!json.success) {
      throw new Error(json.error || 'Failed to start repository analysis');
    }

    return { jobId: json.jobId || '' };
  },

  /**
   * Get job status.
   *
   * The route is /api/jobs/:jobId; the plural matters, the singular 404s.
   */
  async getJobStatus(jobId: string): Promise<Job> {
    const json = await request<Job>(`/jobs/${jobId}`);

    if (!json.success || !json.data) {
      throw new Error(json.error || 'Failed to fetch job status');
    }

    return json.data;
  },

  /**
   * Poll job status until completion or failure
   */
  async pollJobStatus(
    jobId: string,
    onUpdate?: (job: Job) => void,
    interval: number = 2000
  ): Promise<Job> {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const job = await this.getJobStatus(jobId);
          
          if (onUpdate) {
            onUpdate(job);
          }

          if (job.status === 'completed') {
            resolve(job);
          } else if (job.status === 'failed') {
            reject(new Error(job.error || 'Job failed'));
          } else {
            // Continue polling
            setTimeout(poll, interval);
          }
        } catch (error) {
          reject(error);
        }
      };

      poll();
    });
  },
};
