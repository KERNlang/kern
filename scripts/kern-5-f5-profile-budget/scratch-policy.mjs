import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

import { REPO_ROOT } from './support.mjs';

const F5_DIR = 'scripts/kern-frontend-f5-projection';
const F5_MODULES = ['worker.mjs', 'decoder.mjs', 'policy-validation.mjs'];
const LINKED_SIBLINGS = ['kern-frontend-f1', 'kern-frontend-f4-declarations'];
const LINKED_ROOTS = ['packages', 'examples'];

const roots = [];

export function disposeScratchRoots() {
  for (const root of roots) rmSync(root, { force: true, recursive: true });
  roots.length = 0;
}

// The worker resolves ./policy.json and ../../ against import.meta.url, so the F5 modules must
// be real copies inside the scratch tree while everything else is a link to the live repository.
export function scratchWorker(mutate) {
  const root = mkdtempSync(resolve(tmpdir(), 'kern-f5-budget-'));
  roots.push(root);
  for (const entry of LINKED_ROOTS) symlinkSync(resolve(REPO_ROOT, entry), join(root, entry));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const entry of LINKED_SIBLINGS) {
    symlinkSync(resolve(REPO_ROOT, 'scripts', entry), join(root, 'scripts', entry));
  }
  mkdirSync(join(root, F5_DIR), { recursive: true });
  for (const name of F5_MODULES) {
    cpSync(resolve(REPO_ROOT, F5_DIR, name), join(root, F5_DIR, name));
  }
  const policy = JSON.parse(readFileSync(resolve(REPO_ROOT, F5_DIR, 'policy.json'), 'utf8'));
  mutate(policy);
  writeFileSync(join(root, F5_DIR, 'policy.json'), `${JSON.stringify(policy, null, 2)}\n`);
  return { policy, url: pathToFileURL(join(root, F5_DIR, 'worker.mjs')).href };
}

export async function projectUnderScratchPolicy(modules, mutate) {
  const { policy, url } = scratchWorker(mutate);
  const { runProjection } = await import(url);
  return { policy, result: runProjection(modules) };
}
