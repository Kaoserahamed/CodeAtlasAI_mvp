/**
 * Cross-file symbol resolver.
 *
 * Parsing produces raw, per-file facts: import specifiers and callee names.
 * This turns them into a graph where every edge points at a real node id and
 * carries an honest resolution tier.
 *
 * The important property: a CALLS edge is only emitted as `resolved` when the
 * callee was matched through an import binding traceable back to a file.
 * Name collisions across the repository never produce a `resolved` edge.
 */
import {
  EdgeKind,
  GraphEdge,
  GraphNodeBase,
  ParsedFile,
  RawSymbol,
  ResolutionTier,
  ids,
} from '../types';
import {
  ModuleIndex,
  buildModuleIndex,
  isRelative,
  packageNameOf,
  resolveSpecifier,
} from './moduleResolver';

export interface ResolvedGraph {
  nodes: GraphNodeBase[];
  edges: GraphEdge[];
  externalModules: string[];
  stats: {
    files: number;
    functions: number;
    classes: number;
    imports: number;
    calls: number;
    resolvedCalls: number;
    inferredCalls: number;
    unknownCalls: number;
    externalModules: number;
  };
}

interface SymbolEntry {
  id: string;
  file: string;
  symbol: RawSymbol;
  /** Bare name, e.g. `login` for `Auth.login`. */
  simpleName: string;
  exported: boolean;
}

/** Languages whose relative imports use dots rather than slashes. */
const DOT_RELATIVE_LANGUAGES = new Set(['python']);

export class SymbolResolver {
  private index: ModuleIndex = buildModuleIndex([]);

  resolve(files: ParsedFile[], repoId: string): ResolvedGraph {
    this.index = buildModuleIndex(files.map((f) => f.path));
    const nodes: GraphNodeBase[] = [];
    const edges: GraphEdge[] = [];
    const externalModules = new Set<string>();
    const edgeIds = new Set<string>();

    /** file path -> symbols declared in it */
    const symbolsByFile = new Map<string, SymbolEntry[]>();
    /** simple name -> all symbols with that name, repo-wide */
    const symbolsByName = new Map<string, SymbolEntry[]>();

    const addEdge = (
      from: string,
      kind: EdgeKind,
      to: string,
      resolution: ResolutionTier,
      confidence: number,
      line?: number
    ) => {
      const id = ids.edge(from, kind, to);
      if (edgeIds.has(id)) return;
      edgeIds.add(id);
      edges.push({ id, kind, from, to, meta: { resolution, confidence, line } });
    };

    this.buildNodes(files, repoId, nodes, addEdge, symbolsByFile, symbolsByName);

    const importCount = this.buildImportEdges(
      files,
      repoId,
      nodes,
      externalModules,
      addEdge
    );

    const callCounts = this.buildCallEdges(
      files,
      repoId,
      symbolsByFile,
      symbolsByName,
      addEdge
    );

    const callCount = callCounts.resolved + callCounts.inferred;

    return {
      nodes,
      edges,
      externalModules: [...externalModules].sort(),
      stats: {
        files: files.length,
        functions: nodes.filter(
          (n) => n.kind === 'Function' || n.kind === 'Method'
        ).length,
        classes: nodes.filter(
          (n) => n.kind === 'Class' || n.kind === 'Interface'
        ).length,
        imports: importCount,
        calls: callCount,
        resolvedCalls: callCounts.resolved,
        inferredCalls: callCounts.inferred,
        unknownCalls: callCounts.unknown,
        externalModules: externalModules.size,
      },
    };
  }

