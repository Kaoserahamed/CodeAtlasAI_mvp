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
   * Trigger repository scan
   */
  async scanRepository(path: string): Promise<ApiResponse<GraphData>['data']> {
    const response = await fetch(`${API_BASE}/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path }),
    });

    const json: ApiResponse<GraphData> = await response.json();

    if (!json.success) {
      throw new Error(json.error || 'Failed to scan repository');
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
   * Get graph statistics
   */
  async getStats(): Promise<ApiResponse<GraphData>['data']> {
    const response = await fetch(`${API_BASE}/stats`);
    const json: ApiResponse<GraphData> = await response.json();

    if (!json.success) {
      throw new Error(json.error || 'Failed to fetch stats');
    }

    return json.data;
  },

  /**
   * Analyze GitHub repository
   */
  async analyzeGitHubRepository(repoUrl: string): Promise<{ jobId: string }> {
    const response = await fetch(`${API_BASE}/analyze-github`, {
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
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<Job> {
    const response = await fetch(`${API_BASE}/job/${jobId}`);
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
