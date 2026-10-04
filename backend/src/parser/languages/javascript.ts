/**
 * JavaScript / TypeScript parser (Babel).
 *
 * Fixes over the original implementation:
 *  - Caller attribution uses a scope stack instead of a single mutable
 *    `currentFunction`, which previously leaked the first function seen in a
 *    file into every subsequent call.
 *  - Records the callee *and* enclosing symbol, so cross-file resolution can
 *    decide whether a call points where we think it does.
 *  - Computes a complexity estimate during traversal.
 */
import * as babel from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import { ParsedFile, RawCall, RawImport, RawSymbol } from '../../types';
import {
  LanguageParser,
  ParseContext,
  basename,
  emptyParsedFile,
  extname,
  modulePathOf,
} from '../types';

const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts'];

export class JavaScriptParser implements LanguageParser {
  readonly id = 'javascript';
  readonly extensions = EXTENSIONS;

  supports(extension: string): boolean {
    return EXTENSIONS.includes(extension.toLowerCase());
  }

  async parse(ctx: ParseContext): Promise<ParsedFile> {
    const { repoId, path: relPath, content } = ctx;
    const extension = extname(relPath);
    const isTs = /\.(ts|tsx|mts|cts)$/i.test(extension);

    let ast: babel.ParseResult<any>;
    try {
      ast = babel.parse(content, {
        sourceType: 'unambiguous',
        errorRecovery: true,
        plugins: [
          'jsx',
          ...(isTs ? (['typescript'] as const) : []),
          'decorators-legacy',
          'classProperties',
          'classPrivateProperties',
          'classPrivateMethods',
          'objectRestSpread',
          'dynamicImport',
          'optionalChaining',
          'nullishCoalescingOperator',
          'topLevelAwait',
          'importAssertions',
        ] as babel.ParserPlugin[],
      });
    } catch (err: any) {
      return emptyParsedFile(
        repoId,
        relPath,
        this.id,
        err?.message?.slice(0, 300) || 'Parse error'
      );
    }

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

    /** Stack of enclosing scopes: `class:Foo` / `fn:Foo.bar`. */
    const scopeStack: string[] = [];

    const classCtx = (): string | undefined => {
      for (let i = scopeStack.length - 1; i >= 0; i--) {
        if (scopeStack[i].startsWith('class:')) return scopeStack[i].slice(6);
      }
      return undefined;
    };

    const functionCtx = (): string | undefined => {
      for (let i = scopeStack.length - 1; i >= 0; i--) {
        if (scopeStack[i].startsWith('fn:')) return scopeStack[i].slice(3);
      }
      return undefined;
    };

    // Babel's typings don't model `:exit` visitor keys, so the visitor map is typed
    // explicitly and cast at the call site.
    type Visitors = Record<string, (path: any) => void>;
    const visitors: Visitors = {
      // ---- declarations ------------------------------------------------
      FunctionDeclaration: {
        enter(path) {
          const node = path.node;
          if (!node.id) return;
          const cls = classCtx();
          const qualified = cls ? `${cls}.${node.id.name}` : node.id.name;
          file.symbols.push(buildSymbol(node, qualified, 'Function', false));
          scopeStack.push(`fn:${qualified}`);
        },
        exit() {
          scopeStack.pop();
        },
      },

      ClassDeclaration: {
        enter(path) {
          const node = path.node;
          const name = node.id?.name || 'AnonymousClass';
          file.symbols.push({
            name,
            qualifiedName: name,
            kind: 'Class',
            parameters: [],
            startLine: node.loc?.start.line ?? 0,
            endLine: node.loc?.end.line ?? 0,
            isExported: hasExportModifier(path),
            isAsync: false,
            complexity: 1,
          });
          scopeStack.push(`class:${name}`);
        },
        exit() {
          scopeStack.pop();
        },
      },

      ClassMethod: {
        enter(path) {
          const node = path.node;
          const cls = classCtx() || 'AnonymousClass';
          const methodName = keyName(node.key) || 'method';
          const qualified = `${cls}.${methodName}`;
          file.symbols.push(
            buildSymbol(node, qualified, 'Method', hasExportModifier(path))
          );
          scopeStack.push(`fn:${qualified}`);
        },
        exit() {
          scopeStack.pop();
        },
      },

      ClassProperty: {
        enter(path) {
          const value = path.node.value;
          if (!isFunctionNode(value)) return;
          const cls = classCtx() || 'AnonymousClass';
          const propName = keyName(path.node.key) || 'field';
          const qualified = `${cls}.${propName}`;
          file.symbols.push(buildSymbol(value, qualified, 'Method', false));
          scopeStack.push(`fn:${qualified}`);
        },
        exit(path) {
          if (isFunctionNode(path.node.value)) scopeStack.pop();
        },
      },

      // const foo = () => {}  /  const foo = function () {}
      VariableDeclarator: {
        enter(path) {
          const node = path.node;
          if (!isFunctionNode(node.init)) return;
          if (node.id.type !== 'Identifier') return;
          const cls = classCtx();
          const qualified = cls ? `${cls}.${node.id.name}` : node.id.name;
          file.symbols.push(
            buildSymbol(
              node.init,
              qualified,
              'Function',
              hasExportModifier(path.parentPath)
            )
          );
          scopeStack.push(`fn:${qualified}`);
        },
        exit(path) {
          const node = path.node;
          if (isFunctionNode(node.init) && node.id.type === 'Identifier') {
            scopeStack.pop();
          }
        },
      },

      // Object literal methods: { foo() {} }
      ObjectMethod: {
        enter(path) {
          const node = path.node;
          const name = keyName(node.key) || 'method';
          file.symbols.push(
            buildSymbol(node, name, 'Function', hasExportModifier(path))
          );
          scopeStack.push(`fn:${name}`);
        },
        exit() {
          scopeStack.pop();
        },
      },

      TSInterfaceDeclaration(path) {
        const node = path.node;
        const name = node.id?.name || 'AnonymousInterface';
        file.symbols.push({
          name,
          qualifiedName: name,
          kind: 'Interface',
          parameters: [],
          startLine: node.loc?.start.line ?? 0,
          endLine: node.loc?.end.line ?? 0,
          isExported: hasExportModifier(path),
          isAsync: false,
          complexity: 1,
        });
      },

      // ---- imports ------------------------------------------------------
      ImportDeclaration(path) {
        file.imports.push(extractImport(path.node, false));
      },

      ExportNamedDeclaration(path) {
        if (!path.node.source) return;
        file.imports.push(extractImport(path.node, true));
      },

      ExportAllDeclaration(path) {
        file.imports.push(extractImport(path.node, true));
      },

      // ---- calls --------------------------------------------------------
      CallExpression(path) {
        const callee = calleeName(path.node.callee);
        if (!callee) return;

        // require('./x') is an import, not a tracked call
        const firstArg = path.node.arguments[0];
        if (callee === 'require' && firstArg?.type === 'StringLiteral') {
          file.imports.push({
            specifier: firstArg.value,
            bindings: [],
            isTypeOnly: false,
            isRequire: true,
            isReExport: false,
            line: path.node.loc?.start.line ?? 0,
          });
          return;
        }

        file.calls.push(makeCall(callee, functionCtx(), file, path.node));
      },

      NewExpression(path) {
        const callee = calleeName(path.node.callee);
        if (!callee) return;
        file.calls.push(makeCall(callee, functionCtx(), file, path.node));
      },
    };

    traverse(ast, visitors as any);

    file.imports = file.imports.filter((i) => !i.specifier.startsWith('node:'));

    // Complexity is a lexical estimate over each symbol's line range.
    const lines = content.split(/\r?\n/);
    for (const symbol of file.symbols) {
      symbol.complexity = estimateComplexity(lines, symbol.startLine, symbol.endLine);
    }

    void modulePathOf;
    return file;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFunctionNode(node: any): boolean {
  return (
    !!node &&
    (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression')
  );
}

function buildSymbol(
  node: any,
  qualifiedName: string,
  kind: 'Function' | 'Method',
  isExported: boolean
): RawSymbol {
  return {
    name: qualifiedName.split('.').pop() || qualifiedName,
    qualifiedName,
    kind,
    parameters: (node.params || []).map(paramText).filter(Boolean) as string[],
    startLine: node.loc?.start.line ?? 0,
    endLine: node.loc?.end.line ?? 0,
    isExported,
    isAsync: node.async === true,
    complexity: 1,
  };
}

function makeCall(
  callee: string,
  caller: string | undefined,
  file: ParsedFile,
  node: any
): RawCall {
  return {
    calleeName: callee,
    callerQualifiedName: caller,
    callerStartLine: caller
      ? file.symbols.find((s) => s.qualifiedName === caller)?.startLine
      : undefined,
    line: node.loc?.start.line ?? 0,
  };
}

function paramText(param: any): string | null {
  switch (param.type) {
    case 'Identifier':
      return param.name;
    case 'RestElement':
      return param.argument?.type === 'Identifier'
        ? `...${param.argument.name}`
        : '...';
    case 'AssignmentPattern':
      return param.left?.type === 'Identifier' ? param.left.name : null;
    case 'ObjectPattern':
      return '{...}';
    case 'ArrayPattern':
      return '[...]';
    default:
      return null;
  }
}

/** True when the declaration is directly wrapped in an export statement. */
function hasExportModifier(path: NodePath | null | undefined): boolean {
  let cur: any = path;
  // Only walk a couple of levels; walking to the root is O(depth) per node.
  for (let i = 0; cur && i < 4; i++) {
    const type = cur.node?.type;
    if (type === 'ExportNamedDeclaration' || type === 'ExportDefaultDeclaration') {
      return true;
    }
    cur = cur.parentPath;
  }
  return false;
}

function keyName(key: any): string | undefined {
  if (!key) return undefined;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'StringLiteral') return key.value;
  if (key.type === 'NumericLiteral') return String(key.value);
  return undefined;
}

/**
 * Dotted callee name. Member expressions yield the full chain
 * (`utils.formatDate`) so namespace-qualified calls can be resolved later.
 */
function calleeName(callee: any): string | undefined {
  switch (callee.type) {
    case 'Identifier':
      return callee.name;
    case 'MemberExpression':
    case 'OptionalMemberExpression': {
      const property = callee.computed
        ? callee.property?.type === 'StringLiteral'
          ? callee.property.value
          : undefined
        : keyName(callee.property);
      const object = calleeName(callee.object);
      if (!property) return object;
      return object ? `${object}.${property}` : property;
    }
    default:
      return undefined;
  }
}

function extractImport(node: any, isReExport: boolean): RawImport {
  const bindings: RawImport['bindings'] = [];
  let namespaceBinding: string | undefined;
  let defaultBinding: string | undefined;
  let isTypeOnly = node.importKind === 'type';

  for (const spec of node.specifiers || []) {
    switch (spec.type) {
      case 'ImportSpecifier':
        if (spec.importKind === 'type') isTypeOnly = true;
        bindings.push({
          local: spec.local?.name ?? '',
          imported: spec.imported?.name ?? spec.local?.name ?? '',
        });
        break;
      case 'ImportDefaultSpecifier':
        defaultBinding = spec.local?.name;
        break;
      case 'ImportNamespaceSpecifier':
        namespaceBinding = spec.local?.name;
        break;
      case 'ExportSpecifier':
        bindings.push({
          local: spec.local?.name ?? '',
          imported: spec.local?.name ?? '',
        });
        break;
    }
  }

  return {
    specifier: node.source?.value ?? '',
    bindings,
    namespaceBinding,
    defaultBinding,
    isTypeOnly,
    isRequire: false,
    isReExport,
    line: node.loc?.start.line ?? 0,
  };
}

/**
 * Cyclomatic complexity estimate: 1 + branch points inside the symbol's line
 * range. Lexical rather than AST-based so it works for every language through
 * the same code path. Documented as an estimate, not an exact metric.
 */
export function estimateComplexity(
  lines: string[],
  startLine: number,
  endLine: number
): number {
  if (!startLine || !endLine) return 1;
  const body = lines.slice(startLine - 1, endLine).join('\n');
  let complexity = 1;
  const patterns = [
    /\bif\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bcase\b/g,
    /\bcatch\s*\(/g,
    /\?[^:.\n]+\s*:/g, // ternary
    /(&&|\|\|)/g,
  ];
  for (const re of patterns) {
    const matches = body.match(re);
    if (matches) complexity += matches.length;
  }
  return complexity;
}