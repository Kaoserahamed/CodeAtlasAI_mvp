/**
 * Declarative grammar definitions for tree-sitter-backed languages.
 *
 * Node type names come from each language's tree-sitter grammar; see
 * tree-sitter-{python,java,go} grammar.js for the authoritative lists.
 */
import { GrammarSpec } from './treeSitterParser';

export const PYTHON: GrammarSpec = {
  id: 'python',
  extensions: ['.py', '.pyi'],
  grammar: 'python',
  functionNodes: ['function_definition'],
  methodNodes: ['function_definition'],
  classNodes: ['class_definition'],
  interfaceNodes: [],
  importNodes: ['import_statement', 'import_from_statement', 'future_import_statement'],
  importPathStyle: 'dotted',
  callNodes: ['call'],
  nameFields: ['name'],
};

export const JAVA: GrammarSpec = {
  id: 'java',
  extensions: ['.java'],
  grammar: 'java',
  functionNodes: ['method_declaration', 'constructor_declaration'],
  methodNodes: ['method_declaration', 'constructor_declaration'],
  classNodes: ['class_declaration', 'record_declaration'],
  interfaceNodes: ['interface_declaration'],
  importNodes: ['import_declaration'],
  importPathStyle: 'quoted',
  callNodes: ['method_invocation', 'object_creation_expression'],
  nameFields: ['name'],
};

export const GO: GrammarSpec = {
  id: 'go',
  extensions: ['.go'],
  grammar: 'go',
  functionNodes: ['function_declaration'],
  methodNodes: ['method_declaration'],
  classNodes: [],
  interfaceNodes: [],
  importNodes: ['import_spec', 'import_declaration'],
  importPathStyle: 'quoted',
  callNodes: ['call_expression'],
  nameFields: ['name'],
};

export const RUBY: GrammarSpec = {
  id: 'ruby',
  extensions: ['.rb'],
  grammar: 'ruby',
  functionNodes: ['method', 'singleton_method'],
  methodNodes: ['method', 'singleton_method'],
  classNodes: ['class', 'module'],
  interfaceNodes: [],
  importNodes: ['call'],
  importPathStyle: 'quoted',
  callNodes: ['call', 'method_call'],
  nameFields: ['name'],
};

export const RUST: GrammarSpec = {
  id: 'rust',
  extensions: ['.rs'],
  grammar: 'rust',
  functionNodes: ['function_item'],
  methodNodes: ['function_item'],
  classNodes: ['struct_item', 'enum_item'],
  interfaceNodes: ['trait_item'],
  importNodes: ['use_declaration'],
  importPathStyle: 'quoted',
  callNodes: ['call_expression', 'macro_invocation'],
  nameFields: ['name'],
};

export const CSHARP: GrammarSpec = {
  id: 'csharp',
  extensions: ['.cs'],
  grammar: 'c_sharp',
  functionNodes: ['method_declaration', 'constructor_declaration'],
  methodNodes: ['method_declaration', 'constructor_declaration'],
  classNodes: ['class_declaration'],
  interfaceNodes: ['interface_declaration'],
  importNodes: ['using_directive'],
  importPathStyle: 'quoted',
  callNodes: ['invocation_expression', 'object_creation_expression'],
  nameFields: ['name'],
};

export const ALL_GRAMMARS: GrammarSpec[] = [
  PYTHON,
  JAVA,
  GO,
  RUBY,
  RUST,
  CSHARP,
];
