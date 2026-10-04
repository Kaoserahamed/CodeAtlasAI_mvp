/**
 * AST-aware code index for retrieval.
 *
 * Chunks are aligned to symbols rather than fixed-size windows. A window that
 * cuts a function in half produces text that matches neither half well and
 * yields citations pointing at meaningless line ranges. Symbol-aligned chunks
 * mean every retrieval can cite a real function with a real line range.
 *
 * A lexical index is always available, so retrieval works with no external
 * services and no API key. Embeddings are added when a provider is configured,
 * improving ranking but never being required.
 */
import { GraphNodeBase } from '../types';

export interface CodeChunk {
  id: string;
  repoId: string;
  path: string;
  symbolId?: string;
  symbolName?: string;
  kind: string;
  startLine: number;
  endLine: number;
  language?: string;
  /** Source text of the chunk. */
  text: string;
  /** Lower-cased text used for lexical matching. */
  searchable: string;
  /** Populated when embeddings are available. */
  embedding?: number[];
}

export interface ScoredChunk {
  chunk: CodeChunk;
  score: number;
  /** Which signals contributed, so results can be explained. */
  reasons: string[];
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'for', 'while',
  'of', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'is', 'are', 'was',
  'were', 'be', 'been', 'this', 'that', 'these', 'those', 'it', 'its', 'as',
  'import', 'export', 'const', 'let', 'var', 'function', 'return', 'class',
  'def', 'func', 'fn', 'public', 'private', 'static', 'void', 'null', 'nil',
  'true', 'false', 'self', 'this',
]);

/**
 * Split text into search terms.
 *
 * Identifiers are additionally split on case and underscores so `getUserById`
 * also matches `user`, `get` and `id`. Searching for "user" should find
 * `getUserById`.
 *
 * Case splitting happens on the ORIGINAL text, before lower-casing, since
 * lower-casing first would destroy every camelCase boundary.
 */
export function tokenize(text: string): string[] {
  const raw = text.split(/[^A-Za-z0-9_]+/).filter(Boolean);

  const terms: string[] = [];
  const add = (candidate: string) => {
    const lower = candidate.toLowerCase();
    if (lower.length < 2 || STOP_WORDS.has(lower)) return;
    terms.push(lower);
  };

  for (const token of raw) {
    add(token);

    // Split snake_case into its parts.
    for (const part of token.split(/_+/).filter((p) => p.length >= 2)) {
      add(part);
    }

    // Split camelCase and PascalCase on the original casing.
    for (const part of token.split(/(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean)) {
      add(part);
    }
  }

  return [...new Set(terms)];
}

/**
 * Build symbol-aligned chunks from the graph plus the original sources.
 *
 * Files with no parsable symbols still get one chunk each, so a repository of
 * unparseable code is still searchable by filename and content.
 */
export function buildChunks(
  repoId: string,
  nodes: GraphNodeBase[],
  sources: Map<string, string>
): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const coveredFiles = new Set<string>();

  const symbols = nodes.filter(
    (n) =>
      (n.kind === 'Function' ||
        n.kind === 'Method' ||
        n.kind === 'Class' ||
        n.kind === 'Interface') &&
      n.path &&
      n.startLine &&
      n.endLine
  );

  for (const symbol of symbols) {
    const source = sources.get(symbol.path!);
    if (!source) continue;

    const lines = source.split(/\r?\n/);
    const start = Math.max(0, symbol.startLine! - 1);
    const end = Math.min(lines.length, symbol.endLine!);
    if (end <= start) continue;

    const text = lines.slice(start, end).join('\n');
    const id = `${symbol.id}#chunk`;

    chunks.push({
      id,
      repoId,
      path: symbol.path!,
      symbolId: symbol.id,
      symbolName: symbol.name,
      kind: symbol.kind,
      startLine: symbol.startLine!,
      endLine: symbol.endLine!,
      language: symbol.language,
      text,
      searchable: buildSearchable(symbol, text),
    });

    coveredFiles.add(symbol.path!);
  }

  // Whole-file fallbacks for files with no extracted symbols.
  for (const [path, source] of sources) {
    if (coveredFiles.has(path)) continue;
    const lines = source.split(/\r?\n/);

    // Cap file-level chunks so one huge file cannot dominate the index.
    const WINDOW = 120;
    for (let i = 0; i < lines.length; i += WINDOW) {
      const start = i;
      const end = Math.min(lines.length, i + WINDOW);
      const text = lines.slice(start, end).join('\n');
      if (!text.trim()) continue;

      chunks.push({
        id: `file:${repoId}:${path}:${start + 1}`,
        repoId,
        path,
        kind: 'File',
        startLine: start + 1,
        endLine: end,
        text,
        searchable: `${path} ${text}`,
      });
    }
  }

  return chunks;
}

