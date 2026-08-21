import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  POST_SCALAR_HELPER_HISTORY_4_6_COMPILED_RECONSTRUCTIONS as ROWS,
  SCALAR_HELPER_HISTORY_4_6_HISTORICAL_TRANSITION as TRANSITION,
  atScalarHelperHistory4_6CompiledPredecessor,
  validateScalarHelperHistory4_6HistoricalTransition,
} from './scalar-helper-history-4-6-transition-module.mjs';
import {
  POST_SCALAR_HELPER_HISTORY_COMPILED_RECONSTRUCTIONS as OLD_ROWS,
  atScalarHelperHistoryCompiledPredecessor,
} from './scalar-helper-history-transition.mjs';
import {
  historicalTransitionStage,
  reconstructHistoricalTransitionChain,
} from './historical-transition-chain.mjs';

const DIST = resolve(process.cwd(), 'packages/core/dist');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blob = (bytes) => createHash('sha1')
  .update(Buffer.from(`blob ${bytes.length}\0`))
  .update(bytes)
  .digest('hex');
const OLD_BY_PATH = new Map(OLD_ROWS.map((row) => [row.path, row]));

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

test('4.6 aggregate authenticates five exact pinned compiled endpoints', () => {
  assert.equal(validateScalarHelperHistory4_6HistoricalTransition(), true);
  assert.equal(
    execFileSync('git', ['rev-parse', TRANSITION.predecessorCommit], { encoding: 'utf8' }).trim(),
    TRANSITION.predecessorCommit,
  );
  assert.equal(
    execFileSync('git', ['rev-parse', TRANSITION.successorCommit], { encoding: 'utf8' }).trim(),
    TRANSITION.successorCommit,
  );
  assert.deepEqual(ROWS.map((row) => row.path), [
    'codegen/kern-stdlib.js',
    'codegen/stdlib-preamble.js',
    'codegen/text-contract.js',
    'ir/semantics/portable-machine-shape.js',
    'ir/semantics/portable-string.js',
  ]);
  for (const row of ROWS) {
    const current = readFileSync(resolve(DIST, row.path));
    const historical = atScalarHelperHistory4_6CompiledPredecessor(row.path, current);
    assert.equal(sha256(current), row.currentDigest, row.path);
    assert.equal(blob(current), row.currentBlob, row.path);
    assert.deepEqual(current, Buffer.from(row.replacements[0].current), row.path);
    assert.equal(sha256(historical), row.expectedDigest, row.path);
    assert.equal(blob(historical), row.expectedBlob, row.path);
    assert.deepEqual(historical, Buffer.from(row.replacements[0].historical), row.path);
    assert.equal(
      execFileSync('git', ['hash-object', '--stdin'], { input: historical, encoding: 'utf8' }).trim(),
      row.expectedBlob,
      row.path,
    );
  }
  assert.equal(
    endpointDigest(ROWS, 'historical'),
    TRANSITION.compiledEndpoints.predecessor,
  );
  assert.equal(endpointDigest(ROWS, 'current'), TRANSITION.compiledEndpoints.successor);
});

test('4.6 aggregate rejects manifest, row-order, digest, blob, and byte drift', () => {
  for (const options of [
    { reconstructions: ROWS.slice(1) },
    { reconstructions: [...ROWS, ROWS[0]] },
    { reconstructions: [ROWS[1], ROWS[0], ...ROWS.slice(2)] },
    { reconstructions: [ROWS[0], ROWS[0], ...ROWS.slice(2)] },
    { transition: { ...TRANSITION, predecessorCommit: '0'.repeat(40) } },
    { transition: { ...TRANSITION, successorCommit: '0'.repeat(40) } },
    { transition: { ...TRANSITION, future: true } },
  ]) {
    assert.throws(
      () => validateScalarHelperHistory4_6HistoricalTransition(options),
      /immutable identity/u,
    );
  }
  for (const mutate of [
    (rows) => { rows[0].currentDigest = '0'.repeat(64); },
    (rows) => { rows[0].expectedDigest = '0'.repeat(64); },
    (rows) => { rows[0].currentBlob = '0'.repeat(40); },
    (rows) => { rows[0].expectedBlob = '0'.repeat(40); },
    (rows) => { rows[0].replacements[0].current += '\n'; },
    (rows) => { rows[0].replacements[0].historical += '\n'; },
    (rows) => { rows[0].future = true; },
    (rows) => { rows[0].replacements[0].future = true; },
  ]) {
    const rows = clonedRows();
    mutate(rows);
    assert.throws(
      () => validateScalarHelperHistory4_6HistoricalTransition({ reconstructions: rows }),
      /immutable identity/u,
    );
  }
  const reordered = clonedRows();
  const { path, expectedDigest, currentDigest, currentBlob, expectedBlob, replacements, claim } =
    reordered[0];
  reordered[0] = {
    claim,
    replacements,
    expectedBlob,
    currentBlob,
    expectedDigest,
    currentDigest,
    path,
  };
  assert.equal(
    validateScalarHelperHistory4_6HistoricalTransition({ reconstructions: reordered }),
    true,
  );
});

