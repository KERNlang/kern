import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ENTRY,
  LIMITS,
  POSITIONS,
  POSITION_NAMES,
  PROBE_MATRIX,
  PROBE_MATRIX_FORMAT,
  SHAPE_NAMES,
  compileJavaScript,
  linkVerifiedKernKirProgram,
  project,
} from './k0-support.mjs';
import { F5_WALLED_POSITIONS } from './pins.mjs';

function pinned(name) {
  const row = PROBE_MATRIX.rows.find((candidate) => candidate.name === name);
  assert.ok(row !== undefined, `F_PROBE_MISSING: ${name} has no pinned probe row`);
  return row;
}

test('the probe matrix is the slice-F format and covers every fixture exactly once', () => {
  assert.equal(PROBE_MATRIX.format, PROBE_MATRIX_FORMAT);
  assert.deepEqual(
    PROBE_MATRIX.rows.map((row) => row.name).sort(),
    [...POSITION_NAMES],
    'F_PROBE_COVERAGE: the probe matrix is not exactly the fixture set',
  );
  assert.equal(new Set(PROBE_MATRIX.rows.map((row) => row.name)).size, PROBE_MATRIX.rows.length);
});

// The point of this file: a RED row elsewhere must be RED because the LINKER refuses `with`, not
// because the frontend never handed it over. Every fixture the suite credits to a link label is
// pinned as `projected` here, and every fixture F5 walls is pinned as `not-projected`.
test('every fixture keeps its pinned F5 projection status', async () => {
  for (const name of POSITION_NAMES) {
    const verified = await project(POSITIONS[name]());
    const status = verified === undefined ? 'not-projected' : 'projected';
    assert.equal(status, pinned(name).projection, `F_PROBE_DRIFT: ${name} changed F5 projection status`);
  }
});

test('exactly the pinned fixtures are walled by F5', () => {
  const walled = PROBE_MATRIX.rows.filter((row) => row.projection === 'not-projected').map((row) => row.name);
  assert.deepEqual(walled.sort(), [...F5_WALLED_POSITIONS], 'F_F5_WALL_DRIFT: the F5-walled fixture set moved');
});

// Leg parity, not a pinned decision: the rt1/javascript columns move the moment F1 lands, but the
// two legs share one linker and must never disagree, at base or after.
test('a projected fixture reports the same link decision on RT-1 and on the JavaScript leg', async () => {
  for (const name of POSITION_NAMES) {
    if (pinned(name).projection !== 'projected') continue;
    const verified = await project(POSITIONS[name]());
    const linked = linkVerifiedKernKirProgram(verified, ENTRY, LIMITS);
    const rt1 = linked.outcome === 'success' ? 'admitted' : linked.code;
    const javascript = compileJavaScript(verified);
    const js = javascript.outcome === 'failure' ? javascript.code : 'admitted';
    assert.equal(rt1, js, `F_LEG_ADMISSION_SPLIT: ${name} links on one leg and not the other`);
  }
});

// The twins carry no `with` at all, so they must be admitted at base and stay admitted: they are the
// control arm of every metering and expansion equality in the suite.
test('every expansion twin is admitted on both legs at base', async () => {
  for (const shape of SHAPE_NAMES) {
    const name = `twin-${shape}`;
    const verified = await project(POSITIONS[name]());
    assert.ok(verified !== undefined, `F_TWIN_BROKEN: ${name} must project`);
    assert.equal(
      linkVerifiedKernKirProgram(verified, ENTRY, LIMITS).outcome,
      'success',
      `F_TWIN_BROKEN: ${name} must link at base, or every equality it anchors is vacuous`,
    );
    assert.equal(compileJavaScript(verified).outcome, 'success', `F_TWIN_BROKEN: ${name} must emit at base`);
  }
});

// A refused row must carry the refusal REASON, and an admitted one must carry none: a matrix that
// recorded a message beside an admission, or a refusal with no message, is a matrix nobody remeasured.
test('every pinned row records a link message exactly when it records a refusal', () => {
  for (const row of PROBE_MATRIX.rows) {
    const refused = row.projection === 'projected' && row.rt1 !== 'admitted';
    assert.equal(
      typeof row.linkMessage === 'string',
      refused,
      `F_PROBE_SHAPE: ${row.name} must record a link message exactly when the linker refuses it`,
    );
  }
});
