import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseWithMutableNodeTypeRegistrySnapshot,
} from '../../packages/core/dist/mutable-node-type-registry-snapshot.js';
import { KernRuntime } from '../../packages/core/dist/runtime-state.js';
import {
  evaluateKnownNodeWarningFixture,
  executeKnownNodeWarning,
  executeKnownNodeWarningFields,
  loadKnownNodeWarningSource,
  parseKnownNodeWarningEnvelope,
  validateNativeKnownNodeWarningSource,
} from '../check-kern-frontend-known-node-warning.mjs';
import { knownNodeWarningTruthTableFixtures } from './fixtures.mjs';
import {
  loadFrontendKnownNodeWarningPolicy,
  validateFrontendKnownNodeWarningPolicy,
} from './policy.mjs';

const policy = loadFrontendKnownNodeWarningPolicy();
const snapshotLimits = Object.freeze({
  maxNameBytes: policy.maxNameBytes,
  maxNameCodePoints: policy.maxNameCodePoints,
  maxRegistryEntries: policy.maxRegistryEntries,
});

function evidenceFor(source, runtime = new KernRuntime()) {
  return parseWithMutableNodeTypeRegistrySnapshot(source, runtime, snapshotLimits);
}

function textFields(value) {
  return value.value.map((entry) => entry.value);
}

function textList(fields) {
  return { tag: 'list', value: fields.map((value) => ({ tag: 'text', value })) };
}

function parseFields(content, snapshot, fields, currentPolicy = policy) {
  return parseKnownNodeWarningEnvelope(content, snapshot, textList(fields), currentPolicy);
}

function executeRaw(content, snapshot, currentPolicy, source) {
  return parseKnownNodeWarningEnvelope(
    content,
    snapshot,
    executeKnownNodeWarningFields(content, snapshot, currentPolicy, source),
    currentPolicy,
  );
}

function replaceOnce(source, from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, 'missing mutation target ' + from);
  assert.equal(source.indexOf(from, start + from.length), -1, 'mutation target is not unique: ' + from);
  return source.slice(0, start) + to + source.slice(start + from.length);
}

function replaceLast(source, from, to) {
  const start = source.lastIndexOf(from);
  assert.ok(start >= 0, 'missing mutation target ' + from);
  return source.slice(0, start) + to + source.slice(start + from.length);
}

test('all sixteen membership combinations plus dropped match the fused bootstrap parse', () => {
  const source = loadKnownNodeWarningSource();
  const fixtures = knownNodeWarningTruthTableFixtures(policy);
  assert.equal(fixtures.length, 17);
  for (const fixture of fixtures) {
    const { result, warningDiagnostics } = evaluateKnownNodeWarningFixture(fixture, policy, source);
    const expectedKnown = fixture.builtin || fixture.evolved || fixture.multiline || fixture.template;
    assert.equal(result.state, fixture.id === 'dropped' ? 'dropped' : expectedKnown ? 'known' : 'unknown', fixture.id);
    assert.equal(warningDiagnostics.length, result.state === 'unknown' ? 1 : 0, fixture.id);
  }
});

test('policy is exact and the derived maximum result fits the runtime collection bound', () => {
  assert.ok(policy.maxKnownNodeWarningEnvelopeFields <= policy.runtimeLimits.maxCollectionLength);
  assert.throws(() => validateFrontendKnownNodeWarningPolicy({}), /exactly/);
  assert.throws(
    () => validateFrontendKnownNodeWarningPolicy({
      diagnosticCode: 'OTHER',
      diagnosticSeverity: 'warning',
      format: policy.knownNodeWarningFormat,
      sourceProfile: policy.knownNodeWarningSourceProfile,
    }),
    /diagnosticCode/,
  );
  assert.throws(
    () => validateFrontendKnownNodeWarningPolicy({
      diagnosticCode: 'UNKNOWN_NODE_TYPE',
      diagnosticSeverity: 'warning',
      format: policy.knownNodeWarningFormat,
      sourceProfile: policy.knownNodeWarningSourceProfile,
    }, {
      ...policy,
      maxMutableRegistryEnvelopeFields: policy.runtimeLimits.maxCollectionLength * 12,
    }),
    /runtime collection/,
  );

  const extension = {
    diagnosticCode: 'UNKNOWN_NODE_TYPE',
    diagnosticSeverity: 'warning',
    format: policy.knownNodeWarningFormat,
    sourceProfile: policy.knownNodeWarningSourceProfile,
  };
  const maxAuthenticationRecords = Math.floor(
    (policy.runtimeLimits.maxCollectionLength - 1) / 16,
  ) - 3;
  const exactInheritedFieldBoundary = maxAuthenticationRecords * 12;
  assert.doesNotThrow(() => validateFrontendKnownNodeWarningPolicy(extension, {
    ...policy,
    maxMutableRegistryEnvelopeFields: exactInheritedFieldBoundary,
  }));
  assert.throws(
    () => validateFrontendKnownNodeWarningPolicy(extension, {
      ...policy,
      maxMutableRegistryEnvelopeFields: exactInheritedFieldBoundary + 1,
    }),
    /runtime collection/,
  );
});

