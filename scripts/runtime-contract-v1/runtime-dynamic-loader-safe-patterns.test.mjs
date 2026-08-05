import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

import { runtimeModuleSpecifiers } from './runtime-dynamic-loader-boundary.mjs';
import { digestSafePatternSource } from './runtime-dynamic-loader-safe-pattern-kernel.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_RELATIVE_PATH = 'packages/core/src/ir/semantics/internal-effect-machine-class-graph.ts';
const SOURCE_PATH = resolve(REPO_ROOT, SOURCE_RELATIVE_PATH);
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');
const BUILT_RELATIVE_PATH = 'packages/core/dist/ir/semantics/internal-effect-machine-class-graph.js';
const BUILT_PATH = resolve(REPO_ROOT, BUILT_RELATIVE_PATH);
const BUILT = readFileSync(BUILT_PATH, 'utf8');

test('class body budget scan accepts an exact authority through a symlinked checkout', (context) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'kern-runtime-authority-'));
  context.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));
  const checkoutAlias = join(temporaryRoot, 'checkout');
  symlinkSync(REPO_ROOT, checkoutAlias, process.platform === 'win32' ? 'junction' : 'dir');

  assert.doesNotThrow(() => runtimeModuleSpecifiers(SOURCE, resolve(checkoutAlias, SOURCE_RELATIVE_PATH)));
});

test('class body budget scan rejects a hardlink twin outside the exact authority', (context) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'kern-runtime-authority-'));
  context.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));
  const twinPath = join(temporaryRoot, 'internal-effect-machine-class-graph.ts');
  linkSync(SOURCE_PATH, twinPath);

  assert.throws(() => runtimeModuleSpecifiers(SOURCE, twinPath), /dynamic constructor invocation/u);
});

test('class body budget scan follows filesystem case identity without manual case folding', (context) => {
  const caseVariant = SOURCE_PATH.replace('/KERN/', '/kern/');
  if (caseVariant === SOURCE_PATH || !existsSync(caseVariant) || realpathSync.native(caseVariant) !== realpathSync.native(SOURCE_PATH)) {
    context.skip('filesystem does not expose a case-variant alias for this checkout');
    return;
  }

  assert.doesNotThrow(() => runtimeModuleSpecifiers(SOURCE, caseVariant));
});

