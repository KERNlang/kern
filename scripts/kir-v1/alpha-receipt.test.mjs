import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ALPHA_RECEIPT_AUTHORITY_BINDINGS,
  discoverRuntimeContractCoreTestBindings,
  discoverRuntimeContractDirectoryBindings,
  generateAlphaReceipt,
  KIR_RUNTIME_BINDING_RECEIPT_BINDINGS,
  RUNTIME_CONTRACT_CORE_TEST_BINDINGS,
  RUNTIME_CONTRACT_DIRECTORY_BINDINGS,
  RUNTIME_CONTRACT_RECEIPT_BINDINGS,
  validateAlphaReceiptBindings,
  validateAlphaReceiptPolicy,
} from './alpha-receipt.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAFE_PATTERN_RECEIPT_BINDINGS = Object.freeze([
  'scripts/runtime-contract-v1/SAFE_PATTERN_AUTHORITY.md',
  'scripts/runtime-contract-v1/check-runtime-dynamic-loader-safe-patterns.mjs',
  'scripts/runtime-contract-v1/runtime-dynamic-loader-safe-pattern-kernel.mjs',
  'scripts/runtime-contract-v1/runtime-dynamic-loader-safe-patterns.mjs',
  'scripts/runtime-contract-v1/runtime-dynamic-loader-safe-patterns.test.mjs',
]);
const RECEIPT_AUTHORITY_BINDINGS = Object.freeze([
  'scripts/kir-v1/alpha-receipt.mjs',
  'scripts/kir-v1/alpha-receipt.test.mjs',
  'scripts/release/artifact-types.mjs',
]);
const EXECUTED_RUNTIME_EXTERNAL_BINDINGS = Object.freeze([
  'packages/core/tests/runtime-contract-v1-parity.test.ts',
  'packages/core/tests/runtime-contract-v1-timer-observer.mjs',
]);

function policy() {
  return {
    bindings: [
      ...ALPHA_RECEIPT_AUTHORITY_BINDINGS,
      ...KIR_RUNTIME_BINDING_RECEIPT_BINDINGS,
      ...RUNTIME_CONTRACT_RECEIPT_BINDINGS,
      'scripts/kir-v1/alpha-receipt-policy.json',
    ].sort(),
    exclusions: [{ id: 'public-release', reason: 'deferred-to-r4' }],
    format: 'kern.kir.alpha-receipt.r1.5d.2',
    maxCommandOutputBytes: 65_536,
    oracleTimeoutMs: 5_000,
    oracles: [
      { argv: ['pnpm', 'test:kern-kir-runtime-binding'], id: 'internal-decoded-module-kir-binding' },
      { argv: ['pnpm', 'test:kern-kir-runner-composed-evidence'], id: 'kir-runner-composed-evidence' },
    ],
    outputRoot: '.kern/alpha',
    status: {
      alphaAccepted: true,
      kirV1Frozen: true,
      publicReaderExport: false,
      runtimeCutover: false,
      runtimeHandlerAbi: true,
      semanticSelfHosting: false,
    },
  };
}

function fixture() {
  const rootDir = path.join(os.tmpdir(), `kern-alpha-receipt-${process.pid}-${Math.random().toString(16).slice(2)}`);
  const policyPath = path.join(rootDir, 'scripts/kir-v1');
  mkdirSync(policyPath, { recursive: true });
  for (const binding of policy().bindings) {
    const bindingPath = path.join(rootDir, binding);
    mkdirSync(path.dirname(bindingPath), { recursive: true });
    writeFileSync(bindingPath, `${binding}\n`);
  }
  writeFileSync(path.join(policyPath, 'alpha-receipt-policy.json'), JSON.stringify(policy()));
  return rootDir;
}

function runner({ dirtyBefore = false, dirtyAfter = false, failOracle = false, headChanges = false } = {}) {
  let statusCalls = 0;
  let headCalls = 0;
  return (argv) => {
    if (argv[0] === 'git' && argv[1] === 'status') {
      statusCalls += 1;
      return { status: 0, stdout: statusCalls === 1 ? (dirtyBefore ? ' M file\n' : '') : dirtyAfter ? ' M file\n' : '' };
    }
    if (argv[0] === 'git' && argv[1] === 'rev-parse') {
      headCalls += 1;
      const value = headChanges && headCalls > 1 ? '89abcdef0123456789abcdef0123456789abcdef' : sha;
      return { status: 0, stdout: `${value}\n` };
    }
    return { status: failOracle ? 1 : 0, stdout: 'oracle output is deliberately excluded\n' };
  };
}

