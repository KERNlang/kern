import { spawnSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { hasFlag, parseFlag } from '../shared.js';

export function runSidecarInstall(args: string[]): void {
  const outDir = resolve(parseFlag(args, '--outdir') || parseFlag(args, '--dir') || 'generated');
  const explicitRequirements = parseFlag(args, '--requirements');
  const requirements = explicitRequirements ? [resolve(explicitRequirements)] : findRequirementFiles(outDir);
  const python = parseFlag(args, '--python') || process.env.KERN_PYTHON || process.env.PYTHON || 'python3';
  const dryRun = hasFlag(args, '--dry-run');

  if (requirements.length === 0) {
    console.log(`No sidecar requirements found under: ${outDir}`);
    return;
  }

  const activeRequirements = requirements.filter((file) => existsSync(file) && readFileSync(file, 'utf-8').trim());
  if (activeRequirements.length === 0) {
    console.log(`No sidecar packages to install under: ${outDir}`);
    return;
  }

  const installArgs = ['-m', 'pip', 'install', ...activeRequirements.flatMap((file) => ['-r', file])];
  if (dryRun) {
    console.log([python, ...installArgs].join(' '));
    return;
  }

  const result = spawnSync(python, installArgs, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== null && result.status !== 0) {
    process.exit(result.status);
  }
  if (result.signal) {
    throw new Error(`pip install terminated by signal ${result.signal}`);
  }
}

function findRequirementFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === '.git') continue;
        stack.push(full);
      } else if (entry === 'kern-sidecar-requirements.txt' || entry === 'kern-python-requirements.txt') {
        files.push(full);
      }
    }
  }
  return files.sort();
}
