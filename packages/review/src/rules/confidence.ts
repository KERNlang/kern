/**
 * Confidence-layer KERN-IR lint rules.
 *
 * 7 rules that analyze the confidence graph for missing sources,
 * cycles, unresolved needs, low confidence, and impossible raises.
 */

import type { IRNode } from '@kernlang/core';
import type { ConfidenceGraph, MultiFileConfidenceGraph } from '../confidence.js';
import { buildConfidenceGraph, buildMultiFileConfidenceGraph, parseConfidence } from '../confidence.js';
import type { ReviewFinding, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function props(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function loc(node: IRNode): { line: number; col: number } {
  return { line: node.loc?.line || 0, col: node.loc?.col || 1 };
}

function finding(
  ruleId: string,
  severity: 'error' | 'warning' | 'info',
  category: ReviewFinding['category'],
  message: string,
  line: number,
  col: number,
  file = '',
  extra?: Partial<ReviewFinding>,
): ReviewFinding {
  return {
    source: 'kern',
    ruleId,
    severity,
    category,
    message,
    primarySpan: { file, startLine: line, startCol: col, endLine: line, endCol: col },
    fingerprint: createFingerprint(ruleId, line, col),
    ...extra,
  };
}

// ── Rules ────────────────────────────────────────────────────────────────

/** confidence=from:X but node X doesn't exist */
function confidenceMissingSource(graph: ConfidenceGraph): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const cnode of graph.nodes.values()) {
    if (cnode.spec.kind !== 'inherited') continue;
    for (const src of cnode.spec.sources || []) {
      if (!graph.nodes.has(src)) {
        findings.push(
          finding(
            'confidence-missing-source',
            'error',
            'pattern',
            `Confidence source '${src}' not found (referenced by '${cnode.name}')`,
            cnode.nodeRef.line,
            1,
            cnode.sourceFile,
          ),
        );
      }
    }
  }
  return findings;
}

/** Circular confidence dependency */
function confidenceCycle(graph: ConfidenceGraph): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const cycle of graph.cycles) {
    const first = graph.nodes.get(cycle[0]);
    findings.push(
      finding(
        'confidence-cycle',
        'error',
        'pattern',
        `Circular confidence dependency: ${cycle.join(' → ')}`,
        first?.nodeRef.line ?? 0,
        1,
        first?.sourceFile ?? '',
      ),
    );
  }
  return findings;
}

/** Node has unresolved needs children */
function confidenceNeedsUnresolved(graph: ConfidenceGraph): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const cnode of graph.nodes.values()) {
    const unresolvedNeeds = cnode.needs.filter((n) => !n.resolved);
    if (unresolvedNeeds.length > 0) {
      const descs = unresolvedNeeds.map((n) => n.what).join(', ');
      findings.push(
        finding(
            'confidence-needs-unresolved',
            'info',
            'pattern',
            `'${cnode.name}' has ${unresolvedNeeds.length} unresolved need(s): ${descs}`,
            cnode.nodeRef.line,
            1,
            cnode.sourceFile,
          ),
        );
      }
  }
  return findings;
}

/** Resolved confidence is low (> 0 && < 0.5) */
function confidenceLow(graph: ConfidenceGraph, threshold = 0.5): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const cnode of graph.nodes.values()) {
    // Guard: only fire when resolved > 0 && resolved < threshold
    if (cnode.resolved !== null && cnode.resolved > 0 && cnode.resolved < threshold) {
      findings.push(
        finding(
            'confidence-low',
            'warning',
            'pattern',
            `'${cnode.name}' has low confidence: ${cnode.resolved}`,
            cnode.nodeRef.line,
            1,
            cnode.sourceFile,
          ),
        );
      }
  }
  return findings;
}

/** would-raise-to less than current confidence */
function confidenceImpossible(graph: ConfidenceGraph): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const cnode of graph.nodes.values()) {
    if (cnode.spec.kind !== 'literal' || cnode.spec.value === undefined) continue;
    for (const need of cnode.needs) {
      if (need.wouldRaiseTo !== undefined && need.wouldRaiseTo < cnode.spec.value) {
        findings.push(
          finding(
            'confidence-impossible',
            'error',
            'pattern',
            `'${cnode.name}' need "${need.what}" has would-raise-to=${need.wouldRaiseTo} which is less than current confidence ${cnode.spec.value}`,
            cnode.nodeRef.line,
            1,
            cnode.sourceFile,
          ),
        );
      }
    }
  }
  return findings;
}

