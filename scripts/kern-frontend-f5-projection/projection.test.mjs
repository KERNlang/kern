import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { encodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { parseDocumentStrict } from '../../packages/core/dist/parser.js';
import { runModuleSet } from '../kern-frontend-f4-declarations/worker.mjs';
import { __test, runProjection } from './worker.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const STATIC_GOLDENS = JSON.parse(readFileSync(
  new URL('../kern-frontend-closure/static-goldens.json', import.meta.url), 'utf8'));
const LIMITS = Object.freeze({
  maxBytes: 16_777_216,
  maxCollectionLength: 262_144,
  maxDecimalChars: 128,
  maxDepth: 256,
  maxFractionDigits: 64,
  maxIntegerDigits: 512,
  maxMapEntries: 262_144,
  maxNodes: 1_048_576,
  maxRecordFields: 262_144,
  maxStringBytes: 16_777_216,
});

function request(modules) {
  return modules.map(({ id, moduleId, source }) => ({ moduleId: moduleId ?? id, source }));
}

function bootstrapBytes(modules) {
  return Buffer.from(encodeModuleKir(modules.map(({ id, moduleId, source }) => ({
    id: moduleId ?? id,
    roots: parseDocumentStrict(source).children ?? [],
  })), LIMITS));
}

function assertProjected(result, expected, label) {
  assert.equal(result.receipt.status, 'projected', `${label} status`);
  assert.equal(result.receipt.header.format, 'kern.frontend.f5-projection.1');
  assert.equal(result.receipt.diagnostics.length, 0, `${label} diagnostics`);
  assert.equal(result.f4RuntimeInvocations > 0, true, `${label} F4 execution`);
  assert.equal(result.f5RuntimeInvocations, 1, `${label} F5 execution`);
  assert.ok(result.bytes instanceof Uint8Array, `${label} bytes`);
  assert.deepEqual(Buffer.from(result.bytes), Buffer.from(expected), `${label} canonical bytes`);
}

function diagnostics(result) {
  return result.receipt.diagnostics.map(({ code, severity, line, col, endLine, endCol }) =>
    ({ code, severity, line, col, endLine, endCol }));
}

test('F5 projects the immutable two-module golden byte-for-byte without reading it', () => {
  const modules = request(STATIC_GOLDENS.valid.modules);
  const expected = Buffer.from(STATIC_GOLDENS.valid.expectedCanonicalBase64, 'base64');
  assertProjected(runProjection(modules), expected, 'static golden');

  const reversed = runProjection([...modules].reverse());
  assertProjected(reversed, expected, 'reversed static golden');
});

test('F5 matches an independently generated three-module and disconnected-module oracle', () => {
  const modules = [
    { moduleId: 'lib/alpha.kern', source: 'fn name=alpha export=true\n' },
    {
      moduleId: 'main.kern',
      source: 'use path="./lib/alpha"\n  from name=alpha kind=fn as=beta export=true\n' +
        'fn name=main export=true\n  handler lang=kern\n    return value="beta(3)"\n',
    },
    { moduleId: 'zeta/disconnected.kern', source: 'fn name=omega export=true\n' },
  ];
  const expected = bootstrapBytes(modules);
  assertProjected(runProjection(modules), expected, 'three modules');
  assertProjected(runProjection([modules[2], modules[0], modules[1]]), expected, 'permuted modules');
});

test('F5 projects all frozen expression kinds from F2 evidence instead of reparsing source', () => {
  const expressions = [
    'value', 'null', 'true', '42', '4.25', '"astral 🌍"', '[1, 2]', '{alpha: 1, beta: 2}',
    'value.name', 'value[0]', 'fnRef(1)', 'new Map()', 'x => x', '1 + 2', '!flag',
    'flag ? 1 : 2',
  ];
  const modules = expressions.map((expression, index) => ({
    moduleId: `expressions/e${String(index).padStart(2, '0')}.kern`,
    source: `fn name=e${index} export=true\n  handler lang=kern\n    return value=${JSON.stringify(expression)}\n`,
  }));
  assertProjected(runProjection(modules), bootstrapBytes(modules), 'expression corpus');
});

