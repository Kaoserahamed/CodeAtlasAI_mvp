/**
 * Tree-sitter backed parser, used for languages Babel cannot handle.
 *
 * Each language is described declaratively (which node types are functions,
 * methods, classes, imports) so adding a language is a data change rather
 * than new traversal code.
 */
import { ParsedFile, RawImport } from '../../types';
import {
  LanguageParser,
  ParseContext,
  basename,
  emptyParsedFile,
  extname,
} from '../types';
import { acquireParser, releaseParser } from './treeSitterLoader';
import { estimateComplexity } from './javascript';

export interface GrammarSpec {
  id: string;
  extensions: string[];
  /** WASM grammar file name, without the tree-sitter- prefix. */
  grammar: string;
  functionNodes: string[];
  methodNodes: string[];
  classNodes: string[];
  interfaceNodes: string[];
  importNodes: string[];
  callNodes: string[];
  /** Fields to try, in order, when reading a declared name. */
  nameFields: string[];
  /**
   * How the module path of an import is written for this language.
   *  - quoted  : a string literal (Go, Java, Rust, JS)
   *  - dotted  : a dotted/relative name (Python)
   */
  importPathStyle: 'quoted' | 'dotted';
  /** Node types that make up a dotted module path. */
  dottedParts?: string[];
}

