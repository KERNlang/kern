/**
 * @kernlang/review — Scan TS, infer .kern IR, review pipeline, report.
 *
 * Public API:
 *   reviewFile(filePath, config?)     — review a single file
 *   reviewSource(source, filePath?, config?) — review source string
 *   reviewDirectory(dirPath, config?) — review all .ts/.tsx files
 *
 * v2: Unified ReviewFinding pipeline. All findings merged into single array.
 */

import { createRequire } from 'node:module';
import type { IRNode, ParseDiagnostic } from '@kernlang/core';
import { countTokens, parseWithDiagnostics, serializeIR } from '@kernlang/core';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { Project } from 'ts-morph';

// This module compiles to ESM (`type: "module"`), so the runtime has no `require`.
// `@kernlang/review-python` is an optional peer — we load it on demand with a
// createRequire shim. Without this shim the dynamic load throws
// `ReferenceError: require is not defined`, the catch swallows the error, and
// every Python file falls into the "missing-python-support" info fallback —
// silently disabling the fullstack wedge rules on any cross-stack repo.
const moduleRequire = createRequire(import.meta.url);

import { buildCallGraph } from './call-graph.js';
import { runConceptRules } from './concept-rules/index.js';
import { structuralDiff } from './differ.js';
import { runTSCDiagnostics } from './external-tools.js';
import { buildFileContextMap } from './file-context.js';
import { classifyFileRole } from './file-role.js';
import { resolveImportGraph } from './graph.js';
import { createInMemoryProject, findTsConfig, inferFromSourceFile } from './inferrer.js';
import { flattenIR, lintKernIR } from './kern-lint.js';
import { extractTsConcepts } from './mappers/ts-concepts.js';
import { mineNorms } from './norm-miner.js';
import { synthesizeObligations } from './obligations.js';
import { buildPublicApiMap, expandPublicApiThroughReExports } from './public-api.js';
import { runQualityRules } from './quality-rules.js';
import { assignDefaultConfidence, calculateStats, sortAndDedup, sortFindings } from './reporter.js';
import { debugDetail, ReviewHealthBuilder } from './review-health.js';
import { loadBuiltinNativeRules, loadNativeRules } from './rule-loader.js';
import { lintConfidenceGraph, lintMultiFileConfidenceGraph } from './rules/confidence.js';
import { crossFileAsyncRule, deadExportRule } from './rules/dead-code.js';
import { runFastapiConceptRules } from './rules/fastapi.js';
import { GROUND_LAYER_RULES } from './rules/ground-layer.js';
import { KERN_SOURCE_RULES, lintKernSourceIR, missingConfidence } from './rules/kern-source.js';
import { lintKernSourceCrossFile } from './rules/kern-source-cross-file.js';
import { detectTemplates } from './template-detector.js';
import type { GraphOptions } from './types.js';

// Load native .kern rules once at module init
// Guard: import.meta.url is undefined when bundled as CJS (e.g. esbuild for VS Code worker)
let NATIVE_RULES: import('./kern-lint.js').KernLintRule[] = [];
try {
  NATIVE_RULES = loadBuiltinNativeRules();
} catch {
  // CJS bundle — native .kern rules not available, regex rules still work
}

import { buildConfidenceGraph, computeConfidenceSummary, serializeGraph } from './confidence.js';
import { applySuppression } from './suppression/index.js';
import { analyzeTaint, analyzeTaintCrossFile, crossFileTaintToFindings, taintToFindings } from './taint.js';
import type { InferResult, ReviewConfig, ReviewFinding, ReviewReport } from './types.js';
import { createFingerprint } from './types.js';

