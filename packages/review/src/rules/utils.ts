/**
 * Shared helpers for review rules — eliminates duplication of span() and finding()
 * across base.ts, react.ts, nextjs.ts, express.ts, security.ts, vue.ts, dead-logic.ts.
 */

import type { Node } from 'ts-morph';
import type { ReviewFinding, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';

export function span(file: string, line: number, col = 1, endLine?: number, endCol?: number): SourceSpan {
  return { file, startLine: line, startCol: col, endLine: endLine ?? line, endCol: endCol ?? col };
}

/**
 * Compute a precise SourceSpan for a ts-morph Node, using 1-based line/column.
 * Used by autofix rules that need character-accurate replacement coordinates.
 */
export function nodeSpan(node: Node, file: string): SourceSpan {
  const sf = node.getSourceFile();
  const start = sf.getLineAndColumnAtPos(node.getStart());
  const end = sf.getLineAndColumnAtPos(node.getEnd());
  return {
    file,
    startLine: start.line,
    startCol: start.column,
    endLine: end.line,
    endCol: end.column,
  };
}

/**
 * Compute a SourceSpan for the insertion point immediately before a node.
 * For use with FixAction.type === 'insert-before'.
 */
export function insertBeforeSpan(node: Node, file: string): SourceSpan {
  const sf = node.getSourceFile();
  const start = sf.getLineAndColumnAtPos(node.getStart());
  return {
    file,
    startLine: start.line,
    startCol: start.column,
    endLine: start.line,
    endCol: start.column,
  };
}

/**
 * Compute a SourceSpan for the insertion point immediately after a node.
 * For use with FixAction.type === 'insert-after'.
 */
export function insertAfterSpan(node: Node, file: string): SourceSpan {
  const sf = node.getSourceFile();
  const end = sf.getLineAndColumnAtPos(node.getEnd());
  return {
    file,
    startLine: end.line,
    startCol: end.column,
    endLine: end.line,
    endCol: end.column,
  };
}

export function finding(
  ruleId: string,
  severity: 'error' | 'warning' | 'info',
  category: ReviewFinding['category'],
  message: string,
  file: string,
  line: number,
  col = 1,
  extra?: Partial<ReviewFinding>,
): ReviewFinding {
  return {
    source: 'kern',
    ruleId,
    severity,
    category,
    message,
    primarySpan: span(file, line, col),
    fingerprint: createFingerprint(ruleId, line, col),
    ...extra,
  };
}
