/**
 * Code quality and technical debt analysis.
 *
 * Findings come with a plain-English explanation rather than a bare score,
 * because a number a developer cannot act on is noise. Every finding states
 * what was observed, why it matters, and what to do about it.
 *
 * Thresholds are deliberately conservative. Flagging most of a repository as
 * a problem trains people to ignore the output, so each rule has a bar above
 * ordinary code and is meant to catch genuine outliers.
 */
import { GraphEdge, GraphNodeBase } from '../types';

export type Severity = 'low' | 'medium' | 'high';

export interface Finding {
  id: string;
  kind:
    | 'high-complexity'
    | 'long-function'
    | 'god-function'
    | 'dead-code'
    | 'duplicate'
    | 'circular-import'
    | 'high-coupling'
    | 'many-dependencies';
  severity: Severity;
  /** What was found. */
  title: string;
  /** Why it matters, in plain language. */
  explanation: string;
  /** Concrete suggestion. */
  suggestion: string;
  /** Node ids the finding concerns, for linking back to the graph. */
  nodeIds: string[];
  /** File paths the finding concerns. */
  paths: string[];
  /** Numeric detail behind the finding. */
  metric?: { label: string; value: number };
}

export interface QualityReport {
  summary: {
    files: number;
    functions: number;
    averageComplexity: number;
    maxComplexity: number;
    longestFunctionLines: number;
    findings: number;
    bySeverity: Record<Severity, number>;
    /** 0-100, higher is healthier. Directional only, not a gate. */
    healthScore: number;
  };
  findings: Finding[];
  /** Files ranked by how much they deserve attention. */
  hotspots: { path: string; score: number; reasons: string[] }[];
}

export interface QualityThresholds {
  /** Cyclomatic complexity above which a function is flagged. */
  complexity: number;
  /** Line count above which a function is flagged as long. */
  functionLines: number;
  /** Functions with more incoming edges than this are coupling hotspots. */
  fanIn: number;
  /** Files importing more than this many others. */
  fanOut: number;
  /** Bodies at least this similar are reported as duplicates. */
  duplicateSimilarity: number;
}

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  complexity: 15,
  functionLines: 80,
  fanIn: 25,
  fanOut: 30,
  duplicateSimilarity: 0.85,
};

const isFunction = (n: GraphNodeBase) =>
  n.kind === 'Function' || n.kind === 'Method';

