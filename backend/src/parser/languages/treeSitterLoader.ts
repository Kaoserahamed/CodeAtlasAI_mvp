/**
 * WebAssembly tree-sitter loader.
 *
 * The backend compiles to CommonJS but `web-tree-sitter` is ESM-only, so the
 * import is performed through an indirect dynamic import that TypeScript
 * leaves untouched (a direct `import()` would be downleveled to `require()`
 * and fail at runtime).
 *
 * WASM grammars are used rather than native bindings because native modules
 * require a compilation toolchain on every platform we need to support.
 */
import fs from 'fs';
import path from 'path';

type WasmParser = {
  parse(source: string): any | null;
  setLanguage(language: unknown): unknown;
  delete?(): void;
};

type WasmLanguage = unknown;

let initPromise: Promise<any> | null = null;
const languageCache = new Map<string, WasmLanguage>();
const parserPool: WasmParser[] = [];

/**
 * Indirection so TypeScript emits a real dynamic import, not require().
 *
 * It is overridable because vitest executes modules inside a `vm` context,
 * where a `new Function` dynamic import has no import callback registered.
 * Tests inject Vite's own dynamic import via `setDynamicImporter`.
 */
const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<any>;

let importer: (specifier: string) => Promise<any> = nativeImport;

/** Override how the ESM-only runtime is loaded. Intended for tests. */
export function setDynamicImporter(fn: (specifier: string) => Promise<any>): void {
  importer = fn;
}

export function resetDynamicImporter(): void {
  importer = nativeImport;
}

/**
 * Locate the tree-sitter WASM grammars.
 *
 * Works whether dependencies are hoisted to a monorepo root or installed
 * inside the backend, by walking upward from both this module and the process
 * working directory. Cached after the first successful lookup.
 */
let cachedDir: string | null = null;

function walkUp(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'node_modules', 'tree-sitter-wasms', 'out');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function grammarsDir(): string {
  if (cachedDir) return cachedDir;
  const found =
    walkUp(__dirname) ||
    walkUp(process.cwd()) ||
    walkUp(path.resolve(__dirname, '..'));
  if (!found) {
    throw new Error(
      'tree-sitter-wasms grammars not found. Install dependencies at the repository root.'
    );
  }
  cachedDir = found;
  return found;
}

async function initRuntime(): Promise<any> {
  if (!initPromise) {
    initPromise = (async () => {
      const mod = await importer('web-tree-sitter');
      await mod.Parser.init();
      return mod;
    })().catch((err) => {
      // Allow a later call to retry instead of caching the failure.
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export async function loadLanguage(grammar: string): Promise<WasmLanguage> {
  if (languageCache.has(grammar)) return languageCache.get(grammar)!;

  const mod = await initRuntime();
  const file = path.join(grammarsDir(), `tree-sitter-${grammar}.wasm`);
  const bytes = fs.readFileSync(file);
  const language = await mod.Language.load(bytes);
  languageCache.set(grammar, language);
  return language;
}

/**
 * Borrow a parser instance. Parsers are pooled because instantiating them per
 * file was the single largest cost in scan timings.
 */
export async function acquireParser(grammar: string): Promise<WasmParser> {
  const existing = parserPool.pop();
  const mod = await initRuntime();
  const parser: WasmParser = existing ?? new mod.Parser();
  parser.setLanguage(await loadLanguage(grammar));
  return parser;
}

export function releaseParser(parser: WasmParser): void {
  // Bound the pool so long scans do not retain unbounded WASM heap.
  if (parserPool.length < 4) parserPool.push(parser);
  else parser.delete?.();
}

/** True when the WASM runtime can be loaded at all. */
export async function isTreeSitterAvailable(): Promise<boolean> {
  try {
    await initRuntime();
    return fs.existsSync(grammarsDir());
  } catch {
    return false;
  }
}