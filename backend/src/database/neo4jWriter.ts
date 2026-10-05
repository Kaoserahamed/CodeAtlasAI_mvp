/**
 * Batched graph writes.
 *
 * Extracted from Neo4jClient so that the write path reads as one concern:
 * everything here takes a session and the repository id, and issues UNWIND
 * batches. The client owns the connection and decides when to call these;
 * they own the Cypher.
 *
 * The batch size is a deliberate trade-off. Cypher parameters are sent inline,
 * so a larger batch means fewer round-trips but a longer time holding a
 * transaction open. 500 keeps a full write well inside the default
 * transaction timeout on a repository of a few thousand files.
 */
import { Session } from 'neo4j-driver';
import { GraphEdge, GraphNodeBase } from '../types';

export const WRITE_BATCH = 500;

/** Split an array into fixed-size chunks for UNWIND batches. */
export function chunk<T>(items: T[], size = WRITE_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Remove the subgraph of the given files.
 *
 * Scoped to a repoId and to the listed paths: an incremental refresh must
 * discard what the changed files used to contain without touching the rest of
 * the repository, let alone another repository.
 */
export async function deleteFilesInBatches(
  session: Session,
  repoId: string,
  paths: string[]
): Promise<void> {
  for (const batch of chunk(paths)) {
    await session.run(
      `MATCH (n:CodeNode {repoId: $repoId})
       WHERE n.path IN $paths
       DETACH DELETE n`,
      { repoId, paths: batch }
    );
  }
}

/**
 * MERGE nodes by their deterministic id, then SET every property.
 *
 * MERGE on (repoId, id) rather than a blanket CREATE is what makes a rescan
 * idempotent, and the SET list is exhaustive rather than partial so a symbol
 * that loses a property between runs does not keep the stale value.
 */
export async function writeNodes(
  session: Session,
  nodes: GraphNodeBase[],
  repoId: string
): Promise<void> {
  const rows = nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    name: n.name,
    path: n.path ?? null,
    language: n.language ?? null,
    qualifiedName: n.qualifiedName ?? null,
    parameters: n.parameters ?? null,
    startLine: n.startLine ?? null,
    endLine: n.endLine ?? null,
    complexity: n.complexity ?? null,
    isExported: n.isExported ?? null,
    isTest: n.isTest ?? null,
    modulePath: n.modulePath ?? null,
  }));

  for (const batch of chunk(rows)) {
    await session.run(
      `UNWIND $rows AS row
       MERGE (n:CodeNode {repoId: $repoId, id: row.id})
       SET n.kind = row.kind,
           n.name = row.name,
           n.path = row.path,
           n.language = row.language,
           n.qualifiedName = row.qualifiedName,
           n.parameters = row.parameters,
           n.startLine = row.startLine,
           n.endLine = row.endLine,
           n.complexity = row.complexity,
           n.isExported = row.isExported,
           n.isTest = row.isTest,
           n.modulePath = row.modulePath,
           n.updatedAt = timestamp()`,
      { repoId, rows: batch }
    );
  }
}

/**
 * MERGE edges on the node pair and their kind.
 *
 * The kind is part of the merge key, so re-running a scan updates the
 * relationship metadata instead of duplicating relationships, and a symbol
 * that loses one of its call sites drops that edge rather than keeping it.
 */
export async function writeEdges(
  session: Session,
  edges: GraphEdge[],
  repoId: string
): Promise<void> {
  const rows = edges.map((e) => ({
    from: e.from,
    to: e.to,
    kind: e.kind,
    resolution: e.meta.resolution,
    confidence: e.meta.confidence,
    line: e.meta.line ?? null,
  }));

  for (const batch of chunk(rows)) {
    // Relationships are typed dynamically, so APOC-free Cypher merges them
    // under a generic RELATES relationship plus a `kind` property.
    await session.run(
      `UNWIND $rows AS row
       MATCH (a:CodeNode {repoId: $repoId, id: row.from})
       MATCH (b:CodeNode {repoId: $repoId, id: row.to})
       MERGE (a)-[r:RELATES {kind: row.kind}]->(b)
       SET r.resolution = row.resolution,
           r.confidence = row.confidence,
           r.line = row.line`,
      { repoId, rows: batch }
    );
  }
}