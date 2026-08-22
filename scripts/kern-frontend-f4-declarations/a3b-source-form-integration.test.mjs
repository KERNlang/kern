import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../../packages/core/dist/runtime-handler.js';
import { loadKeywordHandlerMemberSource } from '../kern-frontend-keyword-handlers/source.mjs';
import {
  KEYWORD_HANDLER_FIXTURES,
} from '../kern-frontend-keyword-handlers/fixtures.mjs';
import { loadFrontendKeywordHandlerPolicy } from '../kern-frontend-keyword-handlers/policy.mjs';
import { normalizeRetainedTokenStreamOracle } from '../kern-frontend-retained-token-stream/oracle.mjs';
import { __test, runDocument } from './worker.mjs';
import { F4_COMPOSITION_PATHS } from './policy-validation.mjs';

const keywordPolicy = loadFrontendKeywordHandlerPolicy();
const fixtureByType = new Map(KEYWORD_HANDLER_FIXTURES.map((fixture) => [fixture.type, fixture]));

const MATRIX = Object.freeze([
  ['fn', 'rejected', ['name', 'params', 'returns', 'async'], ['FRONTEND_EXCLUDED_HOST_TYPE'], ['excluded-host-payload']],
  ['let', 'rejected', ['name', 'type', 'value'], ['FRONTEND_EXCLUDED_HOST_TYPE'], ['excluded-host-payload']],
  ['return', 'classified', ['value'], [], []],
  ['throw', 'classified', ['value'], [], []],
  ['do', 'classified', ['value'], [], []],
  ['if', 'classified', ['cond'], [], []],
  ['while', 'classified', ['cond'], [], []],
  ['doc', 'classified', ['text'], [], []],
  ['theme', 'classified', ['name'], [], []],
  ['import', 'classified', ['names', 'from'], [], []],
  ['island', 'classified', ['kind', 'name'], [], []],
  ['route', 'classified', ['method', 'path', 'name'], [], []],
  ['params', 'classified', [], [], []],
  ['auth', 'classified', ['mode'], [], []],
  ['validate', 'classified', ['schema'], [], []],
  ['error', 'rejected', ['message'], ['UNEXPECTED_TOKEN'], ['unknown-property', 'missing-property', 'missing-property']],
  ['derive', 'rejected', ['name'], ['UNEXPECTED_TOKEN'], ['missing-property']],
  ['guard', 'classified', ['name'], [], []],
  ['effect', 'classified', ['name'], [], []],
  ['strategy', 'classified', ['name'], [], []],
  ['trigger', 'classified', ['kind'], [], []],
  ['respond', 'rejected', ['status', 'json'], ['FRONTEND_EXCLUDED_HOST_EXPRESSION'], ['excluded-host-payload']],
  ['expect', 'classified', ['codegen', 'contains'], [], []],
  ['rule', 'classified', ['id', 'severity'], [], []],
  ['message', 'classified', ['template'], [], []],
  ['middleware', 'rejected', [], ['UNEXPECTED_TOKEN'], ['missing-property']],
]);

function nestedSource(type) {
  const fixture = fixtureByType.get(type);
  assert.ok(fixture, `fixture for ${type}`);
  const nested = fixture.source.split('\n').map((line) => `  ${line}`).join('\n');
  return `module name=app\n${nested}\n`;
}

function lineOccurrences(receipt) {
  return receipt.propertyOccurrences.filter(({ ownerLogicalOrdinal }) => ownerLogicalOrdinal === 1);
}

function codes(rows) {
  return rows.map(({ code }) => code);
}

function textFields(value) {
  assert.equal(value.tag, 'list');
  return value.value.map((entry) => {
    assert.equal(entry.tag, 'text');
    return entry.value;
  });
}

function runKernel(content, maxWrites = keywordPolicy.maxKeywordHandlerWrites) {
  const stream = normalizeRetainedTokenStreamOracle(content, keywordPolicy);
  assert.ok(!('status' in stream), content);
  const kinds = stream.tokens.map(({ kind }) => kind);
  const values = stream.tokens.map(({ value }) => value);
  const starts = stream.tokens.map(({ startScalar }) => startScalar);
  const ends = stream.tokens.map((token, index) =>
    stream.tokens[index + 1]?.startScalar ?? stream.boundary.codeEndOffset);
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [content, '', 0, kinds, values, starts, ends, maxWrites],
    identity: {
      handlerName: 'normalizekeywordhandlerwrites',
      sourcePath: 'examples/kern-frontend/keyword-handler-normalization.kern',
    },
    source: loadKeywordHandlerMemberSource(),
  }, { enabled: true, limits: keywordPolicy.runtimeLimits });
  assert.equal(envelope.outcome, 'success', JSON.stringify(envelope.diagnostics));
  assert.equal(envelope.completion.kind, 'return');
  assert.equal(envelope.events.length, 0);
  assert.equal(envelope.result.presence, 'value');
  return textFields(envelope.result.value);
}

