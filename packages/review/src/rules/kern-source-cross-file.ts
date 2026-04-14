import type { IRNode } from '@kernlang/core';
import type { ReviewFinding, ReviewReport, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';

const DUPLICATE_SYMBOL_NODE_TYPES = new Set([
  'screen',
  'hook',
  'provider',
  'fn',
  'derive',
  'context',
  'type',
  'interface',
  'union',
  'service',
  'machine',
  'singleton',
  'signal',
  'middleware',
  'route',
  'server',
  'cli',
  'command',
]);

function props(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function loc(node: IRNode): { line: number; col: number } {
  return {
    line: node.loc?.line || 1,
    col: node.loc?.col || 1,
  };
}

function topLevelNamedNodes(nodes: IRNode[]): Array<{ node: IRNode; name: string; type: string }> {
  const childSet = new Set<IRNode>();
  for (const node of nodes) {
    for (const child of node.children || []) {
      childSet.add(child);
    }
  }

  const result: Array<{ node: IRNode; name: string; type: string }> = [];
  for (const node of nodes) {
    if (childSet.has(node)) continue;
    if (!DUPLICATE_SYMBOL_NODE_TYPES.has(node.type)) continue;
    const name = props(node).name;
    if (typeof name !== 'string' || name.trim() === '') continue;
    result.push({ node, name: name.trim(), type: node.type });
  }
  return result;
}

export function lintKernSourceCrossFile(reports: ReviewReport[]): ReviewFinding[] {
  const groups = new Map<string, Array<{ filePath: string; node: IRNode; name: string; type: string }>>();

  for (const report of reports) {
    if (!report.filePath.endsWith('.kern')) continue;
    for (const entry of topLevelNamedNodes(report.inferred.map((r) => r.node))) {
      const key = `${entry.type}:${entry.name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ ...entry, filePath: report.filePath });
    }
  }

  const findings: ReviewFinding[] = [];
  for (const entries of groups.values()) {
    if (entries.length < 2) continue;

    for (const entry of entries) {
      const { line, col } = loc(entry.node);
      const relatedSpans: SourceSpan[] = entries
        .filter((other) => other !== entry)
        .map((other) => {
          const otherLoc = loc(other.node);
          return {
            file: other.filePath,
            startLine: otherLoc.line,
            startCol: otherLoc.col,
            endLine: otherLoc.line,
            endCol: otherLoc.col,
          };
        });

      findings.push({
        source: 'kern',
        ruleId: 'kern-duplicate-symbol',
        severity: 'error',
        category: 'structure',
        message: `Top-level ${entry.type} '${entry.name}' is defined in multiple .kern files`,
        primarySpan: {
          file: entry.filePath,
          startLine: line,
          startCol: col,
          endLine: line,
          endCol: col,
        },
        relatedSpans,
        suggestion: `Rename '${entry.name}' or consolidate the ${entry.type} into a single source of truth.`,
        fingerprint: createFingerprint(`kern-duplicate-symbol:${entry.type}:${entry.name}`, line, col),
      });
    }
  }

  return findings;
}
