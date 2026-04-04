/**
 * Quality Rules — delegates to rule layers based on config.target.
 *
 * v2: Thin orchestrator. Actual rules live in ./rules/*.ts
 */

import type { Project, SourceFile } from 'ts-morph';
import { getActiveRules } from './rules/index.js';
import type { FileRole, InferResult, ReviewConfig, ReviewFinding, TemplateMatch } from './types.js';

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
  project?: Project,
): ReviewFinding[] {
  const filePath = sourceFile.getFilePath() || 'input.ts';
  const rules = getActiveRules(config?.target);

  // Resolve file context from import graph (if available)
  const fileContext = config?.fileContextMap?.get(filePath);

  const findings: ReviewFinding[] = [];
  for (const rule of rules) {
    findings.push(...rule({ sourceFile, project, inferred, templateMatches, config, filePath, fileRole, fileContext }));
  }

  return findings;
}
