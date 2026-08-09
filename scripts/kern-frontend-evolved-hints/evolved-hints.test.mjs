import assert from 'node:assert/strict';
import test from 'node:test';

import { parseWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithGenericPropertyStyleThemeDiagnosticsSafety,
} from '../../packages/core/dist/mutable-node-type-registry-snapshot.js';
import { KernRuntime } from '../../packages/core/dist/runtime-state.js';
import {
  captureEvolvedHintsEvidence,
  evaluateEvolvedHints,
  executeEvolvedHintsFields,
  loadEvolvedHintsMemberSource,
  loadEvolvedHintsSource,
  runtimeForEvolvedHintFixture,
  serializeParserHintSnapshot,
  validateNativeEvolvedHintsSource,
} from '../check-kern-frontend-evolved-hints.mjs';
import { parseEvolvedHintsEnvelope } from './envelope.mjs';
import { EVOLVED_HINT_FIXTURES } from './fixtures.mjs';
import {
  loadFrontendEvolvedHintsPolicy,
  validateFrontendEvolvedHintsPolicy,
} from './policy.mjs';

const policy = loadFrontendEvolvedHintsPolicy();
const source = loadEvolvedHintsSource();
const results = new Map();
const snapshotLimits = {
  maxNameBytes: policy.maxNameBytes,
  maxNameCodePoints: policy.maxNameCodePoints,
  maxRegistryEntries: policy.maxRegistryEntries,
};

function fixture(id) {
  const value = EVOLVED_HINT_FIXTURES.find((entry) => entry.id === id);
  assert.ok(value, `missing fixture ${id}`);
  return value;
}

function result(id) {
  if (!results.has(id)) {
    const value = fixture(id);
    results.set(id, evaluateEvolvedHints(value.source, runtimeForEvolvedHintFixture(value), policy, source));
  }
  return results.get(id);
}

function diagnosticShape({ category, code, col, endCol, line, message, severity, suggestion }) {
  return { category, code, col, endCol, line, message, severity, suggestion };
}

function publicDiagnostics(parseResult) {
  return parseResult.diagnostics
    .filter(({ code }) => ['DUPLICATE_PROP', 'UNEXPECTED_TOKEN'].includes(code))
    .map(diagnosticShape);
}

function mutantSource(needle, replacement) {
  assert.equal(source.split(needle).length - 1, 1, `mutation needle must be unique: ${needle}`);
  return source.replace(needle, replacement);
}

function assertMutantKilled(id, needle, replacement) {
  const value = fixture(id);
  assert.throws(
    () => evaluateEvolvedHints(
      value.source,
      runtimeForEvolvedHintFixture(value),
      policy,
      mutantSource(needle, replacement),
    ),
    /rejection|Expected values|runtime rejection|unsupported runtime input/,
    id,
  );
}

test('native evolved hints preserve bootstrap props and public diagnostic parity', () => {
  assert.equal(EVOLVED_HINT_FIXTURES.length, 12);
  for (const value of EVOLVED_HINT_FIXTURES) {
    const actual = result(value.id);
    const bootstrap = parseWithDiagnostics(value.source, runtimeForEvolvedHintFixture(value));
    assert.equal(actual.status, 'decision', value.id);
    assert.equal(actual.admittedType, bootstrap.root.type, value.id);
    assert.deepEqual(actual.props, bootstrap.root.props, value.id);
    assert.deepEqual(actual.diagnostics.map(diagnosticShape), publicDiagnostics(bootstrap), value.id);
  }
});

