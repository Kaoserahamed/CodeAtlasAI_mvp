/**
 * Impact analysis and cycle detection.
 *
 * The properties asserted here are the ones a developer would be misled by if
 * they broke: transitive reach, honest separation of uncertain results, and
 * cycles that do not include ordinary recursion.
 */
import { describe, it, expect } from 'vitest';
import {
  buildAdjacency,
  analyzeImpact,
  analyzePaths,
} from '../../src/services/impactAnalysis';
import { findCycles } from '../../src/services/circularDeps';
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

// Impact flows from callers to callees: b calls a, c calls b.
// So changing `a` affects `b` and `c` UPSTREAM, not downstream.
const CHAIN = [
  { path: 'src/a.ts', content: 'export function a() {}' },
  { path: 'src/b.ts', content: `import { a } from './a';\nexport function b() { a(); }` },
  { path: 'src/c.ts', content: `import { b } from './b';\nexport function c() { b(); }` },
];

const idOf = (g: { nodes: { name: string; kind: string; id: string }[] }, name: string) =>
  g.nodes.find((n) => n.name === name && n.kind === 'Function')!.id;

describe('analyzeImpact', () => {
  it('finds the callers affected when a leaf function changes', async () => {
    const g = await graphOf(CHAIN);
    const adjacency = buildAdjacency(g.nodes, g.edges);

    // `a` is called by b, which is called by c: both are impacted.
    const result = analyzeImpact(adjacency, idOf(g, 'a'), { direction: 'upstream' });

    const names = result!.impacted.map((i) => i.node.name);
    expect(names).toContain('b');
    expect(names).toContain('c');
  });

  it('reports what a caller depends on when walking downstream', async () => {
    const g = await graphOf(CHAIN);
    const adjacency = buildAdjacency(g.nodes, g.edges);
    const result = analyzeImpact(adjacency, idOf(g, 'c'), { direction: 'downstream' });

    const names = result!.impacted.map((i) => i.node.name);
    expect(names).toContain('b');
    expect(names).toContain('a');
  });

  it('finds transitive impact with a call chain', async () => {
    const g = await graphOf(CHAIN);
    const adjacency = buildAdjacency(g.nodes, g.edges);
    const result = analyzeImpact(adjacency, idOf(g, 'a'), { direction: 'upstream' });

    // The chain shows how c is reached, not just that it is affected.
    const c = result!.impacted.find((i) => i.node.name === 'c')!;
    expect(c.depth).toBe(2);
    expect(c.path.join(' -> ')).toContain('a');
  });

  it('does not include the origin itself', async () => {
    const g = await graphOf(CHAIN);
    const adjacency = buildAdjacency(g.nodes, g.edges);
    const result = analyzeImpact(adjacency, idOf(g, 'a'), { direction: 'upstream' });
    expect(result!.impacted.some((i) => i.node.id === idOf(g, 'a'))).toBe(false);
  });

  it('respects the depth limit', async () => {
    const g = await graphOf(CHAIN);
    const adjacency = buildAdjacency(g.nodes, g.edges);

    const shallow = analyzeImpact(adjacency, idOf(g, 'a'), {
      direction: 'upstream',
      maxDepth: 1,
    });
    expect(shallow!.impacted.some((i) => i.node.name === 'c')).toBe(false);
    expect(shallow!.impacted.some((i) => i.node.name === 'b')).toBe(true);
  });

  it('separates impact reached only through inferred edges', async () => {
    const g = await graphOf(CHAIN);
    const adjacency = buildAdjacency(g.nodes, g.edges);

    // Downgrade every call edge; everything behind one becomes uncertain.
    adjacency.outgoing.forEach((links) => {
      for (const link of links) {
        if (link.edge.kind === 'CALLS') link.edge.meta.resolution = 'inferred';
      }
    });

    const result = analyzeImpact(adjacency, idOf(g, 'a'), { direction: 'upstream' });
    // Nothing proven remains, so nothing is claimed as certain impact.
    expect(result!.impacted).toHaveLength(0);
    expect(result!.uncertain.length).toBeGreaterThan(0);
  });

  it('returns null for an unknown node', async () => {
    const g = await graphOf(CHAIN);
    const adjacency = buildAdjacency(g.nodes, g.edges);
    expect(analyzeImpact(adjacency, 'nope', { direction: 'downstream' })).toBeNull();
  });

  it('lists affected files and tests separately', async () => {
    const g = await graphOf([
      ...CHAIN,
      {
        path: 'src/__tests__/a.test.ts',
        content: `import { a } from '../a';\nfunction t() { a(); }`,
      },
    ]);
    const adjacency = buildAdjacency(g.nodes, g.edges);
    const result = analyzeImpact(adjacency, idOf(g, 'a'), { direction: 'upstream' });

    expect(result!.affectedFiles).toContain('src/b.ts');
    // Tests that cover the change are called out so they can be run.
    expect(result!.affectedTests.some((t) => t.includes('a.test.ts'))).toBe(true);
  });

  it('surfaces exported symbols as the likeliest breakages', async () => {
    const g = await graphOf(CHAIN);
    const adjacency = buildAdjacency(g.nodes, g.edges);
    const result = analyzeImpact(adjacency, idOf(g, 'a'), { direction: 'upstream' });
    expect(result!.affectedExports.map((e) => e.node.name)).toContain('b');
  });

  it('merges impact across several changed paths', async () => {
    const g = await graphOf(CHAIN);
    const adjacency = buildAdjacency(g.nodes, g.edges);
    const result = analyzePaths(adjacency, [idOf(g, 'a')], { direction: 'upstream' });
    expect(result!.impacted.length).toBeGreaterThan(0);
  });

  it('returns null when no origin matches', async () => {
    const g = await graphOf(CHAIN);
    const adjacency = buildAdjacency(g.nodes, g.edges);
    expect(analyzePaths(adjacency, ['missing'], { direction: 'downstream' })).toBeNull();
  });
});

