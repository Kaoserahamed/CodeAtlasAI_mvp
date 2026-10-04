/**
 * Core type definitions for CodeAtlas.
 *
 * Design rules enforced here:
 *  - Every node/edge id is deterministic and repo-scoped (no absolute FS paths).
 *  - Every relationship carries a resolution tier + confidence so the UI can be
 *    honest about what static analysis could NOT prove.
 */

// ---------------------------------------------------------------------------
// Graph vocabulary
// ---------------------------------------------------------------------------

export type NodeKind =
  | 'Repository'
  | 'File'
  | 'Module'
  | 'Class'
  | 'Interface'
  | 'Function'
  | 'Method'
  | 'ExternalModule';

export type EdgeKind =
  | 'CONTAINS'
  | 'DEFINES'
  | 'IMPORTS'
  | 'REEXPORTS'
  | 'CALLS'
  | 'EXTENDS'
  | 'IMPLEMENTS';

/**
 * How much we trust a relationship.
 *  - resolved : provable from the AST + import graph (high confidence)
 *  - inferred : best guess (name match inside an imported file, heuristic)
 *  - unknown  : callee exists but target could not be identified
 */
export type ResolutionTier = 'resolved' | 'inferred' | 'unknown';

export interface SourceLocation {
  startLine: number;
  endLine: number;
  startColumn?: number;
}

/** Position + tier attached to every relationship. */
export interface RelationshipMeta {
  resolution: ResolutionTier;
  confidence: number;
  line?: number;
}

export interface GraphNodeBase {
  id: string;
  kind: NodeKind;
  name: string;
  repoId: string;
  /** POSIX-normalised, repo-relative path (files only). */
  path?: string;
  language?: string;
  startLine?: number;
  endLine?: number;
  /** Set on Function/Method nodes. */
  parameters?: string[];
  /** `Foo.bar` style fully qualified name. */
  qualifiedName?: string;
  /** Module/folder this symbol belongs to (e.g. `src/api`). */
  modulePath?: string;
  complexity?: number;
  isExported?: boolean;
  isTest?: boolean;
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  meta: RelationshipMeta;
}

// ---------------------------------------------------------------------------
// Deterministic identifiers
// ---------------------------------------------------------------------------

/**
 * Ids are content-derived, not filesystem-derived.
 * The same repository analysed on two machines produces identical ids, which
 * is what makes incremental scans and cross-commit graph diffs possible.
 */
export const ids = {
  repository: (repoId: string) => `repo:${repoId}`,
  file: (repoId: string, relPath: string) => `file:${repoId}:${relPath}`,
  module: (repoId: string, modulePath: string) =>
    `module:${repoId}:${modulePath.replace(/\\/g, '/')}`,
  /** Symbol ids use path + qualified name + start line for disambiguation. */
  symbol: (
    repoId: string,
    relPath: string,
    qualifiedName: string,
    startLine: number
  ) => `symbol:${repoId}:${relPath}#${qualifiedName}@${startLine}`,
  external: (repoId: string, moduleName: string) =>
    `external:${repoId}:${moduleName}`,
  edge: (from: string, kind: EdgeKind, to: string) => `${from}-${kind}->${to}`,
};

/** Strip absolute prefixes so a path is stable across machines. */
export function toRepoRelative(absolutePath: string, repoRoot: string): string {
  const rel = absolutePath.startsWith(repoRoot)
    ? absolutePath.slice(repoRoot.length)
    : absolutePath;
  return rel.replace(/\\/g, '/').replace(/^\/+/, '');
}

// ---------------------------------------------------------------------------
// Analysis runs (versioned so results are reproducible)
// ---------------------------------------------------------------------------

/** Bumped whenever parsing semantics change, to force a full re-parse. */
export const PARSER_VERSION = '2';

export interface AnalysisRun {
  repoId: string;
  /** Git commit the analysis is bound to, when known. */
  commitSha?: string;
  parserVersion: string;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  stats?: GraphStats;
}

export interface GraphStats {
  files: number;
  functions: number;
  classes: number;
  imports: number;
  calls: number;
  resolvedCalls: number;
  inferredCalls: number;
  unknownCalls: number;
  externalModules: number;
}

/** Per-file bookkeeping that makes incremental scans possible. */
export interface FileFingerprint {
  repoId: string;
  path: string;
  /** sha256 of file contents. */
  contentHash: string;
  parserVersion: string;
  sizeBytes: number;
  updatedAt: number;
}

/** Result of parsing one file, before cross-file resolution. */
export interface ParsedFile {
  repoId: string;
  /** repo-relative, POSIX separators */
  path: string;
  name: string;
  extension: string;
  language: string;
  /** import specifiers as written in source, not yet resolved to files */
  imports: RawImport[];
  symbols: RawSymbol[];
  /** calls recorded as (calleeName, line); resolved later, repo-wide */
  calls: RawCall[];
  /** syntax error, if the file failed to parse */
  error?: string;
}

export interface RawImport {
  /** literal from source, e.g. './auth' or 'express' */
  specifier: string;
  /** local name -> exported name, for named imports */
  bindings: { local: string; imported: string }[];
  namespaceBinding?: string;
  defaultBinding?: string;
  isTypeOnly: boolean;
  isRequire: boolean;
  isReExport: boolean;
  line: number;
}

export interface RawSymbol {
  name: string;
  qualifiedName: string;
  kind: 'Function' | 'Method' | 'Class' | 'Interface';
  parameters: string[];
  startLine: number;
  endLine: number;
  isExported: boolean;
  isAsync: boolean;
  /** cyclomatic complexity, computed during parse */
  complexity: number;
}

export interface RawCall {
  /** identifier as written, e.g. 'login' or 'utils.format' */
  calleeName: string;
  /** enclosing symbol id, or undefined at module top level */
  callerQualifiedName?: string;
  callerStartLine?: number;
  line: number;
}
