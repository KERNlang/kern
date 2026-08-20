import assert from 'node:assert/strict';
import test from 'node:test';

import { DOCUMENT_FIXTURES } from './fixtures.mjs';
import { __test, loadPolicy, runDocument } from './worker.mjs';

function codes(rows) {
  return rows.map((row) => row.code);
}

test('policy pins the complete 302-node and 1,149-property authorities', () => {
  const { policy } = loadPolicy();
  assert.equal(policy.format, 'kern.frontend.f4-declarations-policy.1');
  assert.equal(policy.authorities[0].rows, 302);
  assert.equal(policy.authorities[1].rows, 1451);
});

test('empty document produces one sealed classified F4A receipt', () => {
  const result = runDocument('empty.kern', DOCUMENT_FIXTURES.empty);
  assert.equal(result.runtimeInvocations, 1);
  assert.equal(result.receipt.status, 'classified');
  assert.deepEqual(result.receipt.declarations, []);
  assert.deepEqual(result.receipt.propertyOccurrences, []);
  assert.deepEqual(result.receipt.propertyPresence, []);
  assert.deepEqual(result.receipt.attachments, []);
  assert.deepEqual(result.receipt.decorators, []);
  assert.deepEqual(result.receipt.symbols, []);
  assert.deepEqual(result.receipt.bindings, []);
  assert.deepEqual(result.receipt.facts, []);
  assert.match(result.receipt.seal, /^[0-9a-f]{64}$/u);
});

test('legacy properties retain occurrences and last-write-wins presence', () => {
  const { receipt } = runDocument('page.kern', DOCUMENT_FIXTURES.duplicateProperty);
  assert.equal(receipt.status, 'classified');
  assert.equal(receipt.declarations[0].kind, 'page');
  const names = receipt.propertyOccurrences.filter((row) => row.propertyName === 'name');
  assert.equal(names.length, 2);
  assert.ok(names[0].startScalar < names[1].startScalar);
  assert.equal(receipt.propertyPresence.find((row) => row.propertyName === 'name').effectiveOccurrenceOrdinal, names[1].ordinal);
  assert.deepEqual(codes(receipt.diagnostics), ['DUPLICATE_PROP']);
  assert.equal(receipt.diagnostics[0].severity, 'warning');
  assert.deepEqual(receipt.facts, []);
});

test('required omissions and unknown properties reject without a consumable interface', () => {
  const missing = runDocument('missing.kern', DOCUMENT_FIXTURES.missingRequired).receipt;
  assert.equal(missing.status, 'rejected');
  assert.ok(codes(missing.facts).includes('missing-property'));
  assert.deepEqual(missing.symbols, []);
  assert.deepEqual(missing.bindings, []);

  const unknown = runDocument('unknown.kern', DOCUMENT_FIXTURES.unknownProperty).receipt;
  assert.equal(unknown.status, 'rejected');
  assert.ok(codes(unknown.facts).includes('unknown-property'));
  assert.equal(unknown.facts.find((row) => row.code === 'unknown-property').propertyName, 'constructor');
});

test('unrestricted, explicit, and closed child catalogs are distinct', () => {
  assert.equal(runDocument('unrestricted.kern', DOCUMENT_FIXTURES.unrestrictedChild).receipt.status, 'classified');
  assert.equal(runDocument('explicit.kern', DOCUMENT_FIXTURES.explicitChild).receipt.status, 'classified');

  for (const source of [DOCUMENT_FIXTURES.invalidExplicitChild, DOCUMENT_FIXTURES.closedChild]) {
    const receipt = runDocument('invalid-child.kern', source).receipt;
    assert.equal(receipt.status, 'rejected');
    assert.ok(codes(receipt.facts).includes('invalid-child'));
    assert.ok(receipt.detachedLogicalOrdinals.length >= 1);
  }
});

test('detached subtrees are locally checked but cannot export semantic effects', () => {
  const source = 'list\n  fn name=detached export=true\n    page route="/also-missing"\n';
  const { receipt } = runDocument('detached.kern', source);
  assert.equal(receipt.status, 'rejected');
  assert.ok(codes(receipt.facts).includes('invalid-child'));
  assert.ok(codes(receipt.facts).includes('missing-property'));
  assert.deepEqual(receipt.symbols, []);
});

test('decorators attach only to the immediate same-indent fn and explicit export propagates', () => {
  const attached = runDocument('attached.kern', DOCUMENT_FIXTURES.decoratorAttached).receipt;
  assert.equal(attached.status, 'classified');
  assert.equal(attached.decorators[0].disposition, 'attached');
  assert.equal(attached.decorators[0].targetLogicalOrdinal, 1);
  assert.equal(attached.symbols[0].exported, false);

  const exported = runDocument('exported.kern', DOCUMENT_FIXTURES.decoratorExported).receipt;
  assert.equal(exported.symbols[0].exported, true);

  const dropped = runDocument('dropped.kern', DOCUMENT_FIXTURES.decoratorDropped).receipt;
  assert.equal(dropped.status, 'classified');
  assert.equal(dropped.decorators[0].disposition, 'dropped');
  assert.deepEqual(codes(dropped.diagnostics), ['DROPPED_DECORATOR']);
});

test('multiline F2B expressions and astral quoted values retain exact spans', () => {
  const expression = runDocument('expression.kern', DOCUMENT_FIXTURES.expressionBound).receipt;
  const value = expression.propertyOccurrences.find((row) => row.ownerKind === 'return' && row.propertyName === 'value');
  assert.ok(value);
  assert.ok(value.f2bSegmentOrdinal >= 0);
  assert.equal(value.valueRepresentation, 'expression');

  const astral = runDocument('astral.kern', DOCUMENT_FIXTURES.astralQuoted).receipt;
  const route = astral.propertyOccurrences.find((row) => row.propertyName === 'route');
  assert.equal(route.endScalar - route.startScalar, Array.from('route="/hello/🌍"').length);
});

test('unsupported roots reject while admitted roots produce complete symbol candidates', () => {
  const unsupported = runDocument('unsupported.kern', DOCUMENT_FIXTURES.unsupportedRoot).receipt;
  assert.equal(unsupported.status, 'rejected');
  assert.deepEqual(codes(unsupported.diagnostics), ['FRONTEND_UNSUPPORTED_MODULE_ROOT']);

  const valid = runDocument('valid.kern', DOCUMENT_FIXTURES.validModuleRoot).receipt;
  assert.equal(valid.status, 'classified');
  assert.deepEqual(valid.symbols.map(({ kind, name, exported }) => ({ kind, name, exported })), [
    { kind: 'fn', name: 'main', exported: true },
  ]);
});

test('authority and prerequisite mutations fail closed before semantic rows escape', () => {
  for (const mutation of ['authority-row-reorder', 'f1-record-kind', 'f2b-segment-span', 'f3-parent-edge']) {
    const { receipt } = __test.runDocumentWithMutation('mutated.kern', DOCUMENT_FIXTURES.validModuleRoot, mutation);
    assert.equal(receipt.status, 'fatal', mutation);
    assert.deepEqual(receipt.declarations, [], mutation);
    assert.deepEqual(receipt.symbols, [], mutation);
    assert.equal(receipt.diagnostics.length, 1, mutation);
    assert.match(receipt.diagnostics[0].code, /^F4_(?:AUTHORITY|F1|F2B|F3)_DRIFT$/u, mutation);
  }
});
