import assert from 'node:assert/strict';
import test from 'node:test';

import { RESERVED_LABELS_PATH, compiledCorePaths, readRepositoryText, sourceFilesUnder } from '../kern-5-d0-contracts-split/support.mjs';
import {
  NEW_EMITTED_LABELS,
  RESERVED_LABELS,
  SPENDING_SLICE,
  SPENT_LABELS_WITH_FINALLY,
  SPENT_LABELS_WITHOUT_FINALLY,
  TARGET_KIR_TOKENS_WITH_FINALLY,
  TARGET_KIR_TOKENS_WITHOUT_FINALLY,
  UNSPENT_AFTER_FINALLY,
} from './pins.mjs';
import { repositoryText } from './k0-support.mjs';

const LABEL_PATTERN = /KIR_[A-Z_0-9]+/gu;
const CROSS_TRY_LABEL = 'KIR_LOOP_JUMP_CROSSES_TRY';

function registry() {
  return JSON.parse(readRepositoryText(RESERVED_LABELS_PATH));
}

function unspentLabels(value) {
  return RESERVED_LABELS.filter((label) => (value.spentBy[label] ?? null) === null);
}

function finallyLanded(value) {
  return Object.hasOwn(value.spentBy, 'KIR_TRY_REQUIRES_CATCH_OR_FINALLY');
}

function emittedTokens() {
  const tokens = new Set();
  for (const path of sourceFilesUnder('packages/core/src/kir-runtime')) {
    for (const match of readRepositoryText(path).matchAll(LABEL_PATTERN)) tokens.add(match[0]);
  }
  return [...tokens].sort();
}

// The registry SET never grows: only `spentBy` moves. Four new labels arrive as emitted-only,
// exactly as `KIR_JUMP_WITHOUT_LOOP_FRAME` did in rt12. GREEN at base.
test('the reserved label set is still exactly the pinned eight, sorted', () => {
  assert.deepEqual(
    registry().labels,
    [...RESERVED_LABELS],
    'D_REGISTRY_SET: D spends labels and adds none; the registry set must not grow',
  );
});

test('spentBy names exactly the labels D emits, each attributed to this slice', () => {
  const value = registry();
  const expected = finallyLanded(value) ? SPENT_LABELS_WITH_FINALLY : SPENT_LABELS_WITHOUT_FINALLY;
  assert.deepEqual(
    Object.keys(value.spentBy).sort(),
    [...expected],
    `D_REGISTRY_SPENT: spentBy must name exactly the ${expected.length} labels D emits in this configuration`,
  );
  for (const [label, slice] of Object.entries(value.spentBy)) {
    assert.equal(slice, SPENDING_SLICE, `D_REGISTRY_SPENT: spentBy[${label}] must attribute the spend to ${SPENDING_SLICE}`);
  }
});

// D-7d, exact. When the finally commit lands, `KIR_TRY_REQUIRES_CATCH` stops being emitted because
// `try{}finally{}` becomes legal, so its key is DELETED -- not set to null, which D.0 forbids.
test('the KIR_TRY_REQUIRES_CATCH key is deleted once the finally commit lands, never nulled', () => {
  const value = registry();
  assert.deepEqual(
    unspentLabels(value).filter((label) => Object.hasOwn(value.spentBy, label)),
    [],
    'D_REGISTRY_SPENT: a spentBy entry may never resolve to null',
  );
  if (!finallyLanded(value)) return;
  assert.deepEqual(
    unspentLabels(value),
    [...UNSPENT_AFTER_FINALLY],
    'D_REGISTRY_TRANSITION: with finally landed, KIR_TRY_REQUIRES_CATCH is the one label handed back unspent',
  );
  assert.equal(
    Object.hasOwn(value.spentBy, 'KIR_TRY_REQUIRES_CATCH'),
    false,
    'D_REGISTRY_TRANSITION: the key must be deleted, so the not-emitted scan enforces it again',
  );
});

test('every label with no spentBy entry appears in no file under packages/core/src', () => {
  const unspent = unspentLabels(registry());
  for (const path of sourceFilesUnder('packages/core/src')) {
    const source = readRepositoryText(path);
    for (const label of unspent) {
      assert.equal(
        source.includes(label),
        false,
        `D_LABEL_SPENT: ${path} names the reserved label ${label}, which spentBy does not exempt`,
      );
    }
  }
});

test('every label with no spentBy entry appears in neither built kernel', () => {
  const unspent = unspentLabels(registry());
  const kernels = compiledCorePaths().filter(
    (path) => path.startsWith('compiler/kir-js-esm/') || path.startsWith('compiler/kir-python/'),
  );
  assert.ok(kernels.length > 0, 'D_KERNEL_SCAN_EMPTY: the built kernel inventory must not be empty');
  for (const path of kernels) {
    const source = readRepositoryText(`packages/core/dist/${path}`);
    for (const label of unspent) {
      assert.equal(source.includes(label), false, `D_LABEL_SPENT: built ${path} names unspent ${label}`);
    }
  }
});