test('checked-in policy is closed, sorted, and self-bound', () => {
  const actual = JSON.parse(readFileSync(path.join(REPO_ROOT, 'scripts/kir-v1/alpha-receipt-policy.json'), 'utf8'));
  assert.equal(validateAlphaReceiptPolicy(actual), actual);
  assert.equal(actual.bindings.includes('scripts/kir-v1/alpha-receipt-policy.json'), true);
  const bindings = validateAlphaReceiptBindings(REPO_ROOT, actual);
  assert.equal(bindings.length, actual.bindings.length);
  assert.equal(bindings.every((binding) => /^[0-9a-f]{64}$/u.test(binding.sha256)), true);
});

test('runtime contract denominator tracks every normative artifact mechanically', () => {
  const actual = JSON.parse(readFileSync(path.join(REPO_ROOT, 'scripts/kir-v1/alpha-receipt-policy.json'), 'utf8'));
  for (const binding of RUNTIME_CONTRACT_RECEIPT_BINDINGS) {
    assert.equal(actual.bindings.includes(binding), true, binding);
  }
  for (const missing of RUNTIME_CONTRACT_RECEIPT_BINDINGS) {
    const mutated = structuredClone(actual);
    mutated.bindings.splice(mutated.bindings.indexOf(missing), 1);
    assert.throws(
      () => validateAlphaReceiptPolicy(mutated),
      /complete runtime contract denominator|runtime contract directory|runtime contract core test family/u,
      missing,
    );
  }
});

test('receipt binds the literal safe-pattern and receipt-authority denominator', () => {
  const actual = JSON.parse(readFileSync(path.join(REPO_ROOT, 'scripts/kir-v1/alpha-receipt-policy.json'), 'utf8'));
  const policyDirectoryBindings = actual.bindings.filter((binding) =>
    binding.startsWith('scripts/runtime-contract-v1/'));
  assert.deepEqual(policyDirectoryBindings, RUNTIME_CONTRACT_DIRECTORY_BINDINGS);
  const policyCoreTestBindings = actual.bindings.filter((binding) =>
    binding.startsWith('packages/core/tests/runtime-contract-v1-'));
  assert.deepEqual(policyCoreTestBindings, RUNTIME_CONTRACT_CORE_TEST_BINDINGS);
  for (const binding of RUNTIME_CONTRACT_DIRECTORY_BINDINGS) {
    assert.equal(RUNTIME_CONTRACT_RECEIPT_BINDINGS.includes(binding), true, binding);
    assert.equal(actual.bindings.includes(binding), true, binding);
  }
  for (const binding of EXECUTED_RUNTIME_EXTERNAL_BINDINGS) {
    assert.equal(RUNTIME_CONTRACT_RECEIPT_BINDINGS.includes(binding), true, binding);
    assert.equal(actual.bindings.includes(binding), true, binding);
  }
  for (const binding of SAFE_PATTERN_RECEIPT_BINDINGS) {
    assert.equal(RUNTIME_CONTRACT_RECEIPT_BINDINGS.includes(binding), true, binding);
    assert.equal(actual.bindings.includes(binding), true, binding);
  }
  assert.deepEqual(ALPHA_RECEIPT_AUTHORITY_BINDINGS, RECEIPT_AUTHORITY_BINDINGS);
  for (const binding of RECEIPT_AUTHORITY_BINDINGS) {
    assert.equal(actual.bindings.includes(binding), true, binding);
    const mutated = structuredClone(actual);
    mutated.bindings.splice(mutated.bindings.indexOf(binding), 1);
    assert.throws(() => validateAlphaReceiptPolicy(mutated), /receipt authority/u, binding);
  }
});