test('each 4.6 aggregate row fails closed on successor and literal mutations', () => {
  for (const row of ROWS) {
    const current = Buffer.from(row.replacements[0].current);
    const tampered = Buffer.from(current);
    tampered[0] ^= 1;
    assert.throws(
      () => atScalarHelperHistory4_6CompiledPredecessor(row.path, tampered),
      /broken or misordered successor edge/u,
      row.path,
    );

    const historicalDrift = {
      ...row,
      replacements: [{ ...row.replacements[0], historical: `${row.replacements[0].historical}\n` }],
    };
    assert.throws(
      () => reconstructHistoricalTransitionChain({
        currentSource: current,
        expectedTerminalDigest: row.expectedDigest,
        milestone: `4.6 historical mutation ${row.path}`,
        path: row.path,
        stages: [historicalTransitionStage(historicalDrift)],
      }),
      /reconstructed bytes/u,
      row.path,
    );

    const absentLiteral = {
      ...row,
      replacements: [{ current: 'absent literal', historical: row.replacements[0].historical }],
    };
    assert.throws(
      () => reconstructHistoricalTransitionChain({
        currentSource: current,
        expectedTerminalDigest: row.expectedDigest,
        milestone: `4.6 absent mutation ${row.path}`,
        path: row.path,
        stages: [historicalTransitionStage(absentLiteral)],
      }),
      /occur exactly once/u,
      row.path,
    );

    const duplicated = Buffer.concat([current, current]);
    const duplicateLiteral = { ...row, currentDigest: sha256(duplicated) };
    assert.throws(
      () => reconstructHistoricalTransitionChain({
        currentSource: duplicated,
        expectedTerminalDigest: row.expectedDigest,
        milestone: `4.6 duplicate mutation ${row.path}`,
        path: row.path,
        stages: [historicalTransitionStage(duplicateLiteral)],
      }),
      /occur exactly once/u,
      row.path,
    );
  }
});

test('4.6 aggregate must precede the immutable scalar-helper edge', () => {
  for (const row of ROWS) {
    const oldRow = OLD_BY_PATH.get(row.path);
    assert.notEqual(oldRow, undefined, row.path);
    const current = Buffer.from(row.replacements[0].current);
    const aggregatePredecessor = atScalarHelperHistory4_6CompiledPredecessor(row.path, current);
    assert.deepEqual(aggregatePredecessor, Buffer.from(oldRow.replacements[0].current), row.path);
    assert.deepEqual(
      atScalarHelperHistoryCompiledPredecessor(row.path, aggregatePredecessor),
      Buffer.from(oldRow.replacements[0].historical),
      row.path,
    );
    assert.throws(
      () => atScalarHelperHistoryCompiledPredecessor(row.path, current),
      /broken or misordered successor edge/u,
      row.path,
    );
    assert.throws(
      () => atScalarHelperHistory4_6CompiledPredecessor(row.path, aggregatePredecessor),
      /broken or misordered successor edge/u,
      row.path,
    );
  }
  const unknown = Buffer.from('export const untouched = true;\n');
  assert.deepEqual(atScalarHelperHistory4_6CompiledPredecessor('unknown.js', unknown), unknown);
});
