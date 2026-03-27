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

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, relative, join } from 'path';
import { parseWithDiagnostics, countTokens, serializeIR } from '@kernlang/core';
import type { IRNode, ParseDiagnostic } from '@kernlang/core';
import { inferFromSource, inferFromFile, inferFromSourceFile, createInMemoryProject } from './inferrer.js';
import { resolveImportGraph } from './graph.js';
import type { GraphOptions } from './types.js';
import { detectTemplates } from './template-detector.js';
import { structuralDiff } from './differ.js';
import { runQualityRules } from './quality-rules.js';
import { calculateStats, formatReport, formatReportJSON, formatSARIF, formatSummary, checkEnforcement, formatEnforcement, dedup, sortAndDedup, sortFindings } from './reporter.js';
import { classifyFileRole } from './file-role.js';
import { runTSCDiagnostics } from './external-tools.js';
import { exportKernIR, buildLLMPrompt, parseLLMResponse } from './llm-review.js';
import { extractTsConcepts } from './mappers/ts-concepts.js';
import { runConceptRules } from './concept-rules/index.js';
import { lintConfidenceGraph } from './rules/confidence.js';
import { lintKernIR, flattenIR } from './kern-lint.js';
import { loadBuiltinNativeRules, loadNativeRules } from './rule-loader.js';
import { lintKernSourceIR, KERN_SOURCE_RULES } from './rules/kern-source.js';
import { GROUND_LAYER_RULES } from './rules/ground-layer.js';

// Load native .kern rules once at module init
// Guard: import.meta.url is undefined when bundled as CJS (e.g. esbuild for VS Code worker)
let NATIVE_RULES: import('./kern-lint.js').KernLintRule[] = [];
try {
  NATIVE_RULES = loadBuiltinNativeRules();
} catch {
  // CJS bundle — native .kern rules not available, regex rules still work
}
import { buildConfidenceGraph, serializeGraph, computeConfidenceSummary } from './confidence.js';
import { analyzeTaint, taintToFindings, analyzeTaintCrossFile, crossFileTaintToFindings } from './taint.js';
import { applySuppression } from './suppression/index.js';
import type { ReviewReport, InferResult, TemplateMatch, ReviewConfig, EnforceResult, ReviewFinding, SourceSpan } from './types.js';
import { createFingerprint } from './types.js';

export type { ReviewReport, InferResult, TemplateMatch, ReviewFinding, SourceSpan } from './types.js';
export type { ReviewStats, Confidence, ReviewConfig, EnforceResult, RuleContext, ReviewRule } from './types.js';
export type { GraphFile, GraphResult, GraphOptions } from './types.js';
export type { FileRole, AnalysisContext } from './types.js';
export { resolveImportGraph } from './graph.js';
export { createFingerprint } from './types.js';
export { inferFromSource, inferFromFile } from './inferrer.js';
export { classifyFileRole } from './file-role.js';
export { detectTemplates } from './template-detector.js';
export { structuralDiff } from './differ.js';
export { runQualityRules } from './quality-rules.js';
export { calculateStats, formatReport, formatReportJSON, formatSARIF, formatSARIFWithSuppressions, formatSummary, checkEnforcement, formatEnforcement, dedup, sortAndDedup, sortFindings } from './reporter.js';
export { exportKernIR, buildLLMPrompt, parseLLMResponse } from './llm-review.js';
export type { LLMGraphContext } from './llm-review.js';
export { runESLint, runTSCDiagnostics, runTSCDiagnosticsFromPaths, linkToNodes } from './external-tools.js';
export { extractTsConcepts } from './mappers/ts-concepts.js';
export { runConceptRules } from './concept-rules/index.js';
export type { ConceptRule, ConceptRuleContext } from './concept-rules/index.js';

// Suppression
export { applySuppression, parseDirectives, configDirectives, isConceptRule } from './suppression/index.js';
export type { SuppressionDirective, SuppressionResult, StrictMode } from './suppression/index.js';

// KERN-IR lint pipeline (ground layer)
export { lintKernIR, flattenIR } from './kern-lint.js';
export type { KernLintRule } from './kern-lint.js';
export { GROUND_LAYER_RULES } from './rules/ground-layer.js';
export { lintKernSourceIR, KERN_SOURCE_RULES, undefinedReference, typeModelMismatch, unusedState, handlerHeavy, missingConfidence } from './rules/kern-source.js';
export type { KernSourceRule } from './rules/kern-source.js';
export {
  guardWithoutElse, actionMissingIdempotent, branchNonExhaustive,
  collectUnbounded, reasonWithoutBasis, assumeLowTrust, expectRangeInverted,
} from './rules/ground-layer.js';

