/**
 * Module resolution.
 *
 * Turns an import specifier as written in source into the repo-relative path
 * of the file it actually refers to. Handles the extension and index-file
 * conventions of each language family, and correctly distinguishes relative
 * paths (internal imports) from bare package names (external dependencies).
 */

/** Extensions tried when a specifier has none, most specific first. */
const EXTENSION_CANDIDATES: Record<string, string[]> = {
  javascript: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
  typescript: ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py', '.pyi'],
  java: ['.java'],
  go: ['.go'],
  ruby: ['.rb'],
  rust: ['.rs'],
  csharp: ['.cs'],
};

const INDEX_FILES = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'index.py',
  'index.go',
  'index.rb',
  'index.rs',
  '__init__.py',
  'mod.rs',
  'lib.rs',
];

/** Normalise separators and strip a leading './'. */
function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Join a file's directory with a specifier, resolving '..' segments. */
function joinPath(fromDir: string, specifier: string): string {
  const segments = fromDir ? fromDir.split('/') : [];
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join('/');
}

export interface ModuleIndex {
  /** All known repo-relative file paths. */
  files: Set<string>;
  /** Directory -> files directly inside it, for index resolution. */
  byDirectory: Map<string, string[]>;
}

export function buildModuleIndex(paths: Iterable<string>): ModuleIndex {
  const files = new Set<string>();
  const byDirectory = new Map<string, string[]>();

  for (const raw of paths) {
    const p = normalize(raw);
    files.add(p);
    const slash = p.lastIndexOf('/');
    const dir = slash === -1 ? '' : p.slice(0, slash);
    const list = byDirectory.get(dir) || [];
    list.push(p);
    byDirectory.set(dir, list);
  }
  return { files, byDirectory };
}

/** True when a specifier refers to a file inside the repository. */
export function isRelative(specifier: string): boolean {
  return (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier === '.' ||
    specifier === '..' ||
    /^[a-zA-Z]:[\\/]/.test(specifier) ||
    specifier.startsWith('/')
  );
}

/** Extract the package name from a bare specifier (`@scope/pkg/sub` -> `@scope/pkg`). */
export function packageNameOf(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.slice(0, 2).join('/');
  }
  return specifier.split('/')[0];
}

export interface ResolveOptions {
  /** Language family driving extension candidates. */
  language?: string;
  /** Language subpath used for Python-style relative imports. */
  relativeStyle?: 'slash' | 'dot';
}

/**
 * Resolve a specifier to a repo-relative file path, or null when it points
 * outside the repository (an external dependency) or at a missing file.
 */
export function resolveSpecifier(
  specifier: string,
  fromFile: string,
  index: ModuleIndex,
  options: ResolveOptions = {}
): string | null {
  if (!isRelative(specifier)) return null;

  const fromDir = fromFile.includes('/')
    ? fromFile.slice(0, fromFile.lastIndexOf('/'))
    : '';

  let candidate = normalize(joinPath(fromDir, specifier));
  if (options.relativeStyle === 'dot') {
    // Python `from . import x` collapses to the current package directory.
    if (specifier === '.') candidate = fromDir;
  }

  // Exact match (usually the specifier already carried an extension).
  if (index.files.has(candidate)) return candidate;

  const family = options.language || 'javascript';
  const extensions = EXTENSION_CANDIDATES[family] ?? EXTENSION_CANDIDATES.javascript;

  for (const ext of extensions) {
    const withExt = candidate + ext;
    if (index.files.has(withExt)) return withExt;
  }

  // Directory import: ./foo -> ./foo/index.ts
  const inDir = index.byDirectory.get(candidate);
  if (inDir) {
    for (const indexFile of INDEX_FILES) {
      const full = candidate ? `${candidate}/${indexFile}` : indexFile;
      if (index.files.has(full)) return full;
    }
  }

  // A `.js` specifier frequently refers to the TypeScript source.
  const withoutExt = candidate.replace(/\.(js|jsx|mjs|cjs)$/, '');
  if (withoutExt !== candidate) {
    for (const ext of extensions) {
      if (index.files.has(withoutExt + ext)) return withoutExt + ext;
    }
  }

  return null;
}