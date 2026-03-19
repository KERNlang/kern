/**
 * Confidence Graph — Layer 5 propagation engine
 *
 * Builds a directed graph of confidence dependencies between KERN IR nodes,
 * then propagates confidence values using Kahn's topological sort.
 *
 * Supports single-file and multi-file graphs. Cross-file resolution allows
 * `confidence=from:authMethod` to resolve across .kern files.
 *
 * Strategies:
 *   - literal: confidence=0.7 — direct value
 *   - from:X  — inherits from one source (min strategy)
 *   - min:X,Y — inherits from multiple sources (weakest link)
 */

import type { IRNode } from '@kernlang/core';

// ── Types ────────────────────────────────────────────────────────────────

export interface ConfidenceSpec {
  kind: 'literal' | 'inherited';
  value?: number;           // for literal: 0.0–1.0
  strategy: 'min';          // only min for v1 (product/max deferred)
  sources?: string[];       // node names for inherited
}

export interface ConfidenceNode {
  name: string;             // node name, or fallback `type:line` for anonymous
  nodeRef: { type: string; line: number };  // lightweight ref (not full IRNode)
  sourceFile?: string;      // file path for multi-file graphs
  spec: ConfidenceSpec;
  resolved: number | null;  // null = unresolved. No sentinel values.
  dependsOn: string[];
  dependedBy: string[];
  needs: NeedsEntry[];
  inCycle: boolean;         // true if part of a cycle
}

export interface NeedsEntry {
  what: string;
  wouldRaiseTo: number | undefined;  // undefined if not specified
  resolved: boolean;
}

export interface ConfidenceGraph {
  nodes: Map<string, ConfidenceNode>;
  topoOrder: string[];
  cycles: string[][];
}

export interface DuplicateNameEntry {
  name: string;
  files: string[];
}

export interface MultiFileConfidenceGraph extends ConfidenceGraph {
  duplicates: DuplicateNameEntry[];
}

/** Serializable form of the graph (no IRNode references) */
export interface SerializedConfidenceGraph {
  nodes: Array<{
    name: string;
    nodeRef: { type: string; line: number };
    sourceFile?: string;
    spec: ConfidenceSpec;
    resolved: number | null;
    dependsOn: string[];
    needs: NeedsEntry[];
    inCycle: boolean;
  }>;
  topoOrder: string[];
  cycles: string[][];
  duplicates?: DuplicateNameEntry[];
}

