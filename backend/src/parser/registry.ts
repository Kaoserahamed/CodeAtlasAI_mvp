/**
 * Parser registry: maps a file extension to the parser that understands it.
 *
 * Everything downstream (scanner, resolver, database) asks the registry for a
 * parser rather than branching on language, so adding a language touches only
 * this file and the grammar spec.
 */
import { LanguageParser, extname } from './types';
import { JavaScriptParser } from './languages/javascript';
import { TreeSitterParser } from './languages/treeSitterParser';
import { ALL_GRAMMARS } from './languages/grammars';

export class ParserRegistry {
  private parsers: LanguageParser[];
  private byExtension: Map<string, LanguageParser>;

  constructor(parsers: LanguageParser[]) {
    this.parsers = parsers;
    this.byExtension = new Map();
    for (const parser of parsers) {
      for (const ext of parser.extensions) {
        this.byExtension.set(ext.toLowerCase(), parser);
      }
    }
  }

  /** Default registry: Babel for JS/TS, tree-sitter for the rest. */
  static default(): ParserRegistry {
    const parsers: LanguageParser[] = [
      new JavaScriptParser(),
      ...ALL_GRAMMARS.map((spec) => new TreeSitterParser(spec)),
    ];
    return new ParserRegistry(parsers);
  }

  /**
   * Look up a parser by extension (`.ts`) or by any file path (`src/a/b.ts`).
   * A value that is already a bare extension must not be run through
   * `extname`, since a leading dot makes it look like an extensionless dotfile.
   */
  get(extensionOrPath: string): LanguageParser | undefined {
    const value = extensionOrPath.trim().toLowerCase();
    if (!value) return undefined;
    const looksLikeBareExtension = value.startsWith('.') && !value.includes('/');
    const ext = looksLikeBareExtension ? value : extname(value);
    return this.byExtension.get(ext);
  }

  supports(extensionOrPath: string): boolean {
    return !!this.get(extensionOrPath);
  }

  /** Every extension the registry can handle. */
  supportedExtensions(): string[] {
    return [...this.byExtension.keys()].sort();
  }

  get languages(): string[] {
    return [...new Set(this.parsers.map((p) => p.id))].sort();
  }
}