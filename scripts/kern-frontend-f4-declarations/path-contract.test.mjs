import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { sha256 } from './decoder.mjs';
import { runDocument, runModuleSet, __test } from './worker.mjs';

const POLICY_URL = new URL('./policy.json', import.meta.url);
const STATIC_GOLDENS_URL = new URL('../kern-frontend-closure/static-goldens.json', import.meta.url);
const POLICY = JSON.parse(readFileSync(POLICY_URL, 'utf8'));
const STATIC_GOLDENS = JSON.parse(readFileSync(STATIC_GOLDENS_URL, 'utf8'));

function codes(rows) {
  return rows.map((row) => row.code);
}

function assertAtomicDocumentInvalidRequest(result) {
  assert.equal(result.runtimeInvocations, 1);
  assert.equal(result.receipt.status, 'fatal');
  assert.deepEqual(codes(result.receipt.diagnostics), ['F4_INVALID_REQUEST']);
  for (const field of [
    'declarations', 'propertyOccurrences', 'propertyPresence', 'attachments', 'decorators',
    'symbols', 'bindings', 'facts', 'detachedLogicalOrdinals', 'expressionEvidence',
  ]) assert.deepEqual(result.receipt[field], [], field);
}

function assertAtomicModuleSetInvalidRequest(result) {
  assert.equal(result.moduleSetRuntimeInvocations, 1);
  assert.equal(result.receipt.status, 'fatal');
  assert.deepEqual(codes(result.receipt.linkFacts), ['F4_INVALID_REQUEST']);
  assert.deepEqual(result.receipt.rejected, []);
  assert.deepEqual(result.receipt.blocked, []);
  assert.deepEqual(result.receipt.validatedComponents, []);
  assert.deepEqual(result.receipt.modules, []);
  assert.deepEqual(result.receipt.bindings, []);
  assert.deepEqual(result.receipt.header.inputIdentityTape, []);
}

function importSource(specifier) {
  return `use path="${specifier}"\n`;
}

function documentResult(moduleId, source) {
  let result;
  assert.doesNotThrow(() => { result = runDocument(moduleId, source); }, moduleId);
  return result;
}

function moduleSetResult(modules) {
  let result;
  assert.doesNotThrow(() => { result = runModuleSet(modules); });
  return result;
}

test('F4A/F4B reject every noncanonical module ID atomically', async (t) => {
  const invalidModuleIds = [
    '', 'missing-suffix', '/absolute.kern', 'back\\slash.kern', 'colon:segment.kern',
    'double//slash.kern', 'trailing/.kern/', './relative.kern', '../upward.kern',
    'a/./b.kern', 'a/../b.kern',
  ];
  for (const moduleId of invalidModuleIds) {
    await t.test(`F4A ${JSON.stringify(moduleId)}`, () => {
      assertAtomicDocumentInvalidRequest(documentResult(moduleId, ''));
    });
    await t.test(`F4B ${JSON.stringify(moduleId)}`, () => {
      assertAtomicModuleSetInvalidRequest(moduleSetResult([{ moduleId, source: '' }]));
    });
  }
});

test('F4A accepts precisely the module-ID edge cases left open by the predicate', () => {
  for (const moduleId of [
    '.kern', 'nested/a.kern', 'dash_and-1.kern', 'café.kern', 'cafe\u0301.kern', 'control\u0001.kern',
  ]) {
    const result = documentResult(moduleId, '');
    assert.equal(result.receipt.status, 'classified', moduleId);
    assert.equal(result.receipt.header.moduleId, moduleId);
  }
});

