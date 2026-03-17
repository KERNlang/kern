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
import { calculateStats, formatReport, formatReportJSON, formatSummary, checkEnforcement, formatEnforcement, dedup } from './reporter.js';
import { exportKernIR, buildLLMPrompt, parseLLMResponse } from './llm-review.js';
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
export { calculateStats, formatReport, formatReportJSON, formatSummary, checkEnforcement, formatEnforcement, dedup } from './reporter.js';
export { exportKernIR, buildLLMPrompt, parseLLMResponse } from './llm-review.js';
export type { LLMGraphContext } from './llm-review.js';
export { runESLint, runTSCDiagnostics, runTSCDiagnosticsFromPaths, linkToNodes } from './external-tools.js';

/**
 * Review a single TypeScript file.
 */
export function reviewFile(filePath: string, config?: ReviewConfig): ReviewReport {
  const source = readFileSync(filePath, 'utf-8');
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

  // Merge all findings into single unified array
  const findings = dedup([...diffFindings, ...qualityFindings]);

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
  };
}

/**
 * Review all .ts/.tsx files in a directory.
 */
export function reviewDirectory(dirPath: string, recursive = false, config?: ReviewConfig): ReviewReport[] {
  const reports: ReviewReport[] = [];
  const files = collectTsFiles(dirPath, recursive);

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
  const distanceMap = new Map(graph.files.map(f => [f.path, f.distance]));
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
          // distance 1 errors retain severity — these are direct imports
          // that materially affect the changed code
        }
      }

      reports.push(report);
    } catch (err) {
      console.error(`  Skipping ${relative(process.cwd(), gf.path)}: ${(err as Error).message}`);
    }
  }

  return reports;
}

function collectTsFiles(dirPath: string, recursive: boolean): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dirPath)) {
    const full = join(dirPath, entry);
    const stat = statSync(full);
    if (stat.isDirectory() && recursive && !entry.startsWith('.') && entry !== 'node_modules' && entry !== 'dist') {
      files.push(...collectTsFiles(full, true));
    } else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      files.push(full);
    }
  }
  return files;
}
