/**
 * Codebase question answering.
 *
 * Answers are always accompanied by citations: a file path, a symbol name and
 * a line range. When no model is configured the assistant still answers, by
 * presenting the retrieved source and the graph facts that were found. That is
 * deliberate: a tool that refuses to work without an API key is less useful
 * than one that degrades to something honest and still actionable.
 *
 * Nothing reaches an external provider unless a key is configured, and prompt
 * text is redacted before it is sent.
 */
import { CodeIndex, ScoredChunk, anyTermMatches, tokenize } from './codeIndex';
import { redactForPrompt } from './secretScanner';
import { GraphEdge, GraphNodeBase } from '../types';
import { LlmClient } from './llmService';

export interface Citation {
  path: string;
  symbolName?: string;
  startLine: number;
  endLine: number;
  kind: string;
  /** Why this source was retrieved, shown in the UI. */
  matchedBecause: string[];
  /** The excerpt the answer is based on. */
  excerpt: string;
}

export interface AssistantAnswer {
  answer: string;
  citations: Citation[];
  /** How the answer was produced. */
  mode: 'ai' | 'retrieval-only';
  /** Symbols whose names appear in the question. */
  relatedSymbols: { name: string; path?: string; id: string }[];
  /** Follow-on questions derived from what was found. */
  suggestions: string[];
  /** True when nothing in the repository matched. */
  noMatch: boolean;
}

export interface AskOptions {
  repoId: string;
  question: string;
  limit?: number;
}

const EXCERPT_LIMIT = 1200;

export class AssistantService {
  constructor(private llm: LlmClient) {}

  async ask(
    index: CodeIndex,
    graph: { nodes: GraphNodeBase[]; edges: GraphEdge[] },
    options: AskOptions
  ): Promise<AssistantAnswer> {
    const limit = Math.min(Math.max(options.limit ?? 6, 1), 12);
    const retrieved = index.search(options.question, limit);
    const relatedSymbols = this.matchSymbolsByName(graph.nodes, options.question);

    const citations: Citation[] = retrieved.map(({ chunk, reasons }) =>
      this.toCitation(chunk, reasons)
    );

    const mode: 'ai' | 'retrieval-only' = this.llm.isAvailable() ? 'ai' : 'retrieval-only';

    // Nothing matched: say so rather than inventing an answer.
    if (retrieved.length === 0 && relatedSymbols.length === 0) {
      return {
        answer:
          'No matching code was found in this repository for that question. ' +
          'Static analysis can only answer about code it has parsed, so this may ' +
          'mean the relevant code is in a file that could not be parsed, or lives in ' +
          'a dependency rather than in this repository.',
        citations: [],
        mode,
        relatedSymbols: [],
        suggestions: [],
        noMatch: true,
      };
    }

    if (this.llm.isAvailable()) {
      try {
        const answer = await this.askModel(retrieved, relatedSymbols, options.question);
        return {
          answer,
          citations,
          mode: 'ai',
          relatedSymbols,
          suggestions: this.suggest(retrieved),
          noMatch: false,
        };
      } catch (err) {
        // A provider failure must not discard the retrieved evidence.
        return {
          answer:
            `${this.retrievalSummary(retrieved, relatedSymbols)}\n\n` +
            `(The language model could not be reached: ${
              err instanceof Error ? err.message : 'unknown error'
            }. Showing retrieved source instead.)`,
          citations,
          mode: 'retrieval-only',
          relatedSymbols,
          suggestions: this.suggest(retrieved),
          noMatch: false,
        };
      }
    }

    return {
      answer: this.retrievalSummary(retrieved, relatedSymbols),
      citations,
      mode: 'retrieval-only',
      relatedSymbols,
      suggestions: this.suggest(retrieved),
      noMatch: false,
    };
  }

  private toCitation(
    chunk: {
      path: string;
      symbolName?: string;
      startLine: number;
      endLine: number;
      kind: string;
      text: string;
    },
    reasons: string[]
  ): Citation {
    return {
      path: chunk.path,
      symbolName: chunk.symbolName,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      kind: chunk.kind,
      matchedBecause: reasons,
      excerpt:
        chunk.text.length > EXCERPT_LIMIT
          ? `${chunk.text.slice(0, EXCERPT_LIMIT)}\n... (truncated)`
          : chunk.text,
    };
  }

