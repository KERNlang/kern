/**
 * KERN-IR Lint Pipeline
 *
 * Lints the KERN IR directly (not compiled TS via ts-morph).
 * Ground-layer rules need to inspect KERN nodes before compilation.
 * Supports both TypeScript rule functions and native .kern rule files.
 */

import type { IRNode } from '@kernlang/core';
import type { ConceptMap } from '@kernlang/core';
import type { ReviewFinding } from './types.js';

export type KernLintRule = ((nodes: IRNode[], concepts?: ConceptMap) => ReviewFinding[]) & { ruleId?: string };

// Re-export for consumers
export { loadNativeRules, loadBuiltinNativeRules } from './rule-loader.js';
export { buildRuleIndex, evaluateRule, conceptNodeToIR } from './rule-eval.js';

/**
 * Run KERN-IR lint rules against a list of IR nodes.
 * When concepts are provided, native rules with `subject=concept` can match concept nodes.
 */
export function lintKernIR(nodes: IRNode[], rules: KernLintRule[], concepts?: ConceptMap): ReviewFinding[] {
  return rules.flatMap(rule => {
    try {
      return rule(nodes, concepts);
    } catch (err) {
      return [{
        source: 'kern' as const,
        ruleId: 'internal-rule-error',
        severity: 'info' as const,
        category: 'structure' as const,
        message: `Rule threw: ${(err as Error).message}`,
        primarySpan: { file: 'unknown', startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
        fingerprint: `rule-error-${(err as Error).message.slice(0, 20)}`,
      }];
    }
  });
}

/**
 * Recursively collect all nodes from an IR tree.
 */
export function flattenIR(root: IRNode): IRNode[] {
  const result: IRNode[] = [root];
  for (const child of root.children || []) {
    result.push(...flattenIR(child));
  }
  return result;
}
