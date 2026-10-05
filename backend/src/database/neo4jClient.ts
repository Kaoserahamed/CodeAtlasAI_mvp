/**
 * Neo4j graph store.
 *
 * Rewritten around three requirements the previous version did not meet:
 *
 *  - Repository isolation. Every node carries a repoId and every query filters
 *    on it, so analysing one repository cannot overwrite or leak another's
 *    data. Clearing a repository no longer wipes the whole database.
 *  - Batched writes. The old code issued one Cypher round-trip per node and
 *    per edge, which is unusable on real repositories. Writes now use UNWIND
 *    in fixed-size chunks.
 *  - Idempotent, incremental updates. Nodes are MERGEd by their deterministic
 *    id, and a refresh removes only the subgraph of the files that changed.
 */
import neo4j, { Driver, Integer } from 'neo4j-driver';
import { config } from '../config';
import { GraphEdge, GraphNodeBase, PARSER_VERSION } from '../types';
import { ResolvedGraph } from '../resolver/symbolResolver';
import { chunk, deleteFilesInBatches, writeEdges, writeNodes } from './neo4jWriter';

export interface GraphQueryOptions {
  repoId: string;
  /** Cap on returned nodes; the graph must never render everything at once. */
  limit?: number;
  kinds?: string[];
  edgeKinds?: string[];
  /** Only nodes whose path starts with this prefix. */
  pathPrefix?: string;
  language?: string;
  search?: string;
}

export class Neo4jClient {
  private driver: Driver;
  private ready: Promise<void> | null = null;

  constructor() {
    this.driver = neo4j.driver(
      config.neo4j.uri,
      neo4j.auth.basic(config.neo4j.user, config.neo4j.password),
      { maxConnectionPoolSize: 50, connectionAcquisitionTimeout: 30000 }
    );
  }

  async testConnection(): Promise<boolean> {
    const session = this.driver.session();
    try {
      await session.run('RETURN 1');
      return true;
    } catch {
      return false;
    } finally {
      await session.close();
    }
  }

