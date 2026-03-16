/**
 * Quality Rules — delegates to rule layers based on config.target.
 *
 * v2: Thin orchestrator. Actual rules live in ./rules/*.ts
 */

import type { SourceFile } from 'ts-morph';
import type { InferResult, TemplateMatch, ReviewConfig, ReviewFinding } from './types.js';
import { getActiveRules } from './rules/index.js';

/**
 * Run all active quality rules against a source file.
 * Returns unified ReviewFinding[] sorted by severity then line.
 */
export function runQualityRules(
  sourceFile: SourceFile,
  inferred: InferResult[],
  templateMatches: TemplateMatch[],
  config?: ReviewConfig,
): ReviewFinding[] {
  const filePath = sourceFile.getFilePath() || 'input.ts';
  const rules = getActiveRules(config?.target);

  const findings: ReviewFinding[] = [];
  for (const rule of rules) {
    findings.push(...rule({ sourceFile, inferred, templateMatches, config, filePath }));
  }

  // Sort by severity (error > warning > info), then by line
  const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => {
    const sd = severityOrder[a.severity] - severityOrder[b.severity];
    if (sd !== 0) return sd;
    return a.primarySpan.startLine - b.primarySpan.startLine;
  });

  return findings;
}
