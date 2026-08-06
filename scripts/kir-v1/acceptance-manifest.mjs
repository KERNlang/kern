#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stringifyCanonical } from '../release/artifact-types.mjs';

const POLICY_PATH = 'scripts/kir-v1/acceptance-policy.json';
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

export function validateKirV1AcceptancePolicy(policy) {
  exactKeys(
    policy,
    ['bindings', 'exclusions', 'format', 'maxCommandOutputBytes', 'oracleTimeoutMs', 'oracles', 'outputRoot', 'status'],
    'KIR v1 acceptance policy',
  );
  if (policy.format !== 'kern.kir.v1-alpha-acceptance.1') throw new Error('unsupported acceptance format');
  safePath(policy.outputRoot, 'outputRoot');
  if (policy.outputRoot !== 'scripts/kir-v1/acceptance') throw new Error('outputRoot must be scripts/kir-v1/acceptance');
  for (const field of ['maxCommandOutputBytes', 'oracleTimeoutMs']) {
    if (!Number.isSafeInteger(policy[field]) || policy[field] <= 0) throw new Error(`${field} must be positive`);
  }
  if (!Array.isArray(policy.bindings) || policy.bindings.length === 0) throw new Error('bindings must be non-empty');
  policy.bindings.forEach((binding, index) => safePath(binding, `bindings[${index}]`));
  if (
    new Set(policy.bindings).size !== policy.bindings.length ||
    [...policy.bindings].sort().some((binding, index) => binding !== policy.bindings[index])
  ) {
    throw new Error('bindings must be unique and sorted');
  }
  if (!policy.bindings.includes(POLICY_PATH)) throw new Error(`bindings must include ${POLICY_PATH}`);
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
  if (!policy.oracles.some(({ argv, id }) => id === 'kir-v1-profile' && argv[1] === 'test:kern-ir-profile')) {
    throw new Error('oracles must include the exact KIR v1 profile oracle');
  }
  if (!Array.isArray(policy.exclusions) || policy.exclusions.length === 0) throw new Error('exclusions must be non-empty');
  policy.exclusions.forEach((exclusion, index) => {
    exactKeys(exclusion, ['id', 'reason'], `exclusions[${index}]`);
    if (!SAFE_ID.test(exclusion.id) || !SAFE_ID.test(exclusion.reason)) throw new Error('invalid exclusion');
  });
  exactKeys(
    policy.status,
    ['alphaAccepted', 'kirV1Frozen', 'publicReaderExport', 'runtimeCutover', 'runtimeHandlerAbi', 'semanticSelfHosting'],
    'status',
  );
  if (
    policy.status.alphaAccepted !== true ||
    policy.status.kirV1Frozen !== true ||
    policy.status.runtimeHandlerAbi !== true ||
    policy.status.publicReaderExport !== false ||
    policy.status.runtimeCutover !== false ||
    policy.status.semanticSelfHosting !== false
  ) {
    throw new Error('status must accept only internal KIR v1 plus the frozen runtime ABI');
  }
  return policy;
}

function commandText(result, label) {
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with status ${result.status ?? 'unknown'}`);
  return String(result.stdout ?? '').trim();
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

function runGit(rootDir, policy, runCommand, argv, label) {
  return commandText(runCommand(argv, {
    rootDir,
    maxOutputBytes: policy.maxCommandOutputBytes,
    timeoutMs: policy.oracleTimeoutMs,
  }), label);
}

function assertClean(rootDir, policy, runCommand, phase) {
  if (runGit(rootDir, policy, runCommand, ['git', 'status', '--porcelain=v1', '--untracked-files=all'], `git status ${phase}`) !== '') {
    throw new Error(`worktree must be clean ${phase}`);
  }
}

function head(rootDir, policy, runCommand, phase) {
  const value = runGit(rootDir, policy, runCommand, ['git', 'rev-parse', 'HEAD'], `git rev-parse HEAD ${phase}`);
  if (!SHA.test(value)) throw new Error('HEAD must be a full lowercase commit SHA');
  return value;
}

function assertNoSymlinkTraversal(rootDir, relativePath, label) {
  let cursor = rootDir;
  for (const segment of relativePath.split(path.sep)) {
    cursor = path.join(cursor, segment);
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error(`${label} cannot traverse a symlink`);
  }
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

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function generateKirV1AcceptanceManifest({
  rootDir = process.cwd(),
  policy = JSON.parse(readFileSync(path.join(rootDir, POLICY_PATH), 'utf8')),
  runCommand = defaultCommand,
} = {}) {
  validateKirV1AcceptancePolicy(policy);
  const boundPolicy = validateKirV1AcceptancePolicy(JSON.parse(regularBytes(rootDir, POLICY_PATH).toString('utf8')));
  if (stringifyCanonical(boundPolicy) !== stringifyCanonical(policy)) {
    throw new Error('supplied policy does not match the self-bound policy file');
  }
  assertClean(rootDir, policy, runCommand, 'before oracle execution');
  const acceptedCommitSha = head(rootDir, policy, runCommand, 'before oracle execution');
  const bindings = policy.bindings.map((bindingPath) => ({
    path: bindingPath,
    sha256: digest(regularBytes(rootDir, bindingPath)),
  }));
  const oracles = policy.oracles.map((oracle) => {
    commandText(runCommand(oracle.argv, {
      rootDir,
      maxOutputBytes: policy.maxCommandOutputBytes,
      timeoutMs: policy.oracleTimeoutMs,
    }), `oracle ${oracle.id}`);
    return { argv: oracle.argv, id: oracle.id, status: 'passed' };
  });
  assertClean(rootDir, policy, runCommand, 'after oracle execution');
  if (head(rootDir, policy, runCommand, 'after oracle execution') !== acceptedCommitSha) {
    throw new Error('HEAD changed during oracle execution');
  }
  const manifest = {
    acceptedCommitSha,
    bindings,
    exclusions: policy.exclusions,
    format: policy.format,
    oracles,
    policySha256: bindings.find(({ path: bindingPath }) => bindingPath === POLICY_PATH)?.sha256,
    status: policy.status,
  };
  if (manifest.policySha256 === undefined) throw new Error('policy must bind itself');
  const bytes = Buffer.from(stringifyCanonical(manifest), 'utf8');
  const outputRoot = path.resolve(rootDir, policy.outputRoot);
  assertNoSymlinkTraversal(rootDir, path.relative(rootDir, outputRoot), 'outputRoot');
  mkdirSync(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, `${acceptedCommitSha}.json`);
  if (existsSync(outputPath)) {
    const stat = lstatSync(outputPath);
    if (!stat.isFile() || stat.isSymbolicLink() || !readFileSync(outputPath).equals(bytes)) {
      throw new Error('existing KIR v1 acceptance manifest is not byte-identical');
    }
  } else {
    writeFileSync(outputPath, bytes, { flag: 'wx', mode: 0o644 });
  }
  return { manifest, outputPath };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.stdout.write(`${generateKirV1AcceptanceManifest().outputPath}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