function assertAtomicLimit(receipt, label) {
  assert.equal(receipt.status, 'fatal', label);
  assert.deepEqual(codes(receipt.diagnostics), ['F4_LIMIT'], label);
  for (const section of [
    'declarations', 'propertyOccurrences', 'propertyPresence', 'attachments', 'decorators',
    'symbols', 'bindings', 'facts', 'detachedLogicalOrdinals', 'expressionEvidence',
  ]) assert.deepEqual(receipt[section], [], `${label}: ${section}`);
}

function assertProspectiveWriteGuards(source) {
  const lines = source.split('\n');
  const pushes = lines.flatMap((line, index) =>
    line.includes('writeNames.push') ? [{ line, index }] : []);
  assert.equal(pushes.length, 20, 'closed private-write inventory');
  for (const push of pushes) {
    const guardWindow = lines.slice(Math.max(0, push.index - 8), push.index).join('\n');
    assert.match(guardWindow, /writeNames\.length \+ [12] > maxWrites/u,
      `prospective guard before line ${push.index + 1}`);
    assert.match(guardWindow, /return value="\[\\"limit\\", type,/u,
      `atomic limit before line ${push.index + 1}`);
  }
}

for (const [type, expectedStatus, expectedNames, expectedDiagnostics, expectedFacts] of MATRIX) {
  test(`A3b canonical ${type} form has its exact scalar-subset receipt`, () => {
    const receipt = runDocument(`a3b-${type}.kern`, nestedSource(type)).receipt;
    assert.equal(receipt.status, expectedStatus, type);
    assert.deepEqual(lineOccurrences(receipt).map(({ propertyName }) => propertyName), expectedNames, type);
    assert.deepEqual(codes(receipt.diagnostics), expectedDiagnostics, `${type}: diagnostics`);
    assert.deepEqual(codes(receipt.facts), expectedFacts, `${type}: facts`);
  });
}

test('A3b exact authored slices bind structured, normalized, quoted, and residual writes', () => {
  const cases = [
    ['route', { method: 'GET', path: '/users', name: 'name=listUsers' }],
    ['doc', { text: '"hello world"' }],
    ['fn', { name: 'greet', params: 'name: string', returns: 'Result<string>', async: 'async=true' }],
    ['let', { name: 'total', type: 'number', value: 'left + right' }],
    ['import', { names: '{ Users, Roles as UserRoles }', from: '"./users.kern"' }],
  ];
  for (const [type, expectedSlices] of cases) {
    const source = nestedSource(type);
    const receipt = runDocument(`a3b-span-${type}.kern`, source).receipt;
    const points = Array.from(source);
    for (const occurrence of lineOccurrences(receipt)) {
      const expected = expectedSlices[occurrence.propertyName];
      if (expected === undefined) continue;
      assert.equal(points.slice(occurrence.startScalar, occurrence.endScalar).join(''), expected,
        `${type}.${occurrence.propertyName}`);
    }
    assert.deepEqual(
      lineOccurrences(receipt).filter(({ propertyName }) => Object.hasOwn(expectedSlices, propertyName))
        .map(({ propertyName }) => propertyName),
      Object.keys(expectedSlices),
      `${type}: every expected authored slice is represented`,
    );
  }
});

test('A3b normalized bare expressions produce exact local evidence', () => {
  for (const type of ['return', 'throw', 'do', 'if', 'while']) {
    const source = nestedSource(type);
    const receipt = runDocument(`a3b-expression-${type}.kern`, source).receipt;
    const occurrences = lineOccurrences(receipt);
    assert.equal(occurrences.length, 1, `${type}: exact normalized expression occurrence`);
    const occurrence = occurrences[0];
    assert.equal(occurrence.valueRepresentation, 'bare', type);
    assert.equal(receipt.expressionEvidence.length, 1, type);
    const evidence = receipt.expressionEvidence[0];
    assert.equal(evidence.origin, 'f4-local', type);
    assert.equal(evidence.decodedSource, occurrence.value, type);
    assert.equal(
      Array.from(source).slice(evidence.expressionStartScalar, evidence.expressionEndScalar).join(''),
      evidence.decodedSource,
      type,
    );
  }
});

test('A3b private kernel distinguishes success, no-op, and limit with closed provenance', () => {
  const route = runKernel(fixtureByType.get('route').source);
  assert.equal(route[0], 'success');
  assert.equal(route[1], 'route');
  assert.equal(Number(route[4]), 2);
  assert.equal((route.length - 6) % 6, 0);
  assert.deepEqual([route[11], route[17]], ['authored-normalized-scalar', 'authored-scalar']);

  const fallback = runKernel('fn name=legacy returns=void');
  assert.equal(fallback[0], 'success');
  assert.equal(Number(fallback[4]), 0);
  assert.equal(fallback.length, 6);

  const limited = runKernel(fixtureByType.get('route').source, 1);
  assert.equal(limited[0], 'limit');
  assert.equal(limited.length, 6);
});

