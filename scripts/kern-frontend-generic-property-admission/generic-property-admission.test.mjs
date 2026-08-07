import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithGenericPropertyAdmissionSafety,
} from '../../packages/core/dist/mutable-node-type-registry-snapshot.js';
import { KernRuntime } from '../../packages/core/dist/runtime-state.js';
import {
  evaluateGenericPropertyAdmissionFixture,
  executeGenericPropertyAdmission,
  executeGenericPropertyAdmissionFields,
  loadGenericPropertyAdmissionSource,
  parseGenericPropertyAdmissionEnvelope,
  validateNativeGenericPropertyAdmissionSource,
} from '../check-kern-frontend-generic-property-admission.mjs';
import { GENERIC_PROPERTY_ADMISSION_FIXTURES } from './fixtures.mjs';
import {
  loadFrontendGenericPropertyAdmissionPolicy,
  validateFrontendGenericPropertyAdmissionPolicy,
} from './policy.mjs';

const policy = loadFrontendGenericPropertyAdmissionPolicy();
const snapshotLimits = Object.freeze({
  maxNameBytes: policy.maxNameBytes,
  maxNameCodePoints: policy.maxNameCodePoints,
  maxRegistryEntries: policy.maxRegistryEntries,
});

function evidenceFor(source, runtime = new KernRuntime()) {
  return parseWithGenericPropertyAdmissionSafety(source, runtime, snapshotLimits);
}

function textFields(value) {
  return value.value.map((entry) => entry.value);
}

function textList(fields) {
  return { tag: 'list', value: fields.map((value) => ({ tag: 'text', value })) };
}

function fixture(id) {
  const found = GENERIC_PROPERTY_ADMISSION_FIXTURES.find((entry) => entry.id === id);
  assert.ok(found, `missing fixture ${id}`);
  return found;
}

function memberBounds(source) {
  const start = source.lastIndexOf('fn name=observegenericpropertyadmission');
  assert.notEqual(start, -1);
  return { prefix: source.slice(0, start), member: source.slice(start) };
}

function replaceMemberOnce(source, from, to) {
  const { prefix, member } = memberBounds(source);
  const start = member.indexOf(from);
  assert.notEqual(start, -1, `missing mutation target ${from}`);
  assert.equal(member.indexOf(from, start + from.length), -1, `mutation target is not unique: ${from}`);
  return prefix + member.slice(0, start) + to + member.slice(start + from.length);
}

function assertMutantKilled(id, from, to) {
  const source = loadGenericPropertyAdmissionSource();
  const mutant = replaceMemberOnce(source, from, to);
  assert.throws(() => evaluateGenericPropertyAdmissionFixture(fixture(id), policy, mutant));
}

test('all discriminating property-unit fixtures match bootstrap parsing', () => {
  const source = loadGenericPropertyAdmissionSource();
  assert.equal(GENERIC_PROPERTY_ADMISSION_FIXTURES.length, 21);
  const results = new Map();
  for (const current of GENERIC_PROPERTY_ADMISSION_FIXTURES) {
    results.set(current.id, evaluateGenericPropertyAdmissionFixture(current, policy, source));
  }
  assert.deepEqual(
    [...new Set([...results.values()].map(({ state }) => state))].sort(),
    ['dropped', 'none', 'property'],
  );
  assert.deepEqual(
    [...new Set([...results.values()].map(({ valueKind }) => valueKind))].sort(),
    ['bare', 'empty', 'expr', 'none', 'quoted'],
  );
  assert.equal(results.get('quoted')?.quoted, true);
  assert.equal(results.get('quoted-empty')?.value, '');
  assert.equal(results.get('expression')?.value, 'x + 1');
  assert.equal(results.get('bare-unknown-at')?.value, 'wide@mobile');
  assert.equal(results.get('style-zero-token-boundary')?.consumedValueTokenCount, 0);
  assert.equal(results.get('theme-zero-token-boundary')?.consumedValueTokenCount, 0);
  assert.equal(results.get('second-property-deferred')?.value, 'Home');
  assert.equal(results.get('unknown-node-property')?.knownState, 'unknown');
});

test('unsafe bootstrap property keys reject before fused parse evidence exists', () => {
  const runtime = new KernRuntime();
  for (const source of [
    'screen __proto__=bare',
    'screen __proto__={{ ({ polluted: true }) }}',
  ]) {
    assert.throws(() => evidenceFor(source, runtime), /reserved generic property key __proto__/);
  }
  assert.equal(evidenceFor('screen name=Home # __proto__=ignored', runtime).parseResult.root.props?.name, 'Home');
});