/** Normalise a body so formatting differences do not defeat comparison. */
function normalizeBody(text: string): string {
  return text
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cheap similarity: token overlap (Jaccard) over the normalised body.
 * Not a full clone detector, but it catches copy-pasted blocks reliably
 * enough to be worth reporting as a lead.
 */
function similarity(a: string, b: string): number {
  const tokensA = new Set(a.split(' ').filter(Boolean));
  const tokensB = new Set(b.split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let shared = 0;
  for (const t of tokensA) if (tokensB.has(t)) shared++;
  return shared / (tokensA.size + tokensB.size - shared);
}

export interface QualityInput {
  nodes: GraphNodeBase[];
  edges: GraphEdge[];
  /** Function bodies keyed by node id, for duplicate detection. */
  bodies?: Map<string, string>;
  cycles?: { nodeIds: string[]; paths: string[]; size: number }[];
}

export function analyzeQuality(
  input: QualityInput,
  thresholds: QualityThresholds = DEFAULT_THRESHOLDS
): QualityReport {
  const { nodes, edges } = input;
  const findings: Finding[] = [];

  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  const push = (map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge) => {
    const list = map.get(key);
    if (list) list.push(edge);
    else map.set(key, [edge]);
  };
  for (const edge of edges) {
    push(outgoing, edge.from, edge);
    push(incoming, edge.to, edge);
  }

  const functions = nodes.filter(isFunction);
  const files = nodes.filter((n) => n.kind === 'File');

  let maxComplexity = 0;
  let longestLines = 0;

  for (const fn of functions) {
    const complexity = fn.complexity ?? 1;
    const lines =
      fn.startLine && fn.endLine ? Math.max(1, fn.endLine - fn.startLine + 1) : 0;

    maxComplexity = Math.max(maxComplexity, complexity);
    longestLines = Math.max(longestLines, lines);

    if (complexity > thresholds.complexity) {
      findings.push({
        id: `complexity:${fn.id}`,
        kind: 'high-complexity',
        severity: complexity > thresholds.complexity * 2 ? 'high' : 'medium',
        title: `${fn.name} has a complexity of ${complexity}`,
        explanation:
          `This function has ${complexity} decision points, above the threshold of ` +
          `${thresholds.complexity}. High complexity usually means several responsibilities ` +
          `have accumulated in one place, so changes are risky because the side effects of ` +
          `each branch are hard to reason about together.`,
        suggestion: 'Extract the branches into named functions that can be tested individually.',
        nodeIds: [fn.id],
        paths: fn.path ? [fn.path] : [],
        metric: { label: 'complexity', value: complexity },
      });
    }

    if (lines > thresholds.functionLines) {
      findings.push({
        id: `length:${fn.id}`,
        kind: 'long-function',
        severity: lines > thresholds.functionLines * 2 ? 'high' : 'low',
        title: `${fn.name} is ${lines} lines long`,
        explanation:
          `This function spans ${lines} lines. Long functions are hard to review in a diff and ` +
          `tend to accumulate unrelated changes, so a reviewer cannot tell which lines belong ` +
          `to which behaviour.`,
        suggestion: 'Split into smaller units, each doing one thing.',
        nodeIds: [fn.id],
        paths: fn.path ? [fn.path] : [],
        metric: { label: 'lines', value: lines },
      });
    }

    const fanIn = (incoming.get(fn.id) ?? []).filter(
      (e) => e.kind === 'CALLS' || e.kind === 'IMPORTS'
    ).length;
    if (fanIn > thresholds.fanIn) {
      findings.push({
        id: `coupling:${fn.id}`,
        kind: 'high-coupling',
        severity: 'medium',
        title: `${fn.name} is depended on by ${fanIn} places`,
        explanation:
          `Many call sites depend on this symbol, so changing it has a wide blast radius and ` +
          `is hard to modify safely.`,
        suggestion:
          'Split the responsibilities behind it, or narrow the surface callers depend on.',
        nodeIds: [fn.id],
        paths: fn.path ? [fn.path] : [],
        metric: { label: 'callers', value: fanIn },
      });
    }
  }

  // ---- dead code candidates ---------------------------------------------
  // Only for non-exported, non-test symbols with no callers. An exported
  // symbol may be used elsewhere at runtime in a way static analysis cannot
  // see, so calling that dead would be wrong.
  const referenced = new Set<string>();
  for (const edge of edges) {
    if (edge.kind === 'CALLS' || edge.kind === 'IMPORTS' || edge.kind === 'REEXPORTS') {
      referenced.add(edge.to);
    }
  }

  for (const fn of functions) {
    if (fn.isExported || fn.isTest) continue;
    if (referenced.has(fn.id)) continue;

    findings.push({
      id: `dead:${fn.id}`,
      kind: 'dead-code',
      severity: 'low',
      title: `${fn.name} has no callers`,
      explanation:
        `Nothing in the analysed code calls this function and it is not exported, so it ` +
        `appears unreachable. This is a candidate for removal, not a certainty: it may be ` +
        `called dynamically or reached through a framework static analysis cannot follow.`,
      suggestion: 'Confirm it is unused, then delete it.',
      nodeIds: [fn.id],
      paths: fn.path ? [fn.path] : [],
    });
  }

  // ---- files importing many others ------------------------------------
  for (const file of files) {
    const imports = (outgoing.get(file.id) ?? []).filter(
      (e) => e.kind === 'IMPORTS' || e.kind === 'REEXPORTS'
    ).length;
    if (imports <= thresholds.fanOut) continue;

    findings.push({
      id: `fanout:${file.id}`,
      kind: 'many-dependencies',
      severity: 'medium',
      title: `${file.path} imports ${imports} modules`,
      explanation:
        `This file pulls in ${imports} other modules, so it is probably doing too much. It ` +
        `also makes the file sensitive to changes anywhere in that dependency set.`,
      suggestion: 'Split it so each part depends only on what it uses.',
      nodeIds: [file.id],
      paths: file.path ? [file.path] : [],
      metric: { label: 'imports', value: imports },
    });
  }

  // ---- duplicate function bodies ---------------------------------------
  if (input.bodies && input.bodies.size > 1) {
    const entries = [...input.bodies.entries()]
      .map(([id, body]) => ({ id, norm: normalizeBody(body) }))
      // Very short bodies match trivially and produce noise.
      .filter((e) => e.norm.length > 120);

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const score = similarity(entries[i].norm, entries[j].norm);
        if (score < thresholds.duplicateSimilarity) continue;

        const a = nodes.find((n) => n.id === entries[i].id);
        const b = nodes.find((n) => n.id === entries[j].id);
        // Same-file pairs are usually intentional overloads.
        if (!a || !b || a.path === b.path) continue;

        findings.push({
          id: `duplicate:${a.id}:${b.id}`,
          kind: 'duplicate',
          severity: 'low',
          title: `${a.name} and ${b.name} look like duplicates`,
          explanation:
            `These two functions are about ${Math.round(score * 100)}% similar by token ` +
            `overlap. Duplicated logic has to be fixed in every copy, and the copies drift ` +
            `apart over time.`,
          suggestion: 'Extract the shared behaviour into one function both can call.',
          nodeIds: [a.id, b.id],
          paths: [a.path, b.path].filter(Boolean) as string[],
          metric: { label: 'similarity', value: Math.round(score * 100) },
        });
      }
    }
  }

  // ---- import cycles ---------------------------------------------------
  for (const cycle of input.cycles ?? []) {
    findings.push({
      id: `cycle:${cycle.nodeIds.join('|')}`,
      kind: 'circular-import',
      severity: cycle.size > 3 ? 'high' : 'medium',
      title: `${cycle.size} files import each other in a cycle`,
      explanation:
        `These files depend on each other (${cycle.paths.join(' -> ')}). A cycle makes ` +
        `initialisation order load-bearing, which causes subtle bugs that appear only under ` +
        `particular import orders, and it blocks isolated testing.`,
      suggestion: 'Move the shared piece into a module both can depend on.',
      nodeIds: cycle.nodeIds,
      paths: cycle.paths,
      metric: { label: 'files in cycle', value: cycle.size },
    });
  }

  return buildReport(nodes, functions, findings, maxComplexity, longestLines);
}