test('A3b internal aggregates and controls never leak into public partitions', () => {
  for (const type of ['fn', 'import', 'params', 'middleware']) {
    const receipt = runDocument(`a3b-internal-${type}.kern`, nestedSource(type)).receipt;
    const serialized = JSON.stringify(receipt);
    for (const forbidden of [
      '__firstClassSyntax', '__firstClassImport', '__firstClassBindings',
      'bindings-v1', 'params-items-v1', 'middleware-list',
    ]) assert.doesNotMatch(serialized, new RegExp(forbidden, 'u'), `${type}: ${forbidden}`);
  }
});

test('A3b normalized and explicit occurrences share one prospective atomic limit', () => {
  const source = nestedSource('route');
  const baseline = runDocument('a3b-limit-baseline.kern', source);
  assert.equal(baseline.receipt.status, 'classified');
  const count = baseline.receipt.propertyOccurrences.length;
  assert.ok(count > 1);
  const exact = __test.runDocumentWithProfileLimits('a3b-limit-exact.kern', source, {
    maxPropertyOccurrences: count,
  }).receipt;
  assert.equal(exact.status, 'classified');
  assert.equal(exact.propertyOccurrences.length, count);
  assertAtomicLimit(__test.runDocumentWithProfileLimits('a3b-limit-under.kern', source, {
    maxPropertyOccurrences: count - 1,
  }).receipt, 'occurrence cap');
});

test('A3b occurrence byte and work ledgers admit exact caps and reject cap-minus-one atomically', () => {
  const source = nestedSource('route');
  const moduleId = 'a3b-resource-boundary.kern';
  const baseline = runDocument(moduleId, source);
  const occurrenceBytes = new TextEncoder().encode(baseline.fields[5]).length;
  const workSteps = baseline.receipt.workSteps;
  for (const [key, exact] of [
    ['maxEncodedBytes', occurrenceBytes],
    ['maxWorkSteps', workSteps],
  ]) {
    const admitted = __test.runDocumentWithProfileLimits(moduleId, source, { [key]: exact }).receipt;
    assert.equal(admitted.status, 'classified', `${key}: exact`);
    assert.equal(admitted.propertyOccurrences.length, baseline.receipt.propertyOccurrences.length, key);
    assertAtomicLimit(__test.runDocumentWithProfileLimits(moduleId, source, {
      [key]: exact - 1,
    }).receipt, `${key}: cap minus one`);
  }
});

test('A3b authenticated prerequisite drift precedes an otherwise-crossing occurrence cap', () => {
  const source = nestedSource('route');
  const moduleId = 'a3b-drift-precedence.kern';
  const maxPropertyOccurrences = runDocument(moduleId, source).receipt.propertyOccurrences.length - 1;
  assertAtomicLimit(__test.runDocumentWithMutationAndProfileLimits(
    moduleId, source, undefined, { maxPropertyOccurrences },
  ).receipt, 'unmutated cap control');
  for (const [mutation, code] of [
    ['f1-record-kind', 'F4_F1_DRIFT'],
    ['f3-parent-edge', 'F4_F3_DRIFT'],
  ]) {
    const receipt = __test.runDocumentWithMutationAndProfileLimits(
      moduleId, source, mutation, { maxPropertyOccurrences },
    ).receipt;
    assert.equal(receipt.status, 'fatal', mutation);
    assert.deepEqual(codes(receipt.diagnostics), [code], mutation);
    for (const section of ['declarations', 'propertyOccurrences', 'facts', 'expressionEvidence']) {
      assert.deepEqual(receipt[section], [], `${mutation}: ${section}`);
    }
  }
});

test('A3b private writes are guarded prospectively before every retention', () => {
  const kernel = readFileSync(new URL(
    '../../examples/kern-frontend/keyword-handler-normalization.kern', import.meta.url,
  ), 'utf8');
  assertProspectiveWriteGuards(kernel);
  assert.throws(() => assertProspectiveWriteGuards(
    kernel.replace(/\n\s+if cond="writeNames\.length \+ 1 > maxWrites"\n\s+return value="[^\n]+"/u, ''),
  ), /prospective guard/u);
});

test('A3b F4 composition owns the neutral kernel without shadow delegation or direct occurrence append', () => {
  assert.ok(F4_COMPOSITION_PATHS.includes('examples/kern-frontend/keyword-handler-normalization.kern'));
  const sources = F4_COMPOSITION_PATHS.map((path) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')).join('\n');
  assert.equal((sources.match(/^fn name=normalizekeywordhandlerwrites returns="string\[\]"$/gmu) ?? []).length, 1,
    'one normalizer definition');
  assert.equal((sources.match(/let name=normalized value="normalizekeywordhandlerwrites\(/gu) ?? []).length, 1,
    'one F4 adapter call');
  assert.doesNotMatch(sources, /observeretainedtokenstream|kern\.frontend\..*-shadow/u);
  assert.match(sources, /f4occurrenceadmit\(/u);
  assert.doesNotMatch(sources, /assign target=occurrences value="f4append\(/u);
});