test('native source is a successor with one M4.162 call and no host decision delegation', () => {
  const source = loadKnownNodeWarningSource();
  assert.equal(validateNativeKnownNodeWarningSource(source), source);
  assert.throws(() => validateNativeKnownNodeWarningSource(`${source}\n# isKnownNodeType`), /delegation/);
  const member = source.slice(source.lastIndexOf('fn name=observeknownnodewarning'));
  assert.throws(
    () => validateNativeKnownNodeWarningSource(`${source}\n\n${member}`),
    /exactly one|duplicate|composition/,
  );
  assert.throws(
    () => validateNativeKnownNodeWarningSource(source.replace(
      'observemutablenodetyperegistrysnapshot(content,',
      '[] || observemutablenodetyperegistrysnapshot_omitted(content,',
    )),
    /exactly once/,
  );
  assert.throws(
    () => validateNativeKnownNodeWarningSource(source.replace(
      'observemutablenodetyperegistrysnapshot(content,',
      'observemutablenodetyperegistrysnapshot(content, observemutablenodetyperegistrysnapshot(content,',
    )),
    /exactly once/,
  );
  for (const replacement of ['scalarunits(admittedType)', 'utf8units(admittedType)']) {
    assert.throws(
      () => validateNativeKnownNodeWarningSource(
        source.replace('utf16units(admittedType)', replacement),
      ),
      /UTF-16|coordinate|composition/,
    );
  }
});

test('fixed warning diagnostics preserve exact cardinality and UTF-16 coordinates', () => {
  const source = loadKnownNodeWarningSource();
  for (const fixture of [
    {
      builtin: false, evolved: false, id: 'normalized', multiline: false,
      source: 'evolved:mystery value=1', template: false, type: 'mystery',
    },
    {
      builtin: false, evolved: false, id: 'comment', multiline: false,
      source: 'mystery value=1 // payload', template: false, type: 'mystery',
    },
    {
      builtin: false, evolved: false, id: 'other-diagnostic', multiline: false,
      source: 'mystery value="open', template: false, type: 'mystery',
    },
  ]) {
    const { result, warningDiagnostics } = evaluateKnownNodeWarningFixture(fixture, policy, source);
    assert.equal(result.state, 'unknown', fixture.id);
    assert.equal(warningDiagnostics.length, 1, fixture.id);
    assert.deepEqual(result.diagnostic, {
      code: 'UNKNOWN_NODE_TYPE',
      col: 1,
      endCol: 1 + fixture.type.length,
      line: 1,
      severity: 'warning',
    });
  }
});

test('inherited typed failures are authenticated and propagated atomically', () => {
  const source = loadKnownNodeWarningSource();
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
    const bound = evidenceFor(content);
    const result = executeRaw(content, bound.snapshot, currentPolicy, source);
    assert.deepEqual(result, { code, detail: '', status: 'failure' });
  }

  const valid = evidenceFor('mystery').snapshot;
  assert.deepEqual(
    executeRaw('mystery', { ...valid, runtimeInstance: 0 }, policy, source),
    { code: 'REGISTRY_INVALID', detail: '', status: 'failure' },
  );
});

