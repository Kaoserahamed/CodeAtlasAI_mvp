/**
 * Parsing + symbol attribution tests for the JavaScript/TypeScript parser.
 * These guard the caller-attribution bug where the first function in a file
 * absorbed every later call.
 */
import { describe, it, expect } from 'vitest';
import { JavaScriptParser } from '../../src/parser/languages/javascript';

const parser = new JavaScriptParser();

async function parse(path: string, content: string) {
  return parser.parse({ repoId: 'r1', path, content });
}

describe('JavaScriptParser', () => {
  it('attributes each call to its own enclosing function', async () => {
    const file = await parse(
      'src/a.js',
      `
function first() {
  return helperOne();
}
function second() {
  return helperTwo();
}
`
    );

    const byCaller = new Map<string, string[]>();
    for (const call of file.calls) {
      const caller = call.callerQualifiedName ?? '<top-level>';
      byCaller.set(caller, [...(byCaller.get(caller) || []), call.calleeName]);
    }

    expect(byCaller.get('first')).toEqual(['helperOne']);
    expect(byCaller.get('second')).toEqual(['helperTwo']);
  });

  it('records callee and line for calls', async () => {
    const file = await parse('src/b.js', `function go() {\n  doThing();\n}`);
    expect(file.calls).toHaveLength(1);
    expect(file.calls[0].calleeName).toBe('doThing');
    expect(file.calls[0].line).toBe(2);
  });

  it('treats require() as an import rather than a call', async () => {
    const file = await parse(
      'src/c.js',
      `const lib = require('./lib');\nfunction use() { lib.go(); }`
    );

    expect(file.imports.some((i) => i.specifier === './lib' && i.isRequire)).toBe(true);
    expect(file.calls.some((c) => c.calleeName === 'require')).toBe(false);
  });

  it('extracts named, default and namespace bindings separately', async () => {
    const file = await parse(
      'src/d.ts',
      `import def, { named as alias } from './x';
import * as ns from './y';`
    );

    const x = file.imports.find((i) => i.specifier === './x');
    expect(x?.defaultBinding).toBe('def');
    expect(x?.bindings).toEqual([{ local: 'alias', imported: 'named' }]);

    expect(file.imports.find((i) => i.specifier === './y')?.namespaceBinding).toBe('ns');
  });

  it('flags re-exports', async () => {
    const file = await parse('src/e.ts', `export { a } from './a';\nexport * from './b';`);
    const re = file.imports.filter((i) => i.isReExport);
    expect(re.map((i) => i.specifier).sort()).toEqual(['./a', './b']);
  });

  it('qualifies class methods with the class name', async () => {
    const file = await parse(
      'src/f.ts',
      `class Auth {
  login(user: string) { return validate(user); }
}`
    );

    expect(file.symbols.some((s) => s.qualifiedName === 'Auth.login')).toBe(true);
    expect(file.calls[0].callerQualifiedName).toBe('Auth.login');
  });

  it('handles arrow functions assigned to variables', async () => {
    const file = await parse('src/g.js', `const add = (a, b) => a + b;\nadd(1, 2);`);
    expect(file.symbols.some((s) => s.qualifiedName === 'add')).toBe(true);
    expect(file.calls[0].calleeName).toBe('add');
  });

  it('resolves dotted member callees', async () => {
    const file = await parse('src/h.js', `function f() { return utils.formatDate(); }`);
    expect(file.calls[0].calleeName).toBe('utils.formatDate');
  });

  it('returns an error result instead of throwing on bad syntax', async () => {
    const file = await parse('src/bad.js', 'function ( { oops');
    expect(file.error).toBeTruthy();
    expect(file.symbols).toHaveLength(0);
  });

  it('estimates complexity above 1 for branching functions', async () => {
    const file = await parse(
      'src/i.js',
      `function pick(a, b) {
  if (a) { return 1; }
  if (b) { return 2; }
  return 3;
}`
    );
    const fn = file.symbols.find((s) => s.qualifiedName === 'pick');
    expect(fn?.complexity).toBeGreaterThan(1);
  });

  it('maps supported extensions', () => {
    expect(parser.supports('.ts')).toBe(true);
    expect(parser.supports('.py')).toBe(false);
  });
});