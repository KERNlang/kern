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

/** Semantic root cause used to group findings that describe the same underlying issue. */
export interface RootCause {
  /** Stable grouping key. Prefer graph/concept IDs over raw line numbers. */
  key: string;
  /** Coarse class of the underlying issue source. */
  kind: 'api-call' | 'route' | 'data-flow' | 'symbol' | 'file' | 'unknown';
  /** Optional structured facets for dashboards and future explainers. */
  facets?: Record<string, string>;
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
  /** Semantic grouping key for cross-rule/root-cause ownership. */
  rootCause?: RootCause;
  /**
   * Per-stage calibration record. Populated by applyRuleQualityCalibration when a
   * factor actually changes severity or confidence. Lets audit policy show why a
   * finding was demoted/dropped without recomputing the chain.
   */
  calibrationTrail?: CalibrationStage[];
  /**
   * Set true after applyRuleQualityCalibration runs over this finding so that
   * subsequent calls (e.g. graph-mode rerun after cross-file injection) skip it.
   * Prevents compounding multipliers when Phase 1 role/overlap factors land.
   */
  calibrated?: boolean;
  /**
   * If this finding was suppressed by a `// kern-ignore [reason: …]` directive,
   * the closed-enum reason is propagated here so telemetry can compute per-rule
   * FP/intent rates without scanning source again. Closed-enum: any free text
   * is rejected at parse time.
   */
  suppressionReason?: import('./suppression/types.js').SuppressionReason;
}