/**
 * Path, qualified name and source are all searchable, so a query can match a
 * file name or a symbol name as well as the body.
 *
 * Case is preserved deliberately: `tokenize` needs the original casing to split
 * camelCase identifiers, so lower-casing here would make `getUserById`
 * unsearchable by "user".
 */
function buildSearchable(symbol: GraphNodeBase, text: string): string {
  return [symbol.path, symbol.qualifiedName, symbol.name, text]
    .filter(Boolean)
    .join(' ');
}

/**
 * Common derivational suffixes, longest first so `ation` is stripped before
 * `ion`.
 *
 * Only long, unambiguous endings are listed. Aggressive stemming ("running" to
 * "runn") tends to collapse distinct identifiers together, which on code is
 * worse than missing a match.
 */
const SUFFIXES = [
  'ization', 'isation', 'ation', 'ition', 'ating', 'ement', 'ments',
  'ment', 'ness', 'able', 'ible', 'ance', 'ence', 'ings', 'ing', 'ies',
  'ion', 'ate', 'ity', 'ies', 'ers', 'er', 'ed', 'es', 's', 'e',
];

/**
 * Reduce a term to a crude stem.
 *
 * This exists because developers do not search using identifier names. Asking
 * about "authentication" must find `authenticate`, and "sessions" must find
 * `session`. A real stemmer would be better, but this is predictable and, more
 * importantly, never merges two identifiers a developer would consider
 * distinct.
 *
 * Two guards keep it conservative:
 *  - A stripped result must be at least five characters, so short nouns are not
 *    mangled. Without this, `session` becomes `sess` and no longer matches
 *    `sessions`.
 *  - A suffix is only applied if it actually removes something, so `session`
 *    does not try the trailing `s` rule and reduce to itself.
 */
export function stem(token: string): string {
  if (token.length <= 5) return token;

  for (const suffix of SUFFIXES) {
    if (!token.endsWith(suffix)) continue;
    const base = token.slice(0, -suffix.length);
    // Require a substantial, actually-shorter stem.
    if (base.length >= 5 && base !== token) return base;
  }
  return token;
}

/**
 * Do two terms refer to the same thing closely enough to match?
 *
 * Exact equality is too strict for code, so this compares stems first and then
 * allows a shared prefix. A prefix floor of five characters is required, since
 * without it short words match on a couple of characters and every search
 * returns noise.
 */
export function termsMatch(a: string, b: string): boolean {
  if (a === b) return true;

  // Stemming absorbs the common derivational pairs: authentication/authenticate.
  const stemmedA = stem(a);
  const stemmedB = stem(b);
  if (stemmedA === stemmedB) return true;

  const shorter = stemmedA.length <= stemmedB.length ? stemmedA : stemmedB;
  const longer = stemmedA.length <= stemmedB.length ? stemmedB : stemmedA;

  if (shorter.length >= 5 && longer.startsWith(shorter)) return true;

  // A trailing plural is common and cheap to absorb.
  if (shorter.length >= 4 && longer === `${shorter}s`) return true;

  return false;
}

/** True when any term in `candidates` matches any term in `queryTerms`. */
export function anyTermMatches(
  candidates: string[],
  queryTerms: string[]
): boolean {
  return candidates.some((candidate) =>
    queryTerms.some((term) => termsMatch(candidate, term))
  );
}

/**
 * In-memory lexical index with optional vector search.
 *
 * Lexical retrieval (BM25-style term weighting) is the baseline and is always
 * available. Vector search is layered on when embeddings exist, because on
 * code the exact identifier usually matters more than semantic similarity, and
 * a pure-vector index will happily rank a loosely-related file above the one
 * that literally names the symbol the user asked about.
 */
export interface IndexStats {
  chunks: number;
  terms: number;
  hasEmbeddings: boolean;
}

export class CodeIndex {
  private chunks: CodeChunk[] = [];
  private termFrequency = new Map<number, Map<string, number>>();
  /** Per chunk, term counts keyed by stem, so related words can score. */
  private stemFrequency = new Map<number, Map<string, number>>();
  private documentFrequency = new Map<string, number>();
  private chunkTokens: string[][] = [];
  private averageLength = 0;
  private embedded = false;

  /** Rebuild the index from scratch. */
  build(chunks: CodeChunk[]): void {
    this.chunks = chunks;
    this.termFrequency = new Map();
    this.stemFrequency = new Map();
    this.documentFrequency = new Map();
    this.chunkTokens = [];
    this.embedded = chunks.some((c) => Array.isArray(c.embedding));

    let totalLength = 0;

    chunks.forEach((chunk, index) => {
      const tokens = tokenize(chunk.searchable);
      this.chunkTokens.push(tokens);
      totalLength += tokens.length;

      const tf = new Map<string, number>();
      const stemTf = new Map<string, number>();

      for (const token of tokens) {
        tf.set(token, (tf.get(token) ?? 0) + 1);
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);

        // Stemmed counts let a query for "authentication" score a chunk that
        // only ever says "authenticate".
        const stemmed = stem(token);
        if (stemmed !== token) {
          stemTf.set(stemmed, (stemTf.get(stemmed) ?? 0) + 1);
        }
      }

      this.termFrequency.set(index, tf);
      this.stemFrequency.set(index, stemTf);
    });

