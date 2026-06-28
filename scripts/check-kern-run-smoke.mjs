#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = resolve(ROOT, 'packages/cli/dist/cli.js');
const FIXTURE = resolve(ROOT, 'examples/native-runtime-smoke.kern');
const EXPECTED_STDOUT = 'sum-ok\n0\n1\n20\nrag\nruntime\n';

if (!existsSync(CLI)) {
  console.error(`missing built CLI at ${CLI}; run pnpm --filter @kernlang/cli build first`);
  process.exit(2);
}

const result = spawnSync(process.execPath, [CLI, 'run', FIXTURE], {
  encoding: 'utf-8',
  cwd: ROOT,
  env: { ...process.env, NODE_NO_WARNINGS: '1' },
  timeout: 20000,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(2);
}

if (result.signal) {
  console.error(`kern run smoke was killed by signal ${result.signal}`);
  if (result.stderr) console.error(result.stderr);
  process.exit(2);
}

if (result.status !== 0) {
  console.error(`kern run smoke exited ${result.status}`);
  if (result.stderr) console.error(result.stderr);
  process.exit(1);
}

if (result.stderr) {
  console.error(`kern run smoke emitted unexpected stderr:\n${result.stderr}`);
  process.exit(1);
}

if (result.stdout !== EXPECTED_STDOUT) {
  console.error('kern run smoke stdout drifted');
  console.error(`expected:\n${EXPECTED_STDOUT}`);
  console.error(`actual:\n${result.stdout ?? ''}`);
  process.exit(1);
}

console.log('kern run smoke passed');
