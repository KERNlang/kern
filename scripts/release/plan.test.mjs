import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadReleasePolicy } from './policy.mjs';
import { createReleasePlan, validateReleasePlan } from './plan.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const policyPath = path.join(repoRoot, 'scripts/release/release-policy.json');
const sha = '0123456789abcdef0123456789abcdef01234567';

test('stable ReleasePlan v1 is explicit, resolved, and dependency ordered', async () => {
  const policy = await loadReleasePolicy(policyPath);
  const plan = await createReleasePlan({
    rootDir: repoRoot,
    policy,
    channel: 'stable',
    version: '4.5.0',
    sha,
  });

  assert.equal(plan.planVersion, 1);
  assert.equal(plan.sha, sha);
  assert.equal(plan.channel, 'stable');
  assert.equal(plan.version, '4.5.0');
  assert.equal(plan.distTag, 'latest');
  assert.equal(plan.packages.length, 22);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.packages), true);
  assert.equal(Object.isFrozen(plan.packages[0]), true);
  assert.equal(Object.isFrozen(plan.packages[0].dependencies), true);
  assert.throws(() => plan.packages.push({ name: 'injected' }), TypeError);
  assert.throws(() => plan.packages[0].dependencies.push('injected'), TypeError);
  assert.ok(
    plan.packages.findIndex((pkg) => pkg.name === '@kernlang/core') <
      plan.packages.findIndex((pkg) => pkg.name === '@kernlang/cli'),
  );
});

test('canary ReleasePlan v1 is KERN 5 and explicit', async () => {
  const policy = await loadReleasePolicy(policyPath);
  const plan = await createReleasePlan({
    rootDir: repoRoot,
    policy,
    channel: 'canary',
    runNumber: '81',
    sha,
  });

  assert.equal(plan.version, '5.0.0-canary.81.g01234567');
  assert.equal(plan.distTag, 'canary');
  assert.doesNotThrow(() => validateReleasePlan(plan, policy));
});

test('plan validator kills unsafe release-plan mutations', async () => {
  const policy = await loadReleasePolicy(policyPath);
  const canary = await createReleasePlan({
    rootDir: repoRoot,
    policy,
    channel: 'canary',
    runNumber: '81',
    sha,
  });

  const mutations = [
    {
      name: 'prerelease mapped to latest',
      pattern: /latest/i,
      mutate(plan) {
        plan.distTag = 'latest';
      },
    },
    {
      name: 'canary mapped to another prerelease tag',
      pattern: /policy|dist-tag/i,
      mutate(plan) {
        plan.distTag = 'beta';
      },
    },
    {
      name: 'missing explicit tag',
      pattern: /dist-tag/i,
      mutate(plan) {
        delete plan.distTag;
      },
    },
    {
      name: 'unknown plan version',
      pattern: /plan version/i,
      mutate(plan) {
        plan.planVersion = 2;
      },
    },
    {
      name: 'branch ref replaces resolved SHA',
      pattern: /sha/i,
      mutate(plan) {
        plan.sha = 'main';
      },
    },
  ];

  for (const mutation of mutations) {
    const mutant = structuredClone(canary);
    mutation.mutate(mutant);
    assert.throws(
      () => validateReleasePlan(mutant, policy),
      mutation.pattern,
      `oracle failed to kill mutation: ${mutation.name}`,
    );
  }
});

test('package plan mutation cannot reorder a dependency after its consumer', async () => {
  const policy = await loadReleasePolicy(policyPath);
  const stable = await createReleasePlan({
    rootDir: repoRoot,
    policy,
    channel: 'stable',
    version: '4.5.0',
    sha,
  });
  const mutant = structuredClone(stable);
  const coreIndex = mutant.packages.findIndex((pkg) => pkg.name === '@kernlang/core');
  const cliIndex = mutant.packages.findIndex((pkg) => pkg.name === '@kernlang/cli');
  [mutant.packages[coreIndex], mutant.packages[cliIndex]] = [
    mutant.packages[cliIndex],
    mutant.packages[coreIndex],
  ];

  assert.throws(() => validateReleasePlan(mutant, policy), /package order|dependency/i);
});