test('policy is exact and the derived outer envelope has an exact collection boundary', () => {
  assert.ok(policy.maxGenericPropertyAdmissionEnvelopeFields <= policy.runtimeLimits.maxCollectionLength);
  assert.throws(() => validateFrontendGenericPropertyAdmissionPolicy({}), /exactly/);
  assert.throws(
    () => validateFrontendGenericPropertyAdmissionPolicy({
      format: policy.genericPropertyAdmissionFormat + '-forged',
      sourceProfile: policy.genericPropertyAdmissionSourceProfile,
    }),
    /format/,
  );
  const extension = {
    format: policy.genericPropertyAdmissionFormat,
    sourceProfile: policy.genericPropertyAdmissionSourceProfile,
  };
  const maxAuthenticationRecords = Math.floor((policy.runtimeLimits.maxCollectionLength - 1) / 20) - 2;
  const exactInheritedFieldBoundary = maxAuthenticationRecords * 16;
  assert.doesNotThrow(() => validateFrontendGenericPropertyAdmissionPolicy(extension, {
    ...policy,
    maxKnownNodeWarningEnvelopeFields: exactInheritedFieldBoundary,
  }));
  assert.throws(
    () => validateFrontendGenericPropertyAdmissionPolicy(extension, {
      ...policy,
      maxKnownNodeWarningEnvelopeFields: exactInheritedFieldBoundary + 1,
    }),
    /runtime collection/,
  );
});

test('native source contains one successor and exactly one M4.163 plus M4.159 call', () => {
  const source = loadGenericPropertyAdmissionSource();
  assert.equal(validateNativeGenericPropertyAdmissionSource(source), source);
  const { member } = memberBounds(source);
  assert.throws(
    () => validateNativeGenericPropertyAdmissionSource(`${source}\n\n${member}`),
    /exactly one/,
  );
  assert.throws(
    () => validateNativeGenericPropertyAdmissionSource(replaceMemberOnce(
      source,
      'observeknownnodewarning(content,',
      'observeknownnodewarning_omitted(content,',
    )),
    /exactly once/,
  );
  assert.throws(
    () => validateNativeGenericPropertyAdmissionSource(replaceMemberOnce(
      source,
      'observeretainedtokenstream(content,',
      'observeretainedtokenstream(content, observeretainedtokenstream(content,',
    )),
    /exactly once/,
  );
  assert.throws(
    () => validateNativeGenericPropertyAdmissionSource(`${source}\n# parseProp`),
    /delegation/,
  );
});

test('outer parser rejects decision, cursor, inherited chunk, and seal corruption', () => {
  const content = 'screen name=Home';
  const consumed = consumeMutableNodeTypeRegistryParseEvidence(evidenceFor(content));
  const fields = textFields(executeGenericPropertyAdmissionFields(content, consumed.snapshot, policy, loadGenericPropertyAdmissionSource()));
  const lastSeal = fields.length - 20;
  const authStart = 21;
  const inheritedFieldCount = Number(fields[18]);
  const authRecords = Math.ceil(inheritedFieldCount / 16);
  const lastAuthStart = authStart + (authRecords - 1) * 20;
  const lastAuthCount = Number(fields[lastAuthStart + 3]);
  const corruptions = [
    ['truncation', fields.slice(0, -1)],
    ['state', { index: 2, value: 'none' }],
    ['known state', { index: 3, value: 'dropped' }],
    ['key', { index: 5, value: 'other' }],
    ['value kind', { index: 6, value: 'quoted' }],
    ['value', { index: 7, value: 'Other' }],
    ['quoted', { index: 8, value: 'true' }],
    ['cursor before', { index: 9, value: '0' }],
    ['property index', { index: 10, value: '3' }],
    ['equals index', { index: 11, value: '4' }],
    ['value index', { index: 12, value: '5' }],
    ['cursor after', { index: 13, value: '4' }],
    ['consumed count', { index: 14, value: '0' }],
    ['runtime', { indexes: [15, lastSeal + 14], value: '999' }],
    ['epoch', { indexes: [16, lastSeal + 15], value: '999' }],
    ['inherited field', { index: authStart + 4, value: fields[authStart + 4] + '-forged' }],
    ['chunk index', { index: authStart + 1, value: '00' }],
    ['chunk count', { index: authStart + 3, value: '17' }],
    ['chunk padding', { index: lastAuthStart + 4 + lastAuthCount, value: 'forged' }],
    ['source seal', { index: lastSeal + 16, value: 'other' }],
  ];
  for (const [label, corruption] of corruptions) {
    const mutated = Array.isArray(corruption) ? corruption : [...fields];
    if (!Array.isArray(corruption)) {
      for (const index of corruption.indexes ?? [corruption.index]) mutated[index] = corruption.value;
    }
    assert.throws(
      () => parseGenericPropertyAdmissionEnvelope(content, consumed.snapshot, textList(mutated), policy),
      /rejection|invalid|drift|canonical|Expected values/,
      label,
    );
  }
});

