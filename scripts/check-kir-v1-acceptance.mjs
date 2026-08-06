#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { stringifyCanonical } from './release/artifact-types.mjs';
import { validateKirV1AcceptancePolicy } from './kir-v1/acceptance-manifest.mjs';

const ACCEPTANCE_ROOT = 'scripts/kir-v1/acceptance';
const SHA = /^[0-9a-f]{40}$/u;

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim();
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly ${expected.join(',')}`);
  }
}

function validateManifestShape(manifest, policy, manifestPath) {
  exactKeys(
    manifest,
    ['acceptedCommitSha', 'bindings', 'exclusions', 'format', 'oracles', 'policySha256', 'status'],
    manifestPath,
  );
  if (!SHA.test(manifest.acceptedCommitSha)) throw new Error(`${manifestPath} has invalid acceptedCommitSha`);
  if (manifest.format !== policy.format) throw new Error(`${manifestPath} format differs from policy`);
  if (JSON.stringify(manifest.exclusions) !== JSON.stringify(policy.exclusions)) {
    throw new Error(`${manifestPath} exclusions differ from policy`);
  }
  if (JSON.stringify(manifest.status) !== JSON.stringify(policy.status)) {
    throw new Error(`${manifestPath} status differs from policy`);
  }
  if (!Array.isArray(manifest.bindings) || manifest.bindings.length !== policy.bindings.length) {
    throw new Error(`${manifestPath} binding count differs from policy`);
  }
  manifest.bindings.forEach((binding, index) => {
    exactKeys(binding, ['path', 'sha256'], `${manifestPath}.bindings[${index}]`);
    if (binding.path !== policy.bindings[index] || !/^[0-9a-f]{64}$/u.test(binding.sha256)) {
      throw new Error(`${manifestPath} binding ${index} differs from policy`);
    }
  });
  if (!Array.isArray(manifest.oracles) || manifest.oracles.length !== policy.oracles.length) {
    throw new Error(`${manifestPath} oracle count differs from policy`);
  }
  manifest.oracles.forEach((oracle, index) => {
    exactKeys(oracle, ['argv', 'id', 'status'], `${manifestPath}.oracles[${index}]`);
    const expected = policy.oracles[index];
    if (oracle.id !== expected.id || oracle.status !== 'passed' || JSON.stringify(oracle.argv) !== JSON.stringify(expected.argv)) {
      throw new Error(`${manifestPath} oracle ${index} differs from policy`);
    }
  });
}

export function runKirV1AcceptanceCheck() {
  const policy = validateKirV1AcceptancePolicy(
    JSON.parse(readFileSync('scripts/kir-v1/acceptance-policy.json', 'utf8')),
  );
  if (!existsSync(ACCEPTANCE_ROOT)) throw new Error('KIR v1 requires a committed acceptance manifest directory');
  const names = readdirSync(ACCEPTANCE_ROOT).filter((name) => name.endsWith('.json')).sort();
  if (names.length === 0) throw new Error('KIR v1 requires at least one committed acceptance manifest');
  for (const name of names) {
    if (!/^[0-9a-f]{40}\.json$/u.test(name)) throw new Error(`invalid acceptance manifest name ${name}`);
    const manifestPath = path.posix.join(ACCEPTANCE_ROOT, name);
    const bytes = readFileSync(manifestPath);
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (!bytes.equals(Buffer.from(stringifyCanonical(manifest), 'utf8'))) {
      throw new Error(`${manifestPath} is not canonical JSON`);
    }
    validateManifestShape(manifest, policy, manifestPath);
    if (name !== `${manifest.acceptedCommitSha}.json`) throw new Error(`${manifestPath} name does not match accepted SHA`);
    git(['cat-file', '-e', `${manifest.acceptedCommitSha}^{commit}`]);
    if (git(['merge-base', '--is-ancestor', manifest.acceptedCommitSha, 'HEAD']) !== '') {
      throw new Error(`${manifestPath} accepted commit is not an ancestor`);
    }
    for (const binding of manifest.bindings) {
      const committed = execFileSync('git', ['show', `${manifest.acceptedCommitSha}:${binding.path}`], { maxBuffer: 16 * 1024 * 1024 });
      if (digest(committed) !== binding.sha256) throw new Error(`${manifestPath} historical binding drifted: ${binding.path}`);
      if (digest(readFileSync(binding.path)) !== binding.sha256) {
        throw new Error(`${manifestPath} frozen authority changed without v2: ${binding.path}`);
      }
    }
    const policyBinding = manifest.bindings.find(({ path: bindingPath }) => bindingPath === 'scripts/kir-v1/acceptance-policy.json');
    if (manifest.policySha256 !== policyBinding?.sha256) throw new Error(`${manifestPath} policySha256 mismatch`);
    const introduction = git(['log', '--diff-filter=A', '--format=%H', '--', manifestPath]).split('\n').filter(Boolean).at(-1);
    if (!introduction) throw new Error(`${manifestPath} is not committed`);
    const parents = git(['show', '-s', '--format=%P', introduction]).split(' ').filter(Boolean);
    if (parents.length !== 1 || parents[0] !== manifest.acceptedCommitSha) {
      throw new Error(`${manifestPath} must be introduced by the direct child of its accepted commit`);
    }
    const changed = git(['diff', '--name-only', manifest.acceptedCommitSha, introduction]).split('\n').filter(Boolean);
    if (changed.length !== 1 || changed[0] !== manifestPath) {
      throw new Error(`${manifestPath} acceptance commit must add only its manifest`);
    }
  }
  process.stdout.write(`KIR v1 acceptance: PASS (${names.length} immutable manifest${names.length === 1 ? '' : 's'}).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runKirV1AcceptanceCheck();
