/**
 * Resolution tests.
 *
 * These encode the behaviour that the old implementation got wrong: a callee
 * name must never be matched against every function in the repository.
 */
import { describe, it, expect } from 'vitest';
import { SymbolResolver } from '../../src/resolver/symbolResolver';
import { buildModuleIndex, isRelative, packageNameOf, resolveSpecifier } from '../../src/resolver/moduleResolver';
import { JavaScriptParser } from '../../src/parser/languages/javascript';

const REPO = 'r1';
const js = new JavaScriptParser();

async function resolve(files: { path: string; content: string }[]) {
  const parsed = [];
  for (const f of files) {
    parsed.push(await js.parse({ repoId: REPO, path: f.path, content: f.content }));
  }
  return new SymbolResolver().resolve(parsed, REPO);
}

describe('moduleResolver', () => {
  const index = buildModuleIndex([
    'src/a.ts',
    'src/b.ts',
    'src/lib/index.ts',
    'src/util.tsx',
  ]);

  it('recognises relative specifiers', () => {
    expect(isRelative('./a')).toBe(true);
    expect(isRelative('../a')).toBe(true);
    expect(isRelative('react')).toBe(false);
    expect(isRelative('@scope/pkg')).toBe(false);
  });

  it('extracts the package name from a scoped specifier', () => {
    expect(packageNameOf('@scope/pkg/sub')).toBe('@scope/pkg');
    expect(packageNameOf('express/lib/router')).toBe('express');
  });

  it('resolves an extensionless specifier', () => {
    expect(resolveSpecifier('./a', 'src/main.ts', index)).toBe('src/a.ts');
  });

  it('resolves a directory import to its index file', () => {
    expect(resolveSpecifier('./lib', 'src/main.ts', index)).toBe('src/lib/index.ts');
  });

  it('maps a .js specifier onto the TypeScript source', () => {
    expect(resolveSpecifier('./b.js', 'src/main.ts', index)).toBe('src/b.ts');
  });

  it('returns null for a bare package specifier', () => {
    expect(resolveSpecifier('express', 'src/main.ts', index)).toBeNull();
  });

  it('returns null for a missing file', () => {
    expect(resolveSpecifier('./nope', 'src/main.ts', index)).toBeNull();
  });
});

describe('SymbolResolver', () => {
  it('creates a file node and DEFINES edges for symbols', async () => {
    const g = await resolve([{ path: 'src/a.ts', content: 'export function f() {}' }]);

    expect(g.nodes.filter((n) => n.kind === 'File')).toHaveLength(1);
    expect(g.nodes.filter((n) => n.kind === 'Function')).toHaveLength(1);
    expect(g.edges.some((e) => e.kind === 'DEFINES')).toBe(true);
  });

  it('resolves a call through a named import', async () => {
    const g = await resolve([
      { path: 'src/util.ts', content: 'export function validate() {}' },
      {
        path: 'src/app.ts',
        content: `import { validate } from './util';\nfunction run() { validate(); }`,
      },
    ]);

    const call = g.edges.find((e) => e.kind === 'CALLS');
    expect(call).toBeDefined();
    expect(call!.meta.resolution).toBe('resolved');
    expect(call!.to).toContain('util.ts#validate@');
  });

  it('resolves a call through a namespace import', async () => {
    const g = await resolve([
      { path: 'src/util.ts', content: 'export function format() {}' },
      {
        path: 'src/app.ts',
        content: `import * as u from './util';\nfunction run() { u.format(); }`,
      },
    ]);

    const call = g.edges.find((e) => e.kind === 'CALLS');
    expect(call!.meta.resolution).toBe('resolved');
  });

  it('resolves a local call with high confidence', async () => {
    const g = await resolve([
      { path: 'src/a.ts', content: `function helper() {}\nfunction run() { helper(); }` },
    ]);

    const call = g.edges.find((e) => e.kind === 'CALLS');
    expect(call!.meta.confidence).toBe(1);
  });

  it('does not resolve an ambiguous name to an arbitrary match', async () => {
    // `render` exists in two modules; app.ts imports neither.
    const g = await resolve([
      { path: 'src/x.ts', content: 'export function render() {}' },
      { path: 'src/y.ts', content: 'export function render() {}' },
      { path: 'src/app.ts', content: 'function run() { render(); }' },
    ]);

    const calls = g.edges.filter((e) => e.kind === 'CALLS');
    expect(calls).toHaveLength(0);
    expect(g.stats.unknownCalls).toBe(1);
  });

  it('records an external module for a bare import', async () => {
    const g = await resolve([
      { path: 'src/app.ts', content: `import express from 'express';\nfunction run(){}` },
    ]);

    expect(g.externalModules).toContain('express');
    expect(g.nodes.some((n) => n.kind === 'ExternalModule')).toBe(true);
  });

  it('marks test files', async () => {
    const g = await resolve([
      { path: 'src/__tests__/a.test.ts', content: 'function t() {}' },
    ]);
    const file = g.nodes.find((n) => n.kind === 'File');
    const fn = g.nodes.find((n) => n.kind === 'Function');
    expect(fn?.isTest).toBe(true);
    expect(file?.path).toBe('src/__tests__/a.test.ts');
  });

  it('records the line a call occurs on', async () => {
    const g = await resolve([
      {
        path: 'src/a.ts',
        content: `function helper() {}\n\nfunction run() {\n  helper();\n}`,
      },
    ]);
    const call = g.edges.find((e) => e.kind === 'CALLS');
    expect(call!.meta.line).toBe(4);
  });

  it('produces identical ids regardless of scan order', async () => {
    const files = [
      { path: 'src/a.ts', content: 'export function a() {}' },
      { path: 'src/b.ts', content: 'export function b() {}' },
    ];
    const first = await resolve(files);
    const second = await resolve([...files].reverse());

    expect(first.nodes.map((n) => n.id).sort()).toEqual(
      second.nodes.map((n) => n.id).sort()
    );
  });
});