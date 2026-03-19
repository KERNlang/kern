/**
 * Ground-layer KERN-IR lint rules.
 *
 * These operate on IRNode[], not ts-morph SourceFile.
 * 4 are codegen errors (compilation fails via KernCodegenError).
 * 7 are lint warnings/info (reported but compilation succeeds).
 */

import type { IRNode } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import type { KernLintRule } from '../kern-lint.js';
import { flattenIR } from '../kern-lint.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function props(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function children(node: IRNode, type?: string): IRNode[] {
  const c = node.children || [];
  return type ? c.filter(n => n.type === type) : c;
}

function loc(node: IRNode): { line: number; col: number } {
  return { line: node.loc?.line || 0, col: node.loc?.col || 1 };
}

function finding(
  ruleId: string,
  severity: 'error' | 'warning' | 'info',
  category: ReviewFinding['category'],
  message: string,
  node: IRNode,
  extra?: Partial<ReviewFinding>,
): ReviewFinding {
  const { line, col } = loc(node);
  return {
    source: 'kern',
    ruleId,
    severity,
    category,
    message,
    primarySpan: { file: '', startLine: line, startCol: col, endLine: line, endCol: col },
    fingerprint: createFingerprint(ruleId, line, col),
    ...extra,
  };
}

// ── Rules ────────────────────────────────────────────────────────────────

/** guard without else action (lint warning) */
export const guardWithoutElse: KernLintRule = (nodes: IRNode[]) => {
  const findings: ReviewFinding[] = [];
  for (const node of nodes) {
    if (node.type === 'guard' && !props(node).else) {
      findings.push(finding(
        'guard-without-else', 'warning', 'pattern',
        `Guard '${props(node).name || 'unnamed'}' has no else action — failures will throw generic Error`,
        node,
      ));
    }
  }
  return findings;
};

/** action missing idempotent annotation (lint info) */
export const actionMissingIdempotent: KernLintRule = (nodes: IRNode[]) => {
  const findings: ReviewFinding[] = [];
  for (const node of nodes) {
    if (node.type === 'action') {
      const p = props(node);
      if (p.idempotent !== 'true' && p.idempotent !== true) {
        findings.push(finding(
          'action-missing-idempotent', 'info', 'pattern',
          `Action '${p.name}' should declare idempotent=true/false for safety reasoning`,
          node,
        ));
      }
    }
  }
  return findings;
};

/** branch missing known variants (lint warning) */
export const branchNonExhaustive: KernLintRule = (nodes: IRNode[]) => {
  const findings: ReviewFinding[] = [];
  for (const node of nodes) {
    if (node.type === 'branch') {
      const paths = children(node, 'path');
      if (paths.length === 0) {
        findings.push(finding(
          'branch-non-exhaustive', 'warning', 'pattern',
          `Branch '${props(node).name || 'unnamed'}' has no paths defined`,
          node,
        ));
      }
    }
  }
  return findings;
};

/** collect without limit (lint info) */
export const collectUnbounded: KernLintRule = (nodes: IRNode[]) => {
  const findings: ReviewFinding[] = [];
  for (const node of nodes) {
    if (node.type === 'collect' && !props(node).limit) {
      findings.push(finding(
        'collect-unbounded', 'info', 'pattern',
        `Collect '${props(node).name || 'unnamed'}' has no limit — could return unbounded results`,
        node,
      ));
    }
  }
  return findings;
};

/** reason without basis field (lint info) */
export const reasonWithoutBasis: KernLintRule = (nodes: IRNode[]) => {
  const findings: ReviewFinding[] = [];
  for (const node of nodes) {
    if (node.type === 'reason' && !props(node).basis) {
      findings.push(finding(
        'reason-without-basis', 'info', 'pattern',
        `Reason annotation missing basis field — adds low trust level`,
        node,
      ));
    }
  }
  return findings;
};

/** assume with basis but no evidence (lint info — low trust) */
export const assumeLowTrust: KernLintRule = (nodes: IRNode[]) => {
  const findings: ReviewFinding[] = [];
  for (const node of nodes) {
    if (node.type === 'assume') {
      const p = props(node);
      // Check if any reason child has basis but the assume has no evidence
      const reasonChild = children(node, 'reason')[0];
      if (reasonChild && props(reasonChild).basis && !p.evidence) {
        findings.push(finding(
          'assume-low-trust', 'info', 'pattern',
          `Assume has basis but no evidence — low trust level`,
          node,
        ));
      }
    }
  }
  return findings;
};

/** expect range inverted (lint warning — min > max) */
export const expectRangeInverted: KernLintRule = (nodes: IRNode[]) => {
  const findings: ReviewFinding[] = [];
  for (const node of nodes) {
    if (node.type === 'expect') {
      const p = props(node);
      const within = p.within as string | undefined;
      if (within && within.includes('..')) {
        const [lo, hi] = within.split('..').map(Number);
        if (!isNaN(lo) && !isNaN(hi) && lo > hi) {
          findings.push(finding(
            'expect-range-inverted', 'warning', 'bug',
            `Expect '${p.name || 'unnamed'}' has inverted range: ${lo} > ${hi}`,
            node,
          ));
        }
      }
    }
  }
  return findings;
};

// ── All ground-layer lint rules ──────────────────────────────────────────

export const GROUND_LAYER_RULES: KernLintRule[] = [
  guardWithoutElse,
  actionMissingIdempotent,
  branchNonExhaustive,
  collectUnbounded,
  reasonWithoutBasis,
  assumeLowTrust,
  expectRangeInverted,
];