test('F5 preserves all six frozen malformed diagnostic receipts atomically', () => {
  for (const fixture of STATIC_GOLDENS.failures) {
    const result = runProjection(request([{ id: fixture.moduleId, source: fixture.source }]));
    assert.equal(result.receipt.status, 'rejected', fixture.id);
    assert.equal(result.bytes, null, `${fixture.id} bytes`);
    assert.deepEqual(diagnostics(result), fixture.diagnostics, fixture.id);
    assert.equal(result.f5RuntimeInvocations, 0, `${fixture.id} semantic projection`);
  }
});

test('F5 production closure bans bootstrap semantics, golden reads, and decoded F4 rows', () => {
  const directory = resolve(ROOT, 'scripts/kern-frontend-f5-projection');
  const scriptSources = readdirSync(directory)
    .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    .map((name) => [name, readFileSync(resolve(directory, name), 'utf8')]);
  const kernDirectory = resolve(ROOT, 'examples/kern-frontend');
  const kernSources = readdirSync(kernDirectory)
    .filter((name) => name.startsWith('f5-') && name.endsWith('.kern'))
    .map((name) => [name, readFileSync(resolve(kernDirectory, name), 'utf8')]);
  assert.ok(scriptSources.length >= 3, 'expected policy, decoder, and worker modules');
  assert.ok(kernSources.length >= 4, 'expected split KERN projection modules');
  const forbidden = /(?:static-goldens|parseInternal|parseDocument|parseExpression|projectStructuralNode|deriveModuleGraph|encodeModuleKir|expectedCanonicalBase64)/u;
  for (const [name, source] of [...scriptSources, ...kernSources]) {
    assert.equal(forbidden.test(source), false, `${name} imports or embeds bootstrap semantics`);
  }
  const decodedMembers = /\.receipt\.(?:declarations|propertyOccurrences|propertyPresence|attachments|decorators|symbols|bindings|expressionEvidence|validatedComponents|modules)\b/u;
  for (const [name, source] of scriptSources) {
    assert.equal(decodedMembers.test(source), false, `${name} reads decoded F4 semantics`);
  }
});

test('F5 runtime path cannot read decoded F4 semantic objects', () => {
  const semanticMembers = new Set([
    'declarations', 'propertyOccurrences', 'propertyPresence', 'attachments', 'decorators',
    'symbols', 'bindings', 'expressionEvidence', 'validatedComponents', 'modules',
  ]);
  const wrap = (value) => new Proxy(value, {
    get(target, property, receiver) {
      if (semanticMembers.has(property)) throw new Error(`decoded semantic access ${String(property)}`);
      return Reflect.get(target, property, receiver);
    },
  });
  const f4Runner = (modules) => {
    const result = runModuleSet(modules);
    return {
      ...result,
      receipt: wrap(result.receipt),
      documents: result.documents.map((document) => ({ ...document, receipt: wrap(document.receipt) })),
    };
  };
  const modules = request(STATIC_GOLDENS.valid.modules);
  const expected = Buffer.from(STATIC_GOLDENS.valid.expectedCanonicalBase64, 'base64');
  assertProjected(__test.runProjectionWithF4Runner(modules, f4Runner), expected, 'decoded trap');
});

test('F5 validator output is discard-only and cannot replace staged KIR bytes', () => {
  const modules = request(STATIC_GOLDENS.valid.modules);
  const expected = Buffer.from(STATIC_GOLDENS.valid.expectedCanonicalBase64, 'base64');
  const replacement = bootstrapBytes([{ moduleId: 'replacement.kern', source: 'fn name=nope export=true\n' }]);
  const result = __test.runProjectionWithValidator(modules, () => ({ replacement }));
  assertProjected(result, expected, 'discard-only validator');
  assert.notDeepEqual(Buffer.from(result.bytes), replacement);
});
