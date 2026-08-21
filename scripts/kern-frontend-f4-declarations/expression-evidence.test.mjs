import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runDocument } from './worker.mjs';

const STATIC_GOLDENS_URL = new URL('../kern-frontend-closure/static-goldens.json', import.meta.url);
const STATIC_GOLDENS = JSON.parse(readFileSync(STATIC_GOLDENS_URL, 'utf8'));

function frozenModule(moduleId) {
  const module = STATIC_GOLDENS.valid.modules.find((entry) => entry.id === moduleId);
  assert.ok(module, `missing frozen F0 module ${moduleId}`);
  return module;
}

function frozenFailure(id) {
  const failure = STATIC_GOLDENS.failures.find((entry) => entry.id === id);
  assert.ok(failure, `missing frozen F0 failure ${id}`);
  return failure;
}

function expressionEvidence(receipt) {
  assert.ok(Array.isArray(receipt.expressionEvidence), 'F4 document .2 must expose expressionEvidence');
  return receipt.expressionEvidence;
}

function scalarIndex(source, needle) {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `missing ${JSON.stringify(needle)} in source`);
  return Array.from(source.slice(0, index)).length;
}

test('frozen F0 quoted return values bind independent F4-local F2 evidence', () => {
  for (const [moduleId, decodedSource] of [
    ['lib/symbols.kern', 'value * 2'],
    ['main.kern', 'twice(1 + 2 * 3)'],
  ]) {
    const module = frozenModule(moduleId);
    const result = runDocument(module.id, module.source);
    const value = result.receipt.propertyOccurrences.find((row) =>
      row.ownerKind === 'return' && row.propertyName === 'value');
    assert.equal(result.runtimeInvocations, 1, `${moduleId} must use one external F4 invocation`);
    assert.equal(result.receipt.status, 'classified', moduleId);
    assert.equal(value?.disposition, 'lowered-expression', moduleId);
    assert.equal(value?.valueRepresentation, 'quoted', moduleId);
    const evidence = expressionEvidence(result.receipt);
    assert.equal(result.receipt.header.f4LocalF2CallCount, 1, moduleId);
    assert.deepEqual(evidence.map(({ occurrenceOrdinal, origin, f2bSegmentOrdinal, decodedSource: source }) =>
      ({ occurrenceOrdinal, origin, f2bSegmentOrdinal, decodedSource: source })), [{
      occurrenceOrdinal: value.ordinal,
      origin: 'f4-local',
      f2bSegmentOrdinal: -1,
      decodedSource,
    }], moduleId);
    assert.equal(result.receipt.header.format, 'kern.frontend.f4-document.2', moduleId);
  }
});

test('brace return value reuses the exact F2B receipt without an F4-local F2 call', () => {
  const source = 'fn name=main\n  handler lang=kern\n    return value={{ 1 + 2 }}\n';
  const result = runDocument('brace.kern', source);
  const value = result.receipt.propertyOccurrences.find((row) =>
    row.ownerKind === 'return' && row.propertyName === 'value');
  const segment = result.prerequisites.batch.receipt.segments[0];
  const [f2ReceiptTape] = result.prerequisites.batch.expressions;
  assert.equal(result.runtimeInvocations, 1, 'one external F4 invocation');
  assert.equal(result.receipt.status, 'classified');
  assert.equal(value?.valueRepresentation, 'expression');
  const [evidence] = expressionEvidence(result.receipt);
  assert.equal(result.receipt.header.f4LocalF2CallCount, 0);
  assert.equal(evidence.occurrenceOrdinal, value.ordinal);
  assert.equal(evidence.origin, 'f2b');
  assert.equal(evidence.f2bSegmentOrdinal, segment.ordinal);
  assert.equal(evidence.decodedSource, source.slice(
    [...source].findIndex((point, index, points) => points.slice(index, index + 2).join('') === '{{') + 2,
    source.lastIndexOf('}}'),
  ));
  assert.deepEqual(evidence.f2ReceiptTape, f2ReceiptTape);
  assert.equal(result.receipt.header.format, 'kern.frontend.f4-document.2');
});