test('runtime precedence, positional kinds, bare-word guard, cursor, and overwrite order are exact', () => {
  assert.deepEqual(result('runtime-two-positionals').writes.map(({ name, value }) => ({ name, value })), [
    { name: 'left', value: 'x' },
    { name: 'right', value: 'bob' },
  ]);
  assert.deepEqual(result('builtin-class-fallback').writes.map(({ name, source: hintSource, value }) => ({
    hintSource, name, value,
  })), [{ hintSource: 'builtin', name: 'name', value: 'NativeClass' }]);
  assert.equal(result('empty-runtime-suppresses-builtin').hintSource, 'runtime');
  assert.deepEqual(result('empty-runtime-suppresses-builtin').writes, []);
  assert.deepEqual(result('bare-key-value-guard').writes, []);
  assert.deepEqual(result('arbitrary-positional-kinds').writes.map(({ kind, name, value }) => ({
    kind, name, value,
  })), [
    { kind: 'style', name: 'styleArg', value: 'c:red' },
    { kind: 'themeRef', name: 'themeArg', value: 'dark' },
    { kind: 'expr', name: 'exprArg', value: 'x' },
  ]);
  assert.deepEqual(result('write-overwrite-order').writes.map(({ name, value }) => ({ name, value })), [
    { name: 'name', value: 'one' },
    { name: 'name', value: 'two' },
    { name: 'name', value: 'three' },
  ]);
  assert.equal(result('write-overwrite-order').props.name, 'three');
  assert.deepEqual(result('single-bare-word').writes.map(({ value }) => value), ['one']);
  assert.deepEqual(result('positional-key-value-head').diagnostics.map(({ col, endCol, value }) => ({
    col, endCol, value,
  })), [
    { col: 9, endCol: 10, value: '=' },
    { col: 10, endCol: 11, value: '1' },
  ]);
  const spacedEqualsSource = 'widget name = 1 stray';
  const spacedEqualsRuntime = new KernRuntime();
  spacedEqualsRuntime.registerEvolvedType('widget');
  spacedEqualsRuntime.registerParserHints('widget', { bareWord: 'name' });
  const spacedEquals = evaluateEvolvedHints(spacedEqualsSource, spacedEqualsRuntime, policy, source);
  const spacedEqualsBootstrap = parseWithDiagnostics(spacedEqualsSource, spacedEqualsRuntime);
  assert.equal(spacedEquals.props.name, 'name');
  assert.deepEqual(spacedEquals.props, spacedEqualsBootstrap.root.props);
  assert.deepEqual(spacedEquals.diagnostics.map(diagnosticShape), publicDiagnostics(spacedEqualsBootstrap));
  assert.equal(result('runtime-two-positionals').exitFieldCursor, 61);
});

test('masking preserves UTF-16 width and astral diagnostic columns', () => {
  const actual = result('astral-width');
  const bootstrap = parseWithDiagnostics(fixture('astral-width').source, runtimeForEvolvedHintFixture(fixture('astral-width')));
  assert.equal(actual.maskedContent.length, fixture('astral-width').source.length);
  assert.equal(actual.maskedContent, 'widget            stray p=1');
  assert.deepEqual(actual.diagnostics.map(({ col, endCol }) => ({ col, endCol })), [{ col: 19, endCol: 24 }]);
  assert.deepEqual(actual.diagnostics.map(diagnosticShape), publicDiagnostics(bootstrap));
});

test('authenticated parser-hint payload swaps fail closed in both directions', () => {
  const content = 'widget one two p=1';
  const runtimeA = new KernRuntime();
  runtimeA.registerEvolvedType('widget');
  runtimeA.registerParserHints('widget', { positionalArgs: ['first'] });
  const evidenceA = captureEvolvedHintsEvidence(content, runtimeA, policy, source);
  const runtimeB = new KernRuntime();
  runtimeB.registerEvolvedType('widget');
  runtimeB.registerParserHints('widget', { bareWord: 'name' });
  const evidenceB = captureEvolvedHintsEvidence(content, runtimeB, policy, source);

  for (const [expected, supplied] of [[evidenceA, evidenceB], [evidenceB, evidenceA]]) {
    const fields = executeEvolvedHintsFields(
      content,
      expected.consumed.snapshot,
      policy,
      source,
      serializeParserHintSnapshot(supplied.consumed.snapshot),
    );
    assert.throws(
      () => parseEvolvedHintsEnvelope(content, expected.consumed.snapshot, fields, policy),
      /rejection|Expected values/,
    );
  }
});

test('fused evidence rejects structural copies, replay, and stale runtime epochs', () => {
  const runtime = new KernRuntime();
  runtime.registerEvolvedType('widget');
  runtime.registerParserHints('widget', { bareWord: 'name' });
  const stale = parseWithGenericPropertyStyleThemeDiagnosticsSafety('widget one p=1', runtime, snapshotLimits);
  parseWithGenericPropertyStyleThemeDiagnosticsSafety('widget two p=1', runtime, snapshotLimits);
  assert.throws(() => consumeMutableNodeTypeRegistryParseEvidence(stale), /stale|epoch/);

  const current = parseWithGenericPropertyStyleThemeDiagnosticsSafety('widget one p=1', runtime, snapshotLimits);
  assert.throws(() => consumeMutableNodeTypeRegistryParseEvidence({ ...current }), /forged|evidence/);
  assert.equal(consumeMutableNodeTypeRegistryParseEvidence(current).snapshot.parserHints[0].bareWord, 'name');
  assert.throws(() => consumeMutableNodeTypeRegistryParseEvidence(current), /consumed|replay|evidence/);
});

