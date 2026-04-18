/**
 * Audit log — JSONL append-only.
 *
 * Every invocation of applyMatch (including dry-runs and rejections) produces
 * an audit entry. Default path is .kern/codemod-audit.jsonl under cwd, created
 * on demand. Each line is a self-contained JSON object with schema:1.
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import type { ApplyResult, AuditEntry } from './types.js';

export function defaultAuditPath(cwd: string): string {
  return resolve(cwd, '.kern', 'codemod-audit.jsonl');
}

export function writeAuditEntry(auditPath: string, result: ApplyResult): void {
  const entry: AuditEntry = { ...result, schema: 1 };
  try {
    const dir = dirname(auditPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch (err) {
    console.error(`kern-codemod: audit write failed (${auditPath}): ${(err as Error).message}`);
  }
}
