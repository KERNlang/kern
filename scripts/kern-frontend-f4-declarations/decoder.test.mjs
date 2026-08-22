import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { decodeDocument, listTape, sha256 } from './decoder.mjs';
import { VALID_MODULE_SET } from './fixtures.mjs';
import { runDocument } from './worker.mjs';

const item = (value) => `i${Array.from(value).length}:${value}`;
const constitution = JSON.parse(readFileSync(
  new URL('../kir-structural/constitution.json', import.meta.url), 'utf8'));
const fatalDiagnostic = item([
  'F4_LIMIT', 'error', '0', '0', '-1',
].map(item).join(''));

function tape(values) {
  return values.map(item).join('');
}

function context(moduleId, source) {
  return {
    moduleId,
    sourceScalars: Array.from(source).length,
    sourceSha256: sha256(source),
    propertyAuthority: {
      nodeKinds: constitution.properties.map((row) => row.nodeKind),
      propertyNames: constitution.properties.map((row) => row.propertyName),
      schemaKinds: constitution.properties.map((row) => row.schemaKind),
      required: constitution.properties.map((row) => row.required ? 'true' : 'false'),
      dispositions: constitution.properties.map((row) => row.disposition),
    },
  };
}

function equalWidthInvalidBoolean(value) {
  assert.ok(value === 'true' || value === 'false', `boolean control ${value}`);
  return value === 'true' ? 'nope' : 'bogus';
}

function mutateBoolean(fields, section, column) {
  const rows = listTape(fields[section], `test section ${section}`);
  assert.ok(rows.length > 0, `section ${section} control row`);
  const row = listTape(rows[0], `test section ${section} row`);
  const replacement = equalWidthInvalidBoolean(row[column]);
  assert.equal(Array.from(replacement).length, Array.from(row[column]).length, 'equal-width mutation');
  row[column] = replacement;
  fields[section] = tape(rows.map((value, index) => index === 0 ? tape(row) : value));
}

test('fatal decoding rejects a stale producer module-id slot', () => {
  const fields = [
    'kern.frontend.f4-document.2', 'fatal', 'stale.kern', '0', '', '', '', '',
    '', '', '', fatalDiagnostic, '', '', '', '0', 'failure',
  ];
  assert.throws(() => decodeDocument(fields, {
    moduleId: 'expected.kern', sourceScalars: 0, sourceSha256: '0'.repeat(64),
  }), /fatal atomicity/u);
});

test('decoder rejects equal-width invalid boolean tokens before declaration, symbol, or binding coercion', async (t) => {
  const cases = [
    ['declaration detached', 'declaration-bool.kern', 'module name=app\n  page name=Home\n', 4, 9],
    ['symbol exported', 'symbol-bool.kern', 'fn name=main export=true\n', 9, 2],
    ['binding reexport', VALID_MODULE_SET[1].moduleId, VALID_MODULE_SET[1].source, 10, 5],
  ];
  for (const [label, moduleId, source, section, column] of cases) {
    await t.test(label, () => {
      const result = runDocument(moduleId, source);
      const fields = [...result.fields];
      mutateBoolean(fields, section, column);
      assert.throws(() => decodeDocument(fields, context(moduleId, source)), /boolean|vocabulary/u);
    });
  }
});
