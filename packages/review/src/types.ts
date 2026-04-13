/**
 * Types for @kernlang/review — TS → .kern inference, review pipeline, unified findings.
 *
 * v2: Unified ReviewFinding replaces QualityFinding + DiffFinding.
 *     InferResult gains stable nodeId + promptAlias + sourceSpans.
 */

import type { IRNode } from '@kernlang/core';
import type { CrossFileTaintResult } from './taint.js';

// ── File Role ─────────────────────────────────────────────────────────────

/** Classified role of a source file — drives which rules are eligible to run */
export type FileRole = 'runtime' | 'codegen' | 'rule-definition' | 'example' | 'test' | 'barrel';

// ── Analysis Context ──────────────────────────────────────────────────────

/** Shared context built once per file, consumed by all review phases */
export interface AnalysisContext {
  source: string;
  filePath: string;
  project: import('ts-morph').Project;
  sourceFile: import('ts-morph').SourceFile;
  inferred: InferResult[];
  fileRole: FileRole;
}

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

/** Structured autofix action */
export interface FixAction {
  type: 'replace' | 'insert-before' | 'insert-after' | 'wrap' | 'remove';
  span: SourceSpan;
  replacement: string;
  description: string;
}

/** Single hop in an evidence chain — where a finding came from */
export interface ProvenanceStep {
  /** What this step represents — source, sanitizer, boundary, sink, etc. */
  kind: 'source' | 'sanitizer' | 'boundary' | 'sink' | 'import' | 'call';
  /** File + location of this step */
  location: SourceSpan;
  /** Short human-readable label (e.g., "req.body", "fetch(url)", "use client") */
  label: string;
  /** Optional longer explanation rendered in the "why this fired" tooltip */
  detail?: string;
}

/** Evidence chain: ordered steps from root cause to the reported sink */
export interface ProvenanceChain {
  /** Ordered steps from source → sink */
  steps: ProvenanceStep[];
  /** Optional one-line summary shown before expanding the chain */
  summary?: string;
}

/** Unified finding from any review layer */
export interface ReviewFinding {
  /** Which layer produced this finding */
  source: 'kern' | 'kern-native' | 'eslint' | 'tsc' | 'llm';
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
  /** Structured autofix */
  autofix?: FixAction;
  /** Stable fingerprint for dedup across sources */
  fingerprint: string;
  /** Graph provenance: 'changed' = entry file, 'upstream' = dependency */
  origin?: 'changed' | 'upstream';
  /** Distance from nearest entry file (0 = entry, 1 = direct import, etc.) */
  distance?: number;
  /** Evidence chain explaining WHY the finding fired (taint path, boundary walk, etc.) */
  provenance?: ProvenanceChain;
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
  /** Cross-file taint results (present when graph-aware review detects cross-module taint) */
  crossFileTaint?: CrossFileTaintResult[];
  /** Confidence graph (present when confidence layer is active) */
  confidenceGraph?: import('./confidence.js').SerializedConfidenceGraph;
  /** Confidence summary bands */
  confidenceSummary?: import('./confidence.js').ConfidenceSummary;
  /** Proof obligations for AI verification (present in graph mode) */
  obligations?: import('./obligations.js').ProofObligation[];
  /** Semantic changes between old and new versions (present in --diff mode) */
  semanticChanges?: import('./semantic-diff.js').SemanticChange[];
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
  /** Rule IDs to disable project-wide (findings generated but excluded from report) */
  disabledRules?: string[];
  /** Custom rule directories for .kern files */
  rulesDirs?: string[];
  /** Strict mode for CI: false = respect all suppressions, 'inline' = ignore inline comments, 'all' = ignore all suppressions */
  strict?: false | 'inline' | 'all';
  /** When true, parse errors keep 'error' severity instead of being downgraded to 'warning'. Use with --enforce for strict CI. */
  strictParse?: boolean;
  /** When true, skip layered ReviewReport cache. */
  noCache?: boolean;
  /** Pre-computed file context map from import graph (populated by reviewGraph) */
  fileContextMap?: Map<string, FileContext>;
}

// ── File Context (import chain awareness) ───────────────────────────────

/** Runtime boundary determined by position in the import tree */
export type RuntimeBoundary = 'server' | 'client' | 'api' | 'middleware' | 'shared' | 'unknown';

/**
 * Context derived from the import graph — where this file sits in the project.
 * Populated when reviewing with --graph or --recursive on a directory.
 */
export interface FileContext {
  /** Which runtime boundary this file belongs to (based on import chain, not just file content) */
  boundary: RuntimeBoundary;
  /** Entry points that eventually import this file */
  entryPoints: string[];
  /** Import chain from nearest entry point to this file */
  importChain: string[];
  /** Distance from nearest entry point (0 = is an entry point) */
  depth: number;
  /** All files that import this file */
  importedBy: string[];
  /** Whether this file is within a 'use client' boundary (Next.js) */
  isClientBoundary: boolean;
  /** Whether this file has its own 'use client' directive */
  hasUseClientDirective: boolean;
}

// ── Rule Context ─────────────────────────────────────────────────────────

/** Context passed to each review rule */
export interface RuleContext {
  sourceFile: import('ts-morph').SourceFile;
  /** ts-morph Project — enables TypeChecker access for type-aware rules */
  project?: import('ts-morph').Project;
  inferred: InferResult[];
  templateMatches: TemplateMatch[];
  config?: ReviewConfig;
  filePath: string;
  fileRole: FileRole;
  /** Import chain context — present when reviewing with graph awareness */
  fileContext?: FileContext;
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

/** Create a stable fingerprint for dedup across sources and runs.
 *  Returns the raw composite key — collision-free by construction. */
export function createFingerprint(ruleId: string, startLine: number, startCol: number): string {
  return `${ruleId}:${startLine}:${startCol}`;
}