test('one-time fused evidence rejects structural copies, replay, and stale epochs', () => {
  const source = loadKnownNodeWarningSource();
  const runtime = new KernRuntime();
  runtime.dynamicNodeTypes.add('widget');
  const stale = evidenceFor('widget', runtime);
  evidenceFor('other', runtime);
  assert.throws(() => executeKnownNodeWarning(stale, policy, source), /evidence|epoch|stale/);

  const current = evidenceFor('widget', runtime);
  assert.throws(() => executeKnownNodeWarning({ ...current }, policy, source), /evidence|forged/);
  assert.equal(executeKnownNodeWarning(current, policy, source).result.state, 'known');
  assert.throws(() => executeKnownNodeWarning(current, policy, source), /evidence|consumed|replay/);
});

test('outer parser rejects truncation, chunk, decision, diagnostic, seal, and coercion corruption', () => {
  const source = loadKnownNodeWarningSource();
  const bound = evidenceFor('mystery value=1');
  const value = executeKnownNodeWarningFields('mystery value=1', bound.snapshot, policy, source);
  const fields = textFields(value);
  const authStart = 17;
  const inheritedFieldCount = Number(fields[14]);
  const authRecordCount = Math.ceil(inheritedFieldCount / 12);
  const lastAuthStart = authStart + (authRecordCount - 1) * 16;
  const lastAuthCount = Number(fields[lastAuthStart + 3]);
  const diagnosticStart = authStart + authRecordCount * 16;
  const sealStart = diagnosticStart + 16;
  const corruptions = [
    ['truncated', fields.slice(0, -1)],
    ['duplicate chunk', [
      ...fields.slice(0, authStart + 16),
      ...fields.slice(authStart, authStart + 16),
      ...fields.slice(authStart + 16),
    ]],
    ['swapped chunks', [
      ...fields.slice(0, authStart),
      ...fields.slice(authStart + 16, authStart + 32),
      ...fields.slice(authStart, authStart + 16),
      ...fields.slice(authStart + 32),
    ]],
    ['noncanonical chunk index', { index: authStart + 1, value: '00' }],
    ['zero chunk count', { index: authStart + 3, value: '0' }],
    ['oversized chunk count', { index: authStart + 3, value: '13' }],
    ['altered chunk payload', { index: authStart + 4, value: fields[authStart + 4] + '-forged' }],
    ['altered chunk padding', { index: lastAuthStart + 4 + lastAuthCount, value: 'forged' }],
    ['forged format', { index: 0, value: fields[0] + '-forged' }],
    ['forged inherited count', { index: 14, value: String(inheritedFieldCount + 1) }],
    ['forged runtime', { indexes: [11, sealStart + 8], value: '999999' }],
    ['forged epoch', { indexes: [12, sealStart + 9], value: '999999' }],
    ['forged source', { index: sealStart + 10, value: 'other' }],
    ['forged catalog index', { indexes: [15, sealStart + 15], value: '999999' }],
    ['forged admission state', { indexes: [3, sealStart + 14], value: 'dropped' }],
    ['duplicate diagnostic', [
      ...fields.slice(0, sealStart),
      ...fields.slice(diagnosticStart, diagnosticStart + 16),
      ...fields.slice(sealStart),
    ]],
    ['success as failure', { index: 1, value: 'failure' }],
  ];
  for (const [label, corruption] of corruptions) {
    const mutated = Array.isArray(corruption) ? corruption : [...fields];
    if (!Array.isArray(corruption)) {
      for (const index of corruption.indexes ?? [corruption.index]) mutated[index] = corruption.value;
    }
    assert.throws(
      () => parseFields('mystery value=1', bound.snapshot, mutated),
      /rejection|invalid|drift|unsupported|canonical/,
      label,
    );
  }

  const failureBound = evidenceFor('');
  const failureFields = textFields(executeKnownNodeWarningFields('', failureBound.snapshot, policy, source));
  failureFields[1] = 'decision';
  assert.throws(() => parseFields('', failureBound.snapshot, failureFields), /rejection|invalid|drift/);
});