test('receipt binds the complete decoded KIR runtime denominator', () => {
  const actual = JSON.parse(readFileSync(path.join(REPO_ROOT, 'scripts/kir-v1/alpha-receipt-policy.json'), 'utf8'));
  for (const binding of KIR_RUNTIME_BINDING_RECEIPT_BINDINGS) {
    assert.equal(actual.bindings.includes(binding), true, binding);
    const mutated = structuredClone(actual);
    mutated.bindings.splice(mutated.bindings.indexOf(binding), 1);
    assert.throws(() => validateAlphaReceiptPolicy(mutated), /KIR runtime binding denominator/u, binding);
  }
  assert.deepEqual(
    actual.oracles.find(({ id }) => id === 'internal-decoded-module-kir-binding'),
    { id: 'internal-decoded-module-kir-binding', argv: ['pnpm', 'test:kern-kir-runtime-binding'] },
  );
  const missingOracle = structuredClone(actual);
  missingOracle.oracles.splice(
    missingOracle.oracles.findIndex(({ id }) => id === 'internal-decoded-module-kir-binding'),
    1,
  );
  assert.throws(() => validateAlphaReceiptPolicy(missingOracle), /exact KIR runtime binding oracle/u);
  const substitutedOracle = structuredClone(actual);
  substitutedOracle.oracles.find(({ id }) => id === 'internal-decoded-module-kir-binding').argv = [
    'pnpm',
    'test:kern-kir-module-graph',
  ];
  assert.throws(() => validateAlphaReceiptPolicy(substitutedOracle), /exact KIR runtime binding oracle/u);
  assert.deepEqual(
    actual.oracles.find(({ id }) => id === 'kir-runner-composed-evidence'),
    { id: 'kir-runner-composed-evidence', argv: ['pnpm', 'test:kern-kir-runner-composed-evidence'] },
  );
  const missingComposedOracle = structuredClone(actual);
  missingComposedOracle.oracles.splice(
    missingComposedOracle.oracles.findIndex(({ id }) => id === 'kir-runner-composed-evidence'),
    1,
  );
  assert.throws(() => validateAlphaReceiptPolicy(missingComposedOracle), /exact composed KIR runner evidence oracle/u);
  const reorderedBindings = structuredClone(actual);
  [reorderedBindings.bindings[0], reorderedBindings.bindings[1]] = [
    reorderedBindings.bindings[1],
    reorderedBindings.bindings[0],
  ];
  assert.throws(() => validateAlphaReceiptPolicy(reorderedBindings), /bindings must be unique and sorted/u);
});

test('runtime contract directory discovery admits only a closed flat file inventory', (t) => {
  const rootDir = path.join(os.tmpdir(), `kern-runtime-directory-${process.pid}-${Math.random().toString(16).slice(2)}`);
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(path.join(rootDir, 'authority.json'), '{}');
  assert.deepEqual(discoverRuntimeContractDirectoryBindings(rootDir), [
    'scripts/runtime-contract-v1/authority.json',
  ]);
  mkdirSync(path.join(rootDir, 'generated'));
  assert.throws(
    () => discoverRuntimeContractDirectoryBindings(rootDir),
    /must be a regular file: generated/u,
  );
});

test('core runtime contract test discovery closes only its prefix namespace', (t) => {
  const rootDir = path.join(os.tmpdir(), `kern-runtime-tests-${process.pid}-${Math.random().toString(16).slice(2)}`);
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(path.join(rootDir, 'runtime-contract-v1-example.test.mjs'), '');
  writeFileSync(path.join(rootDir, 'unrelated.test.mjs'), '');
  assert.deepEqual(discoverRuntimeContractCoreTestBindings(rootDir), [
    'packages/core/tests/runtime-contract-v1-example.test.mjs',
  ]);
  mkdirSync(path.join(rootDir, 'runtime-contract-v1-generated'));
  assert.throws(
    () => discoverRuntimeContractCoreTestBindings(rootDir),
    /must be a regular file: runtime-contract-v1-generated/u,
  );
});

