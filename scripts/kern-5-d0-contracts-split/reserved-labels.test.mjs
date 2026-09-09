import assert from 'node:assert/strict';
import test from 'node:test';

import { BASE_KIR_TOKENS, RESERVED_LABELS, RESERVED_LABELS_FORMAT } from './pins.mjs';
import {
  KIR_RUNTIME_DIR,
  RESERVED_LABELS_PATH,
  compiledCorePaths,
  exists,
  readRepositoryText,
  sourceFilesUnder,
} from './support.mjs';

const LABEL_PATTERN = /KIR_[A-Z_0-9]+/gu;

function registry() {
  assert.ok(exists(RESERVED_LABELS_PATH), `D0_REGISTRY_MISSING: ${RESERVED_LABELS_PATH} does not exist`);
  return JSON.parse(readRepositoryText(RESERVED_LABELS_PATH));
}

function unspentLabels(value) {
  return RESERVED_LABELS.filter((label) => (value.spentBy[label] ?? null) === null);
}

function kirTokensUnder(relativeDirectory) {
  const tokens = new Set();
  for (const path of sourceFilesUnder(relativeDirectory)) {
    for (const match of readRepositoryText(path).matchAll(LABEL_PATTERN)) tokens.add(match[0]);
  }
  return [...tokens].sort();
}

test('reserved-labels.json exists and is frozen-shaped', () => {
  const value = registry();
  assert.deepEqual(
    Object.keys(value).sort(),
    ['format', 'labels', 'spentBy'],
    'D0_REGISTRY_SHAPE: the registry must carry exactly format, labels and spentBy',
  );
  assert.equal(value.format, RESERVED_LABELS_FORMAT, 'D0_REGISTRY_SHAPE: the format tag drifted');
  assert.ok(Array.isArray(value.labels), 'D0_REGISTRY_SHAPE: labels must be an array');
  assert.ok(
    value.spentBy !== null && typeof value.spentBy === 'object' && !Array.isArray(value.spentBy),
    'D0_REGISTRY_SHAPE: spentBy must be an object',
  );
});

test('the registry holds exactly the eight try-family labels, sorted', () => {
  const value = registry();
  assert.deepEqual(
    value.labels,
    [...RESERVED_LABELS],
    'D0_REGISTRY_SET: the reserved label set is not the pinned eight in sorted order',
  );
});

// D.0 landed with nothing spent; slice D moved this row as QD-3 said it would. What survives the
// move is the interlock, not the emptiness: every key is a reserved label attributed to a slice, and
// the unspent remainder is exactly the registry minus the spent set, which is what keeps the
// not-emitted scan below honest instead of silently narrowing.
test('the registry spends only reserved labels, and the unspent remainder is the complement', () => {
  const value = registry();
  const spent = Object.keys(value.spentBy).sort();
  assert.deepEqual(
    spent.filter((label) => !RESERVED_LABELS.includes(label)),
    [],
    'D0_REGISTRY_SPENT: spentBy may only name a reserved label',
  );
  assert.deepEqual(
    unspentLabels(value),
    RESERVED_LABELS.filter((label) => !spent.includes(label)),
  );
});

// The forward interlock for slice D: a label it emits must gain a spentBy entry in the same commit,
// or the scans above go RED.
test('spentBy may only name a reserved label, and only with a slice name', () => {
  const value = registry();
  assert.deepEqual(
    unspentLabels(value).filter((label) => Object.hasOwn(value.spentBy, label)),
    [],
    'D0_REGISTRY_SPENT: a spentBy entry may not resolve to null',
  );
  for (const [label, slice] of Object.entries(value.spentBy)) {
    assert.ok(
      RESERVED_LABELS.includes(label),
      `D0_REGISTRY_SET: spentBy names ${label}, which is not a reserved label`,
    );
    assert.ok(
      typeof slice === 'string' && slice.length > 0,
      `D0_REGISTRY_SET: spentBy[${label}] must name the spending slice`,
    );
  }
});