function textOf(node: any, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

/** Callee as written, e.g. `utils.format` or `self.request`. */
function calleeText(node: any, source: string): string | undefined {
  const text = textOf(node, source).trim();
  if (!text) return undefined;
  // Only static shapes are understood; dynamic ones stay unresolved.
  if (/^[A-Za-z_$][\w$]*(\s*\.\s*[A-Za-z_$][\w$]*)*$/.test(text)) {
    return text.replace(/\s+/g, '');
  }
  return undefined;
}

export class TreeSitterParser implements LanguageParser {
  readonly id: string;
  readonly extensions: string[];
  private spec: GrammarSpec;

  constructor(spec: GrammarSpec) {
    this.spec = spec;
    this.id = spec.id;
    this.extensions = spec.extensions;
  }

  supports(extension: string): boolean {
    return this.extensions.includes(extension.toLowerCase());
  }

  async parse(ctx: ParseContext): Promise<ParsedFile> {
    const { repoId, path: relPath, content } = ctx;
    const extension = extname(relPath);

    const file: ParsedFile = {
      repoId,
      path: relPath,
      name: basename(relPath),
      extension,
      language: this.id,
      imports: [],
      symbols: [],
      calls: [],
    };

    let parser: Awaited<ReturnType<typeof acquireParser>> | null = null;
    let tree: any = null;
    try {
      parser = await acquireParser(this.spec.grammar);
      tree = parser.parse(content);
    } catch (err: any) {
      return emptyParsedFile(
        repoId,
        relPath,
        this.id,
        `tree-sitter unavailable: ${err?.message?.slice(0, 120)}`
      );
    }

    if (!tree) {
      releaseParser(parser!);
      return emptyParsedFile(repoId, relPath, this.id, 'parse produced no tree');
    }

    const lines = content.split(/\r?\n/);
    const lineOf = (node: any) => (node.startPosition?.row ?? 0) + 1;
    const endLineOf = (node: any) => (node.endPosition?.row ?? 0) + 1;

    /** Stack of enclosing scopes so calls can be attributed. */
    const scopes: string[] = [];

    const declaredName = (node: any): string | undefined => {
      for (const field of this.spec.nameFields) {
        const child = node.childForFieldName(field);
        if (child) {
          const t = textOf(child, content).trim();
          if (t) return t;
        }
      }
      return undefined;
    };

    const paramNames = (node: any): string[] => {
      const params = node.childForFieldName?.('parameters');
      if (!params) return [];
      return textOf(params, content)
        .replace(/[()]/g, '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => p.replace(/=.*$/, '').replace(/:.*$/, '').trim())
        .filter(Boolean);
    };

    const visit = (node: any): void => {
      const type: string = node.type;
      const isClassish =
        this.spec.classNodes.includes(type) || this.spec.interfaceNodes.includes(type);

      if (isClassish) {
        const name = declaredName(node) || 'Anonymous';
        file.symbols.push({
          name,
          qualifiedName: name,
          kind: this.spec.classNodes.includes(type) ? 'Class' : 'Interface',
          parameters: [],
          startLine: lineOf(node),
          endLine: endLineOf(node),
          isExported: this.isExported(node),
          isAsync: false,
          complexity: 1,
        });
        scopes.push(name);
        for (const child of node.namedChildren) visit(child);
        scopes.pop();
        return;
      }

      const isFuncish =
        this.spec.functionNodes.includes(type) || this.spec.methodNodes.includes(type);

      if (isFuncish) {
        const localName = declaredName(node);
        if (localName) {
          const owner = scopes[scopes.length - 1];
          const qualified = owner ? `${owner}.${localName}` : localName;
          file.symbols.push({
            name: localName,
            qualifiedName: qualified,
            kind: this.spec.methodNodes.includes(type) ? 'Method' : 'Function',
            parameters: paramNames(node),
            startLine: lineOf(node),
            endLine: endLineOf(node),
            isExported: this.isExported(node),
            isAsync: /\basync\b/.test(textOf(node, content).slice(0, 40)),
            complexity: 1,
          });
          scopes.push(qualified);
          for (const child of node.namedChildren) visit(child);
          scopes.pop();
          return;
        }
      }

      if (this.spec.importNodes.includes(type)) {
        const imp = this.extractImport(node, content);
        if (imp) file.imports.push(imp);
      }

      if (this.spec.callNodes.includes(type)) {
        const calleeNode =
          node.childForFieldName?.('function') ?? node.namedChildren?.[0];
        if (calleeNode) {
          const name = calleeText(calleeNode, content);
          if (name) {
            const caller = scopes[scopes.length - 1];
            file.calls.push({
              calleeName: name,
              callerQualifiedName: caller,
              callerStartLine: caller
                ? file.symbols.find((s) => s.qualifiedName === caller)?.startLine
                : undefined,
              line: lineOf(node),
            });
          }
        }
      }

      for (const child of node.namedChildren) visit(child);
    };

    visit(tree.rootNode);

    for (const symbol of file.symbols) {
      symbol.complexity = estimateComplexity(lines, symbol.startLine, symbol.endLine);
    }

    tree.delete?.();
    releaseParser(parser!);
    return file;
  }

  private isExported(node: any): boolean {
    let current = node;
    for (let i = 0; i < 3 && current; i++) {
      const prev = current.previousNamedSibling;
      if (prev?.type && /export|public/i.test(prev.type)) return true;
      current = current.parent;
    }
    return false;
  }

  /**
   * Extract the module path and bindings from an import statement.
   *
   * The path itself lives in different node types per language: a string
   * literal for Go/Java/Rust, a dotted or relative name for Python. Walking
   * blindly produced empty imports, so the style is declared in the spec.
   */
  private extractImport(node: any, content: string): RawImport | null {
    if (this.spec.importPathStyle === 'dotted') {
      return this.extractDottedImport(node, content);
    }
    return this.extractQuotedImport(node, content);
  }

  private extractQuotedImport(node: any, content: string): RawImport | null {
    const bindings: RawImport['bindings'] = [];
    let specifier: string | undefined;
    let isNamespace = false;

    const scan = (current: any): void => {
      if (current.type === 'string' || current.type === 'interpreted_string_literal') {
        specifier = textOf(current, content).replace(/^['"]|['"]$/g, '');
      }
      if (current.type === 'wildcard' || current.type === 'asterisk') isNamespace = true;

      // Named imports carry identifiers that are not the module path.
      if (
        (current.type === 'identifier' ||
          current.type === 'type_identifier' ||
          current.type === 'scoped_identifier') &&
        textOf(current, content).trim()
      ) {
        const text = textOf(current, content).trim();
        bindings.push({ local: text, imported: text });
      }
      for (const child of current.namedChildren || []) scan(child);
    };

    scan(node);
    if (!specifier) return null;

    return {
      specifier,
      bindings: isNamespace ? [] : dedupeBindings(bindings),
      namespaceBinding: isNamespace ? '*' : undefined,
      isTypeOnly: false,
      isRequire: false,
      isReExport: false,
      line: (node.startPosition?.row ?? 0) + 1,
    };
  }

  /**
   * Python-style imports: `import a.b`, `from .db import x as y`.
   * The module is a `dotted_name` or `relative_import`, and the imported
   * symbols are the identifiers listed after the import keyword.
   */
  private extractDottedImport(node: any, content: string): RawImport | null {
    const children = node.namedChildren || [];
    let specifier: string | undefined;
    let seenModule = false;
    const bindings: RawImport['bindings'] = [];
    let namespaceBinding: string | undefined;

    for (const child of children) {
      const type = child.type;

      if (type === 'dotted_name' || type === 'relative_import' || type === 'identifier') {
        // A trailing bare identifier after a module is an imported symbol,
        // not part of the path (e.g. `from a import b`).
        if (!seenModule) {
          specifier = textOf(child, content).trim();
          seenModule = true;
          continue;
        }
        bindings.push({
          local: textOf(child, content).trim(),
          imported: textOf(child, content).trim(),
        });
        continue;
      }

      if (type === 'aliased_import') {
        const alias = child.childForFieldName?.('alias');
        const name = child.childForFieldName?.('name');
        const imported = name ? textOf(name, content).trim() : '';
        bindings.push({ local: alias ? textOf(alias, content).trim() : imported, imported });
        continue;
      }

      if (type === 'wildcard') {
        namespaceBinding = '*';
      }
    }

    if (!specifier) return null;

    return {
      specifier,
      bindings: dedupeBindings(bindings),
      namespaceBinding,
      isTypeOnly: false,
      isRequire: false,
      isReExport: false,
      line: (node.startPosition?.row ?? 0) + 1,
    };
  }
}

function dedupeBindings(bindings: RawImport['bindings']): RawImport['bindings'] {
  const seen = new Set<string>();
  const out: RawImport['bindings'] = [];
  for (const b of bindings) {
    if (!b.local || seen.has(b.local)) continue;
    seen.add(b.local);
    out.push(b);
  }
  return out;
}