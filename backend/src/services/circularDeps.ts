/**
 * Circular dependency detection.
 *
 * Uses Tarjan's strongly connected components algorithm over the import graph.
 * A component with more than one node, or a single node with a self-edge, is a
 * dependency cycle.
 *
 * Only IMPORT and REEXPORT edges participate. Following CALLS would flag
 * ordinary recursion, which is a legitimate pattern rather than a structural
 * problem, and would bury the cycles that actually hurt.
 */
import { GraphEdge, GraphNodeBase } from '../types';

export interface DependencyCycle {
  /** Node ids in the cycle, in traversal order. */
  nodeIds: string[];
  /** Human-readable labels for the same nodes. */
  labels: string[];
  /** Repo-relative file paths in the cycle. */
  paths: string[];
  size: number;
}

export interface CycleOptions {
  /** Ignore cycles confined to a single file (e.g. within one module). */
  crossFileOnly?: boolean;
  /** Skip cycles larger than this, which are usually build/vendor noise. */
  maxCycleSize?: number;
}

const CYCLE_EDGE_KINDS = new Set(['IMPORTS', 'REEXPORTS']);

export function findCycles(
  nodes: GraphNodeBase[],
  edges: GraphEdge[],
  options: CycleOptions = {}
): DependencyCycle[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const maxCycleSize = options.maxCycleSize ?? 50;

  // Adjacency restricted to import edges, and to files that exist in the slice.
  const adjacency = new Map<string, string[]>();
  for (const n of nodes) adjacency.set(n.id, []);

  for (const edge of edges) {
    if (!CYCLE_EDGE_KINDS.has(edge.kind)) continue;
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) continue;
    adjacency.get(edge.from)!.push(edge.to);
  }

  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  // Iterative Tarjan: a large repository overflows the stack with recursion.
  for (const root of adjacency.keys()) {
    if (index.has(root)) continue;

    // Each frame is [node, index of next neighbour to visit].
    const work: { node: string; next: number }[] = [{ node: root, next: 0 }];

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const { node } = frame;

      if (frame.next === 0) {
        index.set(node, counter);
        lowLink.set(node, counter);
        counter++;
        stack.push(node);
        onStack.add(node);
      }

      const neighbours = adjacency.get(node) ?? [];
      let descended = false;

      while (frame.next < neighbours.length) {
        const next = neighbours[frame.next++];

        if (!index.has(next)) {
          work.push({ node: next, next: 0 });
          descended = true;
          break;
        } else if (onStack.has(next)) {
          lowLink.set(node, Math.min(lowLink.get(node)!, index.get(next)!));
        }
      }

      if (descended) continue;

      // All neighbours explored: if this node roots an SCC, pop it.
      if (lowLink.get(node) === index.get(node)) {
        const component: string[] = [];
        for (;;) {
          const popped = stack.pop()!;
          onStack.delete(popped);
          component.push(popped);
          if (popped === node) break;
        }
        components.push(component);
      }

      work.pop();

      // Propagate the low-link value back to the parent.
      const parent = work[work.length - 1];
      if (parent) {
        lowLink.set(
          parent.node,
          Math.min(lowLink.get(parent.node)!, lowLink.get(node)!)
        );
      }
    }
  }

  const cycles: DependencyCycle[] = [];

  for (const component of components) {
    const isSelfLoop =
      component.length === 1 &&
      (adjacency.get(component[0]) ?? []).includes(component[0]);

    if (component.length === 1 && !isSelfLoop) continue;
    if (component.length > maxCycleSize) continue;

    const nodesInCycle = component
      .map((id) => nodeMap.get(id))
      .filter((n): n is GraphNodeBase => Boolean(n));

    if (options.crossFileOnly) {
      const paths = new Set(nodesInCycle.map((n) => n.path ?? n.id));
      if (paths.size <= 1) continue;
    }

    cycles.push({
      nodeIds: component,
      labels: nodesInCycle.map((n) => n.name),
      paths: [...new Set(nodesInCycle.map((n) => n.path ?? n.name))],
      size: component.length,
    });
  }

  // Largest cycles first: those are the ones worth fixing.
  return cycles.sort((a, b) => b.size - a.size);
}