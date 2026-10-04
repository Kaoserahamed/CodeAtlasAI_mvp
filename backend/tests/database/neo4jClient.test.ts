/**
 * Graph store tests.
 *
 * A live Neo4j is needed for the integration cases; they run only when
 * TEST_NEO4J=true and are skipped otherwise, so the suite stays runnable on a
 * machine with no database. The query-construction cases below do not need
 * one: they assert against a recording fake driver, which is what protects
 * the properties this layer must keep, such as repo-scoped deletes and
 * batched writes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import neo4j from 'neo4j-driver';
import { Neo4jClient } from '../../src/database/neo4jClient';
import { JavaScriptParser } from '../../src/parser/languages/javascript';
import { SymbolResolver } from '../../src/resolver/symbolResolver';

let liveAvailable = false;

/** Records every Cypher statement and parameters set passed through it. */
class RecordingDriver {
  statements: { cypher: string; params: any }[] = [];

  session() {
    return {
      run: async (cypher: string, params: any = {}) => {
        this.statements.push({ cypher, params });
        return { records: [] as any[] };
      },
      close: async () => {},
    };
  }

  close = async () => {};
}

function makeClientWith(driver: any): Neo4jClient {
  const client = new Neo4jClient();
  (client as any).driver = driver;
  return client;
}

const emptyGraph = {
  nodes: [],
  edges: [],
  externalModules: [],
  stats: {} as any,
};

beforeAll(async () => {
  const probe = new Neo4jClient();
  liveAvailable = await probe.testConnection();
  if (liveAvailable) await probe.ensureSchema();
  await probe.close();
});

describe('Neo4jClient query construction', () => {
  it('scopes every node write by repoId', async () => {
    const driver = new RecordingDriver();
    const client = makeClientWith(driver);
    await client.storeGraph(
      {
        nodes: [{ id: 'n1', kind: 'File', name: 'a.ts', repoId: 'r1' }],
        edges: [],
        externalModules: [],
        stats: {} as any,
      },
      'r1'
    );

    const write = driver.statements.find((s) => s.cypher.includes('MERGE (n:CodeNode'));
    expect(write).toBeDefined();
    expect(write!.params.repoId).toBe('r1');
  });

  it('deletes by repoId and never wipes the whole database', async () => {
    const driver = new RecordingDriver();
    const client = makeClientWith(driver);
    await client.clearRepository('r1');

    const del = driver.statements.find((s) => s.cypher.includes('DETACH DELETE'));
    expect(del).toBeDefined();
    expect(del!.params.repoId).toBe('r1');
    expect(del!.cypher).not.toContain('MATCH (n) DETACH DELETE n');
  });

  it('writes nodes in bounded batches', async () => {
    const driver = new RecordingDriver();
    const client = makeClientWith(driver);

    const nodes = Array.from({ length: 1200 }, (_, i) => ({
      id: `n${i}`,
      kind: 'File' as const,
      name: `f${i}.ts`,
      repoId: 'r1',
    }));

    await client.storeGraph({ nodes, edges: [], externalModules: [], stats: {} as any }, 'r1');

    const writes = driver.statements.filter((s) => s.cypher.includes('MERGE (n:CodeNode'));
    expect(writes.length).toBe(3); // 500 + 500 + 200
    expect(writes[0].params.rows.length).toBe(500);
    expect(writes[2].params.rows.length).toBe(200);
  });

  it('removes only the replaced file subgraph on incremental writes', async () => {
    const driver = new RecordingDriver();
    const client = makeClientWith(driver);

    await client.storeGraph(emptyGraph, 'r1', ['src/a.ts', 'src/b.ts']);

    const del = driver.statements.find((s) => s.cypher.includes('DETACH DELETE'));
    expect(del!.params.paths).toEqual(['src/a.ts', 'src/b.ts']);
    expect(del!.params.repoId).toBe('r1');
  });

  it('clamps the graph fetch limit into a sane range', async () => {
    const driver = new RecordingDriver();
    const client = makeClientWith(driver);

    await client.fetchGraph({ repoId: 'r1', limit: 0 });
    const query = driver.statements[driver.statements.length - 1];

    // Sent as a neo4j integer so the server, not JS, enforces the cap.
    expect(neo4j.isInt(query.params.limit)).toBe(true);
    expect(query.params.limit.toNumber()).toBeGreaterThanOrEqual(1);
  });

  it('bounds neighborhood expansion depth', async () => {
    const driver = new RecordingDriver();
    const client = makeClientWith(driver);
    await client.fetchNeighborhood('r1', 'node1', 99);

    const query = driver.statements[driver.statements.length - 1];
    expect(query.cypher).toContain('[*1..3]');
  });

  it('reports changed and deleted files for incremental scans', async () => {
    // A fake standing in for a previous run that knew two files.
    const fingerprintDriver = {
      session: () => ({
        run: async () => ({
          records: [
            { get: (k: string) => (k === 'path' ? 'src/kept.ts' : k === 'hash' ? 'same' : '1') },
            { get: (k: string) => (k === 'path' ? 'src/gone.ts' : k === 'hash' ? 'old' : '1') },
          ],
        }),
        close: async () => {},
      }),
      close: async () => {},
    };
    const client = makeClientWith(fingerprintDriver);

    const result = await client.getChangedFiles(
      'r1',
      new Map([
        ['src/kept.ts', { hash: 'same', size: 10 }],
        ['src/new.ts', { hash: 'fresh', size: 20 }],
      ]),
      '1'
    );

    expect(result.unchanged).toContain('src/kept.ts');
    expect(result.changed).toContain('src/new.ts');
    // A file that vanished must be reported so its nodes get dropped.
    expect(result.deleted).toContain('src/gone.ts');
  });

  it('treats a parser version change as a full re-parse', async () => {
    const fingerprintDriver = {
      session: () => ({
        run: async () => ({
          records: [
            { get: (k: string) => (k === 'path' ? 'a.ts' : k === 'hash' ? 'same' : 'old-version') },
          ],
        }),
        close: async () => {},
      }),
      close: async () => {},
    };
    const client = makeClientWith(fingerprintDriver);

    const result = await client.getChangedFiles(
      'r1',
      new Map([['a.ts', { hash: 'same', size: 1 }]]),
      'new-version'
    );

    // Content is unchanged, but parsing semantics changed.
    expect(result.changed).toContain('a.ts');
    expect(result.unchanged).toHaveLength(0);
  });
});