test('constant, partial, combined, coordinate, and inherited-auth mutations are killed', () => {
  const source = loadKnownNodeWarningSource();
  const unknown = {
    builtin: false, evolved: false, id: 'unknown', multiline: false,
    source: 'mystery value=1', template: false, type: 'mystery',
  };
  const known = { ...unknown, evolved: true, id: 'known' };
  const builtin = knownNodeWarningTruthTableFixtures(policy).find(
    (fixture) => fixture.builtin && !fixture.evolved && !fixture.multiline && !fixture.template,
  );
  const cases = [
    [unknown, 'constant known',
      'assign target=state value="\\"unknown\\""',
      'assign target=state value="\\"known\\""'],
    [known, 'constant unknown',
      'assign target=state value="\\"known\\""',
      'assign target=state value="\\"unknown\\""'],
    [known, 'OR to AND',
      'builtin == \\"true\\" || evolved == \\"true\\" || multiline == \\"true\\" || template == \\"true\\"',
      'builtin == \\"true\\" && evolved == \\"true\\" && multiline == \\"true\\" && template == \\"true\\"'],
    [builtin, 'omit builtin',
      'builtin == \\"true\\" || evolved == \\"true\\" || multiline == \\"true\\" || template == \\"true\\"',
      'false || evolved == \\"true\\" || multiline == \\"true\\" || template == \\"true\\"'],
    [known, 'omit evolved',
      'builtin == \\"true\\" || evolved == \\"true\\" || multiline == \\"true\\" || template == \\"true\\"',
      'builtin == \\"true\\" || false || multiline == \\"true\\" || template == \\"true\\"'],
    [{ ...unknown, id: 'multiline', multiline: true }, 'omit multiline',
      'builtin == \\"true\\" || evolved == \\"true\\" || multiline == \\"true\\" || template == \\"true\\"',
      'builtin == \\"true\\" || evolved == \\"true\\" || false || template == \\"true\\"'],
    [{ ...unknown, id: 'template', template: true }, 'omit template',
      'builtin == \\"true\\" || evolved == \\"true\\" || multiline == \\"true\\" || template == \\"true\\"',
      'builtin == \\"true\\" || evolved == \\"true\\" || multiline == \\"true\\" || false'],
    [{ ...unknown, id: 'dropped', source: '123 value=1', type: '' }, 'dropped as unknown',
      'let name=state value="\\"dropped\\""',
      'let name=state value="\\"unknown\\""'],
    [{ ...unknown, id: 'failure', source: '', type: '' }, 'failure as dropped',
      'if cond="failureCode != \\"\\""',
      'if cond="false"'],
    [unknown, 'warning count zero',
      'assign target=warningCount value="1"',
      'assign target=warningCount value="0"'],
    [unknown, 'warning count two',
      'assign target=warningCount value="1"',
      'assign target=warningCount value="2"'],
    [unknown, 'forged admission state',
      'assign target=admission value="inherited[2]"',
      'assign target=admission value="\\"dropped\\""'],
    [unknown, 'wrong coordinate',
      'String(1 + utf16units(admittedType))',
      'String(2 + utf16units(admittedType))'],
    [unknown, 'wrong warning code',
      'do value="out.push(warningCode)"',
      'do value="out.push(warningSeverity)"'],
    [unknown, 'wrong warning severity',
      'do value="out.push(warningSeverity)"',
      'do value="out.push(warningCode)"'],
    [unknown, 'partial inherited authentication',
      'for name=authStart from=0 to="inherited.length" step=12',
      'for name=authStart from=0 to="12" step=12'],
    [unknown, 'forged inherited payload',
      'do value="out.push(inherited[authStart + authField])"',
      'do value="out.push(\\"forged\\")"'],
    [unknown, 'forged seal',
      'do value="out.push(state)"',
      'do value="out.push(\\"known\\")"'],
  ];
  for (const [fixture, label, from, to] of cases) {
    const mutant = [
      'failure as dropped', 'forged inherited payload', 'forged seal', 'partial inherited authentication',
    ].includes(label)
      ? replaceLast(source, from, to)
      : replaceOnce(source, from, to);
    assert.throws(() => evaluateKnownNodeWarningFixture(fixture, policy, mutant), label);
  }
});

test('configured maximum registry evidence remains structurally bounded end to end', () => {
  const source = loadKnownNodeWarningSource();
  const runtime = new KernRuntime();
  for (let index = 0; index < policy.maxRegistryEntries; index += 1) {
    const name = 'm' + String(index).padStart(3, '0');
    runtime.dynamicNodeTypes.add(name);
    runtime.templateRegistry.set(name, { name, slots: [], imports: [], body: '' });
    if (index >= 6) runtime.multilineBlockTypes.add(name);
  }
  const bound = evidenceFor('m063 value=1', runtime);
  const { result } = executeKnownNodeWarning(bound, policy, source);
  assert.equal(result.state, 'known');
});