describe('findCycles', () => {
  it('detects a two-file import cycle', async () => {
    const g = await graphOf([
      { path: 'src/x.ts', content: `import './y';\nexport const x = 1;` },
      { path: 'src/y.ts', content: `import './x';\nexport const y = 2;` },
    ]);

    const cycles = findCycles(g.nodes, g.edges);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].size).toBe(2);
    expect(cycles[0].paths.sort()).toEqual(['src/x.ts', 'src/y.ts']);
  });

  it('detects a three-file cycle', async () => {
    const g = await graphOf([
      { path: 'src/a.ts', content: `import './b';\nexport const a = 1;` },
      { path: 'src/b.ts', content: `import './c';\nexport const b = 2;` },
      { path: 'src/c.ts', content: `import './a';\nexport const c = 3;` },
    ]);

    const cycles = findCycles(g.nodes, g.edges);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].size).toBe(3);
  });

  it('finds no cycle in an acyclic graph', async () => {
    const g = await graphOf([
      { path: 'src/a.ts', content: `import './b';\nexport const a = 1;` },
      { path: 'src/b.ts', content: `import './c';\nexport const b = 2;` },
      { path: 'src/c.ts', content: 'export const c = 3;' },
    ]);

    expect(findCycles(g.nodes, g.edges)).toHaveLength(0);
  });

  it('ignores recursion, which is not a structural problem', async () => {
    const g = await graphOf([
      { path: 'src/r.ts', content: 'export function r(n: number) { return n ? r(n - 1) : 0; }' },
    ]);

    // A self-referencing CALLS edge must not be reported as a cycle.
    expect(findCycles(g.nodes, g.edges)).toHaveLength(0);
  });

  it('detects a self-import', async () => {
    const g = await graphOf([
      { path: 'src/self.ts', content: `import './self';\nexport const s = 1;` },
    ]);
    expect(findCycles(g.nodes, g.edges).length).toBeGreaterThan(0);
  });
});