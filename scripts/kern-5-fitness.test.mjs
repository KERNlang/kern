import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadKern5FitnessContract,
  runKern5Fitness,
  validateKern5FitnessContract,
  validateKern5FitnessPolicy,
} from './kern-5-fitness.mjs';

const policy = JSON.parse(readFileSync('scripts/kern-5-fitness-policy.json', 'utf8'));
const matrixText = readFileSync('docs/kern-5-support-matrix.md', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

function validate(overrides = {}) {
  return validateKern5FitnessContract({
    policy: overrides.policy ?? structuredClone(policy),
    matrixText: overrides.matrixText ?? matrixText,
    packageJson: overrides.packageJson ?? structuredClone(packageJson),
  });
}

test('current KERN 5 policy, matrix, and root scripts form one exact contract', () => {
  const contract = loadKern5FitnessContract();
  assert.deepEqual(
    contract.currentGates.map((gate) => gate.id),
    [
      'repo-consistency',
      'lint',
      'build',
      'workspace-tests',
      'cross-target-conformance',
      'native-kern',
      'runner-smoke',
      'app-behavior',
      'drift-showcase',
      'browser-budget',
      'kir-seam-probe',
      'kir-reader-candidate',
      'semantic-ownership-proof',
      'kir-v1-eligibility',
      'canonical-value-reader',
      'kir-structural-constitution',
      'kir-structural-codec',
      'kir-module-graph',
      'kir-coverage-closure',
      'kir-evidence',
      'kir-alpha-receipt',
      'internal-runtime-envelope',
      'diff-hygiene',
      'runtime-handler-abi',
      'core-runtime-internalization',
    ],
  );
});

test('matrix mutations fail with the affected gate or ownership id', () => {
  const cases = [
    {
      name: 'changed gate status',
      text: matrixText.replace(
        '| kir-v1 | Versioned canonical KIR | planned |',
        '| kir-v1 | Versioned canonical KIR | current |',
      ),
      error: /kir-v1/i,
    },
    {
      name: 'missing gate',
      text: matrixText.replace(/^\| packed-release \|.*\n/mu, ''),
      error: /packed-release/i,
    },
    {
      name: 'reordered gate',
      text: matrixText.replace(/^(\| lint \|.*\n)(\| build \|.*\n)/mu, '$2$1'),
      error: /lint/i,
    },
    {
      name: 'changed ownership evidence',
      text: matrixText.replace(
        '| checker-v2 | Checker v2 and production shadow | internal-oracle | `pnpm test:capstone-checker-subset` |',
        '| checker-v2 | Checker v2 and production shadow | internal-oracle | shipped |',
      ),
      error: /checker-v2/i,
    },
    {
      name: 'missing ownership row',
      text: matrixText.replace(/^\| kern-formatter \|.*\n/mu, ''),
      error: /kern-formatter/i,
    },
  ];
  for (const fixture of cases) {
    assert.throws(() => validate({ matrixText: fixture.text }), fixture.error, fixture.name);
  }
});

test('policy rejects unknown status, duplicate id, unsafe argv, and missing evidence', () => {
  const cases = [
    {
      name: 'unknown gate status',
      mutate(copy) {
        copy.gates[0].status = 'partial';
      },
      error: /repo-consistency.*partial/i,
    },
    {
      name: 'duplicate gate id',
      mutate(copy) {
        copy.gates[1].id = copy.gates[0].id;
      },
      error: /duplicate.*repo-consistency/i,
    },
    {
      name: 'no current gate',
      mutate(copy) {
        for (const gate of copy.gates) gate.status = 'planned';
      },
      error: /at least one current gate/i,
    },
    {
      name: 'unsafe argv',
      mutate(copy) {
        copy.gates[0].argv = ['sh', '-c', 'pnpm test'];
      },
      error: /argv.*pnpm.*git diff/i,
    },
    {
      name: 'missing evidence',
      mutate(copy) {
        copy.ownership[0].evidence = '';
      },
      error: /ownership\[0\]\.evidence/i,
    },
  ];
  for (const fixture of cases) {
    const copy = structuredClone(policy);
    fixture.mutate(copy);
    assert.throws(() => validateKern5FitnessPolicy(copy), fixture.error, fixture.name);
  }
});

test('current scripts must exist and planned scripts cannot appear early', () => {
  const missingCurrent = structuredClone(packageJson);
  delete missingCurrent.scripts.lint;
  assert.throws(() => validate({ packageJson: missingCurrent }), /current gate lint.*root script lint/i);

  const prematurePlanned = structuredClone(packageJson);
  prematurePlanned.scripts['test:kern-ir'] = 'node fake-kir-proof.mjs';
  assert.throws(() => validate({ packageJson: prematurePlanned }), /planned gate kir-v1.*promote/i);
});

test('entrypoint scripts must exactly match policy', () => {
  const mutated = structuredClone(packageJson);
  mutated.scripts['fitness:kern-5'] = 'pnpm test:runner-smoke';
  assert.throws(() => validate({ packageJson: mutated }), /fitness:kern-5.*exactly match/i);
});

test('aggregate uses argv without a shell, preserves order, and stops at first failure', () => {
  const calls = [];
  const currentGates = policy.gates.filter((gate) => gate.status === 'current').slice(0, 3);
  assert.throws(
    () =>
      runKern5Fitness({
        currentGates,
        rootDir: '/repo',
        spawn(command, args, options) {
          calls.push({ command, args, options });
          return { status: calls.length === 2 ? 7 : 0, signal: null };
        },
      }),
    /gate lint failed with status 7/i,
  );
  assert.deepEqual(
    calls.map((call) => [call.command, ...call.args]),
    currentGates.slice(0, 2).map((gate) => gate.argv),
  );
  assert.ok(calls.every((call) => call.options.shell === false && call.options.cwd === '/repo'));
});

test('aggregate treats a child signal as failure', () => {
  assert.throws(
    () =>
      runKern5Fitness({
        currentGates: [policy.gates[0]],
        spawn: () => ({ status: null, signal: 'SIGTERM' }),
      }),
    /signal SIGTERM/i,
  );
});