  private buildNodes(
    files: ParsedFile[],
    repoId: string,
    nodes: GraphNodeBase[],
    addEdge: AddEdge,
    symbolsByFile: Map<string, SymbolEntry[]>,
    symbolsByName: Map<string, SymbolEntry[]>
  ): void {
    for (const file of files) {
      const fileId = ids.file(repoId, file.path);
      const modulePath = file.path.includes('/')
        ? file.path.slice(0, file.path.lastIndexOf('/'))
        : '';

      nodes.push({
        id: fileId,
        kind: 'File',
        name: file.name,
        repoId,
        path: file.path,
        language: file.language,
        modulePath,
      });

      const entries: SymbolEntry[] = [];
      for (const symbol of file.symbols) {
        const symbolId = ids.symbol(
          repoId,
          file.path,
          symbol.qualifiedName,
          symbol.startLine
        );
        nodes.push({
          id: symbolId,
          kind: symbol.kind,
          name: symbol.name,
          repoId,
          path: file.path,
          language: file.language,
          qualifiedName: symbol.qualifiedName,
          parameters: symbol.parameters,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
          complexity: symbol.complexity,
          isExported: symbol.isExported,
          isTest: isTestPath(file.path),
          modulePath,
        });

        addEdge(fileId, 'DEFINES', symbolId, 'resolved', 1, symbol.startLine);

        const entry: SymbolEntry = {
          id: symbolId,
          file: file.path,
          symbol,
          simpleName: symbol.name,
          exported: symbol.isExported,
        };
        entries.push(entry);

        const bucket = symbolsByName.get(symbol.name) || [];
        bucket.push(entry);
        symbolsByName.set(symbol.name, bucket);
      }
      symbolsByFile.set(file.path, entries);
    }
  }

  private buildImportEdges(
    files: ParsedFile[],
    repoId: string,
    nodes: GraphNodeBase[],
    externalModules: Set<string>,
    addEdge: AddEdge
  ): number {
    let importCount = 0;
    for (const file of files) {
      const fromId = ids.file(repoId, file.path);
      const style = DOT_RELATIVE_LANGUAGES.has(file.language) ? 'dot' : 'slash';

      for (const imp of file.imports) {
        if (isRelative(imp.specifier)) {
          const target = resolveSpecifier(imp.specifier, file.path, this.index, {
            language: file.language,
            relativeStyle: style,
          });
          if (!target) continue;
          importCount++;
          addEdge(
            fromId,
            imp.isReExport ? 'REEXPORTS' : 'IMPORTS',
            ids.file(repoId, target),
            'resolved',
            1,
            imp.line
          );
        } else {
          const pkg = packageNameOf(imp.specifier);
          externalModules.add(pkg);
          const extId = ids.external(repoId, pkg);
          if (!nodes.some((n) => n.id === extId)) {
            nodes.push({ id: extId, kind: 'ExternalModule', name: pkg, repoId });
          }
          importCount++;
          addEdge(
            fromId,
            imp.isReExport ? 'REEXPORTS' : 'IMPORTS',
            extId,
            'resolved',
            1,
            imp.line
          );
        }
      }
    }
    return importCount;
  }

  private buildCallEdges(
    files: ParsedFile[],
    repoId: string,
    symbolsByFile: Map<string, SymbolEntry[]>,
    symbolsByName: Map<string, SymbolEntry[]>,
    addEdge: AddEdge
  ): { resolved: number; inferred: number; unknown: number } {
    const counts = { resolved: 0, inferred: 0, unknown: 0 };

    for (const file of files) {
      const fromFileId = ids.file(repoId, file.path);
      const declarations = symbolsByFile.get(file.path) || [];
      const importedNames = this.collectImportedNames(file);

      for (const call of file.calls) {
        const callerEntry = call.callerQualifiedName
          ? declarations.find((d) => d.symbol.qualifiedName === call.callerQualifiedName)
          : undefined;
        const callerId = callerEntry ? callerEntry.id : fromFileId;

        const target = this.resolveCallee(
          call.calleeName,
          file.path,
          declarations,
          importedNames,
          symbolsByName
        );

        if (!target) {
          counts.unknown++;
          continue;
        }

        addEdge(callerId, 'CALLS', target.id, target.resolution, target.confidence, call.line);
        counts[target.resolution]++;
      }
    }
    return counts;
  }