test('clean HEAD produces one canonical immutable receipt and regenerates byte-identically', (t) => {
  const rootDir = fixture();
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const first = generateAlphaReceipt({ rootDir, policy: policy(), runCommand: runner() });
  const firstBytes = readFileSync(first.outputPath);
  const second = generateAlphaReceipt({ rootDir, policy: policy(), runCommand: runner() });
  assert.equal(second.outputPath, first.outputPath);
  assert.deepEqual(readFileSync(second.outputPath), firstBytes);
  assert.equal(first.receipt.commitSha, sha);
  assert.equal(first.receipt.status.alphaAccepted, true);
  assert.equal(first.receipt.status.kirV1Frozen, true);
  assert.equal(first.receipt.status.runtimeHandlerAbi, true);
  assert.deepEqual(first.receipt.oracles, [
    {
      argv: ['pnpm', 'test:kern-kir-runtime-binding'],
      id: 'internal-decoded-module-kir-binding',
      status: 'passed',
    },
    {
      argv: ['pnpm', 'test:kern-kir-runner-composed-evidence'],
      id: 'kir-runner-composed-evidence',
      status: 'passed',
    },
  ]);
  assert.equal(firstBytes.toString('utf8').includes('oracle output'), false);
});

test('dirty trees and failed oracles fail before a receipt escapes', (t) => {
  for (const options of [{ dirtyBefore: true }, { dirtyAfter: true }, { failOracle: true }]) {
    const rootDir = fixture();
    t.after(() => rmSync(rootDir, { recursive: true, force: true }));
    assert.throws(
      () => generateAlphaReceipt({ rootDir, policy: policy(), runCommand: runner(options) }),
      /clean|oracle/u,
    );
  }
});

test('HEAD movement during oracle execution fails before a receipt escapes', (t) => {
  const rootDir = fixture();
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  assert.throws(
    () => generateAlphaReceipt({ rootDir, policy: policy(), runCommand: runner({ headChanges: true }) }),
    /HEAD changed/u,
  );
});

test('existing non-identical receipt and symlinked binding fail closed', (t) => {
  const rootDir = fixture();
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const result = generateAlphaReceipt({ rootDir, policy: policy(), runCommand: runner() });
  writeFileSync(result.outputPath, 'tampered\n');
  assert.throws(
    () => generateAlphaReceipt({ rootDir, policy: policy(), runCommand: runner() }),
    /not byte-identical/u,
  );

  const linkRoot = fixture();
  t.after(() => rmSync(linkRoot, { recursive: true, force: true }));
  const binding = path.join(linkRoot, 'scripts/kir-v1/alpha-receipt-policy.json');
  rmSync(binding);
  const target = path.join(linkRoot, 'policy-target.json');
  writeFileSync(target, '{}');
  symlinkSync(target, binding);
  assert.throws(
    () => generateAlphaReceipt({ rootDir: linkRoot, policy: policy(), runCommand: runner() }),
    /regular file|cannot traverse a symlink/u,
  );
});

test('unknown fields, unsafe paths, and premature status claims reject', (t) => {
  const rootDir = fixture();
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const cases = [
    { ...policy(), unknown: true },
    { ...policy(), outputRoot: '../outside' },
    { ...policy(), outputRoot: '.kern/alpha/..' },
    { ...policy(), bindings: ['../outside'] },
    { ...policy(), oracles: [{ argv: ['node', 'unsafe-script'], id: 'oracle' }] },
    { ...policy(), status: { ...policy().status, runtimeCutover: true } },
  ];
  for (const mutated of cases) {
    assert.throws(() => generateAlphaReceipt({ rootDir, policy: mutated, runCommand: runner() }));
  }
});

test('supplied policy drift and symlinked binding parents reject', (t) => {
  const rootDir = fixture();
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  assert.throws(
    () => generateAlphaReceipt({ rootDir, policy: { ...policy(), oracleTimeoutMs: 6_000 }, runCommand: runner() }),
    /does not match/u,
  );

  const linkRoot = fixture();
  t.after(() => rmSync(linkRoot, { recursive: true, force: true }));
  const scriptsPath = path.join(linkRoot, 'scripts');
  rmSync(scriptsPath, { recursive: true });
  const external = path.join(linkRoot, 'external');
  mkdirSync(path.join(external, 'kir-v1'), { recursive: true });
  writeFileSync(path.join(external, 'kir-v1/alpha-receipt-policy.json'), JSON.stringify(policy()));
  symlinkSync(external, scriptsPath);
  assert.throws(
    () => generateAlphaReceipt({ rootDir: linkRoot, policy: policy(), runCommand: runner() }),
    /cannot traverse a symlink/u,
  );
});
