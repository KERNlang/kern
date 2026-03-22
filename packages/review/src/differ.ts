/**
 * Differ — compares original TS with recompiled TS from inferred KERN nodes.
 *
 * v2: Returns unified ReviewFinding[] instead of DiffFinding[].
 */

import type { IRNode } from '@kernlang/core';
import { generateCoreNode, isCoreNode } from '@kernlang/core';
import type { InferResult, ReviewFinding, SourceSpan } from './types.js';
import { createFingerprint } from './types.js';

function span(file: string, line: number, col = 1): SourceSpan {
  return { file, startLine: line, startCol: col, endLine: line, endCol: col };
}

/**
 * Perform a structural diff between original source and what KERN would generate.
 * Returns unified ReviewFinding[] tagged with source='kern'.
 */
export function structuralDiff(
  originalSource: string,
  inferred: InferResult[],
  filePath = 'input.ts',
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const originalLines = originalSource.split('\n');
  const totalLines = originalLines.length;

  // Track which lines are covered by inferred constructs
  const coveredLines = new Set<number>();
  for (const r of inferred) {
    for (let i = r.startLine; i <= r.endLine; i++) {
      coveredLines.add(i);
    }
  }

  // Find uncovered non-trivial lines (potential dead code or non-KERN patterns)
  let consecutiveUncovered = 0;
  let uncoveredStart = 0;

  for (let i = 1; i <= totalLines; i++) {
    const line = originalLines[i - 1];
    const trimmed = line.trim();

    const isTrivial = !trimmed ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed === '*/';

    if (!coveredLines.has(i) && !isTrivial) {
      if (consecutiveUncovered === 0) uncoveredStart = i;
      consecutiveUncovered++;
    } else {
      if (consecutiveUncovered >= 3) {
        findings.push({
          source: 'kern',
          ruleId: 'extra-code',
          severity: 'info',
          category: 'structure',
          message: `${consecutiveUncovered} uncovered lines (L${uncoveredStart}-${uncoveredStart + consecutiveUncovered - 1}) — not expressible as KERN`,
          primarySpan: span(filePath, uncoveredStart),
          fingerprint: createFingerprint('extra-code', uncoveredStart, 1),
        });
      }
      consecutiveUncovered = 0;
    }
  }

  // Flush remaining
  if (consecutiveUncovered >= 3) {
    findings.push({
      source: 'kern',
      ruleId: 'extra-code',
      severity: 'info',
      category: 'structure',
      message: `${consecutiveUncovered} uncovered lines (L${uncoveredStart}-${uncoveredStart + consecutiveUncovered - 1}) — not expressible as KERN`,
      primarySpan: span(filePath, uncoveredStart),
      fingerprint: createFingerprint('extra-code', uncoveredStart, 1),
    });
  }

  // Check for inconsistent patterns in inferred constructs
  for (const r of inferred) {
    if (r.node.type === 'interface' && r.node.children) {
      const fields = r.node.children.filter(c => c.type === 'field');
      const optionalFields = fields.filter(f => f.props?.optional === 'true');
      if (fields.length > 5 && optionalFields.length === 0) {
        findings.push({
          source: 'kern',
          ruleId: 'inconsistent-pattern',
          severity: 'info',
          category: 'pattern',
          message: `Interface ${r.node.props?.name} has ${fields.length} fields but none optional — consider which fields are truly required`,
          primarySpan: span(filePath, r.startLine),
          fingerprint: createFingerprint('inconsistent-pattern', r.startLine, 1),
          nodeIds: [r.nodeId],
        });
      }
    }

    if (r.node.type === 'fn') {
      if (!r.node.props?.returns) {
        findings.push({
          source: 'kern',
          ruleId: 'missing-type',
          severity: 'warning',
          category: 'type',
          message: `Function ${r.node.props?.name} has no explicit return type`,
          primarySpan: span(filePath, r.startLine),
          fingerprint: createFingerprint('missing-type', r.startLine, 1),
          nodeIds: [r.nodeId],
        });
      }
    }
  }

  // Roundtrip comparison: recompile inferred nodes and compare
  for (const r of inferred) {
    if (!isCoreNode(r.node.type)) continue;

    try {
      const recompiled = generateCoreNode(r.node);
      if (recompiled.length === 0) continue;

      const originalLineCount = r.endLine - r.startLine + 1;
      const recompiledLineCount = recompiled.length;
      const delta = Math.abs(originalLineCount - recompiledLineCount);

      if (delta > originalLineCount * 0.5 && originalLineCount > 5) {
        findings.push({
          source: 'kern',
          ruleId: 'style-difference',
          severity: 'info',
          category: 'style',
          message: `${r.node.props?.name}: roundtrip diff — original ${originalLineCount} lines vs recompiled ${recompiledLineCount} lines`,
          primarySpan: span(filePath, r.startLine),
          fingerprint: createFingerprint('style-difference', r.startLine, 1),
          nodeIds: [r.nodeId],
        });
      }
    } catch (_err) {
      // Recompilation failed — inference was incomplete, skip this construct
      // (e.g., partial machine nodes, unresolvable template references)
      void _err; // intentional: roundtrip diff is best-effort
    }
  }

  return findings;
}
