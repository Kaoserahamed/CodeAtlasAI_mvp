/**
 * Parser abstraction.
 *
 * Language-specific syntax lives behind this interface so the shared graph
 * model stays language-agnostic. Adding a language means implementing one
 * function; nothing in the scanner, resolver or database layer changes.
 */
import { ParsedFile } from '../types';

export interface ParseContext {
  repoId: string;
  /** repo-relative path with POSIX separators */
  path: string;
  content: string;
}

export interface LanguageParser {
  /** Stable identifier, e.g. 'typescript'. */
  readonly id: string;
  /** File extensions handled by this parser, including the dot. */
  readonly extensions: string[];
  /**
   * Parse one file. Must never throw: syntax errors are returned on
   * `ParsedFile.error` so a single bad file cannot abort a whole scan.
   */
  parse(ctx: ParseContext): Promise<ParsedFile>;
  /** True when this extension maps to this parser. */
  supports(extension: string): boolean;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function extname(path: string): string {
  const base = path.split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

export function basename(path: string): string {
  return path.split('/').pop() || path;
}

/** Folder path of a repo-relative file ('' for files at the repo root). */
export function modulePathOf(relPath: string): string {
  const parts = relPath.split('/');
  parts.pop();
  return parts.join('/');
}

const TEST_HINTS = [
  '__tests__',
  '/test/',
  '/tests/',
  '/spec/',
  '.test.',
  '.spec.',
  '_test.go',
  'test_',
];

export function looksLikeTest(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return TEST_HINTS.some((h) => lower.includes(h));
}

/** Empty ParsedFile used as a fallback when a file cannot be parsed at all. */
export function emptyParsedFile(
  repoId: string,
  path: string,
  language: string,
  error?: string
): ParsedFile {
  return {
    repoId,
    path,
    name: basename(path),
    extension: extname(path),
    language,
    imports: [],
    symbols: [],
    calls: [],
    error,
  };
}