describe.runIf(process.env.TEST_NEO4J === 'true')('Neo4jClient integration', () => {
  const REPO = `test-${Date.now()}`;

  afterAll(async () => {
    if (!liveAvailable) return;
    const client = new Neo4jClient();
    await client.clearRepository(REPO);
    await client.close();
  });

  it('round-trips a small graph', async () => {
    if (!liveAvailable) return;
    const js = new JavaScriptParser();
    const files = [
      await js.parse({
        repoId: REPO,
        path: 'src/util.ts',
        content: 'export function validate() {}',
      }),
      await js.parse({
        repoId: REPO,
        path: 'src/app.ts',
        content: "import { validate } from './util';\nfunction run() { validate(); }",
      }),
    ];

    const graph = new SymbolResolver().resolve(files, REPO);
    const client = new Neo4jClient();
    await client.storeGraph(graph, REPO);

    const fetched = await client.fetchGraph({ repoId: REPO, limit: 100 });
    expect(fetched.nodes.length).toBeGreaterThan(0);
    expect(fetched.edges.some((e) => e.kind === 'CALLS')).toBe(true);
    expect((await client.getStats(REPO)).File).toBe(2);

    await client.close();
  });

  it('keeps two repositories isolated', async () => {
    if (!liveAvailable) return;
    const js = new JavaScriptParser();
    const client = new Neo4jClient();

    const a = await js.parse({
      repoId: 'A',
      path: 'a.ts',
      content: 'export function onlyInA() {}',
    });
    const b = await js.parse({
      repoId: 'B',
      path: 'b.ts',
      content: 'export function onlyInB() {}',
    });

    await client.storeGraph(new SymbolResolver().resolve([a], 'A'), 'A');
    await client.storeGraph(new SymbolResolver().resolve([b], 'B'), 'B');

    // Clearing one repository must leave the other intact.
    await client.clearRepository('A');
    const remaining = await client.fetchGraph({ repoId: 'B', limit: 100 });
    expect(remaining.nodes.length).toBeGreaterThan(0);

    await client.clearRepository('B');
    await client.close();
  });
});