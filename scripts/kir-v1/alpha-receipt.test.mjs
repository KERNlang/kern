import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  generateAlphaReceipt,
  RUNTIME_CONTRACT_RECEIPT_BINDINGS,
  validateAlphaReceiptBindings,
  validateAlphaReceiptPolicy,
} from './alpha-receipt.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';

function policy() {
  return {
    bindings: [...RUNTIME_CONTRACT_RECEIPT_BINDINGS, 'scripts/kir-v1/alpha-receipt-policy.json'].sort(),
    exclusions: [{ id: 'public-release', reason: 'deferred-to-r4' }],
    format: 'kern.kir.alpha-receipt.r1.5d.2',
    maxCommandOutputBytes: 65_536,
    oracleTimeoutMs: 5_000,
    oracles: [{ argv: ['pnpm', 'test:oracle'], id: 'oracle' }],
    outputRoot: '.kern/alpha',
    status: {
      alphaAccepted: true,
      kirV1Frozen: false,
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
  for (const binding of RUNTIME_CONTRACT_RECEIPT_BINDINGS) {
    const bindingPath = path.join(rootDir, binding);
    mkdirSync(path.dirname(bindingPath), { recursive: true });
    writeFileSync(bindingPath, `${binding}\n`);
  }
  writeFileSync(path.join(policyPath, 'alpha-receipt-policy.json'), JSON.stringify(policy()));
  return rootDir;
}

function runner({ dirtyBefore = false, dirtyAfter = false, failOracle = false } = {}) {
  let statusCalls = 0;
  return (argv) => {
    if (argv[0] === 'git' && argv[1] === 'status') {
      statusCalls += 1;
      return { status: 0, stdout: statusCalls === 1 ? (dirtyBefore ? ' M file\n' : '') : dirtyAfter ? ' M file\n' : '' };
    }
    if (argv[0] === 'git' && argv[1] === 'rev-parse') return { status: 0, stdout: `${sha}\n` };
    return { status: failOracle ? 1 : 0, stdout: 'oracle output is deliberately excluded\n' };
  };
}

test('checked-in policy is closed, sorted, and self-bound', () => {
  const actual = JSON.parse(readFileSync('scripts/kir-v1/alpha-receipt-policy.json', 'utf8'));
  assert.equal(validateAlphaReceiptPolicy(actual), actual);
  assert.equal(actual.bindings.includes('scripts/kir-v1/alpha-receipt-policy.json'), true);
  const bindings = validateAlphaReceiptBindings(process.cwd(), actual);
  assert.equal(bindings.length, actual.bindings.length);
  assert.equal(bindings.every((binding) => /^[0-9a-f]{64}$/u.test(binding.sha256)), true);
});

test('runtime contract denominator tracks every normative artifact mechanically', () => {
  const actual = JSON.parse(readFileSync('scripts/kir-v1/alpha-receipt-policy.json', 'utf8'));
  for (const binding of RUNTIME_CONTRACT_RECEIPT_BINDINGS) {
    assert.equal(actual.bindings.includes(binding), true, binding);
  }
  for (const missing of RUNTIME_CONTRACT_RECEIPT_BINDINGS) {
    const mutated = structuredClone(actual);
    mutated.bindings.splice(mutated.bindings.indexOf(missing), 1);
    assert.throws(() => validateAlphaReceiptPolicy(mutated), /complete runtime contract denominator/u, missing);
  }
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
  assert.equal(first.receipt.status.kirV1Frozen, false);
  assert.equal(first.receipt.status.runtimeHandlerAbi, true);
  assert.deepEqual(first.receipt.oracles, [{ argv: ['pnpm', 'test:oracle'], id: 'oracle', status: 'passed' }]);
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