test('missing authority twins remain independent and canonical collisions fail closed', async (context) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'kern-runtime-authority-'));
  context.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));
  const scriptRoot = join(temporaryRoot, 'scripts/runtime-contract-v1');
  const sourcePath = join(temporaryRoot, SOURCE_RELATIVE_PATH);
  const builtPath = join(temporaryRoot, 'packages/core/dist/ir/semantics/internal-effect-machine-class-graph.js');
  mkdirSync(scriptRoot, { recursive: true });
  mkdirSync(dirname(sourcePath), { recursive: true });
  mkdirSync(dirname(builtPath), { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, 'scripts/runtime-contract-v1/runtime-dynamic-loader-safe-patterns.mjs'),
    join(scriptRoot, 'runtime-dynamic-loader-safe-patterns.mjs'),
  );
  copyFileSync(
    resolve(REPO_ROOT, 'scripts/runtime-contract-v1/runtime-dynamic-loader-safe-pattern-kernel.mjs'),
    join(scriptRoot, 'runtime-dynamic-loader-safe-pattern-kernel.mjs'),
  );
  writeFileSync(sourcePath, SOURCE);

  const safePatterns = await import(pathToFileURL(join(scriptRoot, 'runtime-dynamic-loader-safe-patterns.mjs')).href);
  const sourceFile = ts.createSourceFile(sourcePath, SOURCE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statuses = () => {
    const found = [];
    function visit(node) {
      if (ts.isCallExpression(node)) {
        found.push(safePatterns.classBodyBudgetScanStatus(ts, node, sourceFile, sourcePath));
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return found;
  };

  assert.ok(statuses().includes(safePatterns.SAFE_PATTERN_STATUS.approved));
  symlinkSync(sourcePath, builtPath, 'file');
  assert.ok(statuses().includes(safePatterns.SAFE_PATTERN_STATUS.authorityDrift));
  assert.ok(!statuses().includes(safePatterns.SAFE_PATTERN_STATUS.approved));
});

test('safe-pattern token digest is invariant to checkout line endings', () => {
  const lfDigest = digestSafePatternSource(ts, SOURCE, SOURCE_PATH);
  const crlfDigest = digestSafePatternSource(ts, SOURCE.replace(/\r?\n/gu, '\r\n'), SOURCE_PATH);
  assert.match(lfDigest, /^[0-9a-f]{64}$/u);
  assert.equal(crlfDigest, lfDigest);
});

test('changing an authority pin rejects the unchanged approved helper', async (context) => {
  const safePatternModule = readFileSync(
    resolve(REPO_ROOT, 'scripts/runtime-contract-v1/runtime-dynamic-loader-safe-patterns.mjs'),
    'utf8',
  );
  for (const authority of [
    {
      content: SOURCE,
      digest: '313564f7395995386db660969746dfa038b97c80769d6f9765044da522348fe6',
      relativePath: SOURCE_RELATIVE_PATH,
    },
    {
      content: BUILT,
      digest: '8cb2fdb53b0e0bb4559301759bb60dfa6dbdb0a54cbb26579ee80f362ebfe36c',
      relativePath: BUILT_RELATIVE_PATH,
    },
  ]) {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'kern-runtime-authority-'));
    context.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));
    const scriptRoot = join(temporaryRoot, 'scripts/runtime-contract-v1');
    const authorityPath = join(temporaryRoot, authority.relativePath);
    mkdirSync(scriptRoot, { recursive: true });
    mkdirSync(dirname(authorityPath), { recursive: true });
    const mutatedDigest = `${authority.digest[0] === '0' ? '1' : '0'}${authority.digest.slice(1)}`;
    const mutatedModule = safePatternModule.replace(authority.digest, mutatedDigest);
    assert.notEqual(mutatedModule, safePatternModule);
    writeFileSync(join(scriptRoot, 'runtime-dynamic-loader-safe-patterns.mjs'), mutatedModule);
    copyFileSync(
      resolve(REPO_ROOT, 'scripts/runtime-contract-v1/runtime-dynamic-loader-safe-pattern-kernel.mjs'),
      join(scriptRoot, 'runtime-dynamic-loader-safe-pattern-kernel.mjs'),
    );
    writeFileSync(authorityPath, authority.content);

    const safePatterns = await import(pathToFileURL(join(scriptRoot, 'runtime-dynamic-loader-safe-patterns.mjs')).href);
    const sourceFile = ts.createSourceFile(
      authorityPath,
      authority.content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const statuses = [];
    function visit(node) {
      if (ts.isCallExpression(node)) {
        statuses.push(safePatterns.classBodyBudgetScanStatus(ts, node, sourceFile, authorityPath));
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    assert.ok(statuses.includes(safePatterns.SAFE_PATTERN_STATUS.authorityDrift));
    assert.ok(!statuses.includes(safePatterns.SAFE_PATTERN_STATUS.approved));
  }
});

test('safe-pattern digest report is print-only, reproducible, and current', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(REPO_ROOT, 'scripts/runtime-contract-v1/check-runtime-dynamic-loader-safe-patterns.mjs'), '--json'],
    { cwd: tmpdir(), encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.format, 'kern.runtime.dynamic-loader-safe-pattern-digest-report.v1');
  assert.equal(report.digestFormat, 'typescript-token-tree-sha256.v1');
  assert.equal(typeof report.typescriptVersion, 'string');
  assert.deepEqual(report.authorities.map(({ label }) => label), ['source', 'built']);
  for (const authority of report.authorities) {
    assert.equal(authority.match, true);
    assert.match(authority.expectedDigest, /^[0-9a-f]{64}$/u);
    assert.equal(authority.actualDigest, authority.expectedDigest);
    assert.match(authority.gitBlobOid, /^[0-9a-f]{40,64}$/u);
  }

  const updateAttempt = spawnSync(
    process.execPath,
    [resolve(REPO_ROOT, 'scripts/runtime-contract-v1/check-runtime-dynamic-loader-safe-patterns.mjs'), '--update'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  assert.equal(updateAttempt.status, 2);
  assert.match(updateAttempt.stderr, /Unknown argument: --update/u);
});