// Confidence layer
export {
  parseConfidence, buildConfidenceGraph, buildMultiFileConfidenceGraph,
  propagateConfidence, resolveBaseConfidence, serializeGraph, computeConfidenceSummary,
} from './confidence.js';
export type {
  ConfidenceSpec, ConfidenceNode, NeedsEntry, DuplicateNameEntry,
  ConfidenceGraph, MultiFileConfidenceGraph, SerializedConfidenceGraph, ConfidenceSummary,
} from './confidence.js';
export { lintConfidenceGraph, lintMultiFileConfidenceGraph, CONFIDENCE_RULES } from './rules/confidence.js';

// ReDoS detection (reusable by rule compilers)
export { isReDoSVulnerable } from './rules/security-v3.js';

// Taint tracking (Phase 2 + cross-file)
export { analyzeTaint, taintToFindings, analyzeTaintCrossFile, crossFileTaintToFindings, buildExportMap, buildImportMap, isSanitizerSufficient } from './taint.js';
export type { TaintSource, TaintSink, TaintPath, TaintResult, CrossFileTaintResult, ExportedFunction } from './taint.js';

// LLM bridge (Phase 3)
export { runLLMReview, isLLMAvailable } from './llm-bridge.js';
export type { LLMBridgeConfig, LLMReviewInput } from './llm-bridge.js';

// Spec checker — .kern contract vs .ts implementation
export { checkSpec, checkSpecFiles, extractSpecContracts, extractImplRoutes, matchRoutes, verifyRouteContract, specViolationsToFindings } from './spec-checker.js';
export type { SpecContract, ImplRoute, SpecViolation, SpecCheckResult, ViolationKind } from './spec-checker.js';

/**
 * Review a single file. Auto-detects language from extension.
 * Supports: .ts, .tsx, .py, .kern
 */
export function reviewFile(filePath: string, config?: ReviewConfig): ReviewReport {
  const source = readFileSync(filePath, 'utf-8');
  if (filePath.endsWith('.kern')) {
    return reviewKernSource(source, filePath, config);
  }
  if (filePath.endsWith('.py')) {
    return reviewPythonSource(source, filePath, config);
  }
  return reviewSource(source, filePath, config);
}

/**
 * Review TypeScript source code (string).
 */
