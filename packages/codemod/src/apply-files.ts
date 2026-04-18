/**
 * Batch driver — apply codemod across one or more files.
 *
 * Responsibilities:
 *   - Load the shared ts-morph Project once.
 *   - For each file: ensure it's in the Project, detect templates, and run
 *     applyMatch for every candidate above the confidence threshold.
 *   - Emit one audit entry per decision.
 *
 * The driver does not own --interactive prompting; the CLI layer wraps around
 * this and streams decisions to the user.
 */

import { detectTemplates } from '@kernlang/review';
import { resolve } from 'path';
import { applyMatch } from './apply.js';
import { defaultAuditPath, writeAuditEntry } from './audit.js';
import { snapshotAffectedSet } from './diagnostics.js';
import { loadHostProject } from './project.js';
import type { ApplyOptions, ApplyResult } from './types.js';
// Register built-in adapters via side-effect import.
import './adapters/index.js';

export interface ApplyFilesResult {
  results: ApplyResult[];
  auditPath: string;
}

export function applyFiles(filePaths: string[], options: ApplyOptions = {}): ApplyFilesResult {
  const cwd = options.cwd ?? process.cwd();
  const auditPath = options.auditPath ?? defaultAuditPath(cwd);
  const project = loadHostProject({ cwd });
  const results: ApplyResult[] = [];

  for (const input of filePaths) {
    const absPath = resolve(cwd, input);
    let sourceFile = project.getSourceFile(absPath);
    if (!sourceFile) {
      try {
        sourceFile = project.addSourceFileAtPath(absPath);
      } catch (err) {
        const result: ApplyResult = {
          filePath: absPath,
          templateName: '<unknown>',
          confidencePct: 0,
          decision: 'skipped',
          reason: `could not add to Project: ${(err as Error).message}`,
          timestamp: new Date().toISOString(),
        };
        writeAuditEntry(auditPath, result);
        results.push(result);
        continue;
      }
    }

    const matches = detectTemplates(sourceFile);
    if (matches.length === 0) continue;

    // Snapshot affected-set once per file so every candidate shares the baseline.
    const preDiagnostics = snapshotAffectedSet(project, sourceFile);

    for (const match of matches) {
      const result = applyMatch({ project, filePath: absPath, match, preDiagnostics }, options);
      writeAuditEntry(auditPath, result);
      results.push(result);
    }
  }

  return { results, auditPath };
}
