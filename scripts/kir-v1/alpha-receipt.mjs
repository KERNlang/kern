#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stringifyCanonical } from '../release/artifact-types.mjs';

const POLICY_PATH = 'scripts/kir-v1/alpha-receipt-policy.json';
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUNTIME_CONTRACT_DIRECTORY = new URL('../runtime-contract-v1/', import.meta.url);
const CORE_TEST_DIRECTORY = new URL('../../packages/core/tests/', import.meta.url);
const SAFE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const SAFE_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
const SHA = /^[0-9a-f]{40}$/u;

// scripts/runtime-contract-v1 is a closed authority: every direct entry is in scope.
export function discoverRuntimeContractDirectoryBindings(directory = RUNTIME_CONTRACT_DIRECTORY) {
  const entries = readdirSync(directory, { withFileTypes: true });
  if (entries.length === 0) throw new Error('runtime contract directory must be non-empty');
  for (const entry of entries) {
    if (!entry.isFile()) throw new Error(`runtime contract directory entry must be a regular file: ${entry.name}`);
  }
  const names = entries.map(({ name }) => name);
  const foldedNames = names.map((name) => name.toLowerCase());
  if (new Set(foldedNames).size !== foldedNames.length) {
    throw new Error('runtime contract directory contains case-folded duplicate names');
  }
  return Object.freeze(names.map((name) => `scripts/runtime-contract-v1/${name}`).sort());
}

export const RUNTIME_CONTRACT_DIRECTORY_BINDINGS = discoverRuntimeContractDirectoryBindings();

// packages/core/tests is mixed-purpose, so only this prefix is authoritative.
// Unlike the closed scripts directory, unrelated entries are out of scope.
export function discoverRuntimeContractCoreTestBindings(directory = CORE_TEST_DIRECTORY) {
  const matches = readdirSync(directory, { withFileTypes: true })
    .filter(({ name }) => name.startsWith('runtime-contract-v1-'));
  if (matches.length === 0) throw new Error('runtime contract core test family must be non-empty');
  for (const entry of matches) {
    if (!entry.isFile()) throw new Error(`runtime contract core test entry must be a regular file: ${entry.name}`);
  }
  const names = matches.map(({ name }) => name);
  const foldedNames = names.map((name) => name.toLowerCase());
  if (new Set(foldedNames).size !== foldedNames.length) {
    throw new Error('runtime contract core tests contain case-folded duplicate names');
  }
  return Object.freeze(names.map((name) => `packages/core/tests/${name}`).sort());
}

export const RUNTIME_CONTRACT_CORE_TEST_BINDINGS = discoverRuntimeContractCoreTestBindings();

const RUNTIME_CONTRACT_EXTERNAL_BINDINGS = Object.freeze([
  'package.json',
  'packages/core/src/runtime-handler.ts',
  'scripts/check-runtime-contract-v1-candidate.mjs',
  'scripts/check-runtime-contract-v1.mjs',
  'scripts/kern-5-fitness-policy.json',
  'scripts/kern-5-fitness.test.mjs',
  'scripts/runtime-envelope-import-closure.mjs',
  'scripts/runtime-handler-public-declaration.mjs',
]);
for (const binding of RUNTIME_CONTRACT_EXTERNAL_BINDINGS) {
  let metadata;
  try {
    metadata = lstatSync(path.join(REPO_ROOT, binding));
  } catch {
    throw new Error(`runtime contract external binding is missing: ${binding}`);
  }
  if (!metadata.isFile()) throw new Error(`runtime contract external binding must be a regular file: ${binding}`);
}

export const RUNTIME_CONTRACT_RECEIPT_BINDINGS = Object.freeze([
  ...RUNTIME_CONTRACT_CORE_TEST_BINDINGS,
  ...RUNTIME_CONTRACT_DIRECTORY_BINDINGS,
  ...RUNTIME_CONTRACT_EXTERNAL_BINDINGS,
].sort());

