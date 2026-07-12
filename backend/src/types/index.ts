/**
 * Core type definitions for CodeAtlas
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

export interface ImportRelationship {
  from: string; // file path
  to: string;   // imported file path
  type: 'IMPORTS';
  importedSymbols?: string[];
}

export interface CallRelationship {
  from: string; // function id
  to: string;   // called function name
  type: 'CALLS';
  filePath: string;
}

export interface CodeGraph {
  files: FileNode[];
  functions: FunctionNode[];
  imports: ImportRelationship[];
  calls: CallRelationship[];
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
