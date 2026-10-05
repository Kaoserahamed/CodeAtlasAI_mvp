/**
 * API Service for communicating with backend
 */

import { GraphData, ApiResponse, HealthResponse, AnalyzeResponse } from '../types';

// Use environment variable for production, fallback to /api for development
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

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
    const response = await fetch(`${API_BASE}/graph`);
    const json: ApiResponse<GraphData> = await response.json();

    if (!json.success || !json.data) {
      throw new Error(json.error || 'Failed to fetch graph data');
    }

    return json.data;
  },

  /**
   * Clear graph data
   */
  async clearGraph(): Promise<void> {
    const response = await fetch(`${API_BASE}/graph`, {
      method: 'DELETE',
    });

    const json: ApiResponse<void> = await response.json();

    if (!json.success) {
      throw new Error(json.error || 'Failed to clear graph');
    }
  },

  /**
   * Check backend health
   */
  async healthCheck(): Promise<HealthResponse> {
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
    const response = await fetch(`${API_BASE}/repositories/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ repoUrl }),
    });

    const json: AnalyzeResponse = await response.json();

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
    const response = await fetch(`${API_BASE}/jobs/${jobId}`);
    const json: ApiResponse<Job> = await response.json();

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
