/**
 * Change impact analysis.
 *
 * Answers "what breaks if I change this?" by walking the graph in both
 * directions from a changed node: downstream is what depends on it, upstream
 * is what it depends on.
 *
 * Every hop is bounded by depth, and the traversal records the path it took,
 * so an impact can be shown as an actual call chain rather than a bare list.
 * Nodes reached only through low-confidence edges are reported separately:
 * they may be affected, but static analysis cannot prove it.
 */
import { GraphEdge, GraphNodeBase, ResolutionTier } from '../types';

export type ImpactDirection = 'downstream' | 'upstream';

export interface ImpactedNode {
  node: GraphNodeBase;
  /** Shortest hop count from the changed node. */
  depth: number;
  /** One representative path, for display as a call chain. */
  path: string[];
}

export interface ImpactResult {
  origin: GraphNodeBase;
  impacted: ImpactedNode[];
  /** Impact reachable only through inferred or unknown relationships. */
  uncertain: ImpactedNode[];
  affectedFiles: string[];
  affectedModules: string[];
  affectedTests: string[];
  /** Exported symbols in the blast radius: the likeliest breakages. */
  affectedExports: ImpactedNode[];
  /** True when the traversal was cut off by the depth or node limit. */
  truncated: boolean;
}

export interface ImpactOptions {
  direction: ImpactDirection;
  maxDepth?: number;
  /** Cap on returned nodes, so one hub node cannot flood the response. */
  maxNodes?: number;
}

export interface Adjacency {
  outgoing: Map<string, { to: string; edge: GraphEdge }[]>;
  incoming: Map<string, { to: string; edge: GraphEdge }[]>;
  nodes: Map<string, GraphNodeBase>;
}

/** Build adjacency lists once so repeated impact queries stay cheap. */
export function buildAdjacency(
  nodes: GraphNodeBase[],
  edges: GraphEdge[]
): Adjacency {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, { to: string; edge: GraphEdge }[]>();
  const incoming = new Map<string, { to: string; edge: GraphEdge }[]>();

  const push = (
    map: Map<string, { to: string; edge: GraphEdge }[]>,
    key: string,
    entry: { to: string; edge: GraphEdge }
  ) => {
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  };

  for (const edge of edges) {
    // Ignore edges pointing outside the loaded slice.
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) continue;
    push(outgoing, edge.from, { to: edge.to, edge });
    push(incoming, edge.to, { to: edge.from, edge });
  }

  return { outgoing, incoming, nodes: nodeMap };
}

/**
 * Structural relationships that indicate real coupling.
 * DEFINES is the containment link from a file to its own symbols; following it
 * would make every symbol appear to impact its file's neighbours.
 */
const IMPACT_EDGE_KINDS = new Set([
  'CALLS',
  'IMPORTS',
  'REEXPORTS',
  'EXTENDS',
  'IMPLEMENTS',
]);