/**
 * Slice function bodies out of source files.
 *
 * Duplicate detection needs the text of each function, which the graph does
 * not carry. Bodies are keyed by node id, and symbols whose lines fall outside
 * the file are skipped rather than producing nonsense.
 */
export function extractBodies(
  nodes: GraphNodeBase[],
  files: Map<string, string>
): Map<string, string> {
  const bodies = new Map<string, string>();
  const byPath = new Map<string, GraphNodeBase[]>();

  for (const node of nodes) {
    if (!isFunction(node) || !node.path || !node.startLine || !node.endLine) continue;
    const list = byPath.get(node.path) ?? [];
    list.push(node);
    byPath.set(node.path, list);
  }

  for (const [filePath, symbols] of byPath) {
    const source = files.get(filePath);
    if (!source) continue;
    const lines = source.split(/\r?\n/);

    for (const symbol of symbols) {
      const start = Math.max(0, symbol.startLine! - 1);
      const end = Math.min(lines.length, symbol.endLine!);
      // A symbol extending past the file means the line data is unreliable.
      if (end <= start) continue;
      bodies.set(symbol.id, lines.slice(start, end).join('\n'));
    }
  }

  return bodies;
}

/**
 * Assemble the summary, hotspot ranking and health score.
 *
 * The score is a rough directional indicator, not a gate: a weighted penalty
 * per finding, capped and normalised by repository size, so a handful of
 * issues in a large codebase does not read as a failing project.
 */
function buildReport(
  nodes: GraphNodeBase[],
  functions: GraphNodeBase[],
  findings: Finding[],
  maxComplexity: number,
  longestLines: number
): QualityReport {
  const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) bySeverity[f.severity]++;

  const averageComplexity = functions.length
    ? functions.reduce((sum, f) => sum + (f.complexity ?? 1), 0) / functions.length
    : 0;

  // ---- hotspots ---------------------------------------------------------
  const perFile = new Map<string, { score: number; reasons: Set<string> }>();
  const touch = (path: string | undefined, weight: number, reason: string) => {
    if (!path) return;
    const entry = perFile.get(path) ?? { score: 0, reasons: new Set<string>() };
    entry.score += weight;
    entry.reasons.add(reason);
    perFile.set(path, entry);
  };

  for (const f of findings) {
    const weight = f.severity === 'high' ? 3 : f.severity === 'medium' ? 2 : 1;
    for (const p of f.paths) touch(p, weight, f.kind);
  }

  const hotspots = [...perFile.entries()]
    .map(([path, entry]) => ({
      path,
      score: entry.score,
      reasons: [...entry.reasons],
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  // ---- health score -----------------------------------------------------
  const files = nodes.filter((n) => n.kind === 'File').length;
  const density = files > 0 ? findings.length / files : 0;
  const penalty = Math.min(60, density * 25) + bySeverity.high * 3;

  return {
    summary: {
      files,
      functions: functions.length,
      averageComplexity: Math.round(averageComplexity * 10) / 10,
      maxComplexity,
      longestFunctionLines: longestLines,
      findings: findings.length,
      bySeverity,
      healthScore: Math.max(0, Math.round(100 - penalty)),
    },
    // Worst first, so the list can be read top-down.
    findings: findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    hotspots,
  };
}

function severityRank(s: Severity): number {
  return s === 'high' ? 0 : s === 'medium' ? 1 : 2;
}