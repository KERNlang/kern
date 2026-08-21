import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  HOST_COMPANION_HISTORY_4_6_HISTORICAL_TRANSITION as TRANSITION,
  POST_HOST_COMPANION_HISTORY_4_6_COMPILED_RECONSTRUCTIONS as ROWS,
  atHostCompanionHistory4_6CompiledPredecessor,
  validateHostCompanionHistory4_6HistoricalTransition,
} from './host-companion-history-4-6-transition-module.mjs';
import {
  POST_SCALAR_HELPER_HISTORY_4_6_COMPILED_RECONSTRUCTIONS as SCALAR_ROWS,
  atScalarHelperHistory4_6CompiledPredecessor,
  validateScalarHelperHistory4_6HistoricalTransition,
} from './scalar-helper-history-4-6-transition-module.mjs';
import { atScalarHelperHistoryCompiledPredecessor } from './scalar-helper-history-transition.mjs';
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

test('host companion authenticates five exact pinned compiled endpoints', () => {
  assert.equal(validateHostCompanionHistory4_6HistoricalTransition(), true);
  assert.equal(
    execFileSync('git', ['rev-parse', TRANSITION.predecessorCommit], { encoding: 'utf8' }).trim(),
    TRANSITION.predecessorCommit,
  );
  assert.equal(
    execFileSync('git', ['rev-parse', TRANSITION.successorCommit], { encoding: 'utf8' }).trim(),
    TRANSITION.successorCommit,
  );
  assert.deepEqual(ROWS.map((row) => row.path), [
    'codegen-expression.js',
    'codegen/host-namespace-ir.js',
    'codegen/host-namespace.js',
    'index.js',
    'spec.js',
  ]);
  for (const row of ROWS) {
    const current = readFileSync(resolve(DIST, row.path));
    const historical = atHostCompanionHistory4_6CompiledPredecessor(row.path, current);
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

test('host companion rejects manifest and identity drift but accepts property reordering', () => {
  for (let omitted = 0; omitted < ROWS.length; omitted += 1) {
    assert.throws(
      () => validateHostCompanionHistory4_6HistoricalTransition({
        reconstructions: ROWS.filter((_, index) => index !== omitted),
      }),
      /immutable identity/u,
    );
  }
  for (let omitted = 0; omitted < SCALAR_ROWS.length; omitted += 1) {
    assert.throws(
      () => validateScalarHelperHistory4_6HistoricalTransition({
        reconstructions: SCALAR_ROWS.filter((_, index) => index !== omitted),
      }),
      /immutable identity/u,
    );
  }
  for (const options of [
    { reconstructions: [...ROWS, ROWS[0]] },
    { reconstructions: [ROWS[1], ROWS[0], ...ROWS.slice(2)] },
    { reconstructions: [ROWS[0], ROWS[0], ...ROWS.slice(2)] },
    { transition: { ...TRANSITION, predecessorCommit: '0'.repeat(40) } },
    { transition: { ...TRANSITION, successorCommit: '0'.repeat(40) } },
    { transition: { ...TRANSITION, future: true } },
  ]) {
    assert.throws(
      () => validateHostCompanionHistory4_6HistoricalTransition(options),
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
      () => validateHostCompanionHistory4_6HistoricalTransition({ reconstructions: rows }),
      /immutable identity/u,
    );
  }

  const reordered = clonedRows();
  const { path, currentDigest, expectedDigest, currentBlob, expectedBlob, replacements, claim } =
    reordered[0];
  reordered[0] = { claim, replacements, expectedBlob, currentBlob, expectedDigest, currentDigest, path };
  assert.equal(
    validateHostCompanionHistory4_6HistoricalTransition({ reconstructions: reordered }),
    true,
  );
  const reorderedTransition = {
    rowsDigest: TRANSITION.rowsDigest,
    compiledEndpoints: {
      successor: TRANSITION.compiledEndpoints.successor,
      predecessor: TRANSITION.compiledEndpoints.predecessor,
    },
    compiledManifest: {
      digest: TRANSITION.compiledManifest.digest,
      count: TRANSITION.compiledManifest.count,
    },
    successorCommit: TRANSITION.successorCommit,
    predecessorCommit: TRANSITION.predecessorCommit,
    claim: TRANSITION.claim,
  };
  assert.equal(
    validateHostCompanionHistory4_6HistoricalTransition({ transition: reorderedTransition }),
    true,
  );
});

test('each host companion row fails closed on successor and literal mutations', () => {
  for (const row of ROWS) {
    const current = Buffer.from(row.replacements[0].current);
    const tampered = Buffer.from(current);
    tampered[0] ^= 1;
    assert.throws(
      () => atHostCompanionHistory4_6CompiledPredecessor(row.path, tampered),
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
        milestone: `host companion historical mutation ${row.path}`,
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
        milestone: `host companion absent mutation ${row.path}`,
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
        milestone: `host companion duplicate mutation ${row.path}`,
        path: row.path,
        stages: [historicalTransitionStage(duplicateLiteral)],
      }),
      /occur exactly once/u,
      row.path,
    );
  }
});

test('host companion and scalar 4.6 stages are path-disjoint and commute', () => {
  const scalarPaths = new Set(SCALAR_ROWS.map((row) => row.path));
  assert.equal(ROWS.some((row) => scalarPaths.has(row.path)), false);
  for (const row of ROWS) {
    const current = Buffer.from(row.replacements[0].current);
    const companionFirst = atScalarHelperHistory4_6CompiledPredecessor(
      row.path,
      atHostCompanionHistory4_6CompiledPredecessor(row.path, current),
    );
    const scalarFirst = atHostCompanionHistory4_6CompiledPredecessor(
      row.path,
      atScalarHelperHistory4_6CompiledPredecessor(row.path, current),
    );
    assert.deepEqual(companionFirst, scalarFirst, row.path);
    assert.deepEqual(
      atScalarHelperHistoryCompiledPredecessor(row.path, scalarFirst),
      scalarFirst,
      row.path,
    );
    assert.throws(
      () => atHostCompanionHistory4_6CompiledPredecessor(row.path, scalarFirst),
      /broken or misordered successor edge/u,
      row.path,
    );
  }
  for (const row of SCALAR_ROWS) {
    const current = Buffer.from(row.replacements[0].current);
    const companionFirst = atScalarHelperHistory4_6CompiledPredecessor(
      row.path,
      atHostCompanionHistory4_6CompiledPredecessor(row.path, current),
    );
    const scalarFirst = atHostCompanionHistory4_6CompiledPredecessor(
      row.path,
      atScalarHelperHistory4_6CompiledPredecessor(row.path, current),
    );
    assert.deepEqual(companionFirst, scalarFirst, row.path);
  }
  const unknown = Buffer.from('export const untouched = true;\n');
  assert.deepEqual(atHostCompanionHistory4_6CompiledPredecessor('unknown.js', unknown), unknown);
});
