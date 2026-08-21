import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOST_COMPANION_HISTORY_4_6_HISTORICAL_TRANSITION as COMPANION_TRANSITION,
  validateHostCompanionHistory4_6HistoricalTransition,
} from './host-companion-history-4-6-transition-module.mjs';
import {
  POST_SCALAR_HELPER_HISTORY_4_6_COMPILED_RECONSTRUCTIONS as SCALAR4_ROWS,
  SCALAR_HELPER_HISTORY_4_6_HISTORICAL_TRANSITION as SCALAR4_TRANSITION,
  validateScalarHelperHistory4_6HistoricalTransition,
} from './scalar-helper-history-4-6-transition-module.mjs';
import {
  POST_SCALAR_HELPER_HISTORY_COMPILED_RECONSTRUCTIONS as OLD_ROWS,
  SCALAR_HELPER_HISTORY_HISTORICAL_TRANSITION as OLD_TRANSITION,
  validateScalarHelperHistoryHistoricalTransition,
} from './scalar-helper-history-transition.mjs';

function hiddenExtra(value) {
  const copy = { ...value };
  Object.defineProperty(copy, 'hiddenExtra', { value: true });
  return copy;
}

function accessor(value, key) {
  const copy = { ...value };
  const original = copy[key];
  Object.defineProperty(copy, key, {
    enumerable: true,
    get() { return original; },
  });
  return copy;
}

function nonEnumerableExpectedField(value, key) {
  const copy = { ...value };
  Object.defineProperty(copy, key, { value: copy[key], enumerable: false });
  return copy;
}

function reorderedScalar4Transition() {
  return {
    rowsDigest: SCALAR4_TRANSITION.rowsDigest,
    compiledEndpoints: {
      successor: SCALAR4_TRANSITION.compiledEndpoints.successor,
      predecessor: SCALAR4_TRANSITION.compiledEndpoints.predecessor,
    },
    compiledManifest: {
      digest: SCALAR4_TRANSITION.compiledManifest.digest,
      count: SCALAR4_TRANSITION.compiledManifest.count,
    },
    successorCommit: SCALAR4_TRANSITION.successorCommit,
    predecessorCommit: SCALAR4_TRANSITION.predecessorCommit,
    claim: SCALAR4_TRANSITION.claim,
  };
}

function reorderedOldTransition() {
  return {
    claim: OLD_TRANSITION.claim,
    predecessorCommit: OLD_TRANSITION.predecessorCommit,
    successorCommit: OLD_TRANSITION.successorCommit,
    compiledInventory: {
      digest: OLD_TRANSITION.compiledInventory.digest,
      count: OLD_TRANSITION.compiledInventory.count,
    },
    compiledManifest: {
      digest: OLD_TRANSITION.compiledManifest.digest,
      count: OLD_TRANSITION.compiledManifest.count,
    },
    compiledEndpoints: {
      successor: OLD_TRANSITION.compiledEndpoints.successor,
      predecessor: OLD_TRANSITION.compiledEndpoints.predecessor,
    },
    rowsDigest: OLD_TRANSITION.rowsDigest,
  };
}

function reorderedRow(row) {
  const { path, currentDigest, expectedDigest, currentBlob, expectedBlob, replacements, claim } = row;
  return { claim, replacements, expectedBlob, currentBlob, expectedDigest, currentDigest, path };
}

const SCALAR4_TRANSITION_FORGERIES = [
  ['forged toJSON values', () => ({
    ...SCALAR4_TRANSITION,
    successorCommit: '0'.repeat(40),
    toJSON() { return SCALAR4_TRANSITION; },
  })],
  ['custom prototype', () => Object.assign(Object.create({ inherited: true }), SCALAR4_TRANSITION)],
  ['symbol key', () => ({ ...SCALAR4_TRANSITION, [Symbol('extra')]: true })],
  ['non-enumerable extra key', () => hiddenExtra(SCALAR4_TRANSITION)],
  ['accessor field', () => accessor(SCALAR4_TRANSITION, 'successorCommit')],
];

for (const [name, forge] of SCALAR4_TRANSITION_FORGERIES) {
  test(`scalar 4.6 rejects transition ${name}`, () => {
    assert.throws(
      () => validateScalarHelperHistory4_6HistoricalTransition({ transition: forge() }),
      /immutable identity/u,
    );
  });
}