export function analyzeImpact(
  adjacency: Adjacency,
  originId: string,
  options: ImpactOptions
): ImpactResult | null {
  const origin = adjacency.nodes.get(originId);
  if (!origin) return null;

  const maxDepth = Math.min(Math.max(options.maxDepth ?? 3, 1), 8);
  const maxNodes = Math.min(Math.max(options.maxNodes ?? 500, 1), 5000);

  const neighbours =
    options.direction === 'downstream' ? adjacency.outgoing : adjacency.incoming;

  /** node id -> shortest depth at which it was reached */
  const depthOf = new Map<string, number>([[originId, 0]]);
  /** node id -> one path from the origin */
  const pathOf = new Map<string, string[]>([[originId, [originId]]]);
  /** node id -> whether every hop to it was fully resolved */
  const certainOf = new Map<string, boolean>([[originId, true]]);

  // Breadth-first, so a node is first seen by its shortest path.
  let frontier = [originId];
  let truncated = false;

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];

    for (const current of frontier) {
      const parentCertain = certainOf.get(current) ?? true;

      for (const link of neighbours.get(current) ?? []) {
        if (!IMPACT_EDGE_KINDS.has(link.edge.kind)) continue;

        const { to } = link;
        if (depthOf.has(to)) continue;

        const certain =
          parentCertain &&
          link.edge.meta.resolution === ('resolved' as ResolutionTier);

        depthOf.set(to, depth);
        pathOf.set(to, [...(pathOf.get(current) ?? []), to]);
        certainOf.set(to, certain);

        if (depthOf.size > maxNodes) {
          truncated = true;
          break;
        }
        next.push(to);
      }

      if (truncated) break;
    }

    frontier = next;
    if (truncated) break;
  }

  depthOf.delete(originId);

  const impacted: ImpactedNode[] = [];
  const uncertain: ImpactedNode[] = [];

  for (const [id, depth] of depthOf) {
    const node = adjacency.nodes.get(id);
    if (!node) continue;
    const entry: ImpactedNode = {
      node,
      depth,
      path: (pathOf.get(id) ?? []).map(
        (pid) => adjacency.nodes.get(pid)?.name ?? pid
      ),
    };
    if (certainOf.get(id)) impacted.push(entry);
    else uncertain.push(entry);
  }

  const sortByDepth = (a: ImpactedNode, b: ImpactedNode) => a.depth - b.depth;

  const files = new Set<string>();
  const modules = new Set<string>();
  const tests = new Set<string>();
  const exports: ImpactedNode[] = [];

  for (const entry of [...impacted, ...uncertain]) {
    if (entry.node.path) {
      files.add(entry.node.path);
      // Symbols roll up to their folder so the UI can group by module.
      const slash = entry.node.path.lastIndexOf('/');
      modules.add(slash === -1 ? '' : entry.node.path.slice(0, slash));
    }
    if (entry.node.isTest) tests.add(entry.node.path ?? entry.node.name);
    if (entry.node.isExported && entry.node.kind !== 'File') exports.push(entry);
  }

  return {
    origin,
    impacted: impacted.sort(sortByDepth),
    uncertain: uncertain.sort(sortByDepth),
    affectedFiles: [...files].sort(),
    affectedModules: [...modules].sort(),
    affectedTests: [...tests].sort(),
    affectedExports: exports.sort(sortByDepth),
    truncated,
  };
}

/**
 * Impact of a set of changed paths at once, which is what a pull request needs.
 * Results are merged so a file and a symbol inside it do not appear as
 * separate origins, and the shallowest depth wins for any node reached twice.
 */
export function analyzePaths(
  adjacency: Adjacency,
  pathIds: string[],
  options: ImpactOptions
): ImpactResult | null {
  const origins = pathIds
    .map((id) => adjacency.nodes.get(id))
    .filter((n): n is GraphNodeBase => Boolean(n));

  if (origins.length === 0) return null;

  const merged = new Map<string, ImpactedNode>();
  let truncated = false;

  for (const origin of origins) {
    const result = analyzeImpact(adjacency, origin.id, options);
    if (!result) continue;
    truncated = truncated || result.truncated;
    for (const entry of [...result.impacted, ...result.uncertain]) {
      const existing = merged.get(entry.node.id);
      if (!existing || entry.depth < existing.depth) merged.set(entry.node.id, entry);
    }
  }

  const all = [...merged.values()].sort((a, b) => a.depth - b.depth);

  const files = new Set<string>();
  const modules = new Set<string>();
  const tests = new Set<string>();
  const exports: ImpactedNode[] = [];

  for (const entry of all) {
    if (entry.node.path) {
      files.add(entry.node.path);
      const slash = entry.node.path.lastIndexOf('/');
      modules.add(slash === -1 ? '' : entry.node.path.slice(0, slash));
    }
    if (entry.node.isTest) tests.add(entry.node.path ?? entry.node.name);
    if (entry.node.isExported && entry.node.kind !== 'File') exports.push(entry);
  }

  return {
    origin: origins[0],
    impacted: all,
    uncertain: [],
    affectedFiles: [...files].sort(),
    affectedModules: [...modules].sort(),
    affectedTests: [...tests].sort(),
    affectedExports: exports,
    truncated,
  };
}