  /** Symbols whose own name corresponds to a term in the question. */
  private matchSymbolsByName(
    nodes: GraphNodeBase[],
    question: string
  ): { name: string; path?: string; id: string }[] {
    const queryTerms = tokenize(question).filter((t) => t.length >= 3);
    if (queryTerms.length === 0) return [];

    const matches: { name: string; path?: string; id: string }[] = [];
    for (const node of nodes) {
      if (node.kind === 'File' || node.kind === 'ExternalModule') continue;
      // Prefix-tolerant, so "Where is user authentication implemented?" finds
      // authenticateUser rather than nothing.
      if (anyTermMatches(tokenize(node.name), queryTerms)) {
        matches.push({ name: node.name, path: node.path, id: node.id });
      }
      if (matches.length >= 10) break;
    }
    return matches;
  }

  /**
   * Ask the model, instructing it to cite only from the supplied sources and to
   * admit when the evidence does not support an answer.
   */
  private async askModel(
    retrieved: ScoredChunk[],
    relatedSymbols: { name: string; path?: string }[],
    question: string
  ): Promise<string> {
    const context = retrieved
      .map((r, i) => {
        const where = `${r.chunk.path}:${r.chunk.startLine}-${r.chunk.endLine}`;
        return `--- Source ${i + 1}: ${where} ---\n${r.chunk.text}`;
      })
      .join('\n\n');

    // Redacted on the way out, so a credential in source never reaches a third
    // party even if detection missed it.
    const safeContext = redactForPrompt(context);
    const safeQuestion = redactForPrompt(question);

    const symbolHint = relatedSymbols.length
      ? `\n\nSymbols in this repository whose names match the question: ${relatedSymbols
          .map((s) => `${s.name} (${s.path ?? 'unknown path'})`)
          .join(', ')}.`
      : '';

    const prompt = [
      'You answer questions about one specific codebase using only the source excerpts given below.',
      'You must follow these rules:',
      '- Base every claim strictly on the excerpts. Never speculate about code you were not shown.',
      '- Cite inline with [Source N] markers so each claim can be traced.',
      '- If the excerpts do not contain enough to answer, say so plainly and name what is missing.',
      '- Be concise and concrete, and name files and functions explicitly.',
      '',
      `Question: ${safeQuestion}`,
      symbolHint,
      '',
      'Source excerpts:',
      safeContext,
    ].join('\n');

    return this.llm.complete(prompt);
  }

  /**
   * Answer without a model, by reporting what was found. Honest about being
   * retrieval rather than presenting it as a written answer.
   */
  private retrievalSummary(
    retrieved: ScoredChunk[],
    relatedSymbols: { name: string; path?: string }[]
  ): string {
    const lines: string[] = [];

    if (retrieved.length === 0) {
      lines.push('No source code matched that question closely enough to quote.');
    } else {
      lines.push('This is the closest matching source in the repository:');
      lines.push('');
      for (const { chunk, reasons } of retrieved.slice(0, 3)) {
        const where = chunk.symbolName
          ? `${chunk.path}:${chunk.startLine}-${chunk.endLine} (${chunk.symbolName})`
          : `${chunk.path}:${chunk.startLine}-${chunk.endLine}`;
        lines.push(`- ${where}`);
        lines.push(`  matched because: ${reasons.join('; ')}`);
      }
      lines.push('');
      lines.push(
        'Configure a language model key to get a written explanation. Without one, ' +
          'the retrieved source above is the evidence any answer would rest on.'
      );
    }

    if (relatedSymbols.length > 0) {
      lines.push('');
      lines.push('Related symbols found in the graph:');
      for (const symbol of relatedSymbols.slice(0, 8)) {
        lines.push(`- ${symbol.name}${symbol.path ? ` in ${symbol.path}` : ''}`);
      }
    }

    return lines.join('\n');
  }

  /** Follow-on questions derived from what was retrieved. */
  private suggest(retrieved: ScoredChunk[]): string[] {
    const suggestions: string[] = [];

    for (const { chunk } of retrieved.slice(0, 2)) {
      if (chunk.symbolName) {
        suggestions.push(`What calls ${chunk.symbolName}?`);
        suggestions.push(`What would break if I changed ${chunk.symbolName}?`);
      } else if (chunk.path) {
        suggestions.push(`What does ${chunk.path} do?`);
      }
    }

    return [...new Set(suggestions)].slice(0, 5);
  }
}