/** One step of calibration applied to a finding. */
export interface CalibrationStage {
  /** Identifier for the stage that ran (e.g. 'rule-quality:demote-advisory'). */
  stage: string;
  /** Multiplicative factor applied to confidence (1.0 = no change). */
  factor: number;
  /** Why this stage acted on this finding. */
  reason: string;
  /** Confidence before this stage (undefined if confidence was unset). */
  beforeConfidence?: number;
  /** Confidence after this stage. */
  afterConfidence?: number;
  /** Severity before this stage, if changed. */
  beforeSeverity?: ReviewFinding['severity'];
  /** Severity after this stage, if changed. */
  afterSeverity?: ReviewFinding['severity'];
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

// ── Review Health ────────────────────────────────────────────────────────

/**
 * Which analysis subsystem an entry concerns. Kept stable — reporters and downstream
 * consumers pattern-match on these strings.
 */
export type ReviewHealthSubsystem =
  | 'eslint'
  | 'tsc'
  | 'call-graph'
  | 'fs-project'
  | 'rule-loader'
  | 'concept-extraction';

/**
 * What happened to a subsystem during the review.
 *   skipped — subsystem was not available and was cleanly skipped (e.g. optional peer dep missing)
 *   fallback — subsystem partially ran but had to degrade (e.g. fs project fell back to in-memory)
 *   error — subsystem failed outright; its findings are missing from this report
 */
export type ReviewHealthKind = 'skipped' | 'fallback' | 'error';

/** A single note about a subsystem that didn't run at full fidelity. */
export interface ReviewHealthEntry {
  subsystem: ReviewHealthSubsystem;
  kind: ReviewHealthKind;
  /** Human-readable note — rendered in the report header */
  message: string;
  /** Error detail; only populated when KERN_DEBUG is set or the caller opts in */
  detail?: string;
}

/**
 * Aggregate subsystem status for a review. Present only when something degraded analysis —
 * a clean run leaves this undefined so consumers that check for its presence can treat
 * "no health field" as "all subsystems ran clean." Does NOT affect CI exit codes: `status`
 * is observability, not gatekeeping.
 */
export interface ReviewHealth {
  /**
   *   ok — all subsystems ran clean (this case is normally represented by omitting the field entirely)
   *   degraded — one or more subsystems fell back or were skipped; findings are still trustworthy within scope
   *   partial — one or more subsystems failed outright; findings may be incomplete
   */
  status: 'ok' | 'degraded' | 'partial';
  entries: ReviewHealthEntry[];
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
  /** Findings removed by inline/config suppression, preserved for SARIF and audit output */
  suppressedFindings?: ReviewFinding[];
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
  /** True when the reviewed file is codegen output (path matches /generated/ | /__generated__/ or has @generated header). */
  generated?: boolean;
  /**
   * Subsystem status — present only when something degraded analysis. Does NOT count
   * toward findings-based CI gates; reporters surface it as a banner. See ReviewHealth.
   */
  health?: ReviewHealth;
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

/** Named review posture. Guard is low-noise default, CI is strict, audit is broad. */
export type ReviewPolicy = 'guard' | 'ci' | 'audit';

export interface ReviewTelemetryConfig {
  /** When true, persist a machine-readable telemetry snapshot for this review run. */
  enabled?: boolean;
  /** Output file. Defaults to .kern/cache/review-telemetry.jsonl when telemetry is enabled. */
  outputPath?: string;
  /** Append JSONL snapshots instead of replacing the file. Defaults to true. */
  append?: boolean;
  /** Include per-finding rows in addition to aggregate counts. Defaults to false. */
  includeFindings?: boolean;
}

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
  /** Maximum handler-body line count before handler-size fires (default: 30) */
  maxHandlerLines?: number;
  /** Maximum errors allowed in CI (default: 0) */
  maxErrors?: number;
  /** Maximum warnings allowed in CI (default: undefined - no limit) */
  maxWarnings?: number;
  /** Output format (text, json, sarif) */
  format?: 'text' | 'json' | 'sarif';
  /** Build target — activates framework-specific rules */
  target?: string;
  /**
   * Cross-stack review precision mode.
   *   guard — default, high precision / low noise for KERN Guard and CI.
   *   audit — broader exploratory findings for local investigations.
   */
  crossStackMode?: 'guard' | 'audit';
  /** Explicit review policy. Used by CLI/defaulting/telemetry to distinguish CI, guard, and audit runs. */
  policy?: ReviewPolicy;
  /** Optional persistent telemetry for rule/noise calibration. */
  telemetry?: ReviewTelemetryConfig;
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
  /** Pre-computed file graph map from import graph (populated by reviewGraph) */
  graphFileMap?: Map<string, GraphFile>;
  /** Path to host project's tsconfig.json — loaded into the ts-morph Project so jsx/paths/lib/allowJs match the real build. */
  tsConfigFilePath?: string;
  /** When true, emit the `missing-confidence` finding for .kern files without confidence annotations. Default: false (opt-in) — teams that don't use confidence annotations see no noise. */
  requireConfidenceAnnotations?: boolean;
  /** Override what dead-export treats as intentional public API. */
  publicApi?: {
    /** Absolute or projectRoot-relative paths whose exports are all public. */
    files?: string[];
    /** Per-symbol overrides in `path#name` form. */
    symbols?: string[];
    /** Root for resolving relative `files`/`symbols`. Defaults to process.cwd(). */
    projectRoot?: string;
  };
  /**
   * Pre-extracted concept maps from files outside the current entry set.
   * Merged into `allConcepts` so cross-file / cross-stack rules
   * (contract-drift, untyped-api-response, tainted-across-wire, ...) can
   * correlate against them, but never produce their own ReviewReport in
   * the output since they aren't in `reports` to begin with.
   *
   * Intended for consumers like kern-guard that review a PR against a
   * partner repo whose IR is cached elsewhere: serialize the partner's
   * concepts once on push, feed them here per PR review, and cross-stack
   * rules fire with both sides present without the partner files
   * contributing single-file findings.
   *
   * Paths are caller-namespaced — kern-guard uses
   * `"<installationId>::<relPath>"` so two partner repos that share file
   * names (`src/routes.ts`) never collide. Rules that consult
   * `ctx.allConcepts` treat the keys opaquely.
   */
  externalConcepts?: ReadonlyMap<string, unknown>;
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

export type GraphEdgeKind =
  | 'side-effect-import'
  | 'default-import'
  | 'named-import'
  | 'namespace-import'
  | 'named-reexport'
  | 'export-all'
  /**
   * `export * as ns from './m'` — distinct from bare `export *` because the
   * namespace alias gives us a concrete local name (`ns`) that Producer 1
   * can attach a symbol-scoped blocker to when the target fails to resolve.
   * Bare `export *` stays under `'export-all'` and produces no blocker
   * (no symbol to pin).
   */
  | 'namespace-reexport'
  /**
   * Literal `import('./mod')` — emitted by the graph walker when the argument
   * is a StringLiteral or NoSubstitutionTemplateLiteral. Distinct from the
   * static-import variants so a strongest-path traversal can prefer a static
   * (full-confidence) edge over a dynamic (capped) edge to the same target.
   * Non-literal `import(expr)` does NOT produce an edge — it produces a
   * `ReachabilityBlocker` instead (see step 9b).
   */
  | 'dynamic-import';

export interface GraphEdge {
  from: string;
  to: string;
  specifier: string;
  kind: GraphEdgeKind;
  /** Exported symbol name, when known. */
  importedName?: string;
  /** Local bound name in the importing file, when applicable. */
  localName?: string;
  /** How the module resolution succeeded. */
  via: 'ts-morph' | 'extension-fallback';
}

/** A file node in the import graph */
export interface GraphFile {
  /**
   * Display path — caller-facing (whatever the user passed in for entry
   * files; whatever ts-morph reports for BFS-reached files). Use this
   * for `report.filePath`, finding `primarySpan.file`, and any UI
   * surface. NEVER use this as a Map key for cross-file resolution —
   * symlinks (pnpm, macOS /var → /private/var) cause the same physical
   * file to have multiple display paths and would silently produce
   * twin entries (red-team #9).
   */
  path: string;
  /**
   * Internal identity key — `realpathSync(path)` with a graceful fallback
   * for paths that don't exist on disk. ALL Map keys, ts-morph
   * `addSourceFileAtPath` calls, and cross-file binding lookups MUST use
   * this form so two display paths pointing at the same physical file
   * collapse to a single entry. The two forms are equal for normal
   * projects without symlinks, so this is a no-op there. See
   * `path-canonical.ts` for the canonicaliser invariant.
   */
  canonicalPath: string;
  distance: number;
  imports: string[];
  importedBy: string[];
  importEdges: GraphEdge[];
  incomingEdges: GraphEdge[];
}

/** Result of resolving the import graph */
export interface GraphResult {
  files: GraphFile[];
  entryFiles: string[];
  totalFiles: number;
  skipped: number;
  /** ts-morph Project used to resolve the graph. Exposed so downstream
   *  analyses (call graph, cross-file taint) can reuse it without re-parsing. */
  project?: import('ts-morph').Project;
  /**
   * Symbol-scoped reachability blockers discovered during graph resolution.
   * Currently fed by Producer 1 (named re-export with unresolved relative
   * target). Consumed by deadExportRule to cap finding confidence at 0.4
   * with severity=info instead of emitting at full strength. Empty when
   * every re-export resolved cleanly. NEVER file-scope — see jsdoc on
   * ReachabilityBlocker.
   */
  blockers?: ReachabilityBlocker[];
  /**
   * Telemetry-only counter: number of `import(expr)` call sites where the
   * specifier is non-literal. Cannot derive a target file or export name
   * from these, so they NEVER produce a blocker (would re-introduce the
   * red-team CRITICAL #1 file-scope silencer). Reported via review-health
   * so consumers know dead-export findings on files containing such
   * dynamic dispatch may include FPs that the cap mechanism cannot reach.
   */
  unmappedDynamicImports?: number;
  /**
   * Telemetry-only counter: number of static import declarations that
   * threw when ts-morph tried to read them (malformed AST, transient FS
   * error, etc.). Surfaced via review-health so a silent catch never
   * hides a category of failures from operators. Set KERN_DEBUG to also
   * log the underlying error per occurrence.
   */
  malformedImports?: number;
}

/**
 * A reachability blocker — recorded when the call-graph cannot resolve an
 * edge to a single concrete target (filePath, exportName) and so cannot
 * prove a candidate dead export is unreachable.
 *
 * Blockers are SYMBOL-SCOPED. A non-literal dynamic import inside one
 * function must NEVER suppress findings on unrelated exports in the same
 * file — that was the killing red-team finding against Plan v3 ("one
 * dynamic import silenced 50 unrelated symbols"). Each blocker carries the
 * exact `(filePath, exportName)` it applies to. When the resolver cannot
 * derive an exportName (e.g. fully non-literal `import(expr)`), it must
 * NOT fall back to file scope; emit health/telemetry instead.
 *
 * Blockers do NOT hard-suppress. They cap finding confidence at 0.4 (see
 * step 9b) and append a `CalibrationStage` to the finding's audit trail.
 * Telemetry still sees the finding so `fpRateEstimate` stays honest.
 */
export type ReachabilityBlockerReason =
  /** `import(expr)` where `expr` is not a string literal — target unknown. */
  | 'non-literal-dynamic-import'
  /** A re-export (`export * from`, `export { x } from`) whose target file
   *  resolved but the symbol couldn't be tied to a concrete declaration. */
  | 'unresolved-re-export'
  /** A public-API seed (package.json `exports`, framework convention) that
   *  pointed at a symbol the call graph never observed declaring. */
  | 'unmapped-public-surface';

export interface ReachabilityBlocker {
  reason: ReachabilityBlockerReason;
  /** The candidate export this blocker applies to. SYMBOL scope, not file. */
  filePath: string;
  exportName: string;
  /** Where the blocker decision was made — for the audit trail. */
  site: { file: string; line: number };
}

/** Options for resolveImportGraph */
export interface GraphOptions {
  maxDepth?: number;
  tsConfigFilePath?: string;
  project?: import('ts-morph').Project;
  /** Optional graph already resolved by the caller, used to avoid duplicate resolution in CLI/watch flows. */
  precomputedGraph?: GraphResult;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a stable fingerprint for dedup across sources and runs.
 *  Returns the raw composite key — collision-free by construction. */
export function createFingerprint(ruleId: string, startLine: number, startCol: number): string {
  return `${ruleId}:${startLine}:${startCol}`;
}
