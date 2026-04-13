/**
 * Shared types, confidence map, and helper factories for MCP security rules.
 */

import type { ReviewFinding, SourceSpan } from '@kernlang/review';
import { createFingerprint } from '@kernlang/review';

// ── Confidence defaults per rule ──────────────────────────────────────

export const RULE_CONFIDENCE: Record<string, number> = {
  'mcp-command-injection': 0.95, // Direct code execution
  'mcp-path-traversal': 0.9, // Direct vulnerability
  'mcp-secrets-exposure': 0.9, // Direct pattern match
  'mcp-tool-poisoning': 0.85, // Pattern-based
  'mcp-typosquatting': 0.85, // Levenshtein heuristic
  'mcp-unsanitized-response': 0.8, // Structural
  'mcp-missing-validation': 0.8, // Structural
  'mcp-missing-auth': 0.8, // Structural
  'mcp-data-injection': 0.7, // Data-level heuristic
};

// ── Helpers ──────────────────────────────────────────────────────────

export function span(file: string, line: number, col = 1): SourceSpan {
  return { file, startLine: line, startCol: col, endLine: line, endCol: col };
}

export function finding(
  ruleId: string,
  severity: 'error' | 'warning' | 'info',
  message: string,
  file: string,
  line: number,
  suggestion?: string,
  confidence?: number,
): ReviewFinding {
  return {
    source: 'kern',
    ruleId,
    severity,
    category: 'bug',
    message,
    primarySpan: span(file, line),
    fingerprint: createFingerprint(ruleId, line, 1),
    ...(suggestion ? { suggestion } : {}),
    confidence: confidence ?? RULE_CONFIDENCE[ruleId] ?? 0.8,
  };
}