export type { CallGraph, CallSite, FunctionNode } from './call-graph.js';
export { buildCallGraph } from './call-graph.js';
export type { ConceptRule, ConceptRuleContext } from './concept-rules/index.js';
export { runConceptRules } from './concept-rules/index.js';
export type {
  ConfidenceGraph,
  ConfidenceNode,
  ConfidenceSpec,
  ConfidenceSummary,
  DuplicateNameEntry,
  MultiFileConfidenceGraph,
  NeedsEntry,
  SerializedConfidenceGraph,
} from './confidence.js';
// Confidence layer
export {
  buildConfidenceGraph,
  buildMultiFileConfidenceGraph,
  computeConfidenceSummary,
  parseConfidence,
  propagateConfidence,
  resolveBaseConfidence,
  serializeGraph,
} from './confidence.js';
export { structuralDiff } from './differ.js';
export { linkToNodes, runESLint, runTSCDiagnostics, runTSCDiagnosticsFromPaths } from './external-tools.js';
export { buildFileContextMap, clearFileContextCache } from './file-context.js';
export { classifyFileRole } from './file-role.js';
export { resolveImportGraph } from './graph.js';
export { findTsConfig, inferFromFile, inferFromSource } from './inferrer.js';
export type { KernLintRule } from './kern-lint.js';
// KERN-IR lint pipeline (ground layer)
export { flattenIR, lintKernIR } from './kern-lint.js';
export type {
  LLMBridgeConfig,
  LLMCallResult,
  LLMReviewInput,
  LLMReviewResult,
  LLMUsage,
  ReviewInstructionOptions,
} from './llm-bridge.js';
// LLM bridge (Phase 3)
export { buildReviewInstructions, isLLMAvailable, runLLMReview } from './llm-bridge.js';
export type { LLMGraphContext } from './llm-review.js';
export { buildLLMPrompt, exportKernIR, parseLLMResponse } from './llm-review.js';
export { extractTsConcepts } from './mappers/ts-concepts.js';
export type { NormViolation } from './norm-miner.js';
// Norm mining + obligations
export { mineNorms } from './norm-miner.js';
export type { ObligationType, ProofObligation } from './obligations.js';
export { obligationsFromNorms, obligationsFromStructure, synthesizeObligations } from './obligations.js';
export type { PublicApiMap, PublicApiOverrides } from './public-api.js';
export {
  buildPublicApiMap,
  EMPTY_PUBLIC_API,
  expandPublicApiThroughReExports,
  isPublicApi,
  resolvePackageEntryFiles,
  resolveSpecifierToSrc,
} from './public-api.js';
export { runQualityRules } from './quality-rules.js';
export {
  assignDefaultConfidence,
  calculateStats,
  checkEnforcement,
  dedup,
  formatEnforcement,
  formatReport,
  formatReportJSON,
  formatSARIF,
  formatSARIFWithMetadata,
  formatSARIFWithSuppressions,
  formatSummary,
  sortAndDedup,
  sortFindings,
} from './reporter.js';
export { debugDetail, ReviewHealthBuilder } from './review-health.js';
export { CONFIDENCE_RULES, lintConfidenceGraph, lintMultiFileConfidenceGraph } from './rules/confidence.js';
export {
  actionMissingIdempotent,
  assumeLowTrust,
  branchNonExhaustive,
  collectUnbounded,
  expectRangeInverted,
  GROUND_LAYER_RULES,
  guardWithoutElse,
  reasonWithoutBasis,
} from './rules/ground-layer.js';
export type { RuleInfo } from './rules/index.js';
export { getRuleRegistry } from './rules/index.js';
export type { KernSourceRule } from './rules/kern-source.js';
export {
  handlerHeavy,
  KERN_SOURCE_RULES,
  lintKernSourceIR,
  missingConfidence,
  typeModelMismatch,
  undefinedReference,
  unusedState,
} from './rules/kern-source.js';
// ReDoS detection (reusable by rule compilers)
export { isReDoSVulnerable } from './rules/security-v3.js';
export type { SemanticChange } from './semantic-diff.js';
// Semantic diff
export {
  computeSemanticDiff,
  computeSemanticDiffFromSource,
  formatSemanticDiff,
  getOldFileContent,
  semanticChangesToFindings,
} from './semantic-diff.js';
export type { StrictMode, SuppressionDirective, SuppressionResult } from './suppression/index.js';
// Suppression
export { applySuppression, configDirectives, isConceptRule, parseDirectives } from './suppression/index.js';
export type {
  CrossFileTaintResult,
  ExportedFunction,
  TaintPath,
  TaintResult,
  TaintSink,
  TaintSource,
} from './taint.js';
// Taint tracking (Phase 2 + cross-file)
export {
  analyzeTaint,
  analyzeTaintCrossFile,
  buildExportMap,
  buildImportMap,
  crossFileTaintToFindings,
  isSanitizerSufficient,
  taintToFindings,
} from './taint.js';
export { detectTemplates } from './template-detector.js';
export type {
  AnalysisContext,
  Confidence,
  EnforceResult,
  FileContext,
  FileRole,
  GraphEdge,
  GraphEdgeKind,
  GraphFile,
  GraphOptions,
  GraphResult,
  InferResult,
  ReviewConfig,
  ReviewFinding,
  ReviewHealth,
  ReviewHealthEntry,
  ReviewHealthKind,
  ReviewHealthSubsystem,
  ReviewReport,
  ReviewRule,
  ReviewStats,
  RuleContext,
  RuntimeBoundary,
  SourceSpan,
  TemplateMatch,
} from './types.js';
export { createFingerprint } from './types.js';

// Cache (Phase 0)
import { clearReviewCache, computeCacheKey, reviewCache } from './cache.js';

export type { ImplRoute, SpecCheckResult, SpecContract, SpecViolation, ViolationKind } from './spec-checker.js';

// Spec checker — .kern contract vs .ts implementation
export {
  checkSpec,
  checkSpecFiles,
  extractImplRoutes,
  extractSpecContracts,
  matchRoutes,
  specViolationsToFindings,
  verifyRouteContract,
} from './spec-checker.js';
export { clearReviewCache };

/** Shared filesystem-backed Project for type-aware analysis (reused across reviewFile calls) */
let _fsProject: import('ts-morph').Project | undefined;
let _fsProjectTsConfig: string | undefined;
let _fsProjectTsConfigMtimeMs: number | undefined;
function getOrCreateFsProject(tsConfigFilePath?: string): import('ts-morph').Project {
  // Rebuild when either the tsconfig path OR its contents change. Watch-mode users who edit
  // compilerOptions in place would otherwise keep running with the stale Project's resolver even
  // though the cache key (which hashes tsconfig content) correctly invalidates — the two must stay
  // consistent or findings lag a process restart behind.
  let currentMtime: number | undefined;
  if (tsConfigFilePath) {
    try {
      currentMtime = statSync(tsConfigFilePath).mtimeMs;
    } catch {
      // Unreadable tsconfig — fall through; we'll still attempt construction and let ts-morph surface the error.
    }
  }
  if (_fsProject && (_fsProjectTsConfig !== tsConfigFilePath || _fsProjectTsConfigMtimeMs !== currentMtime)) {
    _fsProject = undefined;
  }
  if (!_fsProject) {
    _fsProject = new Project({
      tsConfigFilePath,
      skipAddingFilesFromTsConfig: true,
      useInMemoryFileSystem: false,
      // When a tsconfig is loaded, let it own compilerOptions (jsx/paths/lib/allowJs come from there).
      // When no tsconfig, ship permissive defaults so .tsx files don't emit phantom ts17004 errors.
      compilerOptions: tsConfigFilePath
        ? undefined
        : {
            strict: true,
            target: 99 /* Latest */,
            module: 99 /* ESNext */,
            moduleResolution: 100 /* Bundler */,
            jsx: 4 /* Preserve */,
            allowJs: true,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
            skipLibCheck: true,
            noEmit: true,
          },
    });
    _fsProjectTsConfig = tsConfigFilePath;
    _fsProjectTsConfigMtimeMs = currentMtime;
  }
  return _fsProject!;
}

/** Reset the shared project (for tests / watch mode) */
export function resetFsProject(): void {
  _fsProject = undefined;
  _fsProjectTsConfig = undefined;
  _fsProjectTsConfigMtimeMs = undefined;
  _fsProjectSourceMtimes.clear();
}

/**
 * Refresh stale source files in the shared fs Project from disk.
 *
 * The singleton caches every source file it has ever loaded — including transitive imports
 * followed by cross-file taint and call-graph analysis. In a long-running process (watch mode,
 * IDE extension, repeated CLI invocations) those cached ASTs go stale whenever the underlying
 * file changes on disk outside our own `replaceWithText` path. Cross-file findings would then
 * reflect the OLD imported source, not the current one.
 *
 * This helper is the lightweight counterpart to resetFsProject(): instead of throwing the
 * whole Project away, it stat-checks each loaded source file and calls ts-morph's
 * refreshFromFileSystemSync only on the ones whose mtime moved. Use it between reviews in
 * watch-mode callers. One-shot CLI runs don't need it — the process exits before stale
 * reads matter.
 *
 * Returns the number of source files actually refreshed, so callers can log "reloaded N
 * files" or decide not to re-review when the count is zero.
 */