// Whole tokens, never substrings: `KIR_TRY_REQUIRES_CATCH` is a prefix of the spent
// `KIR_TRY_REQUIRES_CATCH_OR_FINALLY`, so an `includes` scan reports the unspent label as emitted
// however the linker is written.
test('no unspent reserved label appears anywhere under packages/core/src', () => {
  const unspent = new Set(unspentLabels(registry()));
  for (const path of sourceFilesUnder('packages/core/src')) {
    for (const match of readRepositoryText(path).matchAll(LABEL_PATTERN)) {
      assert.equal(
        unspent.has(match[0]),
        false,
        `D0_LABEL_SPENT: ${path} names the reserved label ${match[0]}, which spentBy does not exempt`,
      );
    }
  }
});

test('no unspent reserved label appears in either built kernel', () => {
  const unspent = unspentLabels(registry());
  const kernels = compiledCorePaths().filter(
    (path) => path.startsWith('compiler/kir-js-esm/') || path.startsWith('compiler/kir-python/'),
  );
  assert.ok(kernels.length > 0, 'D0_KERNEL_SCAN_EMPTY: the built kernel inventory must not be empty');
  for (const path of kernels) {
    const source = readRepositoryText(`packages/core/dist/${path}`);
    for (const label of unspent) {
      assert.equal(
        source.includes(label),
        false,
        `D0_LABEL_SPENT: built ${path} names the reserved label ${label}, which spentBy does not exempt`,
      );
    }
  }
});

// QD-3's interlock, proven directly against the helper rather than the (empty at D.0) registry
// file: a label named in spentBy must fall out of the absence scan above, and every other reserved
// label must stay enforced.
test('unspentLabels exempts a spent label from the absence scan and keeps enforcing the rest', () => {
  const [spent, ...stillUnspent] = RESERVED_LABELS;
  const synthetic = { labels: [...RESERVED_LABELS], spentBy: { [spent]: 'kern-5-d' } };
  assert.deepEqual(
    unspentLabels(synthetic),
    stillUnspent,
    'D0_LABEL_SPENT: a spentBy entry must exempt only its own label from the absence scan',
  );
});

// Moved by slice D, which spends into the reservation. D.0's own forty stay the floor: every token
// it pinned is still emitted, every token added is attributed to a spentBy entry or is an
// emitted-only label the registry never held, and no UNSPENT reserved label is emitted.
test('the emitted KIR label vocabulary keeps D.0 forty and adds only labels a spend accounts for', () => {
  const value = registry();
  const emitted = kirTokensUnder(KIR_RUNTIME_DIR);
  const missing = [...BASE_KIR_TOKENS].filter((token) => !emitted.includes(token));
  assert.deepEqual(missing, [], `D0_LABEL_VOCABULARY: D.0 pinned tokens went missing: ${missing.join(', ')}`);
  const reserved = new Set(RESERVED_LABELS);
  const unaccounted = emitted.filter(
    (token) => !BASE_KIR_TOKENS.includes(token) && reserved.has(token) && !Object.hasOwn(value.spentBy, token),
  );
  assert.deepEqual(
    unaccounted,
    [],
    `D0_LABEL_SPENT: emitted reserved labels with no spentBy entry: ${unaccounted.join(', ')}`,
  );
  for (const token of emitted) {
    assert.equal(
      reserved.has(token) && !Object.hasOwn(value.spentBy, token),
      false,
      `D0_LABEL_SPENT: ${token} is both emitted and unspent`,
    );
  }
});

test('the rt12 reservation of KIR_LOOP_JUMP_CROSSES_TRY is re-homed, not contradicted', () => {
  const value = registry();
  assert.ok(
    value.labels.includes('KIR_LOOP_JUMP_CROSSES_TRY'),
    'D0_REGISTRY_SET: the registry must absorb rt12 own reservation',
  );
  const rt12 = readRepositoryText('scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs');
  assert.ok(
    rt12.includes('KIR_LOOP_JUMP_CROSSES_TRY'),
    'D0_RT12_PIN_LOST: rt12 must keep asserting where its own label stands',
  );
});