test('source mutations kill precedence, positional order, bare guard, masking, and cursor semantics', () => {
  assertMutantKilled(
    'empty-runtime-suppresses-builtin',
    'if cond="selectedIndex < 0"',
    'if cond="selectedIndex >= 0"',
  );
  assertMutantKilled(
    'runtime-two-positionals',
    'if cond="selectedOrdinal == positionalCursor"',
    'if cond="selectedOrdinal == 0"',
  );
  assertMutantKilled(
    'bare-key-value-guard',
    'if cond="!keyValue && tokenKind == \\"identifier\\""',
    'if cond="tokenKind == \\"identifier\\""',
  );
  assertMutantKilled(
    'runtime-positional-bare',
    'let name=maskedContent value="maskevolvedhinttokens(content, consumedStarts, consumedEnds)"',
    'let name=maskedContent value="content"',
  );
  assertMutantKilled(
    'absent-nonclass',
    'assign target=admittedType value="tokenValues[tokenIndex]"\n          assign target=exitTokenCursor value="tokenIndex + 1"',
    'assign target=admittedType value="tokenValues[tokenIndex]"\n          assign target=exitTokenCursor value="tokenIndex"',
  );
});

test('policy, source containment, compact failures, and envelope seals are bounded', () => {
  assert.equal(policy.evolvedHintsFormat, 'kern.frontend.evolved-hints-shadow.1');
  assert.equal(policy.maxEvolvedHintWrites, policy.profileLimits.maxTokens);
  assert.ok(policy.maxEvolvedHintsEnvelopeFields < policy.runtimeLimits.maxCollectionLength);
  assert.ok(policy.maxEvolvedHintsEnvelopeBytes <= policy.runtimeLimits.maxBytes);
  assert.throws(() => validateFrontendEvolvedHintsPolicy({}), /exactly/);
  assert.throws(() => validateNativeEvolvedHintsSource(`${loadEvolvedHintsMemberSource()}\n# parseWithDiagnostics`), /delegation rejection/);

  const value = fixture('runtime-positional-bare');
  const runtime = runtimeForEvolvedHintFixture(value);
  const captured = captureEvolvedHintsEvidence(value.source, runtime, policy, source);
  const fieldFailure = executeEvolvedHintsFields(
    value.source, captured.consumed.snapshot, { ...policy, maxEvolvedHintsEnvelopeFields: 41 }, source,
  );
  assert.equal(fieldFailure.length, 41);
  assert.equal(fieldFailure[2], 'EVOLVED_HINT_FIELDS_LIMIT');
  assert.deepEqual(
    parseEvolvedHintsEnvelope(value.source, captured.consumed.snapshot, fieldFailure, policy),
    {
      code: 'EVOLVED_HINT_FIELDS_LIMIT',
      detail: '',
      format: policy.evolvedHintsFormat,
      status: 'failure',
    },
  );

  const staleFailure = [...fieldFailure];
  staleFailure[4] = String(captured.consumed.snapshot.runtimeInstance + 1);
  staleFailure[25] = staleFailure[4];
  assert.throws(
    () => parseEvolvedHintsEnvelope(value.source, captured.consumed.snapshot, staleFailure, policy),
    /identity/,
  );
  const forgedCodeFailure = [...fieldFailure];
  forgedCodeFailure[2] = 'FORGED_CODE';
  forgedCodeFailure[22] = forgedCodeFailure[2];
  assert.throws(
    () => parseEvolvedHintsEnvelope(value.source, captured.consumed.snapshot, forgedCodeFailure, policy),
    /failure code|contract/,
  );
  const forgedDetailFailure = [...fieldFailure];
  forgedDetailFailure[3] = 'forged detail';
  forgedDetailFailure[23] = forgedDetailFailure[3];
  assert.throws(
    () => parseEvolvedHintsEnvelope(value.source, captured.consumed.snapshot, forgedDetailFailure, policy),
    /failure detail|contract/,
  );
  const byteFailure = executeEvolvedHintsFields(
    value.source, captured.consumed.snapshot, { ...policy, maxEvolvedHintsEnvelopeBytes: 256 }, source,
  );
  assert.equal(byteFailure.length, 41);
  assert.equal(byteFailure[2], 'EVOLVED_HINT_BYTES_LIMIT');
  const invalidHints = executeEvolvedHintsFields(
    value.source,
    captured.consumed.snapshot,
    policy,
    source,
    { bareWords: [], positionalNames: [], positionalOwners: [], types: ['widget'] },
  );
  assert.equal(invalidHints.length, 41);
  assert.equal(invalidHints[2], 'EVOLVED_HINT_INVALID');

  const corruptSeal = [...captured.fields];
  corruptSeal[corruptSeal.length - 20] = 'not-a-seal';
  assert.throws(
    () => parseEvolvedHintsEnvelope(value.source, captured.consumed.snapshot, corruptSeal, policy),
    /seal/,
  );
});
