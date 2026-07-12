/**
 * API Service for communicating with backend
 */

import { GraphData, ApiResponse } from '../types';

const API_BASE = '/api';

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
  async scanRepository(path: string): Promise<any> {
    const response = await fetch(`${API_BASE}/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path }),
    });

    const json: ApiResponse<any> = await response.json();

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
  async healthCheck(): Promise<any> {
    const response = await fetch(`${API_BASE}/health`);
    return await response.json();
  },

  /**
   * Get graph statistics
   */
  async getStats(): Promise<any> {
    const response = await fetch(`${API_BASE}/stats`);
    const json: ApiResponse<any> = await response.json();

    if (!json.success) {
      throw new Error(json.error || 'Failed to fetch stats');
    }

    return json.data;
  },
};