  /**
   * Constraints and indexes, created once per process.
   * Uniqueness is on (repoId, id) so the same logical id may exist in two
   * repositories without colliding.
   */
  async ensureSchema(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const session = this.driver.session();
        try {
          await session.run(
            'CREATE CONSTRAINT codeatlas_node_id IF NOT EXISTS ' +
              'FOR (n:CodeNode) REQUIRE (n.repoId, n.id) IS UNIQUE'
          );
          await session.run(
            'CREATE INDEX codeatlas_repo_kind IF NOT EXISTS ' +
              'FOR (n:CodeNode) ON (n.repoId, n.kind)'
          );
          await session.run(
            'CREATE INDEX codeatlas_repo_path IF NOT EXISTS ' +
              'FOR (n:CodeNode) ON (n.repoId, n.path)'
          );
          await session.run(
            'CREATE INDEX codeatlas_repo_name IF NOT EXISTS ' +
              'FOR (n:CodeNode) ON (n.repoId, n.name)'
          );
          await session.run(
            'CREATE INDEX codeatlas_fingerprint IF NOT EXISTS ' +
              'FOR (n:FileFingerprint) ON (n.repoId, n.path)'
          );
        } finally {
          await session.close();
        }
      })().catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }

  /**
   * Persist a resolved graph.
   *
   * `replacePaths` (when given) deletes the existing subgraph for those files
   * first, which is how an incremental refresh removes symbols that a changed
   * file no longer contains. Without it, writes merge onto whatever is there.
   */
  async storeGraph(
    graph: ResolvedGraph,
    repoId: string,
    replacePaths?: string[]
  ): Promise<void> {
    await this.ensureSchema();
    const session = this.driver.session();
    try {
      if (replacePaths?.length) {
        await deleteFilesInBatches(session, repoId, replacePaths);
      }

      await writeNodes(session, graph.nodes, repoId);
      await writeEdges(session, graph.edges, repoId);
    } finally {
      await session.close();
    }
  }

  /** Convert a neo4j Integer (or number) to a JS number. */
  private static num(value: unknown): number | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number') return value;
    if (Integer.isInteger(value)) return (value as Integer).toNumber();
    return undefined;
  }

  private static nodeFrom(props: Record<string, any>): GraphNodeBase {
    return {
      id: props.id,
      kind: props.kind,
      name: props.name,
      repoId: props.repoId,
      path: props.path ?? undefined,
      language: props.language ?? undefined,
      qualifiedName: props.qualifiedName ?? undefined,
      parameters: props.parameters ?? undefined,
      startLine: Neo4jClient.num(props.startLine),
      endLine: Neo4jClient.num(props.endLine),
      complexity: Neo4jClient.num(props.complexity),
      isExported: props.isExported ?? undefined,
      isTest: props.isTest ?? undefined,
      modulePath: props.modulePath ?? undefined,
    };
  }

  /**
   * Fetch a bounded, filtered slice of the graph.
   *
   * The limit is enforced in the database rather than after fetching, since
   * shipping an entire large repository to the client is what made the
   * original visualisation unusable.
   */
  async fetchGraph(options: GraphQueryOptions): Promise<{
    nodes: GraphNodeBase[];
    edges: GraphEdge[];
    truncated: boolean;
  }> {
    const session = this.driver.session();
    const limit = Math.min(Math.max(options.limit ?? 300, 1), 2000);

    try {
      const result = await session.run(
        `MATCH (n:CodeNode {repoId: $repoId})
         WHERE ($kinds IS NULL OR n.kind IN $kinds)
           AND ($pathPrefix IS NULL OR n.path STARTS WITH $pathPrefix)
           AND ($language IS NULL OR n.language = $language)
           AND ($search IS NULL
                OR toLower(n.name) CONTAINS toLower($search)
                OR toLower(coalesce(n.path, '')) CONTAINS toLower($search))
         RETURN n
         ORDER BY n.kind, n.path, n.startLine
         LIMIT $limit`,
        {
          repoId: options.repoId,
          kinds: options.kinds && options.kinds.length ? options.kinds : null,
          pathPrefix: options.pathPrefix ?? null,
          language: options.language ?? null,
          search: options.search ?? null,
          limit: neo4j.int(limit),
        }
      );

      const nodes: GraphNodeBase[] = [];
      const ids = new Set<string>();
      for (const record of result.records) {
        const node = Neo4jClient.nodeFrom(record.get('n').properties);
        nodes.push(node);
        ids.add(node.id);
      }

      // Only return edges whose endpoints are both present, so the client
      // never receives dangling references.
      const edges: GraphEdge[] = [];
      if (ids.size > 0) {
        const edgeResult = await session.run(
          `MATCH (a:CodeNode {repoId: $repoId})-[r:RELATES]->(b:CodeNode {repoId: $repoId})
           WHERE a.id IN $ids AND b.id IN $ids
             AND ($edgeKinds IS NULL OR r.kind IN $edgeKinds)
           RETURN a.id AS fromId, b.id AS toId, r`,
          {
            repoId: options.repoId,
            ids: [...ids],
            edgeKinds:
              options.edgeKinds && options.edgeKinds.length ? options.edgeKinds : null,
          }
        );

        for (const record of edgeResult.records) {
          const r = record.get('r').properties;
          edges.push({
            id: `${record.get('fromId')}-${r.kind}->${record.get('toId')}`,
            kind: r.kind,
            from: record.get('fromId'),
            to: record.get('toId'),
            meta: {
              resolution: r.resolution ?? 'unknown',
              confidence: Neo4jClient.num(r.confidence) ?? 0,
              line: Neo4jClient.num(r.line),
            },
          });
        }
      }

      // Hitting the cap exactly means there is more to explore.
      return { nodes, edges, truncated: nodes.length === limit };
    } finally {
      await session.close();
    }
  }

  /** Direct neighbours of a node, for lazy expansion in the UI. */
  async fetchNeighborhood(
    repoId: string,
    nodeId: string,
    depth = 1
  ): Promise<{ nodes: GraphNodeBase[]; edges: GraphEdge[] }> {
    const session = this.driver.session();
    // Depth is clamped: unbounded expansion is how a graph view stalls the UI.
    const boundedDepth = Math.min(Math.max(depth, 1), 3);
    try {
      const result = await session.run(
        `MATCH path = (root:CodeNode {repoId: $repoId, id: $nodeId})-[*1..${boundedDepth}]-(n:CodeNode)
         WITH nodes(path) AS ns, relationships(path) AS rs
         UNWIND ns AS node
         WITH collect(DISTINCT node) AS allNodes, collect(DISTINCT rs) AS allRels
         RETURN allNodes, allRels`,
        { repoId, nodeId }
      );

      const record = result.records[0];
      if (!record) return { nodes: [], edges: [] };

      const nodes = record
        .get('allNodes')
        .map((n: any) => Neo4jClient.nodeFrom(n.properties));

      const edges: GraphEdge[] = record.get('allRels').map((r: any) => {
        const p = r.properties;
        return {
          id: `${r.start}-${p.kind}->${r.end}`,
          kind: p.kind,
          from: r.start,
          to: r.end,
          meta: {
            resolution: p.resolution ?? 'unknown',
            confidence: Neo4jClient.num(p.confidence) ?? 0,
            line: Neo4jClient.num(p.line),
          },
        };
      });

      return { nodes, edges };
    } finally {
      await session.close();
    }
  }

  /** Single node with full detail, used for code navigation. */
  async fetchNode(repoId: string, nodeId: string): Promise<GraphNodeBase | null> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        'MATCH (n:CodeNode {repoId: $repoId, id: $nodeId}) RETURN n',
        { repoId, nodeId }
      );
      const record = result.records[0];
      return record ? Neo4jClient.nodeFrom(record.get('n').properties) : null;
    } finally {
      await session.close();
    }
  }

  /** Text search across symbol names and paths. */
  async search(repoId: string, term: string, limit = 50): Promise<GraphNodeBase[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (n:CodeNode {repoId: $repoId})
         WHERE toLower(n.name) CONTAINS toLower($term)
            OR toLower(coalesce(n.path, '')) CONTAINS toLower($term)
         RETURN n
         ORDER BY n.kind = 'File' DESC, size(n.name)
         LIMIT $limit`,
        { repoId, term, limit: neo4j.int(Math.min(limit, 200)) }
      );
      return result.records.map((r) => Neo4jClient.nodeFrom(r.get('n').properties));
    } finally {
      await session.close();
    }
  }

  /** Aggregate counts for the overview dashboard. */
  async getStats(repoId: string): Promise<Record<string, number>> {
    const session = this.driver.session();
    try {
      const nodeResult = await session.run(
        `MATCH (n:CodeNode {repoId: $repoId})
         RETURN n.kind AS kind, count(*) AS count`,
        { repoId }
      );
      const edgeResult = await session.run(
        `MATCH (:CodeNode {repoId: $repoId})-[r:RELATES]->(:CodeNode {repoId: $repoId})
         RETURN r.kind AS kind, count(*) AS count`,
        { repoId }
      );

      const stats: Record<string, number> = {};
      for (const record of [...nodeResult.records, ...edgeResult.records]) {
        const kind = record.get('kind');
        stats[kind] = (stats[kind] ?? 0) + (Neo4jClient.num(record.get('count')) ?? 0);
      }
      return stats;
    } finally {
      await session.close();
    }
  }

  /**
   * Decide which files actually need re-parsing.
   *
   * Returns the changed, added and deleted paths. Deletions matter: a removed
   * file must have its nodes dropped from the graph, otherwise the graph
   * silently drifts from the repository.
   */
  async getChangedFiles(
    repoId: string,
    current: Map<string, { hash: string; size: number }>,
    parserVersion: string
  ): Promise<{ changed: string[]; unchanged: string[]; deleted: string[] }> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (f:FileFingerprint {repoId: $repoId})
         RETURN f.path AS path, f.contentHash AS hash, f.parserVersion AS version`,
        { repoId }
      );

      const stored = new Map<string, { hash: string; version: string }>();
      for (const record of result.records) {
        stored.set(record.get('path'), {
          hash: record.get('hash'),
          version: record.get('version'),
        });
      }

      const changed: string[] = [];
      const unchanged: string[] = [];

      for (const [path, meta] of current) {
        const previous = stored.get(path);
        const sameVersion = previous?.version === parserVersion;
        if (sameVersion && previous?.hash === meta.hash) {
          unchanged.push(path);
        } else {
          changed.push(path);
        }
      }

      // Anything we knew about but can no longer see has been deleted.
      const deleted = [...stored.keys()].filter((p) => !current.has(p));

      return { changed, unchanged, deleted };
    } finally {
      await session.close();
    }
  }

  /** Persist content fingerprints so the next scan can be incremental. */
  async saveFingerprints(
    repoId: string,
    fingerprints: { path: string; hash: string; size: number }[]
  ): Promise<void> {
    const session = this.driver.session();
    try {
      const rows = fingerprints.map((f) => ({
        path: f.path,
        hash: f.hash,
        size: f.size,
      }));
      for (const batch of chunk(rows)) {
        await session.run(
          `UNWIND $rows AS row
           MERGE (f:FileFingerprint {repoId: $repoId, path: row.path})
           SET f.contentHash = row.hash,
               f.sizeBytes = row.size,
               f.parserVersion = $parserVersion,
               f.updatedAt = timestamp()`,
          { repoId, rows: batch, parserVersion: PARSER_VERSION }
        );
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Remove everything belonging to one repository.
   *
   * This deliberately scopes to a repoId. The previous implementation ran
   * MATCH (n) DETACH DELETE n, which destroyed every other repository's data.
   */
  async clearRepository(repoId: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run('MATCH (n:CodeNode {repoId: $repoId}) DETACH DELETE n', {
        repoId,
      });
      await session.run('MATCH (f:FileFingerprint {repoId: $repoId}) DELETE f', {
        repoId,
      });
    } finally {
      await session.close();
    }
  }

  /** Repositories that currently have data, for the project switcher. */
  async listRepositories(): Promise<{ repoId: string; files: number }[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (n:CodeNode)
         WHERE n.kind = 'File'
         WITH n.repoId AS repoId, count(*) AS files
         RETURN repoId, files
         ORDER BY files DESC`
      );
      return result.records.map((r) => ({
        repoId: r.get('repoId'),
        files: Neo4jClient.num(r.get('files')) ?? 0,
      }));
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}