export const ALPHA_RECEIPT_AUTHORITY_BINDINGS = Object.freeze([
  'scripts/kir-v1/alpha-receipt.mjs',
  'scripts/kir-v1/alpha-receipt.test.mjs',
  'scripts/release/artifact-types.mjs',
]);

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly ${expected.join(',')}`);
  }
}

function safePath(value, label) {
  if (
    typeof value !== 'string' ||
    !SAFE_PATH.test(value) ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.includes('\\')
  ) {
    throw new Error(`${label} must be a safe repository-relative path`);
  }
}

export function validateAlphaReceiptPolicy(policy) {
  exactKeys(
    policy,
    ['bindings', 'exclusions', 'format', 'maxCommandOutputBytes', 'oracleTimeoutMs', 'oracles', 'outputRoot', 'status'],
    'alpha receipt policy',
  );
  if (policy.format !== 'kern.kir.alpha-receipt.r1.5d.2') throw new Error('unsupported alpha receipt format');
  safePath(policy.outputRoot, 'outputRoot');
  if (!policy.outputRoot.startsWith('.kern/')) throw new Error('outputRoot must remain below ignored .kern/');
  for (const field of ['maxCommandOutputBytes', 'oracleTimeoutMs']) {
    if (!Number.isSafeInteger(policy[field]) || policy[field] <= 0) throw new Error(`${field} must be positive`);
  }
  if (!Array.isArray(policy.bindings) || policy.bindings.length === 0) throw new Error('bindings must be non-empty');
  policy.bindings.forEach((binding, index) => safePath(binding, `bindings[${index}]`));
  if (new Set(policy.bindings).size !== policy.bindings.length || [...policy.bindings].sort().some((item, index) => item !== policy.bindings[index])) {
    throw new Error('bindings must be unique and sorted');
  }
  const policyRuntimeDirectory = policy.bindings.filter((binding) =>
    binding.startsWith('scripts/runtime-contract-v1/'));
  if (JSON.stringify(policyRuntimeDirectory) !== JSON.stringify(RUNTIME_CONTRACT_DIRECTORY_BINDINGS)) {
    throw new Error('bindings must exactly match the runtime contract directory');
  }
  const policyCoreTests = policy.bindings.filter((binding) =>
    binding.startsWith('packages/core/tests/runtime-contract-v1-'));
  if (JSON.stringify(policyCoreTests) !== JSON.stringify(RUNTIME_CONTRACT_CORE_TEST_BINDINGS)) {
    throw new Error('bindings must exactly match the runtime contract core test family');
  }
  const missingRuntimeBindings = RUNTIME_CONTRACT_RECEIPT_BINDINGS.filter(
    (binding) => !policy.bindings.includes(binding),
  );
  if (missingRuntimeBindings.length > 0) {
    throw new Error(`bindings must include the complete runtime contract denominator: ${missingRuntimeBindings.join(',')}`);
  }
  const missingReceiptAuthority = ALPHA_RECEIPT_AUTHORITY_BINDINGS.filter(
    (binding) => !policy.bindings.includes(binding),
  );
  if (missingReceiptAuthority.length > 0) {
    throw new Error(`bindings must include the receipt authority: ${missingReceiptAuthority.join(',')}`);
  }
  if (!Array.isArray(policy.oracles) || policy.oracles.length === 0) throw new Error('oracles must be non-empty');
  const oracleIds = new Set();
  policy.oracles.forEach((oracle, index) => {
    exactKeys(oracle, ['argv', 'id'], `oracles[${index}]`);
    if (!SAFE_ID.test(oracle.id) || oracleIds.has(oracle.id)) throw new Error(`invalid oracle id ${oracle.id}`);
    oracleIds.add(oracle.id);
    if (
      !Array.isArray(oracle.argv) ||
      oracle.argv.length !== 2 ||
      oracle.argv[0] !== 'pnpm' ||
      typeof oracle.argv[1] !== 'string' ||
      !/^[a-z][a-z0-9:-]{0,127}$/u.test(oracle.argv[1])
    ) {
      throw new Error(`oracles[${index}].argv must be pnpm plus one safe script name`);
    }
  });
  if (!Array.isArray(policy.exclusions) || policy.exclusions.length === 0) throw new Error('exclusions must be non-empty');
  const exclusionIds = new Set();
  policy.exclusions.forEach((exclusion, index) => {
    exactKeys(exclusion, ['id', 'reason'], `exclusions[${index}]`);
    if (!SAFE_ID.test(exclusion.id) || !SAFE_ID.test(exclusion.reason) || exclusionIds.has(exclusion.id)) {
      throw new Error('invalid exclusion');
    }
    exclusionIds.add(exclusion.id);
    if (index > 0 && policy.exclusions[index - 1].id >= exclusion.id) throw new Error('exclusions must be sorted');
  });
  exactKeys(
    policy.status,
    ['alphaAccepted', 'kirV1Frozen', 'publicReaderExport', 'runtimeCutover', 'runtimeHandlerAbi', 'semanticSelfHosting'],
    'status',
  );
  if (
    policy.status.alphaAccepted !== true ||
    policy.status.runtimeHandlerAbi !== true ||
    Object.entries(policy.status).some(
      ([key, value]) => !['alphaAccepted', 'runtimeHandlerAbi'].includes(key) && value !== false,
    )
  ) {
    throw new Error('only alphaAccepted and runtimeHandlerAbi may be true');
  }
  return policy;
}

function defaultCommand(argv, options) {
  return spawnSync(argv[0], argv.slice(1), {
    cwd: options.rootDir,
    encoding: 'utf8',
    maxBuffer: options.maxOutputBytes,
    shell: false,
    timeout: options.timeoutMs,
  });
}

function commandText(result, label) {
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with status ${result.status ?? 'unknown'}`);
  return String(result.stdout ?? '').trim();
}