test('invalid import specifiers and root escape stay F4A-local with no interface', async (t) => {
  const invalidSpecifiers = [
    'bare.kern', '/absolute.kern', './back\\slash.kern', './colon:segment.kern', './trailing/',
    './double//slash.kern', '././dot.kern', './a/../dotdot.kern', './', '../../escape.kern',
  ];
  for (const specifier of invalidSpecifiers) {
    await t.test(JSON.stringify(specifier), () => {
      const { receipt } = documentResult('dir/main.kern', importSource(specifier));
      assert.equal(receipt.status, 'rejected');
      assert.deepEqual(codes(receipt.facts), ['invalid-import-path']);
      assert.deepEqual(receipt.bindings, []);
      assert.deepEqual(receipt.symbols, []);
    });
  }
});

test('valid relative import specifiers normalize F4A binding targets with .kern suffixes', () => {
  for (const [moduleId, specifier, expected] of [
    ['dir/main.kern', './a.kern', 'dir/a.kern'],
    ['dir/main.kern', './a', 'dir/a.kern'],
    ['dir/sub/main.kern', '../a.kern', 'dir/a.kern'],
    ['dir/sub/main.kern', '../a', 'dir/a.kern'],
  ]) {
    const { receipt } = documentResult(moduleId, importSource(specifier));
    assert.equal(receipt.status, 'classified', `${moduleId}:${specifier}`);
    assert.deepEqual(receipt.bindings.map((row) => row.targetModuleId), [expected]);
  }
});

test('F4B resolves only canonical exact targets and reports canonical misses', () => {
  const collision = moduleSetResult([
    { moduleId: 'a.kern.kern', source: 'fn name=collision export=true\n' },
    { moduleId: 'main.kern', source: importSource('./a.kern') },
  ]);
  assert.equal(collision.receipt.status, 'rejected');
  assert.deepEqual(codes(collision.receipt.linkFacts), ['missing-module']);
  assert.deepEqual(collision.receipt.modules, []);
  assert.deepEqual(collision.receipt.bindings, []);

  const missing = moduleSetResult([{ moduleId: 'main.kern', source: importSource('./missing.kern') }]);
  assert.equal(missing.receipt.status, 'rejected');
  assert.deepEqual(codes(missing.receipt.linkFacts), ['missing-module']);
  assert.deepEqual(missing.receipt.modules, []);
  assert.deepEqual(missing.receipt.bindings, []);
});

test('F4B rejects a transported noncanonical binding target atomically before graph work', () => {
  const result = __test.runModuleSetWithReceiptMutation(
    [
      { moduleId: 'a.kern', source: 'fn name=a export=true\n' },
      { moduleId: 'main.kern', source: importSource('./a.kern') },
    ],
    (receipt, moduleId) => {
      if (moduleId === 'main.kern') receipt.bindings[0].targetModuleId = 'a//bad.kern';
    },
  );
  assertAtomicModuleSetInvalidRequest(result);
});

test('duplicate module IDs remain a single atomic F4B invalid request', () => {
  assertAtomicModuleSetInvalidRequest(moduleSetResult([
    { moduleId: 'same.kern', source: '' },
    { moduleId: 'same.kern', source: '' },
  ]));
});

test('policy caps module ID and import specifier scalars and segments', () => {
  for (const key of [
    'maxModuleIdScalars', 'maxModuleIdSegments', 'maxImportSpecifierScalars', 'maxImportSpecifierSegments',
  ]) {
    const value = POLICY.profileLimits[key];
    assert.equal(typeof value, 'number', key);
    assert.ok(Number.isSafeInteger(value) && value > 0, key);
    assert.ok(value <= POLICY.profileLimits.maxSourceScalars, `${key} must be bounded by source scalar cap`);
  }
});

test('path validation preserves the frozen F0 source bytes', () => {
  const frozen = STATIC_GOLDENS.valid.modules.find((entry) => entry.id === 'main.kern');
  assert.ok(frozen, 'missing frozen F0 main.kern module');
  const source = frozen.source;
  const { receipt } = documentResult(frozen.id, source);
  assert.equal(receipt.status, 'classified');
  assert.equal(receipt.header.sourceSha256, sha256(source));
  assert.equal(source, frozen.source);
});
