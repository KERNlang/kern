#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHECK = fileURLToPath(new URL('./check-kern-formatter.mjs', import.meta.url));
const env = { ...process.env };
delete env.KERN_FORMATTER_PROGRESS;
const completed = spawnSync(process.execPath, [CHECK], { encoding: 'utf8', env, timeout: 300_000 });
if (completed.error) throw completed.error;
if (completed.status !== 0) {
  throw new Error(`KERN formatter corpus wall failed (${completed.status}): ${completed.stderr || completed.stdout}`);
}
if (completed.stderr !== '') throw new Error(`KERN formatter corpus wall wrote stderr: ${completed.stderr}`);
process.stdout.write(completed.stdout);
