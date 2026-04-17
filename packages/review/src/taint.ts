/**
 * Taint Tracking — barrel re-export module.
 *
 * Re-exports everything from the 5 taint sub-modules so existing
 * imports from './taint.js' continue to work unchanged.
 */

import type { SourceFile } from 'ts-morph';
import { analyzeTaintAST } from './taint-ast.js';
import { analyzeTaintRegex } from './taint-regex.js';
import type { TaintResult } from './taint-types.js';
import type { InferResult } from './types.js';

// ── Types & Classification ──────────────────────────────────────────────

export type {
  CrossFileTaintResult,
  ExportedFunction,
  InternalSinkFunction,
  SinkCategory,
  SinkPattern,
  TaintPath,
  TaintResult,
  TaintSink,
  TaintSource,
} from './taint-types.js';
export {
  HTTP_PARAM_NAMES,
  HTTP_PARAM_TYPES,
  isSanitizerSufficient,
  SANITIZER_PATTERN_NAMES,
  SANITIZER_PATTERNS,
  SINK_NAMES,
  SINK_PATTERNS,
  USER_INPUT_ACCESS,
} from './taint-types.js';

// ── AST Engine ──────────────────────────────────────────────────────────

export { analyzeTaintAST, buildInternalSinkMap } from './taint-ast.js';

// ── Regex Engine ────────────────────────────────────────────────────────

export {
  analyzeTaintRegex,
  buildPaths,
  classifyParams,
  detectSanitizers,
  extractAllAssignments,
  extractDependencies,
  findClosingParen,
  findTaintedSinks,
  isCircularAssignment,
  parseLineAssignments,
  propagateTaint,
  propagateTaintMultiHop,
} from './taint-regex.js';

// ── Finding Generation ──────────────────────────────────────────────────

export { crossFileTaintToFindings, taintToFindings } from './taint-findings.js';

// ── Cross-File Analysis ─────────────────────────────────────────────────

export {
  analyzeTaintCrossFile,
  buildExportMap,
  buildExportMapFromGraph,
  buildImportAliasMap,
  buildImportMap,
  buildImportMapFromGraph,
} from './taint-crossfile.js';

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
