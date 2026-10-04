/**
 * Code index and secret scanning.
 *
 * The secret tests assert the most important property directly: a detected
 * value must not survive anywhere in the output, not even in a preview.
 */
import { describe, it, expect } from 'vitest';
import { CodeIndex, buildChunks, tokenize } from '../../src/services/codeIndex';
import {
  scanContent,
  redactForPrompt,
  redact,
  isPlaceholder,
} from '../../src/services/secretScanner';
import { JavaScriptParser } from '../../src/parser/languages/javascript';
import { SymbolResolver } from '../../src/resolver/symbolResolver';

const REPO = 'r1';
const js = new JavaScriptParser();

async function graphOf(files: { path: string; content: string }[]) {
  const parsed = [];
  for (const f of files) {
    parsed.push(await js.parse({ repoId: REPO, path: f.path, content: f.content }));
  }
  return new SymbolResolver().resolve(parsed, REPO);
}

describe('tokenize', () => {
  it('drops stop words and keeps meaningful terms', () => {
    const terms = tokenize('export function getUserById');
    expect(terms).toContain('user');
    expect(terms).toContain('get');
    expect(terms).not.toContain('export');
    expect(terms).not.toContain('function');
  });

  it('splits snake_case identifiers', () => {
    expect(tokenize('validate_user_name')).toContain('user');
  });

  it('returns nothing for an empty query', () => {
    expect(tokenize('   ')).toHaveLength(0);
  });
});