test('excluded frozen F0 rawExpr retains no raw payload, expression evidence, or local F2 calls', () => {
  const failure = frozenFailure('excluded-host-expression');
  const result = runDocument(failure.moduleId, failure.source);
  const memo = result.receipt.propertyOccurrences.find((row) =>
    row.ownerKind === 'screen' && row.propertyName === 'memo');
  assert.equal(result.runtimeInvocations, 1, 'one external F4 invocation');
  assert.equal(result.receipt.status, 'rejected');
  assert.equal(memo?.schemaKind, 'rawExpr');
  assert.equal(memo?.disposition, 'excluded-host-expression');
  assert.equal(memo?.value, '');
  assert.deepEqual(expressionEvidence(result.receipt), []);
  assert.equal(result.receipt.header.f4LocalF2CallCount, 0);
  assert.deepEqual(result.receipt.diagnostics.map(({ code }) => code), ['FRONTEND_EXCLUDED_HOST_EXPRESSION']);
  assert.equal(result.receipt.header.format, 'kern.frontend.f4-document.2');
});

test('ordinary quoted strings do not dispatch F2 or create evidence', () => {
  const source = 'module name=app\n  page name=Home route="/hello/🌍"\n';
  const result = runDocument('quoted-string.kern', source);
  const route = result.receipt.propertyOccurrences.find((row) =>
    row.ownerKind === 'page' && row.propertyName === 'route');
  assert.equal(result.runtimeInvocations, 1, 'one external F4 invocation');
  assert.equal(result.receipt.status, 'classified');
  assert.equal(route?.valueRepresentation, 'quoted');
  assert.notEqual(route?.disposition, 'lowered-expression');
  assert.deepEqual(expressionEvidence(result.receipt), []);
  assert.equal(result.receipt.header.f4LocalF2CallCount, 0);
  assert.equal(result.receipt.header.format, 'kern.frontend.f4-document.2');
});

test('frozen F0 invalid quoted expression reports the original quoted span atomically', () => {
  const failure = frozenFailure('invalid-expression');
  const quoted = '"1 +"';
  const startScalar = scalarIndex(failure.source, quoted);
  const result = runDocument(failure.moduleId, failure.source);
  assert.equal(result.runtimeInvocations, 1, 'one external F4 invocation');
  assert.equal(result.receipt.status, 'rejected');
  assert.deepEqual(result.receipt.diagnostics.map(({ code, startScalar: start, endScalar }) =>
    ({ code, startScalar: start, endScalar })), [{
      code: 'FRONTEND_INVALID_EXPRESSION',
      startScalar,
      endScalar: startScalar + Array.from(quoted).length,
    }]);
  assert.deepEqual(expressionEvidence(result.receipt), []);
  assert.equal(result.receipt.header.f4LocalF2CallCount, 1);
  assert.equal(result.receipt.header.format, 'kern.frontend.f4-document.2');
});

test('duplicate expression occurrences retain distinct evidence while presence remains last-write-wins', () => {
  const source = 'fn name=main\n  handler lang=kern\n    return value="1 + 2" value="2 + 3"\n';
  const result = runDocument('duplicate-expression.kern', source);
  const values = result.receipt.propertyOccurrences.filter((row) =>
    row.ownerKind === 'return' && row.propertyName === 'value');
  const presence = result.receipt.propertyPresence.find((row) =>
    row.ownerLogicalOrdinal === values[0]?.ownerLogicalOrdinal && row.propertyName === 'value');
  assert.equal(result.runtimeInvocations, 1, 'one external F4 invocation');
  assert.equal(result.receipt.status, 'classified');
  assert.equal(values.length, 2);
  assert.notEqual(values[0].ordinal, values[1].ordinal);
  assert.equal(presence?.effectiveOccurrenceOrdinal, values[1].ordinal);
  const evidence = expressionEvidence(result.receipt);
  assert.equal(result.receipt.header.f4LocalF2CallCount, 2);
  assert.deepEqual(evidence.map((row) => row.occurrenceOrdinal), values.map((row) => row.ordinal));
  assert.deepEqual(evidence.map((row) => row.decodedSource), ['1 + 2', '2 + 3']);
  assert.equal(new Set(evidence.map((row) => row.evidenceOrdinal)).size, 2);
  assert.equal(result.receipt.header.format, 'kern.frontend.f4-document.2');
});
