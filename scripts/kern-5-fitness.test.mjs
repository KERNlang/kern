import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadKern5FitnessContract,
  runKern5Fitness,
  validateKern5FitnessContract,
  validateKern5FitnessPolicy,
  validateKern5RemainingGates,
} from './kern-5-fitness.mjs';

const policy = JSON.parse(readFileSync('scripts/kern-5-fitness-policy.json', 'utf8'));
const remainingGates = JSON.parse(readFileSync('scripts/kern-5-remaining-gates-v1.json', 'utf8'));
const matrixText = readFileSync('docs/kern-5-support-matrix.md', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const remainingGatesPath = 'scripts/kern-5-remaining-gates-v1.json';
const terminalGateIds = [
  'kern-checker',
  'kern-formatter',
  'kern-frontend',
  'kern-compiler',
  'selfhost-fixed-point',
  'kern-interpreter-shadow',
  'kern-canonical-cutover',
  'packed-release',
];

function validate(overrides = {}) {
  return validateKern5FitnessContract({
    policy: overrides.policy ?? structuredClone(policy),
    remainingGates: overrides.remainingGates ?? structuredClone(remainingGates),
    matrixText: overrides.matrixText ?? matrixText,
    packageJson: overrides.packageJson ?? structuredClone(packageJson),
  });
}

function currentFrontendScripts(gates = policy.gates) {
  return gates
    .filter(
      (gate) =>
        gate.status === 'current' &&
        gate.argv[0] === 'pnpm' &&
        (gate.id === 'kern-frontend' || gate.id.startsWith('kern-frontend-')),
    )
    .map((gate) => gate.argv[1]);
}

test('Phase 0 declares the complete terminal gate suffix and versioned ledger', () => {
  assert.ok(existsSync(remainingGatesPath), `${remainingGatesPath} must exist`);
  assert.deepEqual(
    policy.gates.slice(-terminalGateIds.length).map((gate) => gate.id),
    terminalGateIds,
  );
  assert.equal(policy.gates.filter((gate) => gate.status === 'current').length, 53);
  assert.equal(policy.gates.filter((gate) => gate.status === 'planned').length, 6);
  assert.deepEqual(
    remainingGates.terminalGates.map((gate) => gate.id),
    terminalGateIds,
  );
});

test('remaining-gate ledger rejects category, roster, baseline, and evidence drift', () => {
  const cases = [
    {
      name: 'category order',
      mutate(copy) {
        [copy.contractCategories[0], copy.contractCategories[1]] = [
          copy.contractCategories[1],
          copy.contractCategories[0],
        ];
      },
      error: /contract categories must be exactly/i,
    },
    {
      name: 'unknown row category',
      mutate(copy) {
        copy.terminalGates[0].categories[0] = 'ast';
      },
      error: /kern-checker.*unknown contract category.*ast/i,
    },
    {
      name: 'duplicate row category',
      mutate(copy) {
        copy.terminalGates[0].categories.splice(1, 0, copy.terminalGates[0].categories[0]);
      },
      error: /kern-checker.*unique.*global order/i,
    },
    {
      name: 'missing global category coverage',
      mutate(copy) {
        for (const gate of copy.terminalGates) {
          gate.categories = gate.categories.filter((category) => category !== 'traces');
        }
      },
      error: /cover every contract category/i,
    },
    {
      name: 'terminal order',
      mutate(copy) {
        [copy.terminalGates[0], copy.terminalGates[1]] = [copy.terminalGates[1], copy.terminalGates[0]];
      },
      error: /terminal gates must be exactly/i,
    },
    {
      name: 'baseline drift',
      mutate(copy) {
        copy.baseline.originMain = copy.baseline.m4171Implementation;
      },
      error: /originMain must be bc168288/i,
    },
    {
      name: 'unapproved evidence',
      mutate(copy) {
        copy.terminalGates[0].evidence = ['tmp/local-claim.md'];
      },
      error: /kern-checker.*unapproved completion evidence/i,
    },
    {
      name: 'duplicate evidence',
      mutate(copy) {
        copy.terminalGates[0].evidence.push(copy.terminalGates[0].evidence[0]);
      },
      error: /kern-checker.*duplicate completion evidence/i,
    },
  ];
  for (const fixture of cases) {
    const copy = structuredClone(remainingGates);
    fixture.mutate(copy);
    assert.throws(() => validateKern5RemainingGates(copy), fixture.error, fixture.name);
  }
});

test('remaining-gate evidence resolves to tracked accepted contract artifacts', () => {
  const evidence = [...new Set(remainingGates.terminalGates.flatMap((gate) => gate.evidence))];
  for (const evidencePath of evidence) {
    assert.ok(existsSync(evidencePath), `${evidencePath} must exist`);
    execFileSync('git', ['ls-files', '--error-unmatch', evidencePath], { stdio: 'ignore' });
  }
});

test('default contract loading is independent from the caller working directory', () => {
  const originalCwd = process.cwd();
  try {
    process.chdir('scripts');
    assert.equal(loadKern5FitnessContract().currentGates.length, 53);
  } finally {
    process.chdir(originalCwd);
  }
});

test('policy and ledger bind terminal id, order, status, and argv', () => {
  const cases = [
    {
      name: 'status drift',
      ledger: true,
      mutate(copy) {
        copy.terminalGates.at(-1).status = 'current';
      },
      error: /completion ledger disagree.*packed-release/i,
    },
    {
      name: 'argv drift',
      ledger: true,
      mutate(copy) {
        copy.terminalGates.at(-1).argv = ['pnpm', 'test:kern-frontend'];
      },
      error: /completion ledger disagree.*packed-release/i,
    },
    {
      name: 'order drift',
      mutate(copy) {
        const start = copy.gates.length - terminalGateIds.length;
        [copy.gates[start], copy.gates[start + 1]] = [copy.gates[start + 1], copy.gates[start]];
      },
      error: /completion ledger disagree.*kern-checker/i,
    },
  ];
  for (const fixture of cases) {
    const copy = structuredClone(fixture.ledger ? remainingGates : policy);
    fixture.mutate(copy);
    const overrides = fixture.ledger ? { remainingGates: copy } : { policy: copy };
    assert.throws(() => validate(overrides), fixture.error, fixture.name);
  }
});

test('planned terminal gates have no root scripts while promoted terminal gates execute', () => {
  const contract = validate();
  assert.equal(contract.currentGates.length, 53);
  assert.deepEqual(
    contract.currentGates.filter((gate) => terminalGateIds.includes(gate.id)),
    [
      { id: 'kern-checker', label: 'Production KERN checker', status: 'current', argv: ['pnpm', 'test:kern-checker'] },
      {
        id: 'kern-formatter',
        label: 'Trivia-preserving KERN formatter',
        status: 'current',
        argv: ['pnpm', 'test:kern-formatter'],
      },
    ],
  );
  for (const gate of remainingGates.terminalGates.filter((candidate) => candidate.status === 'planned')) {
    assert.equal(packageJson.scripts[gate.argv[1]], undefined, `${gate.argv[1]} must remain absent`);
    const premature = structuredClone(packageJson);
    premature.scripts[gate.argv[1]] = 'node placeholder.mjs';
    assert.throws(() => validate({ packageJson: premature }), new RegExp(`planned gate ${gate.id}`, 'i'));
  }
});

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
      'internal-decoded-module-kir-binding',
      'kir-runner-composed-evidence',
      'kir-coverage-closure',
      'kir-evidence',
      'kir-alpha-receipt',
      'internal-runtime-envelope',
      'diff-hygiene',
      'kir-v1',
      'runtime-handler-abi',
      'runtime-contract-v1',
      'core-runtime-internalization',
      'source-runner-convergence',
      'kern-kir-canonicalizer',
      'kern-frontend-tokenizer-shadow',
      'kern-frontend-stitch-shadow',
      'kern-frontend-indentation-shadow',
      'kern-frontend-lexical-shadow',
      'kern-frontend-comment-boundary-shadow',
      'kern-frontend-whitespace-trim-shadow',
      'kern-frontend-retained-token-stream-shadow',
      'kern-frontend-node-type-token-admission-shadow',
      'kern-frontend-builtin-node-type-attestation-shadow',
      'kern-frontend-mutable-node-type-registry-snapshot-shadow',
      'kern-frontend-known-node-warning-shadow',
      'kern-frontend-generic-property-admission-shadow',
      'kern-frontend-generic-property-loop-shadow',
      'kern-frontend-generic-property-theme-refs-shadow',
      'kern-frontend-generic-property-style-theme',
      'kern-frontend-generic-property-style-theme-diagnostics',
      'kern-frontend-evolved-hints',
      'kern-frontend-keyword-handlers',
      'kern-frontend-successful-line-composition',
      'kern-frontend-surface-closure',
      'kern-checker',
      'kern-formatter',
    ],
  );
});

