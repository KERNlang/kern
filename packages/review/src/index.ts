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
import { inferFromSource, inferFromFile, createInMemoryProject } from './inferrer.js';
import { resolveImportGraph } from './graph.js';
import type { GraphOptions } from './types.js';
import { detectTemplates } from './template-detector.js';
import { structuralDiff } from './differ.js';
import { runQualityRules } from './quality-rules.js';
import { calculateStats, formatReport, formatReportJSON, formatSARIF, formatSummary, checkEnforcement, formatEnforcement, dedup } from './reporter.js';
import { exportKernIR, buildLLMPrompt, parseLLMResponse } from './llm-review.js';
import { extractTsConcepts } from './mappers/ts-concepts.js';
import { runConceptRules } from './concept-rules/index.js';
import { lintConfidenceGraph } from './rules/confidence.js';
import { lintKernIR } from './kern-lint.js';
import { GROUND_LAYER_RULES } from './rules/ground-layer.js';
import { buildConfidenceGraph, serializeGraph, computeConfidenceSummary } from './confidence.js';
import { analyzeTaint, taintToFindings, analyzeTaintCrossFile, crossFileTaintToFindings } from './taint.js';
import type { ReviewReport, InferResult, TemplateMatch, ReviewConfig, EnforceResult, ReviewFinding, SourceSpan } from './types.js';

export type { ReviewReport, InferResult, TemplateMatch, ReviewFinding, SourceSpan } from './types.js';
export type { ReviewStats, Confidence, ReviewConfig, EnforceResult, RuleContext, ReviewRule } from './types.js';
export type { GraphFile, GraphResult, GraphOptions } from './types.js';
export { resolveImportGraph } from './graph.js';
export { createFingerprint } from './types.js';
export { inferFromSource, inferFromFile } from './inferrer.js';
export { detectTemplates } from './template-detector.js';
export { structuralDiff } from './differ.js';
export { runQualityRules } from './quality-rules.js';
export { calculateStats, formatReport, formatReportJSON, formatSARIF, formatSummary, checkEnforcement, formatEnforcement, dedup } from './reporter.js';
export { exportKernIR, buildLLMPrompt, parseLLMResponse } from './llm-review.js';
export type { LLMGraphContext } from './llm-review.js';
export { runESLint, runTSCDiagnostics, runTSCDiagnosticsFromPaths, linkToNodes } from './external-tools.js';
export { extractTsConcepts } from './mappers/ts-concepts.js';
export { runConceptRules } from './concept-rules/index.js';
export type { ConceptRule, ConceptRuleContext } from './concept-rules/index.js';

// KERN-IR lint pipeline (ground layer)
export { lintKernIR, flattenIR } from './kern-lint.js';
export type { KernLintRule } from './kern-lint.js';
export { GROUND_LAYER_RULES } from './rules/ground-layer.js';
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

// Taint tracking (Phase 2 + cross-file)
export { analyzeTaint, taintToFindings, analyzeTaintCrossFile, crossFileTaintToFindings, buildExportMap, buildImportMap, isSanitizerSufficient } from './taint.js';
export type { TaintSource, TaintSink, TaintPath, TaintResult, CrossFileTaintResult, ExportedFunction } from './taint.js';

// LLM bridge (Phase 3)
export { runLLMReview, isLLMAvailable } from './llm-bridge.js';
export type { LLMBridgeConfig, LLMReviewInput } from './llm-bridge.js';

/**
 * Review a single file. Auto-detects language from extension.
 * Supports: .ts, .tsx, .py
 */
export function reviewFile(filePath: string, config?: ReviewConfig): ReviewReport {
  const source = readFileSync(filePath, 'utf-8');
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

  // Phase 1+2: Infer KERN constructs (with nodeIds + sourceSpans)
  const inferred = inferFromSource(source, filePath);

  // Phase 3: Template detection (config-aware)
  const project = createInMemoryProject();
  const sourceFile = project.createSourceFile(filePath, source);
  const templateMatches = detectTemplates(sourceFile, config);

  // Phase 4: Structural diff → unified findings
  const diffFindings = structuralDiff(source, inferred, filePath);

  // Phase 5: Quality rules → unified findings
  const qualityFindings = runQualityRules(sourceFile, inferred, templateMatches, config);

  // Phase 6: Concept extraction + concept rules (universal, cross-language)
  const concepts = extractTsConcepts(sourceFile, filePath);
  const conceptFindings = runConceptRules(concepts, filePath);

  // Phase 7: KERN-IR lint (ground layer + confidence rules on inferred nodes)
  const irNodes = inferred.map(r => r.node);
  const groundFindings = lintKernIR(irNodes, GROUND_LAYER_RULES);
  const confidenceFindings = lintConfidenceGraph(irNodes);

  // Build confidence graph if any nodes have confidence props
  let confidenceGraph: ReviewReport['confidenceGraph'];
  let confidenceSummary: ReviewReport['confidenceSummary'];
  const hasConfidence = irNodes.some(n => n.props?.confidence !== undefined);
  if (hasConfidence) {
    const graph = buildConfidenceGraph(irNodes);
    confidenceGraph = serializeGraph(graph);
    confidenceSummary = computeConfidenceSummary(graph);
  }

  // Phase 8: Taint tracking — source→sink analysis on handler bodies
  const taintResults = analyzeTaint(inferred, filePath);
  const taintFindings = taintToFindings(taintResults);

  // Merge all findings into single unified array
  const findings = dedup([...diffFindings, ...qualityFindings, ...conceptFindings, ...groundFindings, ...confidenceFindings, ...taintFindings]);

  // Sort: severity (error > warning > info), then by line
  const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => {
    const sd = severityOrder[a.severity] - severityOrder[b.severity];
    if (sd !== 0) return sd;
    return a.primarySpan.startLine - b.primarySpan.startLine;
  });

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

  const findings = dedup(conceptFindings);
  const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => {
    const sd = severityOrder[a.severity] - severityOrder[b.severity];
    if (sd !== 0) return sd;
    return a.primarySpan.startLine - b.primarySpan.startLine;
  });

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
  const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };

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
          // distance 1 errors retain severity — these are direct imports
          // that materially affect the changed code
        }
      }

      // Re-sort after severity mutations
      report.findings.sort((a, b) => {
        const sd = severityOrder[a.severity] - severityOrder[b.severity];
        if (sd !== 0) return sd;
        return a.primarySpan.startLine - b.primarySpan.startLine;
      });

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
    // Add cross-file findings to the caller's report
    for (const f of crossFileFindings) {
      const callerReport = reports.find(r => r.filePath === f.primarySpan.file);
      if (callerReport) {
        callerReport.findings.push(f);
        callerReport.findings = dedup(callerReport.findings);
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
    }
  }
  return files;
}
