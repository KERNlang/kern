#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveKernFormatterWallTimeoutMs } from './kern-formatter/wall-timeout-policy.mjs';

const CHECK = fileURLToPath(new URL('./check-kern-formatter.mjs', import.meta.url));

export function runKernFormatterWall({ checkPath, env, executable, now, spawn, timeoutMs }) {
  const options = { encoding: 'utf8', env };
  if (timeoutMs > 0) options.timeout = timeoutMs;

  const startedAt = now();
  const completed = spawn(executable, [checkPath], options);
  const elapsedMs = Math.max(0, now() - startedAt);

  if (completed.error?.code === 'ETIMEDOUT') {
    return {
      exitCode: 124,
      stderr: `KERN formatter corpus wall timed out: budget=${timeoutMs}ms elapsed=${elapsedMs}ms\n`,
      stdout: '',
    };
  }
  if (completed.error) {
    return {
      exitCode: 1,
      stderr: `KERN formatter corpus wall failed to start: ${completed.error.message}\n`,
      stdout: '',
    };
  }
  if (completed.status !== 0) {
    const childStatus = Number.isInteger(completed.status) ? completed.status : 1;
    const detail = completed.stderr || completed.stdout || '';
    return {
      exitCode: childStatus,
      stderr: `KERN formatter corpus wall failed (${String(completed.status)}): ${detail}`,
      stdout: '',
    };
  }
  if (completed.stderr !== '') {
    return {
      exitCode: 1,
      stderr: `KERN formatter corpus wall wrote stderr: ${completed.stderr}`,
      stdout: '',
    };
  }
  return { exitCode: 0, stderr: '', stdout: completed.stdout };
}

export function runKernFormatterWallCommand({
  env = process.env,
  executable = process.execPath,
  now = Date.now,
  spawn = spawnSync,
  stderr = process.stderr,
  stdout = process.stdout,
} = {}) {
  let timeoutMs;
  try {
    timeoutMs = resolveKernFormatterWallTimeoutMs(env);
  } catch (error) {
    stderr.write(`KERN formatter corpus wall configuration error: ${error.message}\n`);
    return 2;
  }

  const childEnv = { ...env };
  delete childEnv.KERN_FORMATTER_PROGRESS;
  const result = runKernFormatterWall({
    checkPath: CHECK,
    env: childEnv,
    executable,
    now,
    spawn,
    timeoutMs,
  });
  if (result.stdout !== '') stdout.write(result.stdout);
  if (result.stderr !== '') stderr.write(result.stderr);
  return result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runKernFormatterWallCommand();
}
