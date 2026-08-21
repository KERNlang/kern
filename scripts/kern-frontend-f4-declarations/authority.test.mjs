import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { DOCUMENT_FIXTURES } from './fixtures.mjs';
import { renderAuthority } from './generate-authority.mjs';
import { __test, runDocument } from './worker.mjs';

const constitution = JSON.parse(readFileSync(
  new URL('../kir-structural/constitution.json', import.meta.url), 'utf8'));
const keywordPolicy = JSON.parse(readFileSync(
  new URL('../kern-frontend-keyword-handlers/policy.json', import.meta.url), 'utf8'));
const generated = readFileSync(
  new URL('../../examples/kern-frontend/f4-authority.generated.kern', import.meta.url), 'utf8');

function generatedLine(row) {
  return `    do value=${JSON.stringify(`out.push(${JSON.stringify(row)})`)}`;
}

test('generated KERN authority replays every node and property row exactly', () => {
  assert.equal(generated, renderAuthority(constitution, keywordPolicy));
  const nodeRows = constitution.nodes.map((node, index) => [
    String(index),
    node.id,
    node.schemaStatus,
    node.allowedChildren === null ? 'unrestricted' : node.allowedChildren.length === 0 ? 'closed' : 'explicit',
    node.allowedChildren?.join('|') ?? '',
  ].join('|'));
  const propertyRows = constitution.properties.map((property, index) => [
    String(index),
    property.nodeKind,
    property.propertyName,
    property.schemaKind,
    property.required ? 'true' : 'false',
    property.values?.join(',') ?? '',
    property.disposition,
    property.reasonId,
  ].join('|'));
  const keywordRows = keywordPolicy.handlerCatalog.map((form, index) => [
    String(index), form, keywordPolicy.sourceProfile,
  ].join('|'));
  assert.equal(nodeRows.length, 302);
  assert.equal(propertyRows.length, 1149);
  assert.equal(keywordRows.length, 26);
  for (const row of [...nodeRows, ...propertyRows, ...keywordRows]) {
    assert.ok(generated.includes(generatedLine(row)), row);
  }
  assert.equal(runDocument('authority.kern', '').receipt.status, 'classified');
});

test('same-length authority substitutions and row reorderings fail closed', () => {
  for (const mutation of [
    'authority-row-reorder',
    'authority-node-status',
    'authority-child-tape',
    'authority-property-row-reorder',
    'authority-property-disposition',
    'authority-property-values',
    'authority-property-reason',
    'authority-keyword-reorder',
    'authority-keyword-profile',
  ]) {
    const receipt = __test.runDocumentWithMutation(
      'authority-mutation.kern', DOCUMENT_FIXTURES.validModuleRoot, mutation).receipt;
    assert.equal(receipt.status, 'fatal', mutation);
    assert.deepEqual(receipt.declarations, [], mutation);
    assert.deepEqual(receipt.diagnostics.map((row) => row.code), ['F4_AUTHORITY_DRIFT'], mutation);
  }
});
