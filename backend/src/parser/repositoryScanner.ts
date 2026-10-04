/**
 * Repository scanner.
 *
 * Discovers files, hands each to the parser registry and returns per-file
 * results. It deliberately does NOT resolve imports or calls across files:
 * that is the resolver's job, and keeping the two separate is what allows
 * incremental scans to re-resolve without re-parsing.
 *
 * Scanning is asynchronous and bounded by a concurrency limit so a large
 * repository cannot exhaust memory or block the event loop.
 */
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { ParsedFile, PARSER_VERSION, toRepoRelative } from '../types';
import { ParserRegistry } from './registry';
import { extname } from './types';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  'vendor',
  'target',
  'bin',
  'obj',
  '.vscode',
  '.idea',
  '.gradle',
  'Pods',
]);

/** Files above this size are skipped: they are almost always generated. */
const MAX_FILE_BYTES = 1_500_000;

export interface ScanOptions {
  repoId: string;
  repoRoot: string;
  /** Only these paths are parsed; used for incremental scans. */
  onlyPaths?: Set<string>;
  onProgress?: (done: number, total: number, current: string) => void;
  shouldCancel?: () => boolean;
  concurrency?: number;
}

export interface ScanResult {
  files: ParsedFile[];
  /** Files that were found but could not be parsed. */
  errors: { path: string; error: string }[];
  skipped: string[];
  totalDiscovered: number;
  durationMs: number;
}

export class RepositoryScanner {
  private registry: ParserRegistry;

  constructor(registry: ParserRegistry = ParserRegistry.default()) {
    this.registry = registry;
  }

  /** Walk the tree and return repo-relative paths of parseable files. */
  async discoverFiles(repoRoot: string): Promise<string[]> {
    const found: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return; // unreadable directory should not abort the scan
      }

      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          await walk(full);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (!this.registry.supports(ext)) continue;
          try {
            const stat = await fsp.stat(full);
            if (stat.size > MAX_FILE_BYTES) continue;
          } catch {
            continue;
          }
          found.push(toRepoRelative(full, repoRoot));
        }
      }
    };

    await walk(repoRoot);
    return found.sort();
  }

  async scan(options: ScanOptions): Promise<ScanResult> {
    const started = Date.now();
    const { repoId, repoRoot } = options;

    const discovered = await this.discoverFiles(repoRoot);
    const targets = options.onlyPaths
      ? discovered.filter((p) => options.onlyPaths!.has(p))
      : discovered;

    const files: ParsedFile[] = [];
    const errors: { path: string; error: string }[] = [];
    const skipped: string[] = [];
    let done = 0;

    const limit = Math.max(1, options.concurrency ?? 8);
    let cursor = 0;
    let cancelled = false;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (cancelled || options.shouldCancel?.()) {
          cancelled = true;
          return;
        }
        const index = cursor++;
        if (index >= targets.length) return;
        const relPath = targets[index];

        try {
          const absolute = path.join(repoRoot, relPath);
          // Guard against traversal via symlinks or odd path shapes.
          if (!absolute.startsWith(path.resolve(repoRoot))) {
            skipped.push(relPath);
            continue;
          }
          const content = await fsp.readFile(absolute, 'utf-8');
          const parser = this.registry.get(relPath);
          if (!parser) {
            skipped.push(relPath);
            continue;
          }
          const parsed = await parser.parse({ repoId, path: relPath, content });
          if (parsed.error) {
            errors.push({ path: relPath, error: parsed.error });
          } else {
            files.push(parsed);
          }
        } catch (err: any) {
          errors.push({ path: relPath, error: err?.message || 'read failed' });
        } finally {
          done++;
          options.onProgress?.(done, targets.length, relPath);
        }
      }
    };

    await Promise.all(Array.from({ length: limit }, () => worker()));

    return {
      files,
      errors,
      skipped,
      totalDiscovered: discovered.length,
      durationMs: Date.now() - started,
    };
  }
}

/** Stable content fingerprint used to decide what needs re-parsing. */
export function fingerprint(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export { PARSER_VERSION };