// Each spent label must actually be emitted from `statements.ts`, which is where the linker's own
// refusals live. A spentBy entry with no emitting site is the reverse vacuity: a label marked spent
// that no gate raises.
test('every spent label is genuinely emitted from statements.ts, so no spend is on paper only', () => {
  const value = registry();
  const statements = repositoryText('packages/core/src/kir-runtime/linked-kir-program/statements.ts');
  for (const label of Object.keys(value.spentBy)) {
    assert.ok(
      statements.includes(label),
      `D_SPEND_ON_PAPER: ${label} is marked spent but statements.ts raises it nowhere`,
    );
  }
});

test('the four new emitted labels are raised and are not registry members', () => {
  const statements = repositoryText('packages/core/src/kir-runtime/linked-kir-program/statements.ts');
  const registryLabels = new Set(registry().labels);
  const missing = NEW_EMITTED_LABELS.filter(
    (label) => label !== 'KIR_FINALLY_WITHOUT_TRY' && !statements.includes(label),
  );
  assert.deepEqual(
    missing,
    [],
    'D_LABEL_UNRAISED: the emitted-only labels must be raised from statements.ts, or their gates do not exist',
  );
  for (const label of NEW_EMITTED_LABELS) {
    assert.equal(
      registryLabels.has(label),
      false,
      `D_REGISTRY_SET: ${label} is a new emitted label and must never join the reserved eight`,
    );
  }
});

test('the emitted KIR token set under kir-runtime equals the recounted list exactly', () => {
  const value = registry();
  const expected = finallyLanded(value) ? TARGET_KIR_TOKENS_WITH_FINALLY : TARGET_KIR_TOKENS_WITHOUT_FINALLY;
  const emitted = emittedTokens();
  const missing = expected.filter((token) => !emitted.includes(token));
  const extra = emitted.filter((token) => !expected.includes(token));
  assert.deepEqual(
    emitted,
    [...expected],
    `D_LABEL_VOCABULARY: the KIR_* token set under kir-runtime must be the recounted ${expected.length}` +
      (missing.length > 0 ? ` -- missing: ${missing.join(', ')}` : '') +
      (extra.length > 0 ? ` -- extra: ${extra.join(', ')}` : ''),
  );
  const unspent = new Set(unspentLabels(value));
  for (const token of emitted) {
    assert.equal(unspent.has(token), false, `D_LABEL_SPENT: ${token} is both emitted and unspent`);
  }
});

// QD-4, and it is a correction to the spec. rt12's scan is NOT restricted to three URLs: it walks
// every `.ts` file under `packages/core/src/kir-runtime/` recursively, `statements.ts` included. So
// it is already complete and will break LOUDLY the moment D spends the label -- the opposite of the
// vacuous-GREEN failure mode the spec predicts. The right action is therefore to RETIRE the absence
// assertion and replace it with a spend assertion, not to widen a scan that needs no widening.
test('rt12 own cross-try scan is retired rather than widened, because it was already complete', () => {
  const rt12 = repositoryText('scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs');
  const finallyIsLanded = finallyLanded(registry());
  if (!finallyIsLanded) {
    assert.ok(
      rt12.includes('must not be emitted yet'),
      'D_PRIOR_PIN_STALE: with finally cut to D2 the label stays unspent, so rt12 own absence scan must be untouched',
    );
    return;
  }
  assert.equal(
    rt12.includes('must not be emitted yet'),
    false,
    `D_PRIOR_PIN_STALE: rt12 asserts ${CROSS_TRY_LABEL} is emitted nowhere under kir-runtime, and D spends it in statements.ts; the absence scan must be retired`,
  );
  assert.ok(
    rt12.includes(SPENDING_SLICE),
    `D_PRIOR_PIN_STALE: rt12 row must flip to asserting ${CROSS_TRY_LABEL} is spent by ${SPENDING_SLICE} in statements.ts`,
  );
});

// D-4f1's end state, asserted in the branch the D-7f gate can take: with no `finally` in the union
// there is nothing a jump could skip, so the label goes back to reserved-and-unspent and rt12's own
// scan stays correct untouched.
test('if the finally commit is cut, the cross-try label is spent nowhere and keeps no spentBy entry', () => {
  const value = registry();
  if (finallyLanded(value)) return;
  assert.equal(
    Object.hasOwn(value.spentBy, CROSS_TRY_LABEL),
    false,
    `D_REGISTRY_TRANSITION: with finally cut, ${CROSS_TRY_LABEL} must keep no spentBy entry`,
  );
  for (const path of sourceFilesUnder('packages/core/src')) {
    assert.equal(
      readRepositoryText(path).includes(CROSS_TRY_LABEL),
      false,
      `D_LABEL_SPENT: with finally cut, ${CROSS_TRY_LABEL} must appear in no file under packages/core/src`,
    );
  }
});

// D.0's own row said the registry lands with everything unspent, and its comment says slice D moves
// it. The move has to be real, or D.0 goes RED the moment D spends a label.
test('the D.0 lands-unspent row has been moved, because D spends into it', () => {
  const d0 = repositoryText('scripts/kern-5-d0-contracts-split/reserved-labels.test.mjs');
  assert.equal(
    d0.includes('D.0 must land with spentBy empty'),
    false,
    'D_PRIOR_PIN_STALE: D.0 asserts spentBy deepEquals {}; D spends labels and must move that row',
  );
});