test('one-time fused parse evidence rejects copies, replay, and stale epochs', () => {
  const source = loadGenericPropertyAdmissionSource();
  const runtime = new KernRuntime();
  const stale = evidenceFor('screen name=Home', runtime);
  evidenceFor('screen name=Other', runtime);
  assert.throws(() => executeGenericPropertyAdmission(stale, policy, source), /evidence|epoch|stale/);
  const current = evidenceFor('screen name=Home', runtime);
  assert.throws(() => executeGenericPropertyAdmission({ ...current }, policy, source), /evidence|forged/);
  assert.equal(executeGenericPropertyAdmission(current, policy, source).state, 'property');
  assert.throws(() => executeGenericPropertyAdmission(current, policy, source), /evidence|consumed|replay/);
});

test('inherited failures propagate atomically through complete authentication', () => {
  const source = loadGenericPropertyAdmissionSource();
  const executeRaw = (content, snapshot, currentPolicy) => parseGenericPropertyAdmissionEnvelope(
    content,
    snapshot,
    executeGenericPropertyAdmissionFields(content, snapshot, currentPolicy, source),
    currentPolicy,
  );
  for (const [content, code, currentPolicy] of [
    ['', 'EMPTY_RETAINED_CODE', policy],
    ['é', 'UNSUPPORTED_UNKNOWN', policy],
    ['a'.repeat(policy.profileLimits.maxCodePoints + 1), 'CODE_POINTS_LIMIT', policy],
    [','.repeat(policy.profileLimits.maxTokens + 1), 'TOKEN_LIMIT', policy],
    ['1.0n '.repeat(policy.profileLimits.maxDiagnostics + 1), 'DIAGNOSTIC_LIMIT', policy],
    ['mystery', 'INVALID_LIMITS', {
      ...policy,
      profileLimits: { ...policy.profileLimits, maxTokens: 0 },
    }],
  ]) {
    const snapshot = evidenceFor(content).snapshot;
    const result = parseGenericPropertyAdmissionEnvelope(
      content,
      snapshot,
      executeGenericPropertyAdmissionFields(content, snapshot, currentPolicy, source),
      currentPolicy,
    );
    assert.deepEqual(result, { code, detail: '', status: 'failure' });
  }

  const valid = evidenceFor('mystery').snapshot;
  assert.deepEqual(
    executeRaw('mystery', { ...valid, runtimeInstance: 0 }, policy),
    { code: 'REGISTRY_INVALID', detail: '', status: 'failure' },
  );
});

test('named state, value-taxonomy, boundary, and cursor mutations are killed', () => {
  assertMutantKilled(
    'empty-at-eof',
    'assign target=state value="\\"property\\""',
    'assign target=state value="\\"none\\""',
  );
  assertMutantKilled(
    'none-style-first',
    'if cond="propertyPhase == \\"after-type\\" && tokenKind == \\"whitespace\\""',
    'if cond="false"',
  );
  assertMutantKilled(
    'quoted',
    'if cond="tokenKind == \\"quoted\\" || tokenKind == \\"expr\\""',
    'if cond="tokenKind == \\"expr\\""',
  );
  assertMutantKilled(
    'expression',
    'assign target=valueKind value="tokenKind"',
    'assign target=valueKind value="\\"bare\\""',
  );
  assertMutantKilled(
    'theme-zero-token-boundary',
    'if cond="tokenKind == \\"style\\" || tokenKind == \\"themeRef\\""',
    'if cond="tokenKind == \\"style\\""',
  );
  assertMutantKilled(
    'bare-unknown-at',
    'assign target=propertyValue value="propertyValue + tokenValue"',
    'assign target=propertyValue value="propertyValue"',
  );
  assertMutantKilled(
    'bare-single',
    'assign target=equalsIndexText value="String(tokenIndex)"',
    'assign target=equalsIndexText value="String(tokenIndex + 1)"',
  );
  assertMutantKilled(
    'empty-at-eof',
    'assign target=equalsIndexText value="String(tokenIndex)"\n                          assign target=cursorAfter value="tokenIndex + 1"\n                          assign target=propertyPhase value="\\"value\\""',
    'assign target=equalsIndexText value="String(tokenIndex)"\n                          assign target=cursorAfter value="tokenIndex"\n                          assign target=propertyPhase value="\\"value\\""',
  );
  assertMutantKilled(
    'bare-single',
    'for name=authStart from=0 to="inherited.length" step=16',
    'for name=authStart from=0 to="16" step=16',
  );
});
