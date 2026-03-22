/**
 * Quality Rules — delegates to rule layers based on config.target.
 *
 * v2: Thin orchestrator. Actual rules live in ./rules/*.ts
 */

import type { SourceFile } from 'ts-morph';
import type { InferResult, TemplateMatch, ReviewConfig, ReviewFinding, FileRole } from './types.js';
import { getActiveRules } from './rules/index.js';

/**
 * Run all active quality rules against a source file.
 * Returns unified ReviewFinding[] (sorting is done by caller via sortAndDedup).
 */
export function runQualityRules(
  sourceFile: SourceFile,
  inferred: InferResult[],
  templateMatches: TemplateMatch[],
  config?: ReviewConfig,
  fileRole: FileRole = 'runtime',
): ReviewFinding[] {
  const filePath = sourceFile.getFilePath() || 'input.ts';
  const rules = getActiveRules(config?.target);

  const findings: ReviewFinding[] = [];
  for (const rule of rules) {
    findings.push(...rule({ sourceFile, inferred, templateMatches, config, filePath, fileRole }));
  }

  return findings;
}
