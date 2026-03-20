/**
 * Shared helpers for review rules — eliminates duplication of span() and finding()
 * across base.ts, react.ts, nextjs.ts, express.ts, security.ts, vue.ts, dead-logic.ts.
 */

import type { ReviewFinding, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';

export function span(file: string, line: number, col = 1, endLine?: number, endCol?: number): SourceSpan {
  return { file, startLine: line, startCol: col, endLine: endLine ?? line, endCol: endCol ?? col };
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
