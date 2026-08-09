import assert from 'node:assert/strict';
import test from 'node:test';

import { parseWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  captureGenericPropertyStyleThemeDiagnosticsEvidence,
  evaluateGenericPropertyStyleThemeDiagnosticProjection,
  evaluateGenericPropertyStyleThemeDiagnosticRecovery,
  evaluateGenericPropertyStyleThemeDiagnostics,
  executeGenericPropertyStyleThemeDiagnosticRecoveryFields,
  executeGenericPropertyStyleThemeDiagnosticsFields,
  loadGenericPropertyStyleThemeDiagnosticsSource,
  validateNativeGenericPropertyStyleThemeDiagnosticsSource,
} from '../check-kern-frontend-generic-property-style-theme-diagnostics.mjs';
import { GENERIC_PROPERTY_STYLE_THEME_DIAGNOSTIC_FIXTURES } from './fixtures.mjs';
import {
  loadFrontendGenericPropertyStyleThemeDiagnosticsPolicy,
  validateFrontendGenericPropertyStyleThemeDiagnosticsPolicy,
} from './policy.mjs';
import { parseGenericPropertyStyleThemeDiagnosticsEnvelope } from './envelope.mjs';

const policy = loadFrontendGenericPropertyStyleThemeDiagnosticsPolicy();
const source = loadGenericPropertyStyleThemeDiagnosticsSource();
const finalResults = new Map();

function result(id) {
  const fixture = GENERIC_PROPERTY_STYLE_THEME_DIAGNOSTIC_FIXTURES.find((entry) => entry.id === id);
  assert.ok(fixture, `missing fixture ${id}`);
  return evaluateGenericPropertyStyleThemeDiagnosticProjection(
    fixture.source, policy, source,
  );
}

function recovery(id) {
  const fixture = GENERIC_PROPERTY_STYLE_THEME_DIAGNOSTIC_FIXTURES.find((entry) => entry.id === id);
  assert.ok(fixture, `missing fixture ${id}`);
  return evaluateGenericPropertyStyleThemeDiagnosticRecovery(
    fixture.source, policy, source,
  );
}

function finalResult(fixture) {
  if (!finalResults.has(fixture.id)) {
    finalResults.set(fixture.id, evaluateGenericPropertyStyleThemeDiagnostics(fixture.source, policy, source));
  }
  return finalResults.get(fixture.id);
}

function bootstrapProps(result) {
  const props = Object.fromEntries(result.finalProperties.map((property) => [
    property.key, property.valueKind === 'expr' ? { __expr: true, code: property.value } : property.value,
  ]));
  if (result.finalStyles.length > 0) {
    props.styles = Object.fromEntries(result.finalStyles.map(({ key, value }) => [key, value]));
  }
  if (result.finalPseudoStyles.length > 0) {
    props.pseudoStyles = Object.fromEntries(result.finalPseudoStyles.map(
      ({ entries, pseudo }) => [pseudo, Object.fromEntries(entries.map(({ key, value }) => [key, value]))],
    ));
  }
  if (result.themeRefs.length > 0) props.themeRefs = result.themeRefs;
  return props;
}

function diagnosticShape({ category, code, col, endCol, line, message, severity, suggestion }) {
  return { category, code, col, endCol, line, message, severity, suggestion };
}

function authenticatedMember(fields, tag, fieldCount) {
  const member = [];
  for (let cursor = 21; cursor < fields.length - 20 && member.length < fieldCount; cursor += 20) {
    if (fields[cursor] !== tag) continue;
    const count = Number(fields[cursor + 3]);
    member.push(...fields.slice(cursor + 4, cursor + 4 + count));
  }
  assert.equal(member.length, fieldCount);
  return member;
}

test('native projection matches independent unexpected-token classification', () => {
  assert.equal(GENERIC_PROPERTY_STYLE_THEME_DIAGNOSTIC_FIXTURES.length, 15);
  assert.equal(result('no-warning').diagnostics.length, 0);
  assert.deepEqual(result('adjacent-equals-identifier').diagnostics.map(({ col, endCol, value }) => (
    { col, endCol, value }
  )), [
    { col: 8, endCol: 9, value: '=' },
    { col: 10, endCol: 15, value: 'stray' },
  ]);
  assert.deepEqual(result('ascii-punctuation').diagnostics.map(({ value }) => value), ['@', ',', ';']);
  assert.equal(result('quoted-value-width').diagnostics[0].endCol, 9);
  assert.equal(result('expression-value-width').diagnostics[0].endCol, 9);
  assert.deepEqual(result('terminal-adjacent').diagnostics.map(({ value }) => value), ['stray', 'stray2']);
});

test('native recovery authenticates success and recoverable STYLE_PROFILE predecessors', () => {
  const successful = recovery('no-warning');
  assert.equal(successful.status, 'decision');
  assert.equal(successful.predecessorTag, 'decision');
  assert.equal(successful.predecessorCode, '');
  assert.equal(successful.streamFields[0], policy.retainedTokenStreamFormat);
  const recovered = recovery('single-identifier');
  assert.equal(recovered.predecessorTag, 'failure');
  assert.equal(recovered.predecessorCode, 'STYLE_PROFILE');
  assert.equal(recovered.state, 'loop');
  assert.equal(recovered.knownState, 'known');
  assert.equal(recovered.admittedType, 'screen');
  assert.equal(recovered.streamFields[0], policy.retainedTokenStreamFormat);
});