export function refreshFsProjectFromDisk(): number {
  if (!_fsProject) return 0;
  let refreshed = 0;
  for (const sf of _fsProject.getSourceFiles()) {
    const path = sf.getFilePath();
    let diskMtime: number;
    try {
      diskMtime = statSync(path).mtimeMs;
    } catch {
      // File deleted on disk since it was loaded — skip. ts-morph will raise on next access.
      continue;
    }
    const lastKnown = _fsProjectSourceMtimes.get(path);
    if (lastKnown === diskMtime) continue;
    try {
      sf.refreshFromFileSystemSync();
      _fsProjectSourceMtimes.set(path, diskMtime);
      refreshed++;
    } catch {
      // Refresh can fail for unreadable/unparseable files — leave the stale copy rather than
      // hard-crashing the review. The next resetFsProject() call will clear it either way.
    }
  }
  return refreshed;
}

/** Per-file mtimes tracked for the shared fs Project — see refreshFsProjectFromDisk. */
const _fsProjectSourceMtimes = new Map<string, number>();

/** True when the file is codegen output — detected via common path patterns or a @generated header. */
export function isGeneratedFile(filePath: string, source?: string): boolean {
  // Path heuristic — covers /generated/, /__generated__/, /.generated/ anywhere in the path.
  if (/[/\\](?:generated|__generated__|\.generated)[/\\]/i.test(filePath)) return true;
  // Leading `// @generated` or `/* @generated */` header — the standard convention enforced by many codegens.
  if (source && /^\s*(?:\/\/|\/\*)\s*@generated\b/m.test(source.slice(0, 500))) return true;
  return false;
}

/** Extensions the review engine analyzes. Anything else (.md, .json, .yaml, .patch, binaries) returns an empty report at the entry point, so callers that blindly feed changed-file lists (e.g. kern-guard on a PR diff) don't surface noise findings on docs/config files. */
const REVIEWABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.kern',
  '.py',
  '.vue',
]);

export function isReviewableFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return false;
  const ext = filePath.slice(dot);
  return REVIEWABLE_EXTENSIONS.has(ext);
}

/**
 * Extract concept maps from a set of files without running any review
 * rules. Returns one entry per file that was parsed successfully;
 * unparseable or unknown-extension files are skipped silently.
 *
 * Intended for consumers (kern-guard) that want to cache a repo's IR
 * once on push and replay it into later `reviewGraph` calls via
 * `ReviewConfig.externalConcepts`. Much cheaper than running the full
 * review pipeline — no rule evaluation, no import-graph resolution, no
 * health aggregation.
 */
export function extractConceptsForGraph(filePaths: string[]): Map<string, import('@kernlang/core').ConceptMap> {
  const out = new Map<string, import('@kernlang/core').ConceptMap>();
  let extractPythonConcepts: ((src: string, fp: string) => import('@kernlang/core').ConceptMap) | null | undefined;
  for (const filePath of filePaths) {
    try {
      const source = readFileSync(filePath, 'utf-8');
      if (
        filePath.endsWith('.ts') ||
        filePath.endsWith('.tsx') ||
        filePath.endsWith('.mts') ||
        filePath.endsWith('.cts')
      ) {
        const project = createInMemoryProject();
        const sf = project.createSourceFile(filePath, source);
        out.set(filePath, extractTsConcepts(sf, filePath));
      } else if (filePath.endsWith('.py')) {
        if (extractPythonConcepts === undefined) {
          try {
            extractPythonConcepts = moduleRequire('@kernlang/review-python').extractPythonConcepts;
          } catch {
            extractPythonConcepts = null;
          }
        }
        if (extractPythonConcepts) {
          out.set(filePath, extractPythonConcepts(source, filePath));
        }
      }
    } catch {
      // Best-effort — caller sees which files made it into the map.
    }
  }
  return out;
}

function emptyReport(filePath: string): ReviewReport {
  return {
    filePath,
    inferred: [],
    templateMatches: [],
    findings: [],
    stats: {
      totalLines: 0,
      coveredLines: 0,
      coveragePct: 0,
      totalTsTokens: 0,
      totalKernTokens: 0,
      reductionPct: 0,
      constructCount: 0,
    },
  };
}

/**
 * Review a single file. Auto-detects language from extension.
 * Uses a filesystem-backed ts-morph Project for type-aware analysis.
 * Supports: .ts, .tsx, .py, .kern
 */
export function reviewFile(filePath: string, config?: ReviewConfig): ReviewReport {
  if (!isReviewableFile(filePath)) return emptyReport(filePath);
  const source = readFileSync(filePath, 'utf-8');

  // Resolve the effective tsconfig up-front so both the cache key and the ts-morph Project see the
  // same path. If we only discovered it later inside reviewSourceWithProject, adding or changing the
  // nearest tsconfig without editing the source would serve stale cached findings.
  const effectiveConfig: ReviewConfig | undefined =
    config?.tsConfigFilePath || filePath.endsWith('.kern') || filePath.endsWith('.py')
      ? config
      : { ...(config ?? {}), tsConfigFilePath: findTsConfig(dirname(filePath)) };

  let key: string | undefined;
  if (effectiveConfig?.noCache !== true) {
    key = computeCacheKey(source, effectiveConfig || {}, filePath);
    const cached = reviewCache.get(key);
    if (cached) return cached;
  }

  let report: ReviewReport;
  if (filePath.endsWith('.kern')) {
    report = reviewKernSource(source, filePath, effectiveConfig);
  } else if (filePath.endsWith('.py')) {
    report = reviewPythonSource(source, filePath, effectiveConfig);
  } else if (/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(filePath)) {
    // Use filesystem-backed project for real files (enables TypeChecker)
    report = reviewSourceWithProject(source, filePath, effectiveConfig);
  } else {
    // Non-source file (markdown, JSON, patch, yaml, etc.) — skip review entirely
    return {
      filePath,
      inferred: [],
      templateMatches: [],
      findings: [],
      stats: {
        totalLines: source.split('\n').length,
        coveredLines: 0,
        coveragePct: 0,
        totalTsTokens: 0,
        totalKernTokens: 0,
        reductionPct: 0,
        constructCount: 0,
      },
    };
  }

  if (isGeneratedFile(filePath, source)) {
    report.generated = true;
  }

  if (key) {
    reviewCache.set(key, report);
  }

  return report;
}

