/**
 * Optional formatting via Biome with canonical fallback.
 *
 * Q3 of the design: canonical generator output is the default, Biome runs
 * only when --format is passed on a touched file. If Biome is missing or
 * fails, we fall back silently to canonical output and note it in audit.
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

export interface FormatResult {
  ran: boolean;
  ok: boolean;
  error?: string;
}

export function formatWithBiome(filePath: string, cwd: string): FormatResult {
  const binCandidates = [
    resolve(cwd, 'node_modules/.bin/biome'),
    resolve(cwd, 'node_modules/@biomejs/biome/bin/biome'),
  ];
  const bin = binCandidates.find((p) => existsSync(p));
  if (!bin) {
    return { ran: false, ok: false, error: 'biome binary not found in node_modules/.bin' };
  }

  const proc = spawnSync(bin, ['format', '--write', filePath], { cwd, encoding: 'utf-8' });
  if (proc.error) {
    return { ran: true, ok: false, error: proc.error.message };
  }
  if (proc.status !== 0) {
    const stderr = (proc.stderr || '').trim();
    return { ran: true, ok: false, error: stderr || `biome exited with ${proc.status}` };
  }
  return { ran: true, ok: true };
}