test('integrated diagnostics preserve bootstrap semantics and diagnostic order', () => {
  for (const fixture of GENERIC_PROPERTY_STYLE_THEME_DIAGNOSTIC_FIXTURES) {
    const actual = finalResult(fixture);
    const bootstrap = parseWithDiagnostics(fixture.source);
    assert.equal(actual.state, 'loop', fixture.id);
    assert.equal(actual.admittedType, bootstrap.root.type, fixture.id);
    assert.deepEqual(bootstrap.root.props, bootstrapProps(actual), fixture.id);
    assert.deepEqual(
      bootstrap.diagnostics.filter(({ code }) => ['DUPLICATE_PROP', 'UNEXPECTED_TOKEN'].includes(code))
        .map(diagnosticShape),
      actual.diagnostics.map(diagnosticShape),
      fixture.id,
    );
  }
  assert.deepEqual(
    finalResult(GENERIC_PROPERTY_STYLE_THEME_DIAGNOSTIC_FIXTURES.find(({ id }) => id === 'duplicate-interleave'))
      .diagnostics.map(({ code }) => code),
    ['UNEXPECTED_TOKEN', 'DUPLICATE_PROP', 'UNEXPECTED_TOKEN', 'DUPLICATE_PROP'],
  );
});

test('authentication, containment, and compact failures fail closed', () => {
  const content = 'screen stray a=1';
  const evidence = captureGenericPropertyStyleThemeDiagnosticsEvidence(content, policy, source);
  const corruptProjection = [...evidence.fields];
  const projectionAuth = corruptProjection.indexOf('projection-auth');
  assert.ok(projectionAuth > 0);
  corruptProjection[projectionAuth + 4] = 'corrupt-format';
  assert.throws(() => parseGenericPropertyStyleThemeDiagnosticsEnvelope(
    content, evidence.snapshot, corruptProjection, policy, evidence.streamFields, evidence.stream,
  ), /rejection|record rejection/);
  const corruptSeal = [...evidence.fields];
  corruptSeal[corruptSeal.length - 20] = 'not-a-seal';
  assert.throws(() => parseGenericPropertyStyleThemeDiagnosticsEnvelope(
    content, evidence.snapshot, corruptSeal, policy, evidence.streamFields, evidence.stream,
  ), /seal/);

  const predecessor = authenticatedMember(evidence.fields, 'predecessor-auth', Number(evidence.fields[4]));
  predecessor[4] = '999999';
  const recoveryFailure = executeGenericPropertyStyleThemeDiagnosticRecoveryFields(
    content, evidence.snapshot, policy, source, predecessor,
  );
  assert.equal(recoveryFailure.length, 41);
  assert.equal(recoveryFailure[1], 'failure');
  assert.equal(recoveryFailure[2], 'STYLE_DIAGNOSTIC_INVALID');
  assert.equal(recoveryFailure[21], 'failure-seal');

  assert.throws(() => validateNativeGenericPropertyStyleThemeDiagnosticsSource(
    source.slice(source.indexOf('fn name=stylethemediagnosticrecoveryfailure')) + '\n# parseWithDiagnostics',
  ), /delegation rejection/);

  const fieldFailure = executeGenericPropertyStyleThemeDiagnosticsFields(content, evidence.snapshot, {
    ...policy, maxGenericPropertyStyleThemeDiagnosticsEnvelopeFields: 41,
  }, source);
  assert.equal(fieldFailure.length, 41);
  assert.equal(fieldFailure[2], 'STYLE_DIAGNOSTICS_FIELDS_LIMIT');
  assert.equal(fieldFailure[21], 'failure-seal');

  const diagnosticLimit = executeGenericPropertyStyleThemeDiagnosticsFields(
    'screen stray again third a=1', evidence.snapshot,
    { ...policy, maxGenericPropertyStyleThemeUnexpectedDiagnostics: 2 }, source,
  );
  assert.equal(diagnosticLimit.length, 41);
  assert.equal(diagnosticLimit[2], 'STYLE_DIAGNOSTIC_LIMIT');
  assert.equal(diagnosticLimit[21], 'failure-seal');
});

test('diagnostic policy is exact, bounded, and independently budgeted', () => {
  assert.equal(policy.maxGenericPropertyStyleThemeUnexpectedDiagnostics, 64);
  assert.ok(policy.maxGenericPropertyStyleThemeDiagnosticProjectionFields < policy.runtimeLimits.maxCollectionLength);
  assert.ok(policy.maxGenericPropertyStyleThemeDiagnosticsEnvelopeFields < policy.runtimeLimits.maxCollectionLength);
  assert.throws(() => validateFrontendGenericPropertyStyleThemeDiagnosticsPolicy({}), /exactly/);
  assert.throws(() => validateFrontendGenericPropertyStyleThemeDiagnosticsPolicy({
    format: policy.genericPropertyStyleThemeDiagnosticsFormat,
    maxEnvelopeBytes: policy.maxGenericPropertyStyleThemeDiagnosticsEnvelopeBytes,
    maxUnexpectedDiagnostics: policy.profileLimits.maxTokens + 1,
    projectionFormat: policy.genericPropertyStyleThemeDiagnosticProjectionFormat,
    recoveryFormat: policy.genericPropertyStyleThemeDiagnosticRecoveryFormat,
    sourceProfile: policy.genericPropertyStyleThemeDiagnosticsSourceProfile,
  }), /maxUnexpectedDiagnostics/);
});