export function reviewSource(source: string, filePath = 'input.ts', config?: ReviewConfig): ReviewReport {
  const totalLines = source.split('\n').length;

  // ── Shared context: single AST parse, shared across all phases ──
  const project = createInMemoryProject();
  const sourceFile = project.createSourceFile(filePath, source);
  const fileRole = classifyFileRole(sourceFile, filePath);

  // Helper: run a phase safely, collect findings even if a phase throws
  const allFindings: ReviewFinding[] = [];
  function safePhase<T>(name: string, fn: () => T, fallback: T): T {
    try { return fn(); }
    catch (err) {
      allFindings.push({
        source: 'kern', ruleId: 'internal-error', severity: 'info', category: 'structure',
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
  allFindings.push(...safePhase('taint', () => {
    const taintResults = analyzeTaint(inferred, filePath, sourceFile);
    return taintToFindings(taintResults);
  }, []));

  // Phase 3: Template detection (config-aware)
  const templateMatches = safePhase('templates', () => detectTemplates(sourceFile, config), []);

  // Phase 4: Structural diff → unified findings
  allFindings.push(...safePhase('diff', () => structuralDiff(source, inferred, filePath), []));

  // Phase 5: Quality rules → unified findings (receives fileRole)
  allFindings.push(...safePhase('quality', () => runQualityRules(sourceFile, inferred, templateMatches, config, fileRole), []));

  // Phase 6: Concept extraction + concept rules (universal, cross-language)
  const emptyConcepts = { filePath, language: 'typescript', nodes: [], edges: [], extractorVersion: '0' };
  const concepts = safePhase('concepts', () => extractTsConcepts(sourceFile, filePath), emptyConcepts);
  allFindings.push(...safePhase('concept-rules', () => runConceptRules(concepts, filePath), []));

  // Phase 7: KERN-IR lint (ground layer + confidence rules on inferred nodes)
  const irNodes = inferred.map(r => r.node);
  const groundFindings = safePhase('ground-lint', () => lintKernIR(irNodes, GROUND_LAYER_RULES), []);
  for (const f of groundFindings) { if (!f.primarySpan.file) f.primarySpan.file = filePath; }
  allFindings.push(...groundFindings);
  const confFindings = safePhase('confidence-lint', () => lintConfidenceGraph(irNodes), []);
  for (const f of confFindings) { if (!f.primarySpan.file) f.primarySpan.file = filePath; }
  allFindings.push(...confFindings);

  // Phase 7b: Native .kern rules (built-in + custom)
  const rulesToRun = [...NATIVE_RULES];
  if (config?.rulesDirs && config.rulesDirs.length > 0) {
    const builtinIds = new Set(NATIVE_RULES.map(r => r.ruleId).filter(Boolean) as string[]);
    const customRules = loadNativeRules(config.rulesDirs, builtinIds);
    rulesToRun.push(...customRules);
  }
  if (rulesToRun.length > 0) {
    const nativeFindings = safePhase('native-rules', () => lintKernIR(irNodes, rulesToRun, concepts), []);
    for (const f of nativeFindings) { if (!f.primarySpan.file) f.primarySpan.file = filePath; }
    allFindings.push(...nativeFindings);
  }

  // Phase 8: TSC diagnostics — native TypeScript compiler errors
  allFindings.push(...safePhase('tsc', () => runTSCDiagnostics(project), []));

  // Build confidence graph if any nodes have confidence props
  let confidenceGraph: ReviewReport['confidenceGraph'];
  let confidenceSummary: ReviewReport['confidenceSummary'];
  const hasConfidence = irNodes.some(n => n.props?.confidence !== undefined);
  if (hasConfidence) {
    const graph = buildConfidenceGraph(irNodes);
    confidenceGraph = serializeGraph(graph);
    confidenceSummary = computeConfidenceSummary(graph);
  }

  // Merge, dedup, sort — single shared utility
  const dedupedFindings = sortAndDedup(allFindings);

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
    try { return fn(); }
    catch (err) {
      allFindings.push({
        source: 'kern', ruleId: 'internal-error', severity: 'info', category: 'structure',
        message: `Review phase '${name}' failed: ${(err as Error).message}`,
        primarySpan: { file: filePath, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        fingerprint: createFingerprint('internal-error', 1, name.charCodeAt(0)),
      });
      return fallback;
    }
  }

  // Parse .kern → IR tree + structured diagnostics
  const { root, diagnostics: parseDiags } = safePhase(
    'parse',
    () => parseWithDiagnostics(source),
    { root: { type: 'document' } as IRNode, diagnostics: [] as ParseDiagnostic[] },
  );

  // Map parse diagnostics → ReviewFindings (severity capped at 'warning' to avoid breaking --enforce)
  const hasParseErrors = parseDiags.some(d => d.severity === 'error');
  for (const d of parseDiags) {
    allFindings.push({
      source: 'kern',
      ruleId: `parse/${d.code}`,
      severity: d.severity === 'error' ? 'warning' : d.severity,
      category: 'bug',
      message: d.message,
      primarySpan: { file: filePath, startLine: d.line, startCol: d.col, endLine: d.line, endCol: d.endCol },
      suggestion: d.suggestion,
      fingerprint: createFingerprint(`parse/${d.code}`, d.line, d.col),
    });
  }

  // Flatten IR tree for rule consumption
  const flatNodes = flattenIR(root).filter(n => n.type !== 'document');

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

    // File-aware .kern review rules on flattened IR nodes
    const kernSourceFindings = safePhase('kern-source-lint', () => lintKernSourceIR(flatNodes, filePath, KERN_SOURCE_RULES), []);
    allFindings.push(...kernSourceFindings);

    // Native .kern rules (built-in + custom)
    const rulesToRunKern = [...NATIVE_RULES];
    if (_config?.rulesDirs && _config.rulesDirs.length > 0) {
      const builtinIds = new Set(NATIVE_RULES.map(r => r.ruleId).filter(Boolean) as string[]);
      const customRules = loadNativeRules(_config.rulesDirs, builtinIds);
      rulesToRunKern.push(...customRules);
    }
    if (rulesToRunKern.length > 0) {
      const nativeFindings = safePhase('native-rules', () => lintKernIR(flatNodes, rulesToRunKern), []);
      for (const f of nativeFindings) { if (!f.primarySpan.file) f.primarySpan.file = filePath; }
      allFindings.push(...nativeFindings);
    }
  }

  // Confidence graph
  let confidenceGraph: ReviewReport['confidenceGraph'];
  let confidenceSummary: ReviewReport['confidenceSummary'];
  if (flatNodes.some(n => n.props?.confidence !== undefined)) {
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
      sourceSpans: [{
        file: filePath, startLine: line, startCol: node.loc?.col ?? 1,
        endLine, endCol: node.loc?.endCol ?? 1,
      }],
      summary: `${node.type}${name !== node.type ? ` ${name}` : ''}`,
      confidence: 'high' as const,
      confidencePct: 100,
      kernTokens: countTokens(rendered),
      tsTokens: countTokens(rendered),
    };
  });

  const dedupedFindings = sortAndDedup(allFindings);
  const suppression = applySuppression(dedupedFindings, source, filePath, _config, _config?.strict ?? false);
  const findings = sortAndDedup(suppression.findings);
  const kernTokens = countTokens(source);

  return {
    filePath,
    inferred,
    templateMatches: [],
    findings,
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
    const { extractPythonConcepts } = require('@kernlang/review-python');
    const concepts = extractPythonConcepts(source, filePath);
    conceptFindings = runConceptRules(concepts, filePath);
    // Native .kern rules with concept matching (built-in + custom)
    const rulesToRunPy = [...NATIVE_RULES];
    if (config?.rulesDirs && config.rulesDirs.length > 0) {
      const builtinIds = new Set(NATIVE_RULES.map(r => r.ruleId).filter(Boolean) as string[]);
      const customRules = loadNativeRules(config.rulesDirs, builtinIds);
      rulesToRunPy.push(...customRules);
    }
    if (rulesToRunPy.length > 0) {
      conceptFindings.push(...lintKernIR([], rulesToRunPy, concepts));
    }
  } catch (_err) {
    // @kernlang/review-python not installed — skip concept extraction
    conceptFindings = [{
      source: 'kern',
      ruleId: 'missing-python-support',
      severity: 'info',
      category: 'structure' as const,
      message: 'Install @kernlang/review-python for Python concept analysis',
      primarySpan: { file: filePath, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      fingerprint: 'missing-python-0',
    }];
  }

  const dedupedFindings = sortAndDedup(conceptFindings);
  const suppression = applySuppression(dedupedFindings, source, filePath, config, config?.strict ?? false);
  const findings = sortAndDedup(suppression.findings);

  return {
    filePath,
    inferred: [],
    templateMatches: [],
    findings,
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
export function reviewGraph(
  entryFiles: string[],
  config?: ReviewConfig,
  graphOptions?: GraphOptions,
): ReviewReport[] {
  const graph = resolveImportGraph(entryFiles, graphOptions);
  const entrySet = new Set(graph.entryFiles);
  const reports: ReviewReport[] = [];

  for (const gf of graph.files) {
    if (!existsSync(gf.path)) continue;
    try {
      const report = reviewFile(gf.path, config);
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

      // Re-sort after severity mutations
      sortFindings(report.findings);

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

  const crossFileResults = analyzeTaintCrossFile(inferredPerFile, graphImports);
  if (crossFileResults.length > 0) {
    const crossFileFindings = crossFileTaintToFindings(crossFileResults);
    // Add cross-file findings to the caller's report, then re-run suppression
    for (const f of crossFileFindings) {
      const callerReport = reports.find(r => r.filePath === f.primarySpan.file);
      if (callerReport) {
        callerReport.findings.push(f);
      }
    }
    // Re-run suppression + dedup on affected reports (cross-file findings were injected after initial suppression)
    for (const report of reports) {
      try {
        const source = readFileSync(report.filePath, 'utf-8');
        const suppression = applySuppression(report.findings, source, report.filePath, config, config?.strict ?? false);
        report.findings = sortAndDedup(suppression.findings);
      } catch {
        report.findings = sortAndDedup(report.findings);
      }
    }
  }

  return reports;
}

function collectReviewableFiles(dirPath: string, recursive: boolean): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dirPath)) {
    const full = join(dirPath, entry);
    const stat = statSync(full);
    if (stat.isDirectory() && recursive && !entry.startsWith('.') && entry !== 'node_modules' && entry !== 'dist' && entry !== '__pycache__' && entry !== '.venv' && entry !== 'venv') {
      files.push(...collectReviewableFiles(full, true));
    } else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      files.push(full);
    } else if (entry.endsWith('.py') && !entry.startsWith('test_') && !entry.endsWith('_test.py')) {
      files.push(full);
    } else if (entry.endsWith('.kern')) {
      files.push(full);
    }
  }
  return files;
}
