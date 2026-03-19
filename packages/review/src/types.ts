/**
 * Types for @kernlang/review — TS → .kern inference, review pipeline, unified findings.
 *
 * v2: Unified ReviewFinding replaces QualityFinding + DiffFinding.
 *     InferResult gains stable nodeId + promptAlias + sourceSpans.
 */

import type { IRNode } from '@kernlang/core';

// ── Source Spans ──────────────────────────────────────────────────────────

/** Exact location in a source file */
export interface SourceSpan {
  file: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

// ── Unified Finding ──────────────────────────────────────────────────────

/** Unified finding from any review layer */
export interface ReviewFinding {
  /** Which layer produced this finding */
  source: 'kern' | 'eslint' | 'tsc' | 'llm';
  /** Rule identifier (e.g., 'memory-leak', 'floating-promise') */
  ruleId: string;
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
  /** Finding category */
  category: 'bug' | 'type' | 'pattern' | 'style' | 'structure';
  /** Human-readable message */
  message: string;
  /** Primary source location */
  primarySpan: SourceSpan;
  /** Related locations (e.g., definition + usage) */
  relatedSpans?: SourceSpan[];
  /** Associated KERN nodeIds */
  nodeIds?: string[];
  /** Fix suggestion */
  suggestion?: string;
  /** Confidence (0-1, for LLM findings) */
  confidence?: number;
  /** Stable fingerprint for dedup across sources */
  fingerprint: string;
  /** Graph provenance: 'changed' = entry file, 'upstream' = dependency */
  origin?: 'changed' | 'upstream';
  /** Distance from nearest entry file (0 = entry, 1 = direct import, etc.) */
  distance?: number;
}

// ── Confidence ───────────────────────────────────────────────────────────

/** Confidence level for an inference match */
export type Confidence = 'high' | 'medium' | 'low';

// ── Inference Result ─────────────────────────────────────────────────────

/** Result of inferring a single TS construct as a KERN node */
export interface InferResult {
  /** The inferred KERN IR node */
  node: IRNode;
  /** Stable internal ID: file#type:name@offset */
  nodeId: string;
  /** Short alias for LLM prompts: "N1", "N2", etc. (assigned after sort) */
  promptAlias: string;
  /** Source location in the original TS file */
  startLine: number;
  endLine: number;
  /** Exact TS source spans for this construct */
  sourceSpans: SourceSpan[];
  /** What was detected (human-readable summary) */
  summary: string;
  /** Confidence of the inference */
  confidence: Confidence;
  /** Confidence percentage (0-100) */
  confidencePct: number;
  /** KERN token count for this construct */
  kernTokens: number;
  /** Original TS token count for this construct */
  tsTokens: number;
}

// ── Template Match ───────────────────────────────────────────────────────

/** A template pattern match */
export interface TemplateMatch {
  /** Template name (e.g., 'zustand-store', 'swr-hook') */
  templateName: string;
  /** Library name (e.g., 'zustand', 'swr') */
  libraryName: string;
  /** Import that anchored the detection */
  anchorImport: string;
  /** Confidence percentage */
  confidencePct: number;
  /** Source location */
  startLine: number;
  endLine: number;
  /** Suggested .kern rewrite (when template is registered) */
  suggestedKern?: string;
  /** Extracted slot values from code analysis */
  slotValues?: Record<string, string>;
  /** Estimated KERN tokens for the suggested rewrite */
  kernTokens?: number;
  /** Original TS tokens covered by this match */
  tsTokens?: number;
}

// ── Review Report ────────────────────────────────────────────────────────

/** Full review report for a single file */
export interface ReviewReport {
  /** File path that was reviewed */
  filePath: string;
  /** Inferred KERN constructs */
  inferred: InferResult[];
  /** Template pattern matches */
  templateMatches: TemplateMatch[];
  /** All findings from every review layer (unified) */
  findings: ReviewFinding[];
  /** Summary stats */
  stats: ReviewStats;
  /** Confidence graph (present when confidence layer is active) */
  confidenceGraph?: import('./confidence.js').SerializedConfidenceGraph;
  /** Confidence summary bands */
  confidenceSummary?: import('./confidence.js').ConfidenceSummary;
}

/** Summary statistics for a review */
export interface ReviewStats {
  /** Total lines in the original file */
  totalLines: number;
  /** Lines covered by KERN inferences */
  coveredLines: number;
  /** Coverage percentage */
  coveragePct: number;
  /** Total TS tokens */
  totalTsTokens: number;
  /** Total KERN tokens (if re-expressed as .kern) */
  totalKernTokens: number;
  /** Token reduction percentage */
  reductionPct: number;
  /** Number of KERN-expressible constructs */
  constructCount: number;
}

// ── Enforcement ──────────────────────────────────────────────────────────

/** Enforcement result for CI */
export interface EnforceResult {
  /** Whether enforcement passed */
  passed: boolean;
  /** Minimum coverage threshold */
  minCoverage: number;
  /** Actual coverage */
  actualCoverage: number;
  /** Template violations (detected pattern but no KERN template used) */
  templateViolations: string[];
  /** Errors found vs max allowed */
  errors: { actual: number; max: number };
  /** Warnings found vs max allowed */
  warnings: { actual: number; max: number };
  /** Max complexity found vs max allowed */
  complexity: { actual: number; max: number };
}

/** Configuration for the review pipeline */
export interface ReviewConfig {
  /** Registered template names (from kern.config.ts templates) */
  registeredTemplates?: string[];
  /** Minimum coverage for enforcement */
  minCoverage?: number;
  /** Require detected library patterns to use KERN templates */
  enforceTemplates?: boolean;
  /** Maximum cognitive complexity allowed (default: 15) */
  maxComplexity?: number;
  /** Maximum errors allowed in CI (default: 0) */
  maxErrors?: number;
  /** Maximum warnings allowed in CI (default: undefined - no limit) */
  maxWarnings?: number;
  /** Output format (text, json, sarif) */
  format?: 'text' | 'json' | 'sarif';
  /** Build target — activates framework-specific rules */
  target?: string;
  /** Minimum confidence for findings to count in enforcement (default: 0) */
  minConfidence?: number;
  /** Show confidence scores in output */
  showConfidence?: boolean;
}

// ── Rule Context ─────────────────────────────────────────────────────────

/** Context passed to each review rule */
export interface RuleContext {
  sourceFile: import('ts-morph').SourceFile;
  inferred: InferResult[];
  templateMatches: TemplateMatch[];
  config?: ReviewConfig;
  filePath: string;
}

/** A review rule function */
export type ReviewRule = (ctx: RuleContext) => ReviewFinding[];

// ── Import Graph ─────────────────────────────────────────────────────────

/** A file node in the import graph */
export interface GraphFile {
  path: string;
  distance: number;
  imports: string[];
  importedBy: string[];
}

/** Result of resolving the import graph */
export interface GraphResult {
  files: GraphFile[];
  entryFiles: string[];
  totalFiles: number;
  skipped: number;
}

/** Options for resolveImportGraph */
export interface GraphOptions {
  maxDepth?: number;
  tsConfigFilePath?: string;
  project?: import('ts-morph').Project;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a stable fingerprint for dedup across sources and runs */
export function createFingerprint(ruleId: string, startLine: number, startCol: number): string {
  const input = `${ruleId}:${startLine}:${startCol}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