describe('buildChunks', () => {
  it('creates one chunk per symbol with real line ranges', async () => {
    const source =
      'export function alpha() {\n  return 1;\n}\n\nexport function beta() {\n  return 2;\n}';
    const g = await graphOf([{ path: 'src/x.ts', content: source }]);
    const chunks = buildChunks(REPO, g.nodes, new Map([['src/x.ts', source]]));

    expect(chunks).toHaveLength(2);
    const alpha = chunks.find((c) => c.symbolName === 'alpha')!;
    expect(alpha.startLine).toBe(1);
    expect(alpha.endLine).toBe(3);
    // The chunk text must be real source, so citations point at real lines.
    expect(alpha.text).toContain('return 1;');
  });

  it('indexes path and symbol name so either can match', async () => {
    const source = 'export function authenticate() { return true; }';
    const g = await graphOf([{ path: 'src/auth/session.ts', content: source }]);
    const index = new CodeIndex();
    index.build(buildChunks(REPO, g.nodes, new Map([['src/auth/session.ts', source]])));

    expect(index.search('authenticate')[0]?.chunk.symbolName).toBe('authenticate');
    expect(index.search('session')[0]?.chunk.path).toBe('src/auth/session.ts');
  });

  it('chunks files with no symbols so they stay searchable', () => {
    const source = Array.from({ length: 300 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const chunks = buildChunks(REPO, [], new Map([['data/plain.txt', source]]));

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].kind).toBe('File');
  });

  it('returns no results for an empty index or empty query', () => {
    const empty = new CodeIndex();
    empty.build([]);
    expect(empty.search('anything')).toEqual([]);

    const one = new CodeIndex();
    one.build([
      {
        id: 'c',
        repoId: REPO,
        path: 'a.ts',
        kind: 'Function',
        startLine: 1,
        endLine: 1,
        text: 'function a() {}',
        searchable: 'function a',
      },
    ]);
    expect(one.search('   ')).toEqual([]);
  });

  it('reports index statistics', async () => {
    const source = 'export function alpha() { return 1; }';
    const g = await graphOf([{ path: 'src/x.ts', content: source }]);
    const index = new CodeIndex();
    index.build(buildChunks(REPO, g.nodes, new Map([['src/x.ts', source]])));

    const stats = index.stats();
    expect(stats.chunks).toBe(1);
    expect(stats.terms).toBeGreaterThan(0);
    expect(stats.hasEmbeddings).toBe(false);
  });

  it('blends vector similarity without displacing exact matches', () => {
    const index = new CodeIndex();
    index.build([
      { id: 'a', repoId: REPO, path: 'a.ts', kind: 'Function', startLine: 1, endLine: 1,
        text: '', searchable: 'login', symbolName: 'login', embedding: [1, 0] },
      { id: 'b', repoId: REPO, path: 'b.ts', kind: 'Function', startLine: 1, endLine: 1,
        text: '', searchable: 'unrelated words here', symbolName: 'helper', embedding: [0.9, 0.1] },
    ]);

    // Both are semantically close; the exact name match must still win.
    const blended = index.combineWithVectors(index.search('login'), [1, 0], 0.35);
    expect(blended[0].chunk.id).toBe('a');
  });

  it('computes cosine similarity defensively', () => {
    expect(CodeIndex.cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(CodeIndex.cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(CodeIndex.cosine([1, 0], [1, 0, 0])).toBe(0);
    expect(CodeIndex.cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('secret scanning', () => {
  // A realistic-looking key: the pattern is AKIA followed by exactly 16
  // upper-case alphanumerics, so the value is 20 characters. AWS's own
  // documentation key (AKIAIOSFODNN7EXAMPLE) is deliberately treated as a
  // known placeholder, so these tests avoid it.
  const AWS_KEY = 'AKIA7XQ2M9PLK4NRD8VZ';

  it('detects an AWS access key without exposing it', () => {
    const findings = scanContent('src/config.ts', `const key = "${AWS_KEY}";`);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('aws-access-key');
    expect(findings[0].severity).toBe('high');
    // The value must not survive anywhere in the finding.
    expect(JSON.stringify(findings[0])).not.toContain(AWS_KEY);
  });

  it('treats the published AWS documentation key as a placeholder', () => {
    expect(scanContent('a.ts', 'const k = "AKIAIOSFODNN7EXAMPLE";')).toHaveLength(0);
    expect(isPlaceholder('AKIAIOSFODNN7EXAMPLE')).toBe(true);
    expect(isPlaceholder(AWS_KEY)).toBe(false);
  });

  it('detects a GitHub token and reports only a preview', () => {
    const token = 'ghp_' + 'a'.repeat(36);
    const findings = scanContent('.env', `TOKEN=${token}`);

    expect(findings.some((f) => f.kind === 'github-token')).toBe(true);
    expect(JSON.stringify(findings)).not.toContain(token);
  });

  it('detects a private key block', () => {
    const findings = scanContent(
      'id_rsa',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----'
    );
    expect(findings.some((f) => f.kind === 'private-key')).toBe(true);
  });

  it('detects credentials embedded in a connection string', () => {
    const findings = scanContent(
      'db.ts',
      `const url = "postgres://admin:hunter2@localhost:5432/app";`
    );
    expect(findings.find((f) => f.kind === 'basic-auth-url')).toBeDefined();
    expect(JSON.stringify(findings)).not.toContain('hunter2');
  });

  it('ignores placeholder values', () => {
    expect(scanContent('a.ts', `const password = "your_password_here";`)).toHaveLength(0);
    expect(isPlaceholder('change-me')).toBe(true);
    expect(isPlaceholder(AWS_KEY)).toBe(false);
  });

  it('skips very long lines such as minified bundles', () => {
    const minified = `const a="${AWS_KEY.repeat(200)}";`;
    expect(scanContent('bundle.js', minified)).toHaveLength(0);
  });

  it('reports the line number', () => {
    const findings = scanContent(
      'a.ts',
      `line one\nline two\nconst k = "${AWS_KEY}";`
    );
    expect(findings[0].line).toBe(3);
  });

  it('redacts the same secret to the same fingerprint', () => {
    const a = redact(AWS_KEY, 4);
    const b = redact(AWS_KEY, 4);
    const c = redact('AKIA7XQ2M9PLK4NRD8ZW', 4);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });

  it('strips credentials before text reaches a prompt', () => {
    const prompt = [
      'Here is the config:',
      `const key = "${AWS_KEY}";`,
      'const url = "postgres://admin:hunter2@localhost/db";',
    ].join('\n');

    const safe = redactForPrompt(prompt);
    expect(safe).not.toContain(AWS_KEY);
    expect(safe).not.toContain('hunter2');
    // Surrounding content survives, so the prompt stays useful.
    expect(safe).toContain('Here is the config:');
  });
});