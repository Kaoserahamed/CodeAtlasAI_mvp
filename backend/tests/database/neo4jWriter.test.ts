/**
 * Batched write helpers.
 *
 * The Cypher these produce is the contract the graph store depends on: which
 * statement is issued, with which parameters, and in how many batches. These
 * tests assert that shape directly against a recording session, so a change
 * to a query shows up as a failing assertion rather than as corrupted data in
 * someone's database.
 */
import { describe, it, expect } from 'vitest';
import {
  chunk,
  deleteFilesInBatches,
  writeNodes,
  writeEdges,
  WRITE_BATCH,
} from '../../src/database/neo4jWriter';
import { GraphEdge, GraphNodeBase } from '../../src/types';

/** Records every statement issued, standing in for a Neo4j session. */
function recordingSession() {
  const statements: { cypher: string; params: any }[] = [];
  return {
    statements,
    session: {
      run: async (cypher: string, params: any = {}) => {
        statements.push({ cypher, params });
        return { records: [] as any[] };
      },
    } as any,
  };
}

const node = (over: Partial<GraphNodeBase> = {}): GraphNodeBase =>
  ({
    id: 'n1',
    kind: 'File',
    name: 'a.ts',
    repoId: 'r1',
    ...over,
  }) as GraphNodeBase;

const edge = (meta?: Partial<GraphEdge['meta']>): GraphEdge =>
  ({
    from: 'n1',
    to: 'n2',
    kind: 'IMPORTS',
    meta: { resolution: 'resolved', confidence: 'high', line: 12, ...meta },
  }) as GraphEdge;
describe('chunk', () => {
  it('splits into fixed-size batches', () => {
    const items = Array.from({ length: 1200 }, (_, i) => i);
    const batches = chunk(items);

    expect(batches.length).toBe(3);
    expect(batches[0]).toHaveLength(WRITE_BATCH);
    expect(batches[2]).toHaveLength(1200 - WRITE_BATCH * 2);
  });

  it('returns nothing for an empty list rather than one empty batch', () => {
    expect(chunk([])).toEqual([]);
  });

  it('keeps order and loses nothing', () => {
    const items = Array.from({ length: 7 }, (_, i) => i);
    expect(chunk(items, 3).flat()).toEqual(items);
  });

  it('honours an explicit batch size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2).map((b) => b.length)).toEqual([2, 2, 1]);
  });
});

describe('deleteFilesInBatches', () => {
  it('scopes the delete to the repo and the listed paths', async () => {
    const { session, statements } = recordingSession();

    await deleteFilesInBatches(session, 'r1', ['src/a.ts']);

    const [del] = statements;
    expect(del.cypher).toContain('DETACH DELETE');
    expect(del.cypher).toContain('n.path IN $paths');
    expect(del.params.repoId).toBe('r1');
    expect(del.params.paths).toEqual(['src/a.ts']);
  });

  it('never issues a statement that would empty the database', async () => {
    const { session, statements } = recordingSession();

    await deleteFilesInBatches(session, 'r1', ['src/a.ts']);

    expect(statements[0].cypher).not.toContain('MATCH (n) DETACH DELETE n');
    expect(statements[0].params.repoId).toBe('r1');
  });

  it('batches a long path list', async () => {
    const { session, statements } = recordingSession();
    const paths = Array.from({ length: 1100 }, (_, i) => `src/f${i}.ts`);

    await deleteFilesInBatches(session, 'r1', paths);

    expect(statements.length).toBe(3);
    expect(statements[0].params.paths).toHaveLength(WRITE_BATCH);
  });
});

describe('writeNodes', () => {
  it('merges on (repoId, id) so a rescan is idempotent', async () => {
    const { session, statements } = recordingSession();

    await writeNodes(session, [node()], 'r1');

    expect(statements[0].cypher).toContain(
      'MERGE (n:CodeNode {repoId: $repoId, id: row.id})'
    );
    expect(statements[0].params.repoId).toBe('r1');
  });

  it('sends an absent optional property as null rather than omitting it', async () => {
    const { session, statements } = recordingSession();

    await writeNodes(session, [node({ path: undefined, complexity: undefined })], 'r1');

    // A missing key would leave the previous value in place on MERGE+SET, so
    // an absent property still has to be sent, as null.
    const row = statements[0].params.rows[0];
    expect('path' in row).toBe(true);
    expect(row.path).toBeNull();
    expect(row.complexity).toBeNull();
  });

  it('sends every property the SET clause writes', async () => {
    const { session, statements } = recordingSession();

    await writeNodes(session, [node()], 'r1');

    const row = statements[0].params.rows[0];
    for (const key of [
      'id', 'kind', 'name', 'path', 'language', 'qualifiedName',
      'parameters', 'startLine', 'endLine', 'complexity', 'isExported',
      'isTest', 'modulePath',
    ]) {
      expect(row).toHaveProperty(key);
    }
  });

  it('batches beyond the batch size', async () => {
    const { session, statements } = recordingSession();
    const nodes = Array.from({ length: 1200 }, (_, i) => node({ id: `n${i}` }));

    await writeNodes(session, nodes, 'r1');

    expect(statements.length).toBe(3);
    expect(statements[2].params.rows).toHaveLength(200);
  });

  it('issues no statement for an empty node list', async () => {
    const { session, statements } = recordingSession();

    await writeNodes(session, [], 'r1');

    expect(statements).toHaveLength(0);
  });
});

describe('writeEdges', () => {
  it('merges on the node pair and the kind', async () => {
    const { session, statements } = recordingSession();

    await writeEdges(session, [edge()], 'r1');

    expect(statements[0].cypher).toContain('MERGE (a)-[r:RELATES {kind: row.kind}]->(b)');
  });

  it('matches both endpoints within the same repository', async () => {
    const { session, statements } = recordingSession();

    await writeEdges(session, [edge()], 'r1');

    // Both MATCH clauses must be scoped, or an edge could resolve to a node
    // in a different repository that happens to share an id.
    expect(statements[0].cypher).toContain(
      'MATCH (a:CodeNode {repoId: $repoId, id: row.from})'
    );
    expect(statements[0].cypher).toContain(
      'MATCH (b:CodeNode {repoId: $repoId, id: row.to})'
    );
    expect(statements[0].params.repoId).toBe('r1');
  });

  it('carries the resolution metadata so confidence is not lost', async () => {
    const { session, statements } = recordingSession();

    await writeEdges(session, [edge()], 'r1');

    const row = statements[0].params.rows[0];
    expect(row.resolution).toBe('resolved');
    expect(row.confidence).toBe('high');
    expect(row.line).toBe(12);
  });

  it('sends a null line when the edge has none', async () => {
    const { session, statements } = recordingSession();

    await writeEdges(session, [edge({ line: undefined })], 'r1');

    expect(statements[0].params.rows[0].line).toBeNull();
  });

  it('issues no statement for an empty edge list', async () => {
    const { session, statements } = recordingSession();

    await writeEdges(session, [], 'r1');

    expect(statements).toHaveLength(0);
  });
});