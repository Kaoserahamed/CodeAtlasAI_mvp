/**
 * AST Parser using Babel
 * Parses JavaScript/TypeScript files and extracts code structure
 */

import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import fs from 'fs';
import path from 'path';
import { FileNode, FunctionNode, ImportRelationship, CallRelationship } from '../types';

export class ASTParser {
  /**
   * Parse a single file and extract its structure
   */
  parseFile(filePath: string): {
    file: FileNode;
    functions: FunctionNode[];
    imports: ImportRelationship[];
    calls: CallRelationship[];
  } {
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath);

    // Determine if TypeScript
    const isTypeScript = ext.match(/\.tsx?$/);

    // Parse with Babel
    const ast = parser.parse(content, {
      sourceType: 'module',
      plugins: [
        'jsx',
        ...(isTypeScript ? ['typescript'] : []),
        'decorators-legacy',
        'classProperties',
        'objectRestSpread',
        'dynamicImport',
        'optionalChaining',
        'nullishCoalescingOperator',
      ],
    });

    // Create file node
    const file: FileNode = {
      id: filePath,
      type: 'file',
      name: path.basename(filePath),
      path: filePath,
      extension: ext,
    };

    const functions: FunctionNode[] = [];
    const imports: ImportRelationship[] = [];
    const calls: CallRelationship[] = [];

    let currentFunction: string | null = null;

    // Traverse the AST
    traverse(ast, {
      // Function Declarations
      FunctionDeclaration: (path) => {
        const node = path.node;
        const func = this.extractFunction(node, filePath, node.id?.name || 'anonymous');
        if (func) {
          functions.push(func);
          currentFunction = func.id;
        }
      },

      // Arrow Functions and Function Expressions
      VariableDeclarator: (path) => {
        const node = path.node;
        if (
          node.init &&
          (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')
        ) {
          const name = node.id.type === 'Identifier' ? node.id.name : 'anonymous';
          const func = this.extractFunction(node.init, filePath, name);
          if (func) {
            functions.push(func);
          }
        }
      },

      // Class Methods
      ClassMethod: (path) => {
        const node = path.node;
        const name = node.key.type === 'Identifier' ? node.key.name : 'method';
        const func = this.extractFunction(node, filePath, name);
        if (func) {
          functions.push(func);
        }
      },

      // Object Methods
      ObjectMethod: (path) => {
        const node = path.node;
        const name = node.key.type === 'Identifier' ? node.key.name : 'method';
        const func = this.extractFunction(node, filePath, name);
        if (func) {
          functions.push(func);
        }
      },

      // Import Statements (ES6)
      ImportDeclaration: (path) => {
        const node = path.node;
        const importRel = this.extractImport(node, filePath);
        if (importRel) {
          imports.push(importRel);
        }
      },

      // Require Statements (CommonJS)
      CallExpression: (path) => {
        const node = path.node;
        
        // Handle require() for imports
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length > 0 &&
          node.arguments[0].type === 'StringLiteral'
        ) {
          const importPath = node.arguments[0].value;
          const resolvedPath = this.resolveImportPath(filePath, importPath);
          imports.push({
            from: filePath,
            to: resolvedPath,
            type: 'IMPORTS',
            importedSymbols: ['*'],
          });
        }
        
        // Handle function calls for CALLS relationship
        if (currentFunction) {
          const call = this.extractCall(node, filePath, currentFunction);
          if (call) {
            calls.push(call);
          }
        }
      },

      // Track current function scope
      enter: (path) => {
        if (
          path.node.type === 'FunctionDeclaration' ||
          path.node.type === 'ArrowFunctionExpression' ||
          path.node.type === 'FunctionExpression' ||
          path.node.type === 'ClassMethod' ||
          path.node.type === 'ObjectMethod'
        ) {
          // Store for call tracking
        }
      },
    });

    return { file, functions, imports, calls };
  }

  /**
   * Extract function information from node
   */
  private extractFunction(node: any, filePath: string, name: string): FunctionNode | null {
    const parameters: string[] = [];

    // Extract parameters
    if (node.params) {
      for (const param of node.params) {
        if (param.type === 'Identifier') {
          parameters.push(param.name);
        } else if (param.type === 'RestElement' && param.argument.type === 'Identifier') {
          parameters.push(`...${param.argument.name}`);
        } else if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') {
          parameters.push(param.left.name);
        }
      }
    }

    const startLine = node.loc?.start.line || 0;
    const endLine = node.loc?.end.line || 0;
    const functionId = `${filePath}::${name}::${startLine}`;

    return {
      id: functionId,
      type: 'function',
      name,
      filePath,
      parameters,
      startLine,
      endLine,
    };
  }

  /**
   * Extract import relationship
   */
  private extractImport(node: any, filePath: string): ImportRelationship | null {
    const importPath = node.source.value;
    const importedSymbols: string[] = [];

    // Extract imported symbols
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier') {
        importedSymbols.push(specifier.imported.name);
      } else if (specifier.type === 'ImportDefaultSpecifier') {
        importedSymbols.push(specifier.local.name);
      } else if (specifier.type === 'ImportNamespaceSpecifier') {
        importedSymbols.push(`* as ${specifier.local.name}`);
      }
    }

    // Resolve relative imports
    const resolvedPath = this.resolveImportPath(filePath, importPath);

    return {
      from: filePath,
      to: resolvedPath,
      type: 'IMPORTS',
      importedSymbols,
    };
  }

  /**
   * Extract function call relationship
   */
  private extractCall(node: any, filePath: string, parentFunction: string): CallRelationship | null {
    let calledName = '';

    if (node.callee.type === 'Identifier') {
      calledName = node.callee.name;
    } else if (node.callee.type === 'MemberExpression') {
      // Handle obj.method() calls
      if (node.callee.property.type === 'Identifier') {
        calledName = node.callee.property.name;
      }
    }

    if (!calledName) return null;

    return {
      from: parentFunction,
      to: calledName,
      type: 'CALLS',
      filePath,
    };
  }

  /**
   * Resolve import path relative to current file
   */
  private resolveImportPath(currentFile: string, importPath: string): string {
    // Handle relative imports
    if (importPath.startsWith('.')) {
      const currentDir = path.dirname(currentFile);
      let resolved = path.resolve(currentDir, importPath);

      // Try adding common extensions
      const extensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '/index.js', '/index.ts'];
      for (const ext of extensions) {
        const withExt = resolved + ext;
        if (fs.existsSync(withExt)) {
          return withExt;
        }
      }

      return resolved;
    }

    // Return as-is for node_modules or absolute paths
    return importPath;
  }
}
