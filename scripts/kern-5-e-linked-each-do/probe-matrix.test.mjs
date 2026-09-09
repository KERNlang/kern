import assert from 'node:assert/strict';
import test from 'node:test';

import { compileJavaScript, compilePython } from '../kern-5-rt4-user-fn-call/k0-support.mjs';
import {
  ENTRY,
  LIMITS,
  POSITIONS,
  POSITION_NAMES,
  PROBE_MATRIX,
  linkVerifiedKernKirProgram,
  project,
} from './k0-support.mjs';
import { F5_WALLED_POSITIONS } from './pins.mjs';

function pinned(name) {
  const row = PROBE_MATRIX.rows.find((candidate) => candidate.name === name);
  assert.ok(row !== undefined, `E_PROBE_MISSING: ${name} has no pinned probe row`);
  return row;
}

test('the probe matrix is the slice-E format and covers every fixture exactly once', () => {
  assert.equal(PROBE_MATRIX.format, 'kern.kern-5-e.probe-matrix.v1');
  assert.deepEqual(
    PROBE_MATRIX.rows.map((row) => row.name).sort(),
    [...POSITION_NAMES],
    'E_PROBE_COVERAGE: the probe matrix is not exactly the fixture set',
  );
  assert.equal(new Set(PROBE_MATRIX.rows.map((row) => row.name)).size, PROBE_MATRIX.rows.length);
});

// The point of this file: a RED row elsewhere must be RED because the linker refuses the KIND, not
// because the frontend never handed it over. Every fixture the suite credits to a link label is
// pinned as `projected` here, and every fixture F5 walls is pinned as `not-projected`.
test('every fixture keeps its pinned F5 projection status', async () => {
  for (const name of POSITION_NAMES) {
    const verified = await project(POSITIONS[name]());
    const status = verified === undefined ? 'not-projected' : 'projected';
    assert.equal(status, pinned(name).projection, `E_PROBE_DRIFT: ${name} changed F5 projection status`);
  }
});

test('exactly the three pinned fixtures are walled by F5', () => {
  const walled = PROBE_MATRIX.rows.filter((row) => row.projection === 'not-projected').map((row) => row.name);
  assert.deepEqual(walled.sort(), [...F5_WALLED_POSITIONS], 'E_F5_WALL_DRIFT: the F5-walled fixture set moved');
});

test('a projected fixture reports the same link decision on RT-1 and on the JavaScript leg', async () => {
  for (const name of POSITION_NAMES) {
    const row = pinned(name);
    if (row.projection !== 'projected') continue;
    const verified = await project(POSITIONS[name]());
    const linked = linkVerifiedKernKirProgram(verified, ENTRY, LIMITS);
    const rt1 = linked.outcome === 'success' ? 'admitted' : linked.code;
    const javascript = compileJavaScript(verified);
    const js = javascript.outcome === 'failure' ? javascript.code : 'admitted';
    assert.equal(rt1, js, `E_LEG_ADMISSION_SPLIT: ${name} links on one leg and not the other`);
  }
});

// The three twins carry no `do` and no `each`, so they must be admitted on every leg at base and
// stay admitted: they are the control arm of every metering delta in the suite.
test('the metering twins are admitted on all three legs', async () => {
  for (const name of ['do-bare-twin', 'do-sync-call-twin', 'each-plain-twin']) {
    const verified = await project(POSITIONS[name]());
    assert.ok(verified !== undefined, name);
    assert.equal(linkVerifiedKernKirProgram(verified, ENTRY, LIMITS).outcome, 'success', name);
    assert.equal(compileJavaScript(verified).outcome, 'success', name);
    assert.equal(compilePython(verified).outcome, 'success', name);
  }
});