function assertClean(rootDir, runCommand, policy, phase) {
  const result = runCommand(['git', 'status', '--porcelain=v1', '--untracked-files=all'], {
    rootDir,
    maxOutputBytes: policy.maxCommandOutputBytes,
    timeoutMs: policy.oracleTimeoutMs,
  });
  if (commandText(result, `git status ${phase}`) !== '') throw new Error(`worktree must be clean ${phase}`);
}

function regularBytes(rootDir, relativePath) {
  const absolutePath = path.resolve(rootDir, relativePath);
  const relative = path.relative(rootDir, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`binding escapes repository: ${relativePath}`);
  assertNoSymlinkTraversal(rootDir, relative, `binding ${relativePath}`);
  const stat = lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`binding must be a regular file: ${relativePath}`);
  return readFileSync(absolutePath);
}

function assertNoSymlinkTraversal(rootDir, relativePath, label) {
  let cursor = rootDir;
  for (const segment of relativePath.split(path.sep)) {
    cursor = path.join(cursor, segment);
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error(`${label} cannot traverse a symlink`);
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function validateAlphaReceiptBindings(rootDir, policy) {
  validateAlphaReceiptPolicy(policy);
  return policy.bindings.map((bindingPath) => ({
    path: bindingPath,
    sha256: sha256(regularBytes(rootDir, bindingPath)),
  }));
}

function ensureOutputRoot(rootDir, outputRoot) {
  const absolute = path.resolve(rootDir, outputRoot);
  const relative = path.relative(rootDir, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('outputRoot escapes repository');
  assertNoSymlinkTraversal(rootDir, relative, 'outputRoot');
  mkdirSync(absolute, { recursive: true });
  if (!lstatSync(absolute).isDirectory() || lstatSync(absolute).isSymbolicLink()) {
    throw new Error('outputRoot must be a real directory');
  }
  return absolute;
}

export function generateAlphaReceipt({
  rootDir = process.cwd(),
  policy = JSON.parse(readFileSync(path.join(rootDir, POLICY_PATH), 'utf8')),
  runCommand = defaultCommand,
} = {}) {
  validateAlphaReceiptPolicy(policy);
  const boundPolicyBytes = regularBytes(rootDir, POLICY_PATH);
  const boundPolicy = validateAlphaReceiptPolicy(JSON.parse(boundPolicyBytes.toString('utf8')));
  if (stringifyCanonical(boundPolicy) !== stringifyCanonical(policy)) {
    throw new Error('supplied policy does not match the self-bound policy file');
  }
  assertClean(rootDir, runCommand, policy, 'before oracle execution');
  const head = commandText(
    runCommand(['git', 'rev-parse', 'HEAD'], {
      rootDir,
      maxOutputBytes: policy.maxCommandOutputBytes,
      timeoutMs: policy.oracleTimeoutMs,
    }),
    'git rev-parse HEAD',
  );
  if (!SHA.test(head)) throw new Error('HEAD must be a full lowercase commit SHA');

  const bindings = validateAlphaReceiptBindings(rootDir, policy);
  const oracles = policy.oracles.map((oracle) => {
    const result = runCommand(oracle.argv, {
      rootDir,
      maxOutputBytes: policy.maxCommandOutputBytes,
      timeoutMs: policy.oracleTimeoutMs,
    });
    commandText(result, `oracle ${oracle.id}`);
    return { argv: oracle.argv, id: oracle.id, status: 'passed' };
  });
  assertClean(rootDir, runCommand, policy, 'after oracle execution');
  const receipt = {
    bindings,
    commitSha: head,
    exclusions: policy.exclusions,
    format: policy.format,
    oracles,
    policySha256: bindings.find((binding) => binding.path === POLICY_PATH)?.sha256,
    status: policy.status,
  };
  if (receipt.policySha256 === undefined) throw new Error('policy must bind itself');
  const bytes = Buffer.from(stringifyCanonical(receipt), 'utf8');
  const outputRoot = ensureOutputRoot(rootDir, policy.outputRoot);
  const outputPath = path.join(outputRoot, `${head}.json`);
  if (existsSync(outputPath)) {
    const stat = lstatSync(outputPath);
    if (!stat.isFile() || stat.isSymbolicLink() || !readFileSync(outputPath).equals(bytes)) {
      throw new Error('existing alpha receipt is not byte-identical');
    }
  } else {
    writeFileSync(outputPath, bytes, { flag: 'wx', mode: 0o600 });
  }
  return { outputPath, receipt };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const result = generateAlphaReceipt();
    process.stdout.write(`${result.outputPath}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
