import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { decodeDocument, listTape, sha256 } from './decoder.mjs';
import { runDocument } from './worker.mjs';

const ROOT = new URL('../../', import.meta.url);
const constitution = JSON.parse(readFileSync(new URL('scripts/kir-structural/constitution.json', ROOT), 'utf8'));
const decoderSource = readFileSync(new URL('scripts/kern-frontend-f4-declarations/decoder.mjs', ROOT), 'utf8');
const staticGoldens = JSON.parse(readFileSync(new URL('scripts/kern-frontend-closure/static-goldens.json', ROOT), 'utf8'));
const item = (value) => `i${Array.from(value).length}:${value}`;
const tape = (values) => values.map(item).join('');

function propertyAuthority() {
  return {
    nodeKinds: constitution.properties.map((row) => row.nodeKind),
    propertyNames: constitution.properties.map((row) => row.propertyName),
    schemaKinds: constitution.properties.map((row) => row.schemaKind),
    required: constitution.properties.map((row) => row.required ? 'true' : 'false'),
    dispositions: constitution.properties.map((row) => row.disposition),
  };
}

function context(moduleId, source) {
  return {
    moduleId,
    sourceScalars: Array.from(source).length,
    sourceSha256: sha256(source),
    propertyAuthority: propertyAuthority(),
  };
}

function occurrence(result, ownerKind, propertyName) {
  return result.receipt.propertyOccurrences.filter((row) =>
    row.ownerKind === ownerKind && row.propertyName === propertyName);
}

function presence(result, ownerLogicalOrdinal, propertyName) {
  return result.receipt.propertyPresence.find((row) =>
    row.ownerLogicalOrdinal === ownerLogicalOrdinal && row.propertyName === propertyName);
}

function mutateRow(fields, section, rowIndex, mutate) {
  const sectionRows = listTape(fields[section], `section ${section}`);
  const row = listTape(sectionRows[rowIndex], `section ${section} row ${rowIndex}`);
  mutate(row);
  sectionRows[rowIndex] = tape(row);
  fields[section] = tape(sectionRows);
}

function reseal(fields) {
  const old = fields[16].split(':');
  assert.equal(old.length, 20, 'control terminal seal');
  fields[16] = `document:${fields[1]}:${Array.from(fields[4]).length}:${Array.from(fields[5]).length}:${Array.from(fields[6]).length}:${Array.from(fields[7]).length}:${Array.from(fields[8]).length}:${Array.from(fields[9]).length}:${Array.from(fields[10]).length}:${Array.from(fields[11]).length}:${Array.from(fields[12]).length}:${Array.from(fields[13]).length}:${Array.from(fields[14]).length}:${old.slice(13, 19).join(':')}:closed`;
}

function assertReceiptDecodes(moduleId, source, result) {
  assert.deepEqual(decodeDocument(result.fields, context(moduleId, source)), result.receipt);
}

test('A5 authority inventory is the real nine-kind and nine-disposition constitution', () => {
  assert.equal(constitution.properties.length, 1_149);
  assert.deepEqual([...new Set(constitution.properties.map((row) => row.schemaKind))].sort(), [
    'boolean', 'expression', 'identifier', 'importPath', 'number', 'rawBlock', 'rawExpr', 'string',
    'typeAnnotation',
  ]);
  assert.deepEqual([...new Set(constitution.properties.map((row) => row.disposition))].sort(), [
    'excluded-host-expression', 'excluded-host-type', 'excluded-raw-block', 'included-value',
    'lowered-branch-path-value', 'lowered-each-collection-reference', 'lowered-expression',
    'lowered-import-path', 'lowered-type',
  ]);
  assert.deepEqual([
    constitution.properties.filter((row) => row.required).length,
    constitution.properties.filter((row) => !row.required).length,
  ], [314, 835]);
  const enums = constitution.properties.filter((row) => row.values !== null);
  assert.equal(enums.length, 1);
  assert.deepEqual([enums[0].nodeKind, enums[0].propertyName], ['ragAssert', 'kind']);
});

test('A5 optional absence, explicit invalidity, and required omission remain distinct', () => {
  const optionalSource = 'module name=app\n  page name=Home route="/"\n';
  const optional = runDocument('optional.kern', optionalSource);
  const page = optional.receipt.declarations.find((row) => row.kind === 'page');
  assert.equal(occurrence(optional, 'page', 'async').length, 0);
  assert.equal(presence(optional, page.logicalOrdinal, 'async').effectiveOccurrenceOrdinal, -1);

  const invalid = runDocument('invalid.kern', 'module name=app\n  page name=Home async=\n');
  const invalidAsync = occurrence(invalid, 'page', 'async');
  assert.equal(invalidAsync.length, 1);
  assert.equal(invalidAsync[0].value, '');
  assert.equal(presence(invalid, invalidAsync[0].ownerLogicalOrdinal, 'async').effectiveOccurrenceOrdinal,
    invalidAsync[0].ordinal);
  assert.ok(invalid.receipt.facts.some((row) => row.code === 'invalid-property'));

  const missing = runDocument('missing.kern', 'module name=app\n  page route="/"\n');
  assert.equal(missing.receipt.status, 'rejected');
  assert.ok(missing.receipt.facts.some((row) => row.code === 'missing-property' && row.propertyName === 'name'));
  assert.ok(missing.receipt.diagnostics.some((row) => row.code === 'UNEXPECTED_TOKEN'));
  assert.deepEqual([missing.receipt.symbols, missing.receipt.bindings], [[], []]);
});