test('scalar 4.6 accepts an exact transition key set in a different insertion order', () => {
  assert.equal(
    validateScalarHelperHistory4_6HistoricalTransition({ transition: reorderedScalar4Transition() }),
    true,
  );
});

test('scalar 4.6 accepts an exact row key set in a different insertion order', () => {
  assert.equal(
    validateScalarHelperHistory4_6HistoricalTransition({
      reconstructions: [reorderedRow(SCALAR4_ROWS[0]), ...SCALAR4_ROWS.slice(1)],
    }),
    true,
  );
});

const COMPANION_GREEN_CONTROLS = [
  ['toJSON extra key', () => ({ ...COMPANION_TRANSITION, toJSON() { return COMPANION_TRANSITION; } })],
  ['custom prototype', () => Object.assign(Object.create({ inherited: true }), COMPANION_TRANSITION)],
  ['symbol key', () => ({ ...COMPANION_TRANSITION, [Symbol('extra')]: true })],
  ['non-enumerable extra key', () => hiddenExtra(COMPANION_TRANSITION)],
];

for (const [name, forge] of COMPANION_GREEN_CONTROLS) {
  test(`host companion already rejects transition ${name}`, () => {
    assert.throws(
      () => validateHostCompanionHistory4_6HistoricalTransition({ transition: forge() }),
      /immutable identity/u,
    );
  });
}

for (const [name, forge] of [
  ['accessor expected field', () => accessor(COMPANION_TRANSITION, 'successorCommit')],
  ['non-enumerable expected field', () => nonEnumerableExpectedField(COMPANION_TRANSITION, 'successorCommit')],
]) {
  test(`host companion rejects transition ${name}`, () => {
    assert.throws(
      () => validateHostCompanionHistory4_6HistoricalTransition({ transition: forge() }),
      /immutable identity/u,
    );
  });
}

const OLD_TRANSITION_FORGERIES = [
  ['forged nested toJSON values', () => ({
    ...OLD_TRANSITION,
    compiledInventory: {
      count: 0,
      digest: '0'.repeat(64),
      toJSON() { return OLD_TRANSITION.compiledInventory; },
    },
  })],
  ['custom prototype', () => Object.assign(Object.create({ inherited: true }), OLD_TRANSITION)],
  ['symbol key', () => ({ ...OLD_TRANSITION, [Symbol('extra')]: true })],
  ['non-enumerable extra key', () => hiddenExtra(OLD_TRANSITION)],
  ['accessor field', () => accessor(OLD_TRANSITION, 'successorCommit')],
];

for (const [name, forge] of OLD_TRANSITION_FORGERIES) {
  test(`old scalar rejects transition ${name}`, () => {
    assert.throws(
      () => validateScalarHelperHistoryHistoricalTransition({ transition: forge() }),
      /immutable identity/u,
    );
  });
}

test('old scalar accepts exact nested transition key sets in a different insertion order', () => {
  assert.equal(
    validateScalarHelperHistoryHistoricalTransition({ transition: reorderedOldTransition() }),
    true,
  );
});

const OLD_ROW_FORGERIES = [
  ['toJSON key', () => {
    const row = { ...OLD_ROWS[0] };
    Object.defineProperty(row, 'toJSON', { value() { return {}; } });
    return row;
  }],
  ['custom prototype', () => Object.assign(Object.create({ inherited: true }), OLD_ROWS[0])],
  ['symbol key', () => ({ ...OLD_ROWS[0], [Symbol('extra')]: true })],
  ['non-enumerable extra key', () => hiddenExtra(OLD_ROWS[0])],
  ['accessor field', () => accessor(OLD_ROWS[0], 'currentDigest')],
];

for (const [name, forge] of OLD_ROW_FORGERIES) {
  test(`old scalar rejects row ${name}`, () => {
    assert.throws(
      () => validateScalarHelperHistoryHistoricalTransition({
        reconstructions: [forge(), ...OLD_ROWS.slice(1)],
      }),
      /immutable identity/u,
    );
  });
}

test('old scalar accepts an exact row key set in a different insertion order', () => {
  assert.equal(
    validateScalarHelperHistoryHistoricalTransition({
      reconstructions: [reorderedRow(OLD_ROWS[0]), ...OLD_ROWS.slice(1)],
    }),
    true,
  );
});
