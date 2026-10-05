/**
 * Frontend type definitions
 */

export interface FileNode {
  id: string;
  type: 'file';
  name: string;
  path: string;
  extension: string;
}

export interface FunctionNode {
  id: string;
  type: 'function';
  name: string;
  filePath: string;
  parameters: string[];
  startLine: number;
  endLine: number;
}

export interface GraphNode {
  id: string;
  type: 'file' | 'function';
  label: string;
  data: FileNode | FunctionNode;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'IMPORTS' | 'CALLS';
  label: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Analyze response: the job id is returned at the top level, not inside `data`. */
export interface AnalyzeResponse {
  success: boolean;
  jobId: string;
  repoId: string;
  message: string;
  error?: string;
}

/** Shape returned by GET /api/health. */
export interface HealthResponse {
  status: string;
  database: 'connected' | 'disconnected';
  languages: string[];
  version: string;
  timestamp: string;
}
