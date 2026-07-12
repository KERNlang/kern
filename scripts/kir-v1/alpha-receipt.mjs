#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stringifyCanonical } from '../release/artifact-types.mjs';

const POLICY_PATH = 'scripts/kir-v1/alpha-receipt-policy.json';
const SAFE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const SAFE_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
const SHA = /^[0-9a-f]{40}$/u;

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
    Object.entries(policy.status).some(([key, value]) => key !== 'alphaAccepted' && value !== false)
  ) {
    throw new Error('only alphaAccepted may be true');
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