/**
 * Review TypeScript source with a filesystem-backed project.
 * The fs project enables .getReturnType() to resolve types from node_modules.
 */
function reviewSourceWithProject(source: string, filePath: string, config?: ReviewConfig): ReviewReport {
  try {
    // Prefer explicit override from caller; otherwise discover the nearest tsconfig from this file's directory.
    // Discovering per-file (not cwd) lets monorepo reviews pick up the per-package tsconfig with real paths/jsx,
    // instead of the root solution-style tsconfig that only lists `references`.
    const tsConfigFilePath = config?.tsConfigFilePath ?? findTsConfig(dirname(filePath));
    const fsProject = getOrCreateFsProject(tsConfigFilePath);
    // Add or update the file in the project
    let sf = fsProject.getSourceFile(filePath);
    if (sf) {
      sf.replaceWithText(source);
    } else {
      sf = fsProject.addSourceFileAtPath(filePath);
    }
    // Track the disk mtime we just synced with — refreshFsProjectFromDisk uses this to decide
    // whether the cached AST has drifted from disk on later calls. Best-effort: if stat fails
    // we simply don't record a mtime (refresh will unconditionally refresh such files later).
    try {
      _fsProjectSourceMtimes.set(filePath, statSync(filePath).mtimeMs);
    } catch {
      // File may have been deleted between read and stat; leave mtime unrecorded.
    }
    return reviewSourceInternal(source, filePath, config, fsProject, sf);
  } catch (err) {
    // Fs project failed — fall back to in-memory project, but record the degradation on the
    // report so callers can tell this file was reviewed without full type resolution.
    const report = reviewSource(source, filePath, config);
    const health = new ReviewHealthBuilder();
    for (const e of report.health?.entries ?? []) health.note(e);
    health.noteKind(
      'fs-project',
      'fallback',
      'Fell back to in-memory ts-morph project — cross-module type resolution is limited for this file',
      debugDetail(err),
    );
    if (process.env.KERN_DEBUG) console.error('fs-project failure, using in-memory fallback:', (err as Error).message);
    report.health = health.build();
    return report;
  }
}

/**
 * Review TypeScript source code (string). Uses in-memory project (no type resolution).
 * For file-from-disk review with type resolution, use reviewFile() instead.
 */
export function reviewSource(source: string, filePath = 'input.ts', config?: ReviewConfig): ReviewReport {
  if (!isReviewableFile(filePath)) return emptyReport(filePath);
  const project = createInMemoryProject();
  const sourceFile = project.createSourceFile(filePath, source);
  return reviewSourceInternal(source, filePath, config, project, sourceFile);
}

/**
 * Internal review implementation — shared between reviewSource (in-memory) and reviewFile (filesystem).
 */
