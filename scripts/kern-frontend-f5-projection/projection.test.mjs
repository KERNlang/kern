import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { encodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { decodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
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

function permutations(values) {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map((rest) => [value, ...rest]));
}

function property(node, name) {
  return node.properties.find(({ key }) => key === name)?.value;
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
  for (const [index, permutation] of permutations(modules).entries()) {
    assertProjected(runProjection(permutation), expected, `three-module permutation ${index + 1}/6`);
  }
});

test('F5 uses Unicode scalar ordering for non-BMP module identities', () => {
  const modules = [
    { moduleId: '\ud83d\ude00.kern', source: 'fn name=grin export=true\n' },
    { moduleId: '\ue000.kern', source: 'fn name=privateUse export=true\n' },
    { moduleId: '\ud800\udc00.kern', source: 'fn name=astral export=true\n' },
  ];
  const result = runProjection([modules[0], modules[2], modules[1]]);
  assertProjected(result, bootstrapBytes(modules), 'Unicode scalar modules');
  const artifact = decodeModuleKir(result.bytes, LIMITS);
  assert.deepEqual(artifact.modules.map(({ id }) => id), ['\ue000.kern', '\ud800\udc00.kern', '\ud83d\ude00.kern']);
});

test('F5 closes property dispositions, LWW omission, trees, branches, each, and handler metadata', () => {
  const modules = [{
    moduleId: 'closure.kern',
    source: 'module name=app\n' +
      '  page name=Omega route="hello \ud83c\udf0d" async=true\n' +
      '  path value="segment"\n' +
      'fn name=main returns=number export=true\n' +
      '  param name=value type=number\n' +
      '  handler lang=kern\n' +
      '    each name=item in=items\n' +
      '    return value="value + 1"\n',
  }];
  const expected = bootstrapBytes(modules);
  const result = runProjection(modules);
  assertProjected(result, expected, 'property/tree closure');
  const artifact = decodeModuleKir(result.bytes, LIMITS);
  const fn = artifact.modules[0].roots.find(({ kind }) => kind === 'fn');
  assert.equal(property(fn, 'params'), undefined, 'absent fn.params omitted');
  assert.equal(property(fn, 'returns').value[0].value.value, 'integer');
  assert.deepEqual(fn.children.map(({ kind }) => kind), ['param', 'handler']);
  assert.equal(property(fn.children[0], 'type').value[0].value.value, 'integer');
  assert.equal(property(fn.children[1].children[0], 'in').value[0].value.value, 'binding');
  assert.equal(property(fn.children[1].children[1], 'value').value[1].value.value, 'binary');
  const page = artifact.modules[0].roots[0].children.find(({ kind }) => kind === 'page');
  assert.equal(property(page, 'name').value, 'Omega');
  assert.equal(property(page, 'async').value, true);
});

test('F5 raw F4 tape rejects document deletion, duplication, reorder, and identity substitution', () => {
  const modules = request(STATIC_GOLDENS.valid.modules);
  const baseline = runModuleSet(modules);
  const mutants = [
    (f4) => { f4.documents = f4.documents.slice(1); },
    (f4) => { f4.documents = [f4.documents[0], f4.documents[0], f4.documents[1]]; },
    (f4) => { f4.documents = [...f4.documents].reverse(); },
    (f4) => { f4.documents[0].fields[2] = 'x'.repeat(Array.from(f4.documents[0].fields[2]).length); },
  ];
  for (const [index, mutate] of mutants.entries()) {
    const f4 = structuredClone(baseline);
    mutate(f4);
    const result = __test.runProjectionWithF4Runner(modules, () => f4);
    assert.equal(result.receipt.status, 'fatal', `raw F4 mutant ${index}`);
    assert.equal(result.bytes, null, `raw F4 mutant ${index} atomic bytes`);
    assert.equal(result.receipt.diagnostics[0].code, 'F5_F4_DRIFT', `raw F4 mutant ${index} code`);
  }
});

test('F5 work profile accepts the exact boundary and rejects one-over atomically', () => {
  const modules = [{ moduleId: 'limit.kern', source: 'fn name=limit export=true\n' }];
  const baseline = runProjection(modules);
  assert.equal(baseline.receipt.status, 'projected');
  assert.ok(baseline.receipt.workSteps > 1);
  const exact = __test.runProjectionWithProfileLimits(modules, { maxWorkSteps: baseline.receipt.workSteps });
  assert.equal(exact.receipt.status, 'projected');
  assert.ok(exact.bytes instanceof Uint8Array);
  const crossing = __test.runProjectionWithProfileLimits(modules,
    { maxWorkSteps: baseline.receipt.workSteps - 1 });
  assert.equal(crossing.receipt.status, 'fatal');
  assert.equal(crossing.receipt.diagnostics[0].code, 'F5_LIMIT');
  assert.equal(crossing.bytes, null);
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
