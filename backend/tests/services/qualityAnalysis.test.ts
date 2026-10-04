/**
 * Quality and technical debt analysis.
 *
 * The assertions focus on avoiding false confidence: dead-code detection must
 * not accuse exported symbols, and duplicate detection must not fire on
 * trivially short bodies.
 */
import { describe, it, expect } from 'vitest';
import {
  analyzeQuality,
  extractBodies,
  DEFAULT_THRESHOLDS,
} from '../../src/services/qualityAnalysis';
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

describe('analyzeQuality', () => {
  it('flags a function above the complexity threshold', async () => {
    const body = Array.from(
      { length: 25 },
      (_, i) => `  if (x === ${i}) { return ${i}; }`
    ).join('\n');
    const g = await graphOf([{ path: 'src/c.ts', content: `function c(x) {\n${body}\n}` }]);

    const report = analyzeQuality({ nodes: g.nodes, edges: g.edges });
    const finding = report.findings.find((f) => f.kind === 'high-complexity');

    expect(finding).toBeDefined();
    // Findings explain themselves rather than just carrying a number.
    expect(finding!.explanation.length).toBeGreaterThan(40);
    expect(finding!.suggestion.length).toBeGreaterThan(10);
  });

  it('reports average and maximum complexity', async () => {
    const g = await graphOf([
      { path: 'src/a.ts', content: 'function a() { if (1) {} }' },
      { path: 'src/b.ts', content: 'function b() { if (1) { if (2) {} } }' },
    ]);

    const report = analyzeQuality({ nodes: g.nodes, edges: g.edges });
    expect(report.summary.functions).toBe(2);
    expect(report.summary.maxComplexity).toBeGreaterThanOrEqual(
      report.summary.averageComplexity
    );
  });

  it('flags a long function', async () => {
    const filler = Array.from(
      { length: 100 },
      (_, i) => `  const v${i} = ${i};`
    ).join('\n');
    const g = await graphOf([
      { path: 'src/long.ts', content: `function long() {\n${filler}\n}` },
    ]);

    const report = analyzeQuality({ nodes: g.nodes, edges: g.edges });
    expect(report.findings.some((f) => f.kind === 'long-function')).toBe(true);
    expect(report.summary.longestFunctionLines).toBeGreaterThan(80);
  });

  it('suggests an uncalled private function but spares exported ones', async () => {
    const g = await graphOf([
      {
        path: 'src/d.ts',
        content: 'function unused() { return 1; }\nexport function used() {}',
      },
    ]);

    const report = analyzeQuality({ nodes: g.nodes, edges: g.edges });
    const dead = report.findings.filter((f) => f.kind === 'dead-code');

    expect(dead.map((d) => d.title)).toContain('unused has no callers');
    // An export may be used by something static analysis cannot see, so it
    // must not be reported. Match exactly to avoid matching 'unused'.
    expect(dead.some((d) => d.title === 'used has no callers')).toBe(false);
    // The explanation admits this is a candidate, not a certainty.
    expect(dead[0].explanation).toContain('candidate');
  });

  it('does not report called functions as dead', async () => {
    const g = await graphOf([
      { path: 'src/u.ts', content: 'export function helper() {}' },
      {
        path: 'src/m.ts',
        content: `import { helper } from './u';\nfunction main() { helper(); }`,
      },
    ]);

    const report = analyzeQuality({ nodes: g.nodes, edges: g.edges });
    expect(
      report.findings.some(
        (f) => f.kind === 'dead-code' && f.title.includes('helper')
      )
    ).toBe(false);
  });

  it('flags a high fan-in symbol as a coupling hotspot', async () => {
    const callers = Array.from(
      { length: 30 },
      (_, i) => `import { hot } from './hot';\nexport function c${i}() { hot(); }`
    );
    const g = await graphOf([
      { path: 'src/hot.ts', content: 'export function hot() {}' },
      ...callers.map((content, i) => ({ path: `src/c${i}.ts`, content })),
    ]);

    const report = analyzeQuality({ nodes: g.nodes, edges: g.edges });
    expect(report.findings.some((f) => f.kind === 'high-coupling')).toBe(true);
  });

  it('detects near-identical function bodies in different files', async () => {
    const body = (n: number) =>
      Array.from({ length: 12 }, (_, i) => `  const total${i} = ${i} + ${n};`).join('\n');
    const sources = new Map([
      ['src/x.ts', `function calc(n) {\n${body(1)}\n}`],
      ['src/y.ts', `function calc(n) {\n${body(1)}\n}`],
    ]);
    const g = await graphOf([
      { path: 'src/x.ts', content: sources.get('src/x.ts')! },
      { path: 'src/y.ts', content: sources.get('src/y.ts')! },
    ]);

    // Bodies must be supplied from source; the graph does not carry them.
    const bodies = extractBodies(g.nodes, sources);
    expect(bodies.size).toBe(2);

    const report = analyzeQuality({ nodes: g.nodes, edges: g.edges, bodies });
    const dup = report.findings.find((f) => f.kind === 'duplicate');

    expect(dup).toBeDefined();
    expect(dup!.nodeIds).toHaveLength(2);
    expect(dup!.metric!.value).toBeGreaterThanOrEqual(85);
  });

  it('extracts bodies for every function and skips unknown files', async () => {
    const g = await graphOf([
      { path: 'src/a.ts', content: 'function a() {\n  return 1;\n}\nfunction b() {\n  return 2;\n}' },
    ]);

    const bodies = extractBodies(g.nodes, new Map([['src/a.ts', 'function a() {\n  return 1;\n}\nfunction b() {\n  return 2;\n}']]));
    expect(bodies.size).toBe(2);

    // A missing source file yields nothing rather than throwing.
    expect(extractBodies(g.nodes, new Map()).size).toBe(0);
  });

  it('ignores trivially short bodies when comparing for duplicates', async () => {
    const g = await graphOf([
      { path: 'src/a.ts', content: 'function a() { return 1; }' },
      { path: 'src/b.ts', content: 'function b() { return 1; }' },
    ]);

    const report = analyzeQuality({ nodes: g.nodes, edges: g.edges });
    expect(report.findings.some((f) => f.kind === 'duplicate')).toBe(false);
  });

  it('surfaces import cycles as findings', async () => {
    const g = await graphOf([
      { path: 'src/x.ts', content: `import './y';\nexport const x = 1;` },
      { path: 'src/y.ts', content: `import './x';\nexport const y = 1;` },
    ]);

    const report = analyzeQuality({
      nodes: g.nodes,
      edges: g.edges,
      cycles: [{ nodeIds: ['a', 'b'], paths: ['src/x.ts', 'src/y.ts'], size: 2 }],
    });
    expect(report.findings.some((f) => f.kind === 'circular-import')).toBe(true);
  });

  it('orders findings worst-first and ranks hotspots', async () => {
    const body = Array.from(
      { length: 30 },
      (_, i) => `  if (x === ${i}) { return ${i}; }`
    ).join('\n');
    const filler = Array.from(
      { length: 100 },
      (_, i) => `  const v${i} = ${i};`
    ).join('\n');
    const g = await graphOf([
      { path: 'src/bad.ts', content: `function bad(x) {\n${body}\n${filler}\n}` },
    ]);

    const report = analyzeQuality({ nodes: g.nodes, edges: g.edges });
    expect(report.findings[0].severity).toBe('high');
    expect(report.hotspots[0].path).toBe('src/bad.ts');
    expect(report.hotspots[0].reasons.length).toBeGreaterThan(0);
  });

  it('produces a health score within range', async () => {
    const g = await graphOf([
      { path: 'src/clean.ts', content: 'export function ok() { return 1; }' },
    ]);
    const report = analyzeQuality({ nodes: g.nodes, edges: g.edges });
    expect(report.summary.healthScore).toBeGreaterThanOrEqual(0);
    expect(report.summary.healthScore).toBeLessThanOrEqual(100);
  });

  it('honours custom thresholds', async () => {
    const g = await graphOf([
      { path: 'src/s.ts', content: 'function s(x) { if (1) { if (2) { if (3) {} } } }' },
    ]);

    expect(
      analyzeQuality({ nodes: g.nodes, edges: g.edges }).findings.some(
        (f) => f.kind === 'high-complexity'
      )
    ).toBe(false);

    // A permissive threshold should now flag the same code.
    expect(
      analyzeQuality(
        { nodes: g.nodes, edges: g.edges },
        { ...DEFAULT_THRESHOLDS, complexity: 2 }
      ).findings.some((f) => f.kind === 'high-complexity')
    ).toBe(true);
  });
});