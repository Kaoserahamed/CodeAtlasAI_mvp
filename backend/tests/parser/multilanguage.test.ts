/**
 * Multi-language parsing via WASM tree-sitter.
 *
 * These tests exercise the real WASM grammars, so they verify the ESM/CJS
 * bridge works at runtime and not merely that the types line up.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ParserRegistry } from '../../src/parser/registry';
import { isTreeSitterAvailable } from '../../src/parser/languages/treeSitterLoader';

const registry = ParserRegistry.default();
let available = false;

beforeAll(async () => {
  available = await isTreeSitterAvailable();
});

const maybe = (fn: () => void) => (available ? fn : () => undefined);

describe('ParserRegistry', () => {
  it('routes extensions to the right parser', () => {
    expect(registry.get('.ts')?.id).toBe('javascript');
    expect(registry.get('.tsx')?.id).toBe('javascript');
    expect(registry.get('.py')?.id).toBe('python');
    expect(registry.get('.go')?.id).toBe('go');
    expect(registry.get('.java')?.id).toBe('java');
    expect(registry.get('.unknown')).toBeUndefined();
  });

  it('resolves a parser from a full path', () => {
    expect(registry.get('src/main/java/com/x/Main.java')?.id).toBe('java');
  });

  it('lists supported extensions and languages', () => {
    expect(registry.supportedExtensions()).toContain('.py');
    expect(registry.languages).toContain('javascript');
    expect(registry.languages).toContain('go');
  });
});

describe('tree-sitter runtime', () => {
  it('loads the WASM runtime', () => {
    expect(available).toBe(true);
  });

  it('parses python functions, classes and imports', async () => {
    if (!available) return;
    const file = await registry.get('.py')!.parse({
      repoId: 'r1',
      path: 'app/auth.py',
      content: `import os
from .db import connect

class Auth:
    def login(self, user):
        return connect(user)

def logout(user):
    return Auth().login(user)
`,
    });

    expect(file.error).toBeUndefined();
    expect(file.symbols.map((s) => s.qualifiedName)).toContain('Auth.login');
    expect(file.symbols.map((s) => s.qualifiedName)).toContain('logout');
    expect(file.imports.some((i) => i.specifier === 'os')).toBe(true);
    expect(file.imports.some((i) => i.specifier.includes('db'))).toBe(true);
  });

  it('attributes calls to the enclosing python function', async () => {
    if (!available) return;
    const file = await registry.get('.py')!.parse({
      repoId: 'r1',
      path: 'app/svc.py',
      content: `def alpha():
    return helper_one()

def beta():
    return helper_two()
`,
    });

    const byCaller = new Map<string, string[]>();
    for (const call of file.calls) {
      const caller = call.callerQualifiedName ?? '<top>';
      byCaller.set(caller, [...(byCaller.get(caller) || []), call.calleeName]);
    }
    expect(byCaller.get('alpha')).toEqual(['helper_one']);
    expect(byCaller.get('beta')).toEqual(['helper_two']);
  });

  it('parses go functions', async () => {
    if (!available) return;
    const file = await registry.get('.go')!.parse({
      repoId: 'r1',
      path: 'cmd/server.go',
      content: `package main

import "fmt"

func handleRequest(id string) error {
    logRequest(id)
    return nil
}
`,
    });

    expect(file.error).toBeUndefined();
    expect(file.symbols.some((s) => s.name === 'handleRequest')).toBe(true);
    expect(file.imports.some((i) => i.specifier === 'fmt')).toBe(true);
  });

  it('parses java classes and methods', async () => {
    if (!available) return;
    const file = await registry.get('.java')!.parse({
      repoId: 'r1',
      path: 'com/example/Service.java',
      content: `package com.example;

import java.util.List;

public class Service {
    public String greet(String name) {
        return format(name);
    }
}
`,
    });

    expect(file.error).toBeUndefined();
    expect(file.symbols.some((s) => s.kind === 'Class' && s.name === 'Service')).toBe(true);
    expect(file.symbols.some((s) => s.qualifiedName === 'Service.greet')).toBe(true);
  });

  it('returns an error result rather than throwing when content is empty', async () => {
    if (!available) return;
    const file = await registry.get('.py')!.parse({
      repoId: 'r1',
      path: 'empty.py',
      content: '',
    });
    expect(file.symbols).toEqual([]);
    expect(file.calls).toEqual([]);
  });
});