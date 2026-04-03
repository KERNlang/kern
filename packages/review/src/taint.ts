/**
 * Taint Tracking — barrel re-export module.
 *
 * Re-exports everything from the 5 taint sub-modules so existing
 * imports from './taint.js' continue to work unchanged.
 */

import type { SourceFile } from 'ts-morph';
import type { InferResult } from './types.js';
import type { TaintResult } from './taint-types.js';
import { analyzeTaintAST } from './taint-ast.js';
import { analyzeTaintRegex } from './taint-regex.js';

// ── Types & Classification ──────────────────────────────────────────────

export type { TaintSource, TaintSink, TaintPath, TaintResult, CrossFileTaintResult, ExportedFunction } from './taint-types.js';
export type { InternalSinkFunction, SinkPattern, SinkCategory } from './taint-types.js';
export { HTTP_PARAM_NAMES, HTTP_PARAM_TYPES, USER_INPUT_ACCESS } from './taint-types.js';
export { SINK_PATTERNS, SINK_NAMES, SANITIZER_PATTERNS, SANITIZER_PATTERN_NAMES } from './taint-types.js';
export { isSanitizerSufficient } from './taint-types.js';

// ── AST Engine ──────────────────────────────────────────────────────────

export { buildInternalSinkMap, analyzeTaintAST } from './taint-ast.js';

// ── Regex Engine ────────────────────────────────────────────────────────

export { analyzeTaintRegex, classifyParams, propagateTaintMultiHop } from './taint-regex.js';
export { extractAllAssignments, parseLineAssignments, extractDependencies, isCircularAssignment } from './taint-regex.js';
export { propagateTaint, findTaintedSinks, buildPaths, detectSanitizers, findClosingParen } from './taint-regex.js';

// ── Finding Generation ──────────────────────────────────────────────────

export { taintToFindings, crossFileTaintToFindings } from './taint-findings.js';

// ── Cross-File Analysis ─────────────────────────────────────────────────

export { buildExportMap, buildImportMap, analyzeTaintCrossFile } from './taint-crossfile.js';

// ── Main Entry Point ────────────────────────────────────────────────────

/**
 * Run taint analysis on all fn nodes in inferred results.
 * When sourceFile is provided, uses AST-based analysis (more accurate).
 * Falls back to regex-based analysis when no SourceFile available.
 */
export function analyzeTaint(inferred: InferResult[], filePath: string, sourceFile?: SourceFile): TaintResult[] {
  if (sourceFile) {
    return analyzeTaintAST(inferred, filePath, sourceFile);
  }
  return analyzeTaintRegex(inferred, filePath);
}
