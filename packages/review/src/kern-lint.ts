/**
 * KERN-IR Lint Pipeline
 *
 * Lints the KERN IR directly (not compiled TS via ts-morph).
 * Ground-layer rules need to inspect KERN nodes before compilation.
 */

import type { IRNode } from '@kernlang/core';
import type { ReviewFinding } from './types.js';

export type KernLintRule = (nodes: IRNode[]) => ReviewFinding[];

/**
 * Run KERN-IR lint rules against a list of IR nodes.
 * Returns all findings, deduplicated.
 */
export function lintKernIR(nodes: IRNode[], rules: KernLintRule[]): ReviewFinding[] {
  return rules.flatMap(rule => rule(nodes));
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
