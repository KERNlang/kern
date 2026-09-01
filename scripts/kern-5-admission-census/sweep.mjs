import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CENSUS_DIR, CENSUS_FORMAT, CENSUS_LIMITS, ROOT, canonicalStringify } from './support.mjs';

export const DEFAULT_TIMEOUT_MS = 120_000;
export const PROBE = fileURLToPath(new URL('./probe-file.mjs', import.meta.url));
const CHILD_MAX_BYTES = 4_000_000;

export function parseArguments(argv) {
  const options = {
    files: undefined,
    out: resolve(CENSUS_DIR, 'admission.json'),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    update: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--update') {
      options.update = true;
      continue;
    }
    const next = argv[index + 1];
    if (argument === '--files') {
      options.files = next.split(',').filter((item) => item.length > 0);
      index += 1;
      continue;
    }
    if (argument === '--out') {
      options.out = resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (argument === '--timeout') {
      options.timeoutMs = Number(next);
      index += 1;
      continue;
    }
    throw new Error(`unknown census option: ${argument}`);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout must be a positive integer of milliseconds');
  }
  if (options.update && options.files !== undefined) {
    throw new Error('--update rewrites the ratchet and therefore requires the complete tracked sweep');
  }
  return options;
}

export function trackedKernFiles() {
  const listed = spawnSync('git', ['ls-files', '*.kern'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: CHILD_MAX_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  return listed.stdout.split('\n').filter((line) => line.length > 0);
}

export function probeOne(file, timeoutMs) {
  const run = spawnSync(process.execPath, [PROBE, file], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: CHILD_MAX_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
  if (run.signal !== null || run.error?.code === 'ETIMEDOUT') {
    return { admitted: false, code: 'probe-timeout', file, stage: 'timeout', timedOut: true, timeoutMs };
  }
  if (run.status !== 0) {
    return {
      admitted: false,
      code: 'probe-exit',
      detail: `${run.status}: ${run.stderr.slice(0, 480)}`,
      file,
      stage: 'probe',
    };
  }
  const line = run.stdout.trimEnd().split('\n').at(-1);
  try {
    return JSON.parse(line);
  } catch {
    return { admitted: false, code: 'probe-unparsable', file, stage: 'probe' };
  }
}

function report(files, results, timeoutMs) {
  const admitted = results.filter((result) => result.admitted);
  return {
    admitted: admitted.map((result) => result.file),
    admittedCount: admitted.length,
    completed: results.length,
    format: CENSUS_FORMAT,
    generatedBy: 'scripts/kern-5-admission-census/sweep.mjs',
    limits: CENSUS_LIMITS,
    results,
    timeoutMs,
    total: files.length,
  };
}

function ratchet(results) {
  return {
    admitted: results
      .filter((result) => result.admitted)
      .map((result) => ({
        envelopeDigest: result.envelopeDigest,
        eventCount: result.eventCount,
        file: result.file,
        handlerName: result.handlerName,
        linkedProgramSha256: result.linkedProgramSha256,
        projectionArtifactSha256: result.projectionArtifactSha256,
        resultPresence: result.resultPresence,
      }))
      .sort((left, right) => (left.file < right.file ? -1 : 1)),
    format: CENSUS_FORMAT,
    limits: CENSUS_LIMITS,
  };
}

export function sweep(options, log = (line) => process.stderr.write(line)) {
  const files = options.files ?? trackedKernFiles();
  const results = [];
  writeFileSync(options.out, canonicalStringify(report(files, results, options.timeoutMs)));
  for (const [index, file] of files.entries()) {
    const result = probeOne(file, options.timeoutMs);
    results.push(result);
    writeFileSync(options.out, canonicalStringify(report(files, results, options.timeoutMs)));
    const verdict = result.admitted ? `ADMITTED ${result.handlerName}` : `rejected ${result.stage}/${result.code}`;
    log(`[${index + 1}/${files.length}] ${file} ${verdict}\n`);
  }
  if (options.update) {
    writeFileSync(resolve(CENSUS_DIR, 'admitted.json'), canonicalStringify(ratchet(results)));
  }
  return report(files, results, options.timeoutMs);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const final = sweep(options);
  process.stderr.write(`census: ${final.admittedCount}/${final.total} admitted\n`);
}
