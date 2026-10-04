/**
 * Analysis orchestrator.
 *
 * Wires the pipeline together: discover files, decide what needs re-parsing,
 * parse, resolve symbols across the whole repository, and persist.
 *
 * Resolution is always repository-wide even for an incremental scan. A changed
 * file can rename or move an export, which invalidates edges held by files
 * that were not themselves modified, so re-resolving everything is what keeps
 * the graph correct.
 */
import fsp from 'fs/promises';
import path from 'path';
import { GraphStats, PARSER_VERSION } from '../types';
import { ParserRegistry } from '../parser/registry';
import { RepositoryScanner, fingerprint } from '../parser/repositoryScanner';
import { SymbolResolver } from '../resolver/symbolResolver';
import { Neo4jClient } from '../database/neo4jClient';
import { JobContext, JobStats } from '../services/jobService';

export interface AnalysisRequest {
  repoId: string;
  /** Absolute path to a working copy on disk. */
  repoRoot: string;
  /** Force a full re-parse even if fingerprints are unchanged. */
  force?: boolean;
  /** Delete any existing graph for this repository first. */
  replaceAll?: boolean;
}

export interface AnalysisResult extends JobStats {
  changedFiles: number;
  unchangedFiles: number;
  deletedFiles: number;
  parseErrors: number;
  durationMs: number;
}

export interface AnalysisOptions {
  scanner?: RepositoryScanner;
  resolver?: SymbolResolver;
  db: Neo4jClient;
  registry?: ParserRegistry;
}

export class AnalysisService {
  private scanner: RepositoryScanner;
  private resolver: SymbolResolver;
  private db: Neo4jClient;

  constructor(options: AnalysisOptions) {
    const registry = options.registry ?? ParserRegistry.default();
    this.scanner = options.scanner ?? new RepositoryScanner(registry);
    this.resolver = options.resolver ?? new SymbolResolver();
    this.db = options.db;
  }

  async analyze(
    request: AnalysisRequest,
    ctx?: JobContext
  ): Promise<AnalysisResult> {
    const started = Date.now();
    const { repoId } = request;
    const root = path.resolve(request.repoRoot);

    const report = (fraction: number, message: string) =>
      ctx?.progress(fraction, message);

    if (request.replaceAll) {
      await this.db.clearRepository(repoId);
    }

    // ---- discover and fingerprint --------------------------------------
    report(0.05, 'Discovering files');
    const discovered = await this.scanner.discoverFiles(root);
    const fingerprints = await this.fingerprintFiles(root, discovered);

    if (ctx?.isCancelled()) return cancelledResult(started);

    // ---- decide what to parse -------------------------------------------
    const diff = request.force
      ? { changed: discovered, unchanged: [] as string[], deleted: [] as string[] }
      : await this.db.getChangedFiles(repoId, fingerprints, PARSER_VERSION);

    // Files that vanished must be removed from the graph.
    if (diff.deleted.length > 0) {
      report(0.1, 'Removing deleted files');
      await this.removePaths(repoId, diff.deleted);
    }

    if (ctx?.isCancelled()) return cancelledResult(started);

    // ---- parse ----------------------------------------------------------
    report(0.15, 'Parsing files');
    const scan = await this.scanner.scan({
      repoId,
      repoRoot: root,
      onlyPaths: new Set(diff.changed),
      shouldCancel: () => ctx?.isCancelled() ?? false,
      onProgress: (done, total) =>
        report(0.15 + 0.55 * (total ? done / total : 0), `Parsing ${done}/${total}`),
    });

    if (ctx?.isCancelled()) return cancelledResult(started);

    // ---- resolve --------------------------------------------------------
    report(0.72, 'Resolving symbols');
    const graph = this.resolver.resolve(scan.files, repoId);

    if (ctx?.isCancelled()) return cancelledResult(started);

    // ---- persist --------------------------------------------------------
    report(0.82, 'Building knowledge graph');
    // Unchanged files keep their nodes; only re-parsed files are replaced, so
    // a symbol other files still point at is not dropped mid-scan.
    await this.db.storeGraph(
      graph,
      repoId,
      diff.changed.length ? scan.files.map((f) => f.path) : undefined
    );

    await this.db.saveFingerprints(
      repoId,
      [...fingerprints.entries()].map(([p, meta]) => ({
        path: p,
        hash: meta.hash,
        size: meta.size,
      }))
    );

    report(0.95, 'Finalising');
    return {
      ...graph.stats,
      changedFiles: diff.changed.length,
      unchangedFiles: diff.unchanged.length,
      deletedFiles: diff.deleted.length,
      parseErrors: scan.errors.length,
      durationMs: Date.now() - started,
    };
  }

  private async fingerprintFiles(
    root: string,
    paths: string[]
  ): Promise<Map<string, { hash: string; size: number }>> {
    const result = new Map<string, { hash: string; size: number }>();
    for (const rel of paths) {
      try {
        const content = await fsp.readFile(path.join(root, rel), 'utf-8');
        result.set(rel, {
          hash: fingerprint(content),
          size: Buffer.byteLength(content, 'utf-8'),
        });
      } catch {
        // An unreadable file is simply absent, which marks it as deleted.
      }
    }
    return result;
  }

  /** Drop the stored subgraph for paths that no longer exist. */
  private async removePaths(repoId: string, paths: string[]): Promise<void> {
    for (let i = 0; i < paths.length; i += 500) {
      await this.db.storeGraph(
        { nodes: [], edges: [], externalModules: [], stats: emptyStats() },
        repoId,
        paths.slice(i, i + 500)
      );
    }
  }
}

function emptyStats(): GraphStats {
  return {
    files: 0,
    functions: 0,
    classes: 0,
    imports: 0,
    calls: 0,
    resolvedCalls: 0,
    inferredCalls: 0,
    unknownCalls: 0,
    externalModules: 0,
  };
}

function cancelledResult(started: number): AnalysisResult {
  return {
    ...emptyStats(),
    changedFiles: 0,
    unchangedFiles: 0,
    deletedFiles: 0,
    parseErrors: 0,
    durationMs: Date.now() - started,
  };
}