  /**
   * Map every local name this file can reach to the file that declares it,
   * built from the import bindings actually present in the file.
   */
  private collectImportedNames(
    file: ParsedFile
  ): Map<string, { file: string; simple: string }> {
    const imported = new Map<string, { file: string; simple: string }>();
    const style = DOT_RELATIVE_LANGUAGES.has(file.language) ? 'dot' : 'slash';

    for (const imp of file.imports) {
      if (!isRelative(imp.specifier)) continue;
      const target = resolveSpecifier(imp.specifier, file.path, this.index, {
        language: file.language,
        relativeStyle: style,
      });
      if (!target) continue;

      for (const binding of imp.bindings) {
        imported.set(binding.local, { file: target, simple: binding.imported });
      }
      if (imp.defaultBinding) {
        imported.set(imp.defaultBinding, { file: target, simple: 'default' });
      }
      if (imp.namespaceBinding) {
        imported.set(imp.namespaceBinding, { file: target, simple: '*' });
      }
    }
    return imported;
  }

  /**
   * Decide what a callee name refers to.
   *
   * Order of preference:
   *  1. A local declaration in the same file       -> resolved
   *  2. A name imported from another file          -> resolved
   *  3. A unique name elsewhere in the repository  -> inferred
   *  4. Nothing                                    -> dropped (unknown)
   *
   * Ambiguous names are deliberately left unresolved rather than guessed,
   * because a wrong `resolved` edge is worse than an admitted unknown one.
   */
  private resolveCallee(
    calleeName: string,
    filePath: string,
    declarations: SymbolEntry[],
    importedNames: Map<string, { file: string; simple: string }>,
    symbolsByName: Map<string, SymbolEntry[]>
  ): { id: string; resolution: ResolutionTier; confidence: number } | null {
    const head = calleeName.split('.')[0];

    // 1. A local declaration wins; no import shadows it.
    const local = declarations.find((d) => d.simpleName === head);
    if (local) {
      return { id: local.id, resolution: 'resolved', confidence: 1 };
    }

    const binding = importedNames.get(head);
    if (binding) {
      const match = this.matchInModule(binding, calleeName, symbolsByName);
      if (match) return match;
    }

    // A method call on a value we cannot type stays unresolved rather than
    // being guessed from a repository-wide name search.
    if (calleeName.includes('.')) return null;

    // 2. Unique name elsewhere in the repository.
    const candidates = symbolsByName.get(head);
    if (candidates && candidates.length === 1) {
      const only = candidates[0];
      if (only.file !== filePath) {
        return { id: only.id, resolution: 'inferred', confidence: 0.5 };
      }
    }

    return null;
  }

  /** Look up a callee inside a module we have an import binding for. */
  private matchInModule(
    binding: { file: string; simple: string },
    calleeName: string,
    symbolsByName: Map<string, SymbolEntry[]>
  ): { id: string; resolution: ResolutionTier; confidence: number } | null {
    const parts = calleeName.split('.');
    // For `ns.func` the method name is the last segment; for a direct named
    // import it is whatever was imported.
    const methodName =
      parts.length > 1 ? parts[parts.length - 1] : binding.simple;
    if (!methodName || methodName === '*' || methodName === 'default') return null;

    const candidates = symbolsByName.get(methodName);
    if (!candidates) return null;

    const inModule = candidates.filter((c) => c.file === binding.file);
    if (inModule.length === 1) {
      return { id: inModule[0].id, resolution: 'resolved', confidence: 0.95 };
    }

    // Ambiguous inside the module: an exported match is the better guess.
    const exported = inModule.filter((c) => c.exported);
    if (exported.length === 1) {
      return { id: exported[0].id, resolution: 'inferred', confidence: 0.6 };
    }
    return null;
  }
}

type AddEdge = (
  from: string,
  kind: EdgeKind,
  to: string,
  resolution: ResolutionTier,
  confidence: number,
  line?: number
) => void;

function isTestPath(p: string): boolean {
  const lower = p.toLowerCase();
  return (
    lower.includes('__tests__') ||
    lower.includes('/test/') ||
    lower.includes('/tests/') ||
    lower.includes('/spec/') ||
    lower.includes('.test.') ||
    lower.includes('.spec.') ||
    lower.endsWith('_test.go') ||
    lower.includes('test_')
  );
}