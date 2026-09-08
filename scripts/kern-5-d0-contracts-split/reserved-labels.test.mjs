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

// D.0 lands with nothing spent. Slice D moves this row as it spends each label (QD-3), which is
// what keeps the not-emitted scan below honest instead of silently narrowing.
test('the registry lands with every label unspent', () => {
  const value = registry();
  assert.deepEqual(value.spentBy, {}, 'D0_REGISTRY_SPENT: D.0 must land with spentBy empty');
  assert.deepEqual(unspentLabels(value), [...RESERVED_LABELS]);
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

test('no unspent reserved label appears anywhere under packages/core/src', () => {
  const unspent = unspentLabels(registry());
  for (const path of sourceFilesUnder('packages/core/src')) {
    const source = readRepositoryText(path);
    for (const label of unspent) {
      assert.equal(
        source.includes(label),
        false,
        `D0_LABEL_SPENT: ${path} names the reserved label ${label}, which spentBy does not exempt`,
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

test('the emitted KIR label vocabulary is the pinned forty and is disjoint from the reserved set', () => {
  const emitted = kirTokensUnder(KIR_RUNTIME_DIR);
  const expected = [...BASE_KIR_TOKENS];
  const missing = expected.filter((token) => !emitted.includes(token));
  const extra = emitted.filter((token) => !expected.includes(token));
  assert.deepEqual(
    emitted,
    expected,
    'D0_LABEL_VOCABULARY: the KIR_* token set under kir-runtime moved' +
      (missing.length > 0 ? ` — missing: ${missing.join(', ')}` : '') +
      (extra.length > 0 ? ` — extra: ${extra.join(', ')}` : ''),
  );
  const reserved = new Set(RESERVED_LABELS);
  for (const token of emitted) {
    assert.equal(
      reserved.has(token),
      false,
      `D0_LABEL_SPENT: ${token} is both emitted and reserved`,
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
    'D0_RT12_PIN_LOST: rt12 must keep asserting its own label is unspent',
  );
});