function reviewSourceInternal(
  source: string,
  filePath: string,
  config: ReviewConfig | undefined,
  project: import('ts-morph').Project,
  sourceFile: import('ts-morph').SourceFile,
): ReviewReport {
  const totalLines = source.split('\n').length;
  const fileRole = classifyFileRole(sourceFile, filePath);

  // Helper: run a phase safely, collect findings even if a phase throws
  const allFindings: ReviewFinding[] = [];
  function safePhase<T>(name: string, fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (err) {
      allFindings.push({
        source: 'kern',
        ruleId: 'internal-error',
        severity: 'info',
        category: 'structure',
        message: `Review phase '${name}' failed: ${(err as Error).message}`,
        primarySpan: { file: filePath, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        fingerprint: createFingerprint('internal-error', 1, name.charCodeAt(0)),
      });
      return fallback;
    }
  }

  // Phase 1: Infer KERN constructs (reuse existing SourceFile)
  const inferred = safePhase('infer', () => inferFromSourceFile(sourceFile), []);

  // Phase 2: Taint tracking (AST-based when SourceFile is available)
  allFindings.push(
    ...safePhase('taint', () => {
      const taintResults = analyzeTaint(inferred, filePath, sourceFile);
      return taintToFindings(taintResults);
    }, []),
  );

  // Phase 3: Template detection (config-aware)
  const templateMatches = safePhase('templates', () => detectTemplates(sourceFile, config), []);

  // Phase 4: Structural diff → unified findings.
  // `extra-code` and `inconsistent-pattern` are only meaningful on runtime source; on codegen/barrel/test/example
  // files they produce noise (e.g. entire barrel flagged as extra-code). Keep other diff findings regardless.
  const diffFindings = safePhase('diff', () => structuralDiff(source, inferred, filePath), []);
  const diffNoiseRules = new Set(['extra-code', 'inconsistent-pattern']);
  allFindings.push(
    ...(fileRole === 'runtime' ? diffFindings : diffFindings.filter((f) => !diffNoiseRules.has(f.ruleId))),
  );

  // Phase 5: Quality rules → unified findings (receives fileRole)
  allFindings.push(
    ...safePhase(
      'quality',
      () => runQualityRules(sourceFile, inferred, templateMatches, config, fileRole, project),
      [],
    ),
  );

  // Phase 6: Concept extraction + concept rules (universal, cross-language)
  const emptyConcepts = { filePath, language: 'typescript', nodes: [], edges: [], extractorVersion: '0' };
  const concepts = safePhase('concepts', () => extractTsConcepts(sourceFile, filePath), emptyConcepts);
  allFindings.push(...safePhase('concept-rules', () => runConceptRules(concepts, filePath), []));

  // Phase 7: KERN-IR lint (ground layer + confidence rules on inferred nodes)
  const irNodes = inferred.map((r) => r.node);
  const groundFindings = safePhase('ground-lint', () => lintKernIR(irNodes, GROUND_LAYER_RULES), []);
  for (const f of groundFindings) {
    if (!f.primarySpan.file) f.primarySpan.file = filePath;
  }
  allFindings.push(...groundFindings);
  const confFindings = safePhase('confidence-lint', () => lintConfidenceGraph(irNodes), []);
  for (const f of confFindings) {
    if (!f.primarySpan.file) f.primarySpan.file = filePath;
  }
  allFindings.push(...confFindings);

  // Phase 7b: Native .kern rules (built-in + custom)
  const rulesToRun = [...NATIVE_RULES];
  if (config?.rulesDirs && config.rulesDirs.length > 0) {
    const builtinIds = new Set(NATIVE_RULES.map((r) => r.ruleId).filter(Boolean) as string[]);
    const customRules = loadNativeRules(config.rulesDirs, builtinIds);
    rulesToRun.push(...customRules);
  }
  if (rulesToRun.length > 0) {
    const nativeFindings = safePhase('native-rules', () => lintKernIR(irNodes, rulesToRun, concepts), []);
    for (const f of nativeFindings) {
      if (!f.primarySpan.file) f.primarySpan.file = filePath;
    }
    allFindings.push(...nativeFindings);
  }

  // Phase 8: TSC diagnostics — native TypeScript compiler errors.
  // runTSCDiagnostics returns findings for every file in the shared Project, so filter down to
  // just the file we're reviewing — otherwise findings-for-project-file leaks into unrelated reports.
  // ts-morph normalizes filePaths (absolute, posix separators) while callers may pass relative paths,
  // so compare against the sourceFile's own normalized path rather than the raw argument.
  // downgradeProjectLoadingErrors: we injected this file ad-hoc into a Project that carries the
  // host tsconfig, so TS6059/TS6307 are our noise, not the user's bug.
  const normalizedCurrentPath = sourceFile.getFilePath();
  allFindings.push(
    ...safePhase('tsc', () => runTSCDiagnostics(project, { downgradeProjectLoadingErrors: true }), []).filter(
      (f) => f.primarySpan.file === normalizedCurrentPath || f.primarySpan.file === filePath,
    ),
  );

  // Build confidence graph if any nodes have confidence props
  let confidenceGraph: ReviewReport['confidenceGraph'];
  let confidenceSummary: ReviewReport['confidenceSummary'];
  const hasConfidence = irNodes.some((n) => n.props?.confidence !== undefined);
  if (hasConfidence) {
    const graph = buildConfidenceGraph(irNodes);
    confidenceGraph = serializeGraph(graph);
    confidenceSummary = computeConfidenceSummary(graph);
  }

  // Merge, dedup, sort — single shared utility
  const dedupedFindings = sortAndDedup(allFindings);

  // Assign calibrated confidence scores to all findings
  assignDefaultConfidence(dedupedFindings);

  // Apply suppression (inline comments + config disabledRules)
  const suppression = applySuppression(dedupedFindings, source, filePath, config, config?.strict ?? false);
  const findings = sortAndDedup(suppression.findings);

  // Calculate stats
  const stats = calculateStats(inferred, templateMatches, findings, totalLines);

  return {
    filePath,
    inferred,
    templateMatches,
    findings,
    ...(suppression.suppressed.length > 0 ? { suppressedFindings: sortAndDedup(suppression.suppressed) } : {}),
    stats,
    ...(confidenceGraph ? { confidenceGraph } : {}),
    ...(confidenceSummary ? { confidenceSummary } : {}),
  };
}

/**
 * Review .kern source code (native KERN IR).
 * Parses directly to IR — skips TS inference, templates, diff, AST quality rules.
 * Runs: ground-layer rules, confidence rules, LLM review.
 */
export function reviewKernSource(source: string, filePath = 'input.kern', _config?: ReviewConfig): ReviewReport {
  const totalLines = source.split('\n').length;
  const allFindings: ReviewFinding[] = [];

  function safePhase<T>(name: string, fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (err) {
      allFindings.push({
        source: 'kern',
        ruleId: 'internal-error',
        severity: 'info',
        category: 'structure',
        message: `Review phase '${name}' failed: ${(err as Error).message}`,
        primarySpan: { file: filePath, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        fingerprint: createFingerprint('internal-error', 1, name.charCodeAt(0)),
      });
      return fallback;
    }
  }

  // Parse .kern → IR tree + structured diagnostics
  const { root, diagnostics: parseDiags } = safePhase('parse', () => parseWithDiagnostics(source), {
    root: { type: 'document' } as IRNode,
    diagnostics: [] as ParseDiagnostic[],
  });

  // Map parse diagnostics → ReviewFindings (severity capped at 'warning' unless --strict-parse is enabled)
  const hasParseErrors = parseDiags.some((d) => d.severity === 'error');
  for (const d of parseDiags) {
    allFindings.push({
      source: 'kern',
      ruleId: `parse/${d.code}`,
      severity: d.severity === 'error' ? (_config?.strictParse ? 'error' : 'warning') : d.severity,
      category: 'bug',
      message: d.message,
      primarySpan: { file: filePath, startLine: d.line, startCol: d.col, endLine: d.line, endCol: d.endCol },
      suggestion: d.suggestion,
      fingerprint: createFingerprint(`parse/${d.code}`, d.line, d.col),
    });
  }

  // Flatten IR tree for rule consumption
  const flatNodes = flattenIR(root).filter((n) => n.type !== 'document');

  // Skip structural lint when parse has errors — partial tree causes cascading false positives
  if (!hasParseErrors) {
    // Ground-layer rules on IR nodes
    const groundFindings = safePhase('ground-lint', () => lintKernIR(flatNodes, GROUND_LAYER_RULES), []);
    for (const f of groundFindings) {
      if (!f.primarySpan.file) f.primarySpan.file = filePath;
    }
    allFindings.push(...groundFindings);

    // Confidence rules on IR nodes
    const confFindings = safePhase('confidence-lint', () => lintConfidenceGraph(flatNodes), []);
    for (const f of confFindings) {
      if (!f.primarySpan.file) f.primarySpan.file = filePath;
    }
    allFindings.push(...confFindings);

    // File-aware .kern review rules on flattened IR nodes.
    // missing-confidence fires only when the user opts into confidence annotations — defaulting
    // it on produced noise for every .kern file that didn't use the feature (see Agon kern-guard run, 2026-04-19).
    const kernSourceRules = _config?.requireConfidenceAnnotations
      ? KERN_SOURCE_RULES
      : KERN_SOURCE_RULES.filter((r) => r !== missingConfidence);
    const kernSourceFindings = safePhase(
      'kern-source-lint',
      () => lintKernSourceIR(flatNodes, filePath, kernSourceRules),
      [],
    );
    allFindings.push(...kernSourceFindings);

    // Native .kern rules (built-in + custom)
    const rulesToRunKern = [...NATIVE_RULES];
    if (_config?.rulesDirs && _config.rulesDirs.length > 0) {
      const builtinIds = new Set(NATIVE_RULES.map((r) => r.ruleId).filter(Boolean) as string[]);
      const customRules = loadNativeRules(_config.rulesDirs, builtinIds);
      rulesToRunKern.push(...customRules);
    }
    if (rulesToRunKern.length > 0) {
      const nativeFindings = safePhase('native-rules', () => lintKernIR(flatNodes, rulesToRunKern), []);
      for (const f of nativeFindings) {
        if (!f.primarySpan.file) f.primarySpan.file = filePath;
      }
      allFindings.push(...nativeFindings);
    }
  }

  // Confidence graph
  let confidenceGraph: ReviewReport['confidenceGraph'];
  let confidenceSummary: ReviewReport['confidenceSummary'];
  if (flatNodes.some((n) => n.props?.confidence !== undefined)) {
    const graph = buildConfidenceGraph(flatNodes);
    confidenceGraph = serializeGraph(graph);
    confidenceSummary = computeConfidenceSummary(graph);
  }

  // Build InferResult[] adapter for compatibility with report/LLM pipeline
  const inferred: InferResult[] = flatNodes.map((node, i) => {
    const line = node.loc?.line ?? 1;
    const endLine = node.loc?.endLine ?? line;
    const name = (node.props?.name as string) || node.type;
    const shallowNode: IRNode = { ...node, children: undefined };
    const rendered = serializeIR(shallowNode);
    return {
      node,
      nodeId: `${filePath}#${node.type}:${name}@L${line}`,
      promptAlias: `N${i + 1}`,
      startLine: line,
      endLine,
      sourceSpans: [
        {
          file: filePath,
          startLine: line,
          startCol: node.loc?.col ?? 1,
          endLine,
          endCol: node.loc?.endCol ?? 1,
        },
      ],
      summary: `${node.type}${name !== node.type ? ` ${name}` : ''}`,
      confidence: 'high' as const,
      confidencePct: 100,
      kernTokens: countTokens(rendered),
      tsTokens: countTokens(rendered),
    };
  });

  const dedupedFindings = sortAndDedup(allFindings);
  assignDefaultConfidence(dedupedFindings);
  const suppression = applySuppression(dedupedFindings, source, filePath, _config, _config?.strict ?? false);
  const findings = sortAndDedup(suppression.findings);
  const kernTokens = countTokens(source);

  return {
    filePath,
    inferred,
    templateMatches: [],
    findings,
    ...(suppression.suppressed.length > 0 ? { suppressedFindings: sortAndDedup(suppression.suppressed) } : {}),
    stats: {
      totalLines,
      coveredLines: totalLines,
      coveragePct: 100,
      totalTsTokens: kernTokens,
      totalKernTokens: kernTokens,
      reductionPct: 0,
      constructCount: flatNodes.length,
    },
    ...(confidenceGraph ? { confidenceGraph } : {}),
    ...(confidenceSummary ? { confidenceSummary } : {}),
  };
}

/**
 * Review Python source code (string).
 * Concept-only pipeline — no KERN IR inference, no ts-morph AST rules.
 */
export function reviewPythonSource(source: string, filePath = 'input.py', config?: ReviewConfig): ReviewReport {
  const totalLines = source.split('\n').length;

  // Python: concept extraction + concept rules only
  let conceptFindings: ReviewFinding[] = [];
  try {
    // Dynamic import — @kernlang/review-python is optional
    const { extractPythonConcepts } = moduleRequire('@kernlang/review-python');
    const concepts = extractPythonConcepts(source, filePath);
    conceptFindings = runConceptRules(concepts, filePath);
    if (config?.target === 'fastapi') {
      conceptFindings.push(...runFastapiConceptRules(concepts, filePath, source));
    }
    // Native .kern rules with concept matching (built-in + custom)
    const rulesToRunPy = [...NATIVE_RULES];
    if (config?.rulesDirs && config.rulesDirs.length > 0) {
      const builtinIds = new Set(NATIVE_RULES.map((r) => r.ruleId).filter(Boolean) as string[]);
      const customRules = loadNativeRules(config.rulesDirs, builtinIds);
      rulesToRunPy.push(...customRules);
    }
    if (rulesToRunPy.length > 0) {
      conceptFindings.push(...lintKernIR([], rulesToRunPy, concepts));
    }
  } catch (err) {
    if (process.env.KERN_DEBUG) console.error(`python mapper load failed: ${(err as Error).message}`);
    // @kernlang/review-python not installed — skip concept extraction
    conceptFindings = [
      {
        source: 'kern',
        ruleId: 'missing-python-support',
        severity: 'info',
        category: 'structure' as const,
        message: 'Install @kernlang/review-python for Python concept analysis',
        primarySpan: { file: filePath, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        fingerprint: 'missing-python-0',
      },
    ];
  }

  const dedupedFindings = sortAndDedup(conceptFindings);
  assignDefaultConfidence(dedupedFindings);
  const suppression = applySuppression(dedupedFindings, source, filePath, config, config?.strict ?? false);
  const findings = sortAndDedup(suppression.findings);

  return {
    filePath,
    inferred: [],
    templateMatches: [],
    findings,
    ...(suppression.suppressed.length > 0 ? { suppressedFindings: sortAndDedup(suppression.suppressed) } : {}),
    stats: {
      totalLines,
      coveredLines: 0,
      coveragePct: 0,
      totalTsTokens: 0,
      totalKernTokens: 0,
      reductionPct: 0,
      constructCount: 0,
    },
  };
}

/**
 * Review all .ts/.tsx/.py files in a directory.
 */
export function reviewDirectory(dirPath: string, recursive = false, config?: ReviewConfig): ReviewReport[] {
  const reports: ReviewReport[] = [];
  const files = collectReviewableFiles(dirPath, recursive);

  for (const file of files) {
    try {
      reports.push(reviewFile(file, config));
    } catch (err) {
      console.error(`  Skipping ${relative(process.cwd(), file)}: ${(err as Error).message}`);
    }
  }

  return reports;
}

/**
 * Review files with full import graph context.
 * Entry files get normal findings, upstream dependencies get origin='upstream'.
 */
export function reviewGraph(entryFiles: string[], config?: ReviewConfig, graphOptions?: GraphOptions): ReviewReport[] {
  const graph = resolveImportGraph(entryFiles, graphOptions);
  const entrySet = new Set(graph.entryFiles);
  const reports: ReviewReport[] = [];
  // Graph-wide subsystem status — one entry per (subsystem, kind) across the whole run.
  // Attached to every report on return so any single ReviewReport is self-describing.
  const graphHealth = new ReviewHealthBuilder();

  // Build file context map — every file gets import chain awareness
  const fileContextMap = buildFileContextMap(graph);
  const graphFileMap = new Map(graph.files.map((gf) => [gf.path, gf] as const));
  const graphConfig: ReviewConfig = { ...config, fileContextMap, graphFileMap };

  for (const gf of graph.files) {
    if (!existsSync(gf.path)) continue;
    try {
      const report = reviewFile(gf.path, graphConfig);
      const isEntry = entrySet.has(gf.path);

      // Tag every finding with provenance
      for (const f of report.findings) {
        f.origin = isEntry ? 'changed' : 'upstream';
        f.distance = gf.distance;

        // Upstream findings: keep severity for errors on the live path (distance 1),
        // downgrade to info only for distant dependencies (distance 2+)
        if (!isEntry && f.severity !== 'info') {
          if (gf.distance >= 2 || f.severity !== 'error') {
            f.severity = 'info';
          }
        }
      }

      for (const f of report.suppressedFindings ?? []) {
        f.origin = isEntry ? 'changed' : 'upstream';
        f.distance = gf.distance;
      }

      // Re-sort after severity mutations
      sortFindings(report.findings);
      if (report.suppressedFindings) sortFindings(report.suppressedFindings);

      reports.push(report);
    } catch (err) {
      console.error(`  Skipping ${relative(process.cwd(), gf.path)}: ${(err as Error).message}`);
    }
  }

  // Cross-file taint analysis — trace tainted data across import boundaries
  const inferredPerFile = new Map<string, InferResult[]>();
  const graphImports = new Map<string, string[]>();
  for (const report of reports) {
    inferredPerFile.set(report.filePath, report.inferred);
  }
  for (const gf of graph.files) {
    graphImports.set(gf.path, gf.imports);
  }

  const crossFileResults = analyzeTaintCrossFile(inferredPerFile, graphImports, graph);
  if (crossFileResults.length > 0) {
    const crossFileFindings = crossFileTaintToFindings(crossFileResults);
    // Add cross-file findings to the caller's report, then re-run suppression
    for (const f of crossFileFindings) {
      const callerReport = reports.find((r) => r.filePath === f.primarySpan.file);
      if (callerReport) {
        callerReport.findings.push(f);
      }
    }
    // Attach raw cross-file taint results for structured output
    for (const result of crossFileResults) {
      const callerReport = reports.find((r) => r.filePath === result.callerFile);
      if (callerReport) {
        if (!callerReport.crossFileTaint) callerReport.crossFileTaint = [];
        callerReport.crossFileTaint.push(result);
      }
    }
  }

  // Cross-file confidence analysis for KERN IR nodes across the reviewed graph.
  const confidenceFileMap = new Map<string, IRNode[]>();
  for (const report of reports) {
    if (!report.filePath.endsWith('.kern')) continue;
    const nodes = report.inferred.map((r) => r.node);
    if (nodes.length > 0) {
      confidenceFileMap.set(report.filePath, nodes);
    }
  }
  if (confidenceFileMap.size > 1) {
    const crossFileConfidenceFindings = lintMultiFileConfidenceGraph(confidenceFileMap);
    for (const finding of crossFileConfidenceFindings) {
      const targetReport = reports.find((r) => r.filePath === finding.primarySpan.file);
      if (targetReport) {
        targetReport.findings.push(finding);
      }
    }
  }

  const crossFileKernFindings = lintKernSourceCrossFile(reports);
  for (const finding of crossFileKernFindings) {
    const targetReport = reports.find((r) => r.filePath === finding.primarySpan.file);
    if (targetReport) {
      targetReport.findings.push(finding);
    }
  }

  // Cross-file concept analysis — re-run concept rules with full graph context
  // This fixes false positives where guards are in middleware files and effects in handlers
  const allConcepts = new Map<string, import('@kernlang/core').ConceptMap>();
  // Cache the optional Python mapper: require() it once per graph run instead
  // of per-file, and remember if it's absent so we don't pay the throw cost.
  let extractPythonConcepts: ((src: string, fp: string) => import('@kernlang/core').ConceptMap) | null | undefined;
  for (const report of reports) {
    const filePath = report.filePath;
    try {
      const source = readFileSync(filePath, 'utf-8');
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
        const project = createInMemoryProject();
        const sf = project.createSourceFile(filePath, source);
        allConcepts.set(filePath, extractTsConcepts(sf, filePath));
      } else if (filePath.endsWith('.py')) {
        // Python concept seeding is what powers the fullstack wedge rules
        // (contract-drift, untyped-api-response, tainted-across-wire) in graph
        // mode. Without this branch, `allConcepts` only contained TS entries
        // and the rules silently found nothing on cross-stack repos.
        if (extractPythonConcepts === undefined) {
          try {
            extractPythonConcepts = moduleRequire('@kernlang/review-python').extractPythonConcepts;
          } catch {
            extractPythonConcepts = null;
          }
        }
        if (extractPythonConcepts) {
          allConcepts.set(filePath, extractPythonConcepts(source, filePath));
        }
      }
    } catch (err) {
      // Per-file failure — record once at graph level (builder dedupes), then move on.
      graphHealth.noteKind(
        'concept-extraction',
        'fallback',
        'One or more files failed concept extraction — boundary/effect rules may be incomplete',
        debugDetail(err),
      );
      if (process.env.KERN_DEBUG) console.error(`concept extraction failed for ${filePath}:`, (err as Error).message);
    }
  }

  // Pre-extracted concepts from external (non-entry) files — typically
  // a partner repo whose IR has been cached by the caller. Merged so
  // cross-stack rules see both sides even when the partner's files are
  // not physically present in this graph run. External keys never
  // overwrite on-disk entries: if the caller accidentally namespaces a
  // key that collides with a real graph file, the real file wins.
  if (config?.externalConcepts) {
    for (const [path, cm] of config.externalConcepts) {
      if (!allConcepts.has(path)) allConcepts.set(path, cm);
    }
  }

  if (allConcepts.size > 0) {
    // Concept rule IDs to replace (remove per-file findings, add cross-file ones)
    const CONCEPT_RULE_IDS = new Set([
      'boundary-mutation',
      'ignored-error',
      'missing-response-model',
      'sync-handler-does-io',
      'unguarded-effect',
      'unrecovered-effect',
    ]);

    for (const report of reports) {
      const concepts = allConcepts.get(report.filePath);
      if (!concepts) continue;

      // Remove per-file concept findings (they were run without cross-file context)
      report.findings = report.findings.filter((f) => !CONCEPT_RULE_IDS.has(f.ruleId));

      // Re-run concept rules with cross-file context
      const crossFileConceptFindings = runConceptRules(concepts, report.filePath, allConcepts, graphImports);
      report.findings.push(...crossFileConceptFindings);
    }
  }

  // Note: server-hook / missing-use-client client boundary suppression is now handled
  // by FileContext in the rules themselves (ctx.fileContext.isClientBoundary).

  // ── Norm mining + proof obligations ──
  if (allConcepts.size > 0) {
    const normViolations = mineNorms(allConcepts);
    for (const report of reports) {
      const obligations = synthesizeObligations(allConcepts, fileContextMap, report.filePath, normViolations);
      // Attach obligations to the report (as metadata, not findings — they're for the LLM reviewer)
      (report as any).obligations = obligations;
    }
  }

  // ── Call graph analysis: dead exports + cross-file async ──
  try {
    // Use provided project, or build one with all graph files loaded
    let cgProject = graphOptions?.project;
    if (!cgProject) {
      // Fall back to discovering from the first graph file when the caller didn't supply a tsconfig.
      const cgTsConfig =
        graphOptions?.tsConfigFilePath ?? (graph.files[0] ? findTsConfig(dirname(graph.files[0].path)) : undefined);
      cgProject = new Project({
        tsConfigFilePath: cgTsConfig,
        skipAddingFilesFromTsConfig: true,
        useInMemoryFileSystem: false,
        compilerOptions: cgTsConfig
          ? undefined
          : {
              strict: true,
              target: 99,
              module: 99,
              moduleResolution: 100,
              jsx: 4 /* Preserve */,
              allowJs: true,
              esModuleInterop: true,
              allowSyntheticDefaultImports: true,
              skipLibCheck: true,
            },
      });
      for (const gf of graph.files) {
        try {
          cgProject.addSourceFileAtPath(gf.path);
        } catch {
          /* skip unresolvable */
        }
      }
    }

    const callGraph = buildCallGraph(graph, cgProject);

    // Build the public-API map once per run — package.json walk is the heavy bit.
    // Then propagate through re-export chains so curated barrels (Agon-style:
    // `export { foo } from './worker.js'`) carry public-API status upstream.
    const basePublicApi = buildPublicApiMap(
      graph.files.map((gf) => gf.path),
      config?.publicApi,
    );
    const publicApi = expandPublicApiThroughReExports(basePublicApi, (path) => cgProject?.getSourceFile(path));

    for (const report of reports) {
      const deadExportFindings = deadExportRule(callGraph, report.filePath, publicApi);
      report.findings.push(...deadExportFindings);

      const asyncFindings = crossFileAsyncRule(callGraph, report.filePath);
      report.findings.push(...asyncFindings);
    }
  } catch (err) {
    // Call graph build failure must not crash the review pipeline — surface the failure on
    // health so dead-export / cross-file-async rules aren't silently missing from the report.
    graphHealth.noteKind(
      'call-graph',
      'error',
      'Call graph build failed — dead exports and cross-file async checks are unavailable',
      debugDetail(err),
    );
    if (process.env.KERN_DEBUG) console.error('call graph build error:', (err as Error).message);
  }

  // Re-run suppression + dedup on all reports (cross-file findings were injected after initial suppression)
  for (const report of reports) {
    try {
      const source = readFileSync(report.filePath, 'utf-8');
      const unsuppressedCandidates = [...report.findings, ...(report.suppressedFindings ?? [])];
      const suppression = applySuppression(
        sortAndDedup(unsuppressedCandidates),
        source,
        report.filePath,
        config,
        config?.strict ?? false,
      );
      report.findings = sortAndDedup(suppression.findings);
      report.suppressedFindings = suppression.suppressed.length > 0 ? sortAndDedup(suppression.suppressed) : undefined;
    } catch {
      report.findings = sortAndDedup(report.findings);
    }
  }

  // Merge graph-level health into every report. Each report may already carry per-file health
  // (e.g. fs-project fallback); fold those entries into the graph builder so every report sees
  // the complete, deduped picture before we emit.
  for (const report of reports) {
    const merged = new ReviewHealthBuilder();
    for (const e of report.health?.entries ?? []) merged.note(e);
    for (const e of graphHealth.build()?.entries ?? []) merged.note(e);
    report.health = merged.build();
  }

  return reports;
}

function collectReviewableFiles(dirPath: string, recursive: boolean): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dirPath)) {
    const full = join(dirPath, entry);
    const stat = statSync(full);
    if (
      stat.isDirectory() &&
      recursive &&
      !entry.startsWith('.') &&
      entry !== 'node_modules' &&
      entry !== 'dist' &&
      entry !== '__pycache__' &&
      entry !== '.venv' &&
      entry !== 'venv'
    ) {
      files.push(...collectReviewableFiles(full, true));
    } else if (
      stat.isFile() &&
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      files.push(full);
    } else if (stat.isFile() && entry.endsWith('.py') && !entry.startsWith('test_') && !entry.endsWith('_test.py')) {
      files.push(full);
    } else if (stat.isFile() && entry.endsWith('.kern')) {
      files.push(full);
    }
  }
  return files;
}