export interface ConfidenceSummary {
  high: number;    // > 0.9
  medium: number;  // 0.7–0.9
  low: number;     // < 0.7
  unresolved: number;
  unresolvedNeeds: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function props(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function children(node: IRNode, type?: string): IRNode[] {
  const c = node.children || [];
  return type ? c.filter(n => n.type === type) : c;
}

function nodeKey(node: IRNode): string {
  const name = props(node).name as string | undefined;
  if (name) return name;
  const line = node.loc?.line ?? 0;
  return `${node.type}:${line}`;
}

// ── Parse ────────────────────────────────────────────────────────────────

/** Parse a raw confidence prop value into a spec. Returns undefined for malformed. */
export function parseConfidence(raw: unknown): ConfidenceSpec | undefined {
  if (raw === undefined || raw === null) return undefined;
  const str = String(raw).trim();
  if (str === '') return undefined;

  // literal number: "0.7"
  const num = parseFloat(str);
  if (!isNaN(num) && /^[0-9]*\.?[0-9]+$/.test(str)) {
    if (num < 0 || num > 1) return undefined;
    return { kind: 'literal', value: num, strategy: 'min' };
  }

  // from:nodeName — inherits from one source
  if (str.startsWith('from:')) {
    const source = str.slice(5).trim();
    if (!source) return undefined;
    return { kind: 'inherited', strategy: 'min', sources: [source] };
  }

  // min:a,b,c — inherits from multiple
  if (str.startsWith('min:')) {
    const sources = str.slice(4).split(',').map(s => s.trim()).filter(Boolean);
    if (sources.length === 0) return undefined;
    return { kind: 'inherited', strategy: 'min', sources };
  }

  // Anything else (e.g. "high", "auto") is malformed
  return undefined;
}

// ── Internal helpers (shared by single-file + multi-file) ────────────────

/** Pass 1: Register nodes with confidence props into the graph map. */
function registerNodes(
  irNodes: IRNode[],
  nodes: Map<string, ConfidenceNode>,
  sourceFile?: string,
): DuplicateNameEntry[] {
  const duplicates: DuplicateNameEntry[] = [];

  for (const node of irNodes) {
    const conf = props(node).confidence;
    if (conf === undefined) continue;

    const spec = parseConfidence(conf);
    if (!spec) continue;

    const key = nodeKey(node);

    // Check for duplicate names across files
    if (nodes.has(key) && sourceFile) {
      const existing = nodes.get(key)!;
      if (existing.sourceFile && existing.sourceFile !== sourceFile) {
        duplicates.push({ name: key, files: [existing.sourceFile, sourceFile] });
      }
      // Last-writer-wins (deterministic by file sort order)
    }

    const needsChildren = children(node, 'needs');
    const needsEntries: NeedsEntry[] = needsChildren.map(n => {
      const np = props(n);
      const wouldRaise = np['would-raise-to'] as string | undefined;
      const parsed = wouldRaise !== undefined ? parseFloat(wouldRaise) : undefined;
      const resolved = np.resolved === 'true' || np.resolved === true;
      return {
        what: np.what as string || np.description as string || '',
        wouldRaiseTo: (parsed !== undefined && !isNaN(parsed) && parsed >= 0 && parsed <= 1) ? parsed : undefined,
        resolved,
      };
    });

    nodes.set(key, {
      name: key,
      nodeRef: { type: node.type, line: node.loc?.line ?? 0 },
      ...(sourceFile ? { sourceFile } : {}),
      spec,
      resolved: null,
      dependsOn: spec.sources ? [...spec.sources] : [],
      dependedBy: [],
      needs: needsEntries,
      inCycle: false,
    });
  }

  return duplicates;
}

/** Pass 2: Wire reverse edges (dependedBy). */
function wireEdges(nodes: Map<string, ConfidenceNode>): void {
  // Reset dependedBy (important for multi-file where registerNodes runs multiple times)
  for (const cnode of nodes.values()) {
    cnode.dependedBy = [];
  }
  for (const [key, cnode] of nodes) {
    for (const dep of cnode.dependsOn) {
      const target = nodes.get(dep);
      if (target) {
        target.dependedBy.push(key);
      }
    }
  }
}

/** Pass 3: Kahn's algorithm for topological sort + cycle detection. */
function kahnSort(nodes: Map<string, ConfidenceNode>): { topoOrder: string[]; cycles: string[][] } {
  const inDegree = new Map<string, number>();
  for (const [key, cnode] of nodes) {
    const validDeps = cnode.dependsOn.filter(d => nodes.has(d));
    inDegree.set(key, validDeps.length);
  }

  const queue: string[] = [];
  for (const [key, deg] of inDegree) {
    if (deg === 0) queue.push(key);
  }

  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    topoOrder.push(current);
    const cnode = nodes.get(current)!;
    for (const dependent of cnode.dependedBy) {
      const deg = inDegree.get(dependent)!;
      inDegree.set(dependent, deg - 1);
      if (deg - 1 === 0) queue.push(dependent);
    }
  }

  // Detect cycles: any node not in topoOrder is in a cycle
  const cycles: string[][] = [];
  const inTopo = new Set(topoOrder);
  const cycleNodes = [...nodes.keys()].filter(k => !inTopo.has(k));
  if (cycleNodes.length > 0) {
    for (const cn of cycleNodes) {
      nodes.get(cn)!.inCycle = true;
    }
    cycles.push(cycleNodes);
  }

  return { topoOrder, cycles };
}

// ── Build Graph (single-file) ────────────────────────────────────────────

/** Build confidence graph from flat list of IR nodes. O(n). */
export function buildConfidenceGraph(irNodes: IRNode[]): ConfidenceGraph {
  const nodes = new Map<string, ConfidenceNode>();
  registerNodes(irNodes, nodes);
  wireEdges(nodes);
  const { topoOrder, cycles } = kahnSort(nodes);
  propagateConfidence({ nodes, topoOrder, cycles });
  return { nodes, topoOrder, cycles };
}

// ── Build Graph (multi-file) ─────────────────────────────────────────────

/** Build confidence graph from multiple .kern files. Resolves cross-file from: references. */
export function buildMultiFileConfidenceGraph(fileMap: Map<string, IRNode[]>): MultiFileConfidenceGraph {
  const nodes = new Map<string, ConfidenceNode>();
  const allDuplicates: DuplicateNameEntry[] = [];

  // Sort files for deterministic last-writer-wins
  const sortedFiles = [...fileMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  for (const [filePath, irNodes] of sortedFiles) {
    const dups = registerNodes(irNodes, nodes, filePath);
    allDuplicates.push(...dups);
  }

  wireEdges(nodes);
  const { topoOrder, cycles } = kahnSort(nodes);
  propagateConfidence({ nodes, topoOrder, cycles });

  return { nodes, topoOrder, cycles, duplicates: allDuplicates };
}

// ── Propagation ──────────────────────────────────────────────────────────

/** Resolve base confidence for a literal node, applying resolved needs. */
export function resolveBaseConfidence(node: ConfidenceNode): number {
  const declared = node.spec.value ?? 0;

  // Apply resolved needs: max(declared, max(...resolvedNeeds.map(n => n.wouldRaiseTo)))
  let best = declared;
  for (const need of node.needs) {
    if (need.resolved && need.wouldRaiseTo !== undefined) {
      best = Math.max(best, need.wouldRaiseTo);
    }
  }
  return best;
}

/** Propagate confidence values through the graph in topological order. */
export function propagateConfidence(graph: ConfidenceGraph): void {
  for (const key of graph.topoOrder) {
    const cnode = graph.nodes.get(key)!;

    if (cnode.spec.kind === 'literal') {
      cnode.resolved = resolveBaseConfidence(cnode);
    } else {
      // Inherited: resolve from sources using min strategy
      const sources = cnode.spec.sources || [];
      const values: number[] = [];
      for (const src of sources) {
        const srcNode = graph.nodes.get(src);
        if (srcNode && srcNode.resolved !== null) {
          values.push(srcNode.resolved);
        }
      }
      cnode.resolved = values.length > 0 ? Math.min(...values) : null;
    }
  }
}

// ── Serialization ────────────────────────────────────────────────────────

/** Serialize a confidence graph (strips Map, uses arrays). */
export function serializeGraph(graph: ConfidenceGraph): SerializedConfidenceGraph {
  const isMulti = 'duplicates' in graph;
  const nodes = [...graph.nodes.values()].map(n => ({
    name: n.name,
    nodeRef: n.nodeRef,
    ...(n.sourceFile ? { sourceFile: n.sourceFile } : {}),
    spec: n.spec,
    resolved: n.resolved,
    dependsOn: n.dependsOn,
    needs: n.needs,
    inCycle: n.inCycle,
  }));
  return {
    nodes,
    topoOrder: graph.topoOrder,
    cycles: graph.cycles,
    ...(isMulti ? { duplicates: (graph as MultiFileConfidenceGraph).duplicates } : {}),
  };
}

/** Compute confidence summary bands. */
export function computeConfidenceSummary(graph: ConfidenceGraph): ConfidenceSummary {
  let high = 0, medium = 0, low = 0, unresolved = 0, unresolvedNeeds = 0;

  for (const cnode of graph.nodes.values()) {
    if (cnode.resolved === null) {
      unresolved++;
    } else if (cnode.resolved > 0.9) {
      high++;
    } else if (cnode.resolved >= 0.7) {
      medium++;
    } else {
      low++;
    }

    for (const need of cnode.needs) {
      if (!need.resolved) unresolvedNeeds++;
    }
  }

  return { high, medium, low, unresolved, unresolvedNeeds };
}