/** Anonymous node (no name) has confidence=from:X — can't be referenced by others */
function confidenceAnonymousRef(
  irNodes: IRNode[],
  locateFile?: (node: IRNode, line: number, col: number) => string | undefined,
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const node of irNodes) {
    const conf = props(node).confidence;
    if (conf === undefined) continue;
    const name = props(node).name as string | undefined;
    if (name) continue; // Has a name — fine
    const spec = parseConfidence(conf);
    if (spec && spec.kind === 'inherited') {
      const { line, col } = loc(node);
      findings.push(
        finding(
          'confidence-anonymous-ref',
          'warning',
          'pattern',
          `Anonymous ${node.type} node has inherited confidence but can't be referenced by others`,
          line,
          col,
          locateFile?.(node, line, col) ?? '',
        ),
      );
    }
  }
  return findings;
}

/** Duplicate name across files */
function confidenceDuplicateName(graph: MultiFileConfidenceGraph): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const dup of graph.duplicates) {
    for (const file of dup.files) {
      const relatedSpans: SourceSpan[] = dup.files
        .filter((other) => other !== file)
        .map((other) => ({
          file: other,
          startLine: 1,
          startCol: 1,
          endLine: 1,
          endCol: 1,
        }));
      findings.push(
        finding(
          'confidence-duplicate-name',
          'error',
          'pattern',
          `Confidence node '${dup.name}' defined in multiple files: ${dup.files.join(', ')}`,
          1,
          1,
          file,
          { relatedSpans },
        ),
      );
    }
  }
  return findings;
}

// ── Exported lint entry points ───────────────────────────────────────────

/** Run all confidence lint rules against a flat list of IR nodes (single file). */
export function lintConfidenceGraph(irNodes: IRNode[], filePath?: string): ReviewFinding[] {
  const hasConfidence = irNodes.some((n) => props(n).confidence !== undefined);
  if (!hasConfidence) return [];

  const graph = buildConfidenceGraph(irNodes);
  return runGraphRules(graph, irNodes, filePath ? () => filePath : undefined);
}

/** Run all confidence lint rules against multiple files (cross-file resolution). */
export function lintMultiFileConfidenceGraph(fileMap: Map<string, IRNode[]>): ReviewFinding[] {
  // Collect all nodes to check for confidence props
  const allNodes: IRNode[] = [];
  const nodeFiles = new Map<IRNode, string>();
  for (const nodes of fileMap.values()) {
    allNodes.push(...nodes);
  }
  for (const [filePath, nodes] of fileMap) {
    for (const node of nodes) {
      nodeFiles.set(node, filePath);
    }
  }
  const hasConfidence = allNodes.some((n) => props(n).confidence !== undefined);
  if (!hasConfidence) return [];

  const graph = buildMultiFileConfidenceGraph(fileMap);
  const findings = runGraphRules(graph, allNodes, (node) => nodeFiles.get(node));
  findings.push(...confidenceDuplicateName(graph));
  return findings;
}

/** Shared rule runner for both single-file and multi-file graphs. */
function runGraphRules(
  graph: ConfidenceGraph,
  allNodes: IRNode[],
  locateFile?: (node: IRNode, line: number, col: number) => string | undefined,
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  findings.push(...confidenceMissingSource(graph));
  findings.push(...confidenceCycle(graph));
  findings.push(...confidenceNeedsUnresolved(graph));
  findings.push(...confidenceLow(graph));
  findings.push(...confidenceImpossible(graph));
  findings.push(...confidenceAnonymousRef(allNodes, locateFile));
  return findings;
}

export const CONFIDENCE_RULES = {
  confidenceMissingSource,
  confidenceCycle,
  confidenceNeedsUnresolved,
  confidenceLow,
  confidenceImpossible,
  confidenceAnonymousRef,
  confidenceDuplicateName,
};
