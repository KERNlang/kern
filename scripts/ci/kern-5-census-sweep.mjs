import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const RATCHET_PATH = resolve(ROOT, 'scripts/kern-5-admission-census/admitted.json');
const INFRASTRUCTURE_CODES = new Set(['probe-timeout', 'probe-overflow', 'probe-exit', 'probe-unparsable']);

export function fullSweepOptions(files, out, defaults) {
  return { files, jobs: defaults.jobs, out, timeoutMs: defaults.timeoutMs, update: false };
}

export function validateReport(report, ratchet, files) {
  if (report.completed !== files.length || report.total !== files.length || report.results.length !== files.length) {
    throw new Error(`census incomplete: completed=${report.completed} total=${report.total} tracked=${files.length}`);
  }
  const resultFiles = report.results.map((result) => result.file);
  if (new Set(resultFiles).size !== files.length || files.some((file) => !resultFiles.includes(file))) {
    throw new Error('census incomplete: report does not contain each tracked file exactly once');
  }
  const failures = report.results.filter((result) => INFRASTRUCTURE_CODES.has(result.code));
  if (failures.length > 0) throw new Error(`census infrastructure failure: ${failures.map((result) => result.file).join(', ')}`);
  const results = new Map(report.results.map((result) => [result.file, result]));
  const missing = ratchet.admitted.filter((row) => !results.get(row.file)?.admitted).map((row) => row.file);
  if (missing.length > 0) throw new Error(`census ratchet regression: ${missing.join(', ')}`);
  if (report.admittedCount < ratchet.admitted.length) {
    throw new Error(`census admitted count regressed: ${report.admittedCount} < ${ratchet.admitted.length}`);
  }
  return report;
}

export async function runCensusSweep() {
  const { DEFAULT_JOBS, DEFAULT_TIMEOUT_MS, sweep, trackedKernFiles } = await import(
    '../kern-5-admission-census/sweep.mjs'
  );
  const files = trackedKernFiles();
  const directory = await mkdtemp(join(tmpdir(), 'kern-5-ci-census-'));
  try {
    const reportPath = join(directory, 'admission.json');
    const report = await sweep(
      fullSweepOptions(files, reportPath, { jobs: DEFAULT_JOBS, timeoutMs: DEFAULT_TIMEOUT_MS }),
    );
    const ratchet = JSON.parse(await readFile(RATCHET_PATH, 'utf8'));
    return validateReport(report, ratchet, files);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await runCensusSweep();
  process.stderr.write(`CI census: ${report.admittedCount}/${report.total} admitted\n`);
}
