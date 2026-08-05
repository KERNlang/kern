#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
  SAFE_PATTERN_DIGEST_FORMAT,
  digestSafePatternSource,
} from './runtime-dynamic-loader-safe-pattern-kernel.mjs';
import { RUNTIME_DYNAMIC_LOADER_SAFE_PATTERN_AUTHORITIES } from './runtime-dynamic-loader-safe-patterns.mjs';

const REPORT_FORMAT = 'kern.runtime.dynamic-loader-safe-pattern-digest-report.v1';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log('Usage: node scripts/runtime-contract-v1/check-runtime-dynamic-loader-safe-patterns.mjs [--json]');
  console.log('Prints and checks authority digests. It never modifies source or pins.');
  process.exit(0);
}
if (args.some((argument) => argument !== '--json')) {
  console.error(`Unknown argument: ${args.find((argument) => argument !== '--json')}`);
  process.exit(2);
}

function gitBlobOid(path) {
  const result = spawnSync('git', ['hash-object', '--', path], { cwd: REPO_ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function inspectAuthority(authority) {
  try {
    const source = readFileSync(authority.declaredPath, 'utf8');
    const actualDigest = digestSafePatternSource(ts, source, authority.declaredPath);
    return {
      label: authority.label,
      path: relative(REPO_ROOT, authority.declaredPath),
      canonicalPath: realpathSync.native(authority.declaredPath),
      gitBlobOid: gitBlobOid(authority.declaredPath),
      expectedDigest: authority.expectedDigest,
      actualDigest,
      match: actualDigest === authority.expectedDigest,
    };
  } catch (error) {
    return {
      label: authority.label,
      path: relative(REPO_ROOT, authority.declaredPath),
      canonicalPath: null,
      gitBlobOid: null,
      expectedDigest: authority.expectedDigest,
      actualDigest: null,
      match: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const report = {
  format: REPORT_FORMAT,
  digestFormat: SAFE_PATTERN_DIGEST_FORMAT,
  typescriptVersion: ts.version,
  command: 'print-and-check-only',
  authorities: RUNTIME_DYNAMIC_LOADER_SAFE_PATTERN_AUTHORITIES.map(inspectAuthority),
};
const matches = report.authorities.every(({ match }) => match);

if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`${report.format} (${report.digestFormat}, TypeScript ${report.typescriptVersion})`);
  for (const authority of report.authorities) {
    console.log(`${authority.label}: ${authority.match ? 'match' : 'DRIFT'} ${resolve(REPO_ROOT, authority.path)}`);
    console.log(`  expected ${authority.expectedDigest}`);
    console.log(`  actual   ${authority.actualDigest ?? '<unavailable>'}`);
    console.log(`  git blob ${authority.gitBlobOid ?? '<unavailable>'}`);
  }
}

if (!matches) process.exitCode = 1;
