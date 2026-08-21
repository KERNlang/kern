import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import { reconstructRunnerCallCacheCompiledCoreJavaScriptPaths } from './coverage-dependencies.mjs';
import { historicalTransitionStage, reconstructHistoricalTransitionChain } from './historical-transition-chain.mjs';
import {
  POST_SCALAR_HELPER_HISTORY_COMPILED_RECONSTRUCTIONS as ROWS,
  SCALAR_HELPER_HISTORY_HISTORICAL_TRANSITION as TRANSITION,
  atScalarHelperHistoryCompiledPredecessor,
  validateScalarHelperHistoryCompiledInventory,
  validateScalarHelperHistoryHistoricalTransition,
} from './scalar-helper-history-transition.mjs';
import { SCALAR_HELPER_HISTORY_INVENTORY } from './scalar-helper-history-transition-data.mjs';

const ROOT = resolve(process.cwd());
const DIST = resolve(ROOT, 'packages/core/dist');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blob = (bytes) => {
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash('sha1').update(header).update(bytes).digest('hex');
};

function compiledPaths(directory = DIST, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) compiledPaths(path, output);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      output.push(relative(DIST, path).split(sep).join('/'));
    }
  }
  return output.sort();
}

function endpointDigest(rows, field) {
  const hash = createHash('sha256');
  for (const row of rows) {
    const bytes = Buffer.from(row.replacements[0][field]);
    hash.update(`${row.path.length}:${row.path}:${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function clonedRows() {
  return ROWS.map((row) => ({
    ...row,
    replacements: row.replacements.map((replacement) => ({ ...replacement })),
  }));
}

test('scalar helper history authenticates the exact stable 317-path inventory', () => {
  assert.equal(validateScalarHelperHistoryHistoricalTransition(), true);
  const actual = reconstructRunnerCallCacheCompiledCoreJavaScriptPaths(compiledPaths());
  assert.equal(actual.length, 317);
  assert.deepEqual(actual, SCALAR_HELPER_HISTORY_INVENTORY);
  assert.equal(validateScalarHelperHistoryCompiledInventory(actual), actual);
  assert.throws(() => validateScalarHelperHistoryCompiledInventory(actual.slice(1)), /exact stable/u);
  assert.throws(() => validateScalarHelperHistoryCompiledInventory([...actual, 'invented.js']), /exact stable/u);
  assert.throws(
    () => validateScalarHelperHistoryCompiledInventory([actual[1], actual[0], ...actual.slice(2)]),
    /exact stable/u,
  );
});

test('the canonicalizer gate rebuilds core before authenticating transition bytes', () => {
  const script = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).scripts['test:kern-canonicalizer'];
  const build = 'pnpm --filter @kernlang/core build';
  const authenticate = 'node --test scripts/kern-canonicalizer/*.test.mjs';
  assert.equal(typeof script, 'string');
  assert.ok(script.indexOf(build) >= 0, 'canonicalizer gate must rebuild core');
  assert.ok(script.indexOf(build) < script.indexOf(authenticate), 'core rebuild must precede transition tests');
});

test('every changed compiled path reconstructs its authenticated Git blob endpoint', () => {
  const predecessor = [];
  const successor = [];
  for (const row of ROWS) {
    const current = Buffer.from(row.replacements[0].current);
    assert.equal(digest(current), row.currentDigest, row.path);
    assert.equal(blob(current), row.currentBlob, row.path);
    const historical = reconstructHistoricalTransitionChain({
      currentSource: current,
      expectedTerminalDigest: row.expectedDigest,
      milestone: `scalar helper history ${row.path}`,
      path: row.path,
      stages: [historicalTransitionStage(row)],
    });
    assert.deepEqual(historical, Buffer.from(row.replacements[0].historical), row.path);
    assert.equal(blob(historical), row.expectedBlob, row.path);
    assert.deepEqual(atScalarHelperHistoryCompiledPredecessor(row.path, current), historical, row.path);
    const tampered = Buffer.from(current);
    tampered[0] ^= 1;
    assert.throws(
      () => atScalarHelperHistoryCompiledPredecessor(row.path, tampered),
      /broken or misordered successor edge/u,
      row.path,
    );
    assert.throws(
      () => atScalarHelperHistoryCompiledPredecessor(row.path, historical),
      /broken or misordered successor edge/u,
    );
    assert.equal(
      execFileSync('git', ['hash-object', '--stdin'], { input: historical, encoding: 'utf8' }).trim(),
      row.expectedBlob,
      row.path,
    );
    predecessor.push(row);
    successor.push(row);
  }
  assert.equal(endpointDigest(predecessor, 'historical'), TRANSITION.compiledEndpoints.predecessor);
  assert.equal(endpointDigest(successor, 'current'), TRANSITION.compiledEndpoints.successor);
  const unknown = Buffer.from('export const untouched = true;\n');
  assert.deepEqual(atScalarHelperHistoryCompiledPredecessor('unknown.js', unknown), unknown);
});

test('scalar helper history rejects omission, addition, reorder, and identity drift', () => {
  const invalid = [
    { reconstructions: ROWS.slice(1) },
    { reconstructions: [...ROWS, ROWS[0]] },
    { reconstructions: [ROWS[1], ROWS[0], ...ROWS.slice(2)] },
    { transition: { ...TRANSITION, predecessorCommit: '0'.repeat(40) } },
    { transition: { ...TRANSITION, successorCommit: '0'.repeat(40) } },
  ];
  for (const options of invalid) {
    assert.throws(() => validateScalarHelperHistoryHistoricalTransition(options), /immutable identity/u);
  }
  for (const mutate of [
    (rows) => { rows[0].currentDigest = '0'.repeat(64); },
    (rows) => { rows[0].expectedDigest = '0'.repeat(64); },
    (rows) => { rows[0].currentBlob = '0'.repeat(40); },
    (rows) => { rows[0].expectedBlob = '0'.repeat(40); },
    (rows) => { rows[0].replacements[0].current += '\n'; },
    (rows) => { rows[0].replacements[0].historical += '\n'; },
  ]) {
    const rows = clonedRows();
    mutate(rows);
    assert.throws(
      () => validateScalarHelperHistoryHistoricalTransition({ reconstructions: rows }),
      /immutable identity/u,
    );
  }
});

test('the authenticated commits and exact compiled path set cannot drift', () => {
  assert.equal(execFileSync('git', ['rev-parse', TRANSITION.predecessorCommit], { encoding: 'utf8' }).trim(), TRANSITION.predecessorCommit);
  assert.equal(execFileSync('git', ['rev-parse', TRANSITION.successorCommit], { encoding: 'utf8' }).trim(), TRANSITION.successorCommit);
  assert.deepEqual(ROWS.map((row) => row.path), [
    'codegen/kern-stdlib.js',
    'codegen/stdlib-preamble.js',
    'codegen/text-contract.js',
    'ir/semantics/deferred-expression-preflight.js',
    'ir/semantics/internal-effect-machine-expression-bindings.js',
    'ir/semantics/portable-machine-shape.js',
    'ir/semantics/portable-scalar-domain.js',
    'ir/semantics/portable-string.js',
  ]);
});
