import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CENSUS_DIR, CENSUS_FORMAT, CENSUS_LIMITS, ROOT, canonicalStringify } from './support.mjs';

export const DEFAULT_TIMEOUT_MS = 300_000;
export const DEFAULT_JOBS = 8;
export const PROBE = fileURLToPath(new URL('./probe-file.mjs', import.meta.url));
const CHILD_MAX_BYTES = 4_000_000;
const STDERR_MAX_BYTES = 480;

// A half-written report is indistinguishable from a truthful one, so every write lands by rename.
export function writeAtomic(path, text) {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, text, { flag: 'wx' });
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {}
    throw error;
  }
}

export function ratchetRefusals(results, whitelist, { allowShrink = false } = {}) {
  const refusals = [];
  const incomplete = results.filter((result) => result.stage === 'timeout' || result.stage === 'probe');
  if (incomplete.length > 0) {
    const named = incomplete.slice(0, 5).map((result) => `${result.file} (${result.code})`).join(', ');
    refusals.push(`${incomplete.length} probe(s) did not complete cleanly: ${named}`);
  }
  const admitted = new Set(results.filter((result) => result.admitted).map((result) => result.file));
  const regressed = whitelist.filter((file) => !admitted.has(file));
  if (regressed.length > 0) refusals.push(`whitelisted file(s) no longer admit: ${regressed.join(', ')}`);
  if (!allowShrink && admitted.size < whitelist.length) {
    refusals.push(
      `the ratchet may only grow: ${admitted.size} admitted against ${whitelist.length} whitelisted ` +
        '(pass --allow-shrink to record a deliberate shrink)',
    );
  }
  return refusals;
}

export function corpusInvariantFailures(results, whitelist) {
  const incomplete = results.filter((result) => result.stage === 'timeout' || result.stage === 'probe');
  const admitted = results.filter((result) => result.admitted).map((result) => result.file).sort();
  const expected = [...whitelist].sort();
  const failures = [];
  const extra = admitted.filter((file) => !expected.includes(file));
  const missing = expected.filter((file) => !admitted.includes(file));
  if (incomplete.length > 0) {
    const named = incomplete.slice(0, 5).map((result) => `${result.file} (${result.code})`).join(', ');
    failures.push(`${incomplete.length} probe(s) did not complete cleanly: ${named}`);
  }
  if (extra.length > 0) failures.push(`admitted but not whitelisted: ${extra.join(', ')}`);
  if (missing.length > 0) failures.push(`whitelisted but not admitted: ${missing.join(', ')}`);
  return failures;
}

// Synchronous on purpose: the CLI reads this after the sweep resolves, where an accidental
// promise would read as an empty whitelist instead of failing.
export function whitelistFiles() {
  const ratchet = JSON.parse(readFileSync(resolve(CENSUS_DIR, 'admitted.json'), 'utf8'));
  if (!Array.isArray(ratchet.admitted)) throw new TypeError('admitted.json must carry an admitted array');
  return ratchet.admitted.map((row) => row.file);
}

export function parseArguments(argv) {
  const options = {
    files: undefined,
    allowShrink: false,
    jobs: DEFAULT_JOBS,
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
    if (argument === '--allow-shrink') {
      options.allowShrink = true;
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
    if (argument === '--jobs') {
      options.jobs = Number(next);
      index += 1;
      continue;
    }
    throw new Error(`unknown census option: ${argument}`);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout must be a positive integer of milliseconds');
  }
  if (!Number.isInteger(options.jobs) || options.jobs <= 0) throw new Error('--jobs must be a positive integer');
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
  return new Promise((settle) => {
    const child = spawn(process.execPath, [PROBE, file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let overflowed = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (stdout.length + chunk.length > CHILD_MAX_BYTES) {
        overflowed = true;
        child.kill('SIGKILL');
        return;
      }
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < STDERR_MAX_BYTES) stderr += chunk;
    });
    child.on('error', () => {});
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        settle({ admitted: false, code: 'probe-timeout', file, stage: 'timeout', timedOut: true, timeoutMs });
        return;
      }
      if (overflowed) {
        settle({ admitted: false, code: 'probe-overflow', file, stage: 'probe' });
        return;
      }
      if (code !== 0) {
        settle({
          admitted: false,
          code: 'probe-exit',
          detail: `${code}: ${stderr.slice(0, STDERR_MAX_BYTES)}`,
          file,
          stage: 'probe',
        });
        return;
      }
      const line = stdout.trimEnd().split('\n').at(-1);
      try {
        settle(JSON.parse(line));
      } catch {
        settle({ admitted: false, code: 'probe-unparsable', file, stage: 'probe' });
      }
    });
  });
}

function report(files, slots, completed, timeoutMs) {
  const results = slots.filter((slot) => slot !== undefined);
  const admitted = results.filter((result) => result.admitted);
  return {
    admitted: admitted.map((result) => result.file),
    admittedCount: admitted.length,
    completed,
    format: CENSUS_FORMAT,
    generatedBy: 'scripts/kern-5-admission-census/sweep.mjs',
    limits: CENSUS_LIMITS,
    results,
    timeoutMs,
    total: files.length,
  };
}

function ratchet(slots) {
  return {
    admitted: slots
      .filter((slot) => slot?.admitted)
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

export async function sweep(options, log = (line) => process.stderr.write(line)) {
  const files = options.files ?? trackedKernFiles();
  const jobs = Math.min(options.jobs ?? 1, Math.max(files.length, 1));
  const slots = new Array(files.length).fill(undefined);
  let completed = 0;
  let next = 0;
  writeAtomic(options.out, canonicalStringify(report(files, slots, completed, options.timeoutMs)));
  async function worker() {
    while (next < files.length) {
      const index = next;
      next += 1;
      const file = files[index];
      const result = await probeOne(file, options.timeoutMs);
      slots[index] = result;
      completed += 1;
      writeAtomic(options.out, canonicalStringify(report(files, slots, completed, options.timeoutMs)));
      const verdict = result.admitted ? `ADMITTED ${result.handlerName}` : `rejected ${result.stage}/${result.code}`;
      log(`[${completed}/${files.length}] ${file} ${verdict}\n`);
    }
  }
  await Promise.all(Array.from({ length: jobs }, () => worker()));
  const final = report(files, slots, completed, options.timeoutMs);
  if (options.update) {
    const refusals = ratchetRefusals(final.results, whitelistFiles(), options);
    if (refusals.length > 0) return { ...final, refusals, updated: false };
    writeAtomic(resolve(CENSUS_DIR, 'admitted.json'), canonicalStringify(ratchet(slots)));
    return { ...final, refusals: [], updated: true };
  }
  return final;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const final = await sweep(options);
  process.stderr.write(`census: ${final.admittedCount}/${final.total} admitted\n`);
  if (options.update && !final.updated) {
    for (const refusal of final.refusals) process.stderr.write(`census: refusing --update: ${refusal}\n`);
    process.exitCode = 1;
  } else if (options.files === undefined) {
    // The corpus-wide invariant: the sweep is the only place the whole admitted set is knowable.
    const failures = corpusInvariantFailures(final.results, whitelistFiles());
    for (const failure of failures) process.stderr.write(`census: corpus invariant violated: ${failure}\n`);
    if (failures.length > 0) process.exitCode = 1;
  }
}