test('test:infra executes every current frontend fitness gate', () => {
  const frontendScripts = currentFrontendScripts();
  const infraSegments = packageJson.scripts['test:infra'].split(' && ').map((segment) => segment.trim());
  let previousIndex = -1;

  for (const script of frontendScripts) {
    const index = infraSegments.indexOf(`pnpm ${script}`);
    assert.ok(index >= 0, `test:infra must execute ${script}`);
    assert.ok(index > previousIndex, `test:infra must execute ${script} in policy order`);
    previousIndex = index;
  }
});

test('frontend fitness classification includes the terminal frontend gate', () => {
  const future = structuredClone(policy.gates);
  future.find((gate) => gate.id === 'kern-frontend').status = 'current';
  assert.ok(currentFrontendScripts(future).includes('test:kern-frontend'));
});

test('matrix mutations fail with the affected gate or ownership id', () => {
  const cases = [
    {
      name: 'changed gate status',
      text: matrixText.replace(
        '| kir-v1 | Versioned canonical KIR | current |',
        '| kir-v1 | Versioned canonical KIR | planned |',
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
      name: 'missing bounded canonicalizer receipt',
      text: matrixText.replace(/^\| kern-kir-canonicalizer-profile \|.*\n/mu, ''),
      error: /kern-kir-canonicalizer-profile/i,
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

test('current scripts must exist and match their promoted policy', () => {
  const missingCurrent = structuredClone(packageJson);
  delete missingCurrent.scripts.lint;
  assert.throws(() => validate({ packageJson: missingCurrent }), /current gate lint.*root script lint/i);

  const missingKirV1 = structuredClone(packageJson);
  delete missingKirV1.scripts['test:kern-ir'];
  assert.throws(() => validate({ packageJson: missingKirV1 }), /script test:kern-ir.*fitness policy/i);
});

test('entrypoint scripts must exactly match policy', () => {
  const mutated = structuredClone(packageJson);
  mutated.scripts['fitness:kern-5'] = 'pnpm test:runner-smoke';
  assert.throws(() => validate({ packageJson: mutated }), /fitness:kern-5.*exactly match/i);
});

test('runtime ABI gate keeps every public handler entry and helper-link oracle', () => {
  const runtimeAbi = packageJson.scripts['test:runtime-abi'];
  assert.match(
    runtimeAbi,
    /runtime-handler-\(public\|helper-link\)/u,
    'test:runtime-abi must select the public-handler prefix and helper-link oracle',
  );
  assert.ok(
    readdirSync(new URL('../packages/core/tests/', import.meta.url)).some((name) =>
      /^runtime-handler-helper-link.*\.test\.ts$/u.test(name),
    ),
    'test:runtime-abi helper-link selector must match a real test file',
  );
});

test('runtime contract v1 gate executes both candidate and rejection-effects evidence', () => {
  const runtimeContract = packageJson.scripts['test:kern-runtime-contract-v1'];
  assert.match(runtimeContract, /packages\/core\/tests\/runtime-contract-v1-candidate\.test\.mjs/u);
  assert.match(runtimeContract, /packages\/core\/tests\/runtime-contract-v1-effects\.test\.mjs/u);
  assert.equal(policy.entrypoints['test:kern-runtime-contract-v1'], runtimeContract);
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