    this.averageLength = chunks.length ? totalLength / chunks.length : 1;
  }

  get size(): number {
    return this.chunks.length;
  }

  stats(): IndexStats {
    return {
      chunks: this.chunks.length,
      terms: this.documentFrequency.size,
      hasEmbeddings: this.embedded,
    };
  }

  allChunks(): CodeChunk[] {
    return this.chunks;
  }

  /**
   * Rank chunks against a query using BM25, boosted when a chunk's symbol name
   * or path matches a query term exactly, since naming a function is the
   * strongest signal available.
   */
  search(query: string, limit = 8): ScoredChunk[] {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0 || this.chunks.length === 0) return [];

    const k1 = 1.5;
    const b = 0.75;
    const total = this.chunks.length;
    const scored: ScoredChunk[] = [];
    const strongTerms = new Set(queryTerms.filter((t) => t.length >= 3));

    for (let i = 0; i < total; i++) {
      const tf = this.termFrequency.get(i);
      if (!tf) continue;

      let score = 0;
      let matched = 0;
      const stemTf = this.stemFrequency.get(i);

      for (const term of queryTerms) {
        // Fall back to a stem match so related word forms still contribute.
        const stemmed = stem(term);
        const f = tf.get(term) ?? stemTf?.get(stemmed);
        if (!f) continue;
        matched++;

        const df = this.documentFrequency.get(term) ?? 1;
        // BM25 idf, floored so an extremely common term cannot go negative.
        const idf = Math.max(0.05, Math.log(1 + (total - df + 0.5) / (df + 0.5)));
        const lengthNorm =
          1 - b + b * (this.chunkTokens[i].length / (this.averageLength || 1));
        score += idf * ((f * (k1 + 1)) / (f + k1 * lengthNorm));
      }

      if (score <= 0) continue;

      const reasons = [`${matched}/${queryTerms.length} query terms matched`];
      const chunk = this.chunks[i];

      if (chunk.symbolName) {
        // Prefix-tolerant so "authentication" finds `authenticateUser`.
        if (anyTermMatches(tokenize(chunk.symbolName), queryTerms)) {
          score *= 1.6;
          reasons.push('symbol name matches a query term');
        }
      }

      if (chunk.path && strongTerms.size > 0) {
        if (anyTermMatches(tokenize(chunk.path), queryTerms)) {
          score *= 1.2;
          reasons.push('file path matches a query term');
        }
      }

      scored.push({ chunk, score, reasons });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /** Attach embeddings to chunks already in the index. */
  setEmbeddings(embeddings: (number[] | undefined)[]): void {
    if (embeddings.length !== this.chunks.length) {
      throw new Error(
        `Embedding count ${embeddings.length} does not match chunk count ${this.chunks.length}`
      );
    }
    embeddings.forEach((embedding, i) => {
      this.chunks[i].embedding = embedding ?? undefined;
    });
    this.embedded = this.chunks.some((c) => Array.isArray(c.embedding));
  }

  /** Cosine similarity between two equal-length vectors. */
  static cosine(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Blend vector similarity into the lexical ranking.
   *
   * Vector is deliberately the minority signal: on code, an exact identifier
   * match should usually outrank a semantically similar but differently-named
   * chunk.
   */
  combineWithVectors(
    lexical: ScoredChunk[],
    queryEmbedding: number[],
    vectorWeight = 0.35
  ): ScoredChunk[] {
    if (!this.embedded || queryEmbedding.length === 0) return lexical;

    const maxLexical = Math.max(...lexical.map((s) => s.score), 1e-9);
    const byId = new Map(lexical.map((s) => [s.chunk.id, s]));

    for (const chunk of this.chunks) {
      if (!chunk.embedding) continue;
      const similarity = CodeIndex.cosine(queryEmbedding, chunk.embedding);
      const existing = byId.get(chunk.id);

      if (existing) {
        byId.set(chunk.id, {
          chunk,
          score: existing.score / maxLexical + vectorWeight * similarity,
          reasons: [...existing.reasons, `vector similarity ${similarity.toFixed(2)}`],
        });
      } else if (similarity > 0.2) {
        // Lexical scoring found nothing, but semantics may still be relevant.
        byId.set(chunk.id, {
          chunk,
          score: vectorWeight * similarity,
          reasons: [`semantic match only (${similarity.toFixed(2)})`],
        });
      }
    }

    return [...byId.values()].sort((a, b) => b.score - a.score);
  }
}