test('A5 C6 duplicate last-write-wins varies preceding occurrences and values', () => {
  const sources = [
    'module name=app\n  page name=Alpha name=Omega route="/"\n',
    'module name=app\n  page route="/x" name=Alpha async=true name=Omega\n',
  ];
  for (const [index, source] of sources.entries()) {
    const moduleId = `duplicate-${index}.kern`;
    const result = runDocument(moduleId, source);
    const names = occurrence(result, 'page', 'name');
    assert.deepEqual(names.map((row) => row.value), ['Alpha', 'Omega']);
    const effective = presence(result, names[0].ownerLogicalOrdinal, 'name');
    assert.equal(effective.effectiveOccurrenceOrdinal, names.at(-1).ordinal);
    assert.ok(names[0].ordinal !== names.at(-1).ordinal);
    assert.equal(result.receipt.diagnostics.filter((row) => row.code === 'DUPLICATE_PROP').length, 1);
    assertReceiptDecodes(moduleId, source, result);
  }
});

test('A5 prototype-colliding unknown properties stay ordered and unbound', () => {
  const names = ['constructor', '__proto__', 'prototype', 'toString', 'hasOwnProperty', 'valueOf'];
  const source = `module name=app\n  page name=Home ${names.map((name) => `${name}=x`).join(' ')}\n`;
  const result = runDocument('prototype-properties.kern', source);
  assert.deepEqual(result.receipt.facts.filter((row) => row.code === 'unknown-property')
    .map((row) => row.propertyName), names);
  for (const name of names) {
    assert.equal(result.receipt.propertyOccurrences.some((row) => row.propertyName === name), false);
    assert.equal(result.receipt.propertyPresence.some((row) => row.propertyName === name), false);
  }
});

test('A5 public fixtures cover all schema kinds and dispositions', () => {
  const frozen = Object.fromEntries(staticGoldens.failures.map((row) => [row.id, row]));
  const cases = [
    ['ordinary.kern', 'module name=app\n  page name=Home route="hello 🌍" async=true\n    slider min=-1.5\n'],
    ['path.kern', 'module name=app\n  path value="segment"\n  use path="./local"\n'],
    ['type.kern', 'fn name=main returns=number\n'],
    ['expression.kern', 'fn name=main\n  handler lang=kern\n    return value="1 + 2"\n'],
    ['each.kern', 'fn name=main\n  each name=item in={{ items }}\n'],
    [frozen['excluded-raw-block'].moduleId, frozen['excluded-raw-block'].source],
    [frozen['excluded-host-expression'].moduleId, frozen['excluded-host-expression'].source],
    [frozen['excluded-host-type'].moduleId, frozen['excluded-host-type'].source],
  ];
  const occurrences = cases.flatMap(([moduleId, source]) => runDocument(moduleId, source).receipt.propertyOccurrences);
  assert.deepEqual([...new Set(occurrences.map((row) => row.schemaKind))].sort(), [
    'boolean', 'expression', 'identifier', 'importPath', 'number', 'rawBlock', 'rawExpr', 'string',
    'typeAnnotation',
  ]);
  assert.deepEqual([...new Set(occurrences.map((row) => row.disposition))].sort(), [
    'excluded-host-expression', 'excluded-host-type', 'excluded-raw-block', 'included-value',
    'lowered-branch-path-value', 'lowered-each-collection-reference', 'lowered-expression',
    'lowered-import-path', 'lowered-type',
  ]);
});

test('A5 enum admits both endpoints and rejects an out-of-set value', () => {
  for (const value of ['factId', 'citesRequired']) {
    const result = runDocument(`enum-${value}.kern`, `ragAssert kind=${value}\n`);
    assert.equal(occurrence(result, 'ragAssert', 'kind')[0]?.value, value);
    assert.equal(result.receipt.facts.some((row) =>
      row.code === 'invalid-property' && row.propertyName === 'kind'), false);
  }
  const invalid = runDocument('enum-invalid.kern', 'ragAssert kind=notAllowed\n');
  assert.ok(invalid.receipt.facts.some((row) =>
    row.code === 'invalid-property' && row.propertyName === 'kind'));
});

test('A5 decoder rejects an authority-coordinate mutation', () => {
  const moduleId = 'authority-mutation.kern';
  const source = 'module name=app\n  page name=Home route="/"\n';
  const result = runDocument(moduleId, source);
  assertReceiptDecodes(moduleId, source, result);

  const authorityFields = [...result.fields];
  mutateRow(authorityFields, 5, 1, (row) => { row[2] = 'view'; });
  assert.throws(() => decodeDocument(authorityFields, context(moduleId, source)), /property authority/u);
});

test('A5 decoder rejects decreasing occurrence spans', () => {
  const moduleId = 'occurrence-order.kern';
  const source = 'module name=app\n  page name=Home route="/"\n';
  const result = runDocument(moduleId, source);
  const orderFields = [...result.fields];
  const rows = listTape(orderFields[5], 'occurrence order');
  const first = listTape(rows[0], 'first occurrence');
  const second = listTape(rows[1], 'second occurrence');
  [first[10], second[10]] = [second[10], first[10]];
  [first[11], second[11]] = [second[11], first[11]];
  rows[0] = tape(first);
  rows[1] = tape(second);
  orderFields[5] = tape(rows);
  assert.throws(() => decodeDocument(orderFields, context(moduleId, source)), /occurrence order/u);
});

test('A5 decoder rejects every stale earlier duplicate presence ordinal', () => {
  const sources = [
    'module name=app\n  page name=Alpha name=Omega route="/"\n',
    'module name=app\n  page route="/x" name=Alpha async=true name=Omega\n',
  ];
  for (const [sourceIndex, source] of sources.entries()) {
    const moduleId = `stale-presence-${sourceIndex}.kern`;
    const result = runDocument(moduleId, source);
    const names = occurrence(result, 'page', 'name');
    const fields = [...result.fields];
    const presenceRows = listTape(fields[6], 'presence');
    const index = result.receipt.propertyPresence.findIndex((row) =>
      row.ownerLogicalOrdinal === names[0].ownerLogicalOrdinal && row.propertyName === 'name');
    const row = listTape(presenceRows[index], 'name presence');
    assert.equal(row[2], String(names.at(-1).ordinal));
    row[2] = String(names[0].ordinal);
    assert.equal(Array.from(row[2]).length, Array.from(String(names.at(-1).ordinal)).length);
    presenceRows[index] = tape(row);
    fields[6] = tape(presenceRows);
    assert.throws(() => decodeDocument(fields, context(moduleId, source)), /property presence/u);
  }
});

test('A5 decoder rejects duplicate presence keys', () => {
  const duplicateModule = 'duplicate-presence.kern';
  const duplicateSource = 'module name=app\n  page name=Home route="/"\n';
  const duplicate = runDocument(duplicateModule, duplicateSource);
  const duplicateFields = [...duplicate.fields];
  const presenceRows = listTape(duplicateFields[6], 'presence rows');
  presenceRows.push(presenceRows[0]);
  duplicateFields[6] = tape(presenceRows);
  reseal(duplicateFields);
  assert.throws(() => decodeDocument(duplicateFields,
    context(duplicateModule, duplicateSource)), /property presence/u);
});

test('A5 decoder rejects excluded payload leakage', () => {
  const frozen = staticGoldens.failures.find((row) => row.id === 'excluded-host-type');
  const excluded = runDocument(frozen.moduleId, frozen.source);
  const excludedFields = [...excluded.fields];
  const excludedIndex = excluded.receipt.propertyOccurrences.findIndex((row) =>
    row.disposition === 'excluded-host-type');
  mutateRow(excludedFields, 5, excludedIndex, (row) => { row[12] = 'x'; });
  reseal(excludedFields);
  assert.throws(() => decodeDocument(excludedFields,
    context(frozen.moduleId, frozen.source)), /excluded property payload/u);
});

function hasGeneralDecoderContract(source) {
  return /context\.propertyAuthority/u.test(source) &&
    /occurrence\.catalogOrdinal/u.test(source) &&
    /lastOccurrenceByKey\.set/u.test(source) &&
    /effectiveOccurrenceOrdinal\s*!==\s*expected/u.test(source);
}

test('A5 decoder source uses catalog-driven authority and computed last occurrence', () => {
  assert.equal(hasGeneralDecoderContract(decoderSource), true);
  for (const mutation of [
    decoderSource.replace('occurrence.catalogOrdinal', '0'),
    decoderSource.replace('lastOccurrenceByKey.set', 'firstOccurrenceByKey.set'),
    decoderSource.replace(/effectiveOccurrenceOrdinal\s*!==\s*expected/u, 'effectiveOccurrenceOrdinal !== 2'),
  ]) assert.equal(hasGeneralDecoderContract(mutation), false);
});
