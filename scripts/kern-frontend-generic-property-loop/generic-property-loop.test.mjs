import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithGenericPropertyAdmissionSafety,
  parseWithGenericPropertyLoopSafety,
} from '../../packages/core/dist/mutable-node-type-registry-snapshot.js';
import { KernRuntime } from '../../packages/core/dist/runtime-state.js';
import {
  evaluateGenericPropertyLoopFixture,
  executeGenericPropertyLoop,
  executeGenericPropertyLoopFields,
  loadGenericPropertyLoopSource,
  parseGenericPropertyLoopEnvelope,
  validateNativeGenericPropertyLoopSource,
} from '../check-kern-frontend-generic-property-loop.mjs';
import { GENERIC_PROPERTY_LOOP_FIXTURES } from './fixtures.mjs';
import {
  loadFrontendGenericPropertyLoopPolicy,
  validateFrontendGenericPropertyLoopPolicy,
} from './policy.mjs';

const policy = loadFrontendGenericPropertyLoopPolicy();
const snapshotLimits = Object.freeze({
  maxNameBytes: policy.maxNameBytes,
  maxNameCodePoints: policy.maxNameCodePoints,
  maxRegistryEntries: policy.maxRegistryEntries,
});

function evidenceFor(source, runtime = new KernRuntime()) {
  return parseWithGenericPropertyLoopSafety(source, runtime, snapshotLimits);
}

function textFields(value) {
  return value.value.map((entry) => entry.value);
}

function textList(fields) {
  return { tag: 'list', value: fields.map((value) => ({ tag: 'text', value })) };
}

function fixture(id) {
  const found = GENERIC_PROPERTY_LOOP_FIXTURES.find((entry) => entry.id === id);
  assert.ok(found, `missing fixture ${id}`);
  return found;
}

function replaceMemberOnce(source, from, to) {
  const start = source.lastIndexOf('fn name=observegenericpropertyloop');
  assert.notEqual(start, -1);
  const prefix = source.slice(0, start);
  const member = source.slice(start);
  const target = member.indexOf(from);
  assert.notEqual(target, -1, `missing mutation target ${from}`);
  assert.equal(member.indexOf(from, target + from.length), -1, `mutation target is not unique: ${from}`);
  return prefix + member.slice(0, target) + to + member.slice(target + from.length);
}

function assertMutantKilled(id, from, to) {
  const mutant = replaceMemberOnce(loadGenericPropertyLoopSource(), from, to);
  assert.throws(() => evaluateGenericPropertyLoopFixture(fixture(id), policy, mutant));
}

test('all property-loop fixtures match the independent oracle and bootstrap', () => {
  const source = loadGenericPropertyLoopSource();
  assert.equal(GENERIC_PROPERTY_LOOP_FIXTURES.length, 19);
  const results = new Map(GENERIC_PROPERTY_LOOP_FIXTURES.map((current) => (
    [current.id, evaluateGenericPropertyLoopFixture(current, policy, source)]
  )));
  assert.equal(results.get('zero-properties')?.writes.length, 0);
  assert.deepEqual(results.get('duplicate-last-write')?.finalProperties.map(({ key, value }) => [key, value]), [
    ['a', 'three'], ['b', 'two'],
  ]);
  assert.deepEqual(results.get('quoted-repeat-keeps-order')?.quotedProperties.map(({ key }) => key), ['a', 'b']);
  assert.deepEqual(results.get('quoted-delete')?.quotedProperties.map(({ key }) => key), ['b']);
  assert.deepEqual(results.get('quoted-delete-readd')?.quotedProperties.map(({ key }) => key), ['b', 'a']);
  assert.equal(results.get('three-duplicate-coordinates')?.diagnostics.length, 3);
  assert.equal(results.get('unknown-node-loop')?.knownState, 'unknown');
  assert.equal(results.get('dropped-node')?.state, 'dropped');
  assert.equal(results.get('inherited-name-in-bare-value')?.finalProperties[0]?.value, 'toString=value');
  assert.deepEqual(
    results.get('astral-before-duplicate')?.diagnostics.map(({ col, endCol }) => [col, endCol]),
    [[21, 22]],
  );
});

test('M4.165 rejects the complete inherited-key surface before epoch capture', () => {
  const runtime = new KernRuntime();
  assert.equal(evidenceFor('screen safe=one', runtime).snapshot.parseEpoch, 1);
  for (const source of ['screen constructor=one', 'screen safe=one toString=two', 'screen __proto__=three']) {
    assert.throws(() => evidenceFor(source, runtime), /(?:inherited|reserved) generic property key/);
  }
  assert.equal(evidenceFor('screen safe=two', runtime).snapshot.parseEpoch, 2);
  assert.doesNotThrow(() => evidenceFor('screen title="// constructor=quoted" // toString=comment', runtime));
  assert.equal(
    evidenceFor('screen safe=toString=value', runtime).parseResult.root.props?.safe,
    'toString=value',
  );
  const legacy = parseWithGenericPropertyAdmissionSafety('screen constructor=legacy', runtime, snapshotLimits);
  assert.equal(legacy.parseResult.root.props?.constructor, 'legacy');
});

test('policy is exact and derives a bounded outer envelope', () => {
  assert.ok(policy.maxGenericPropertyLoopEnvelopeFields <= policy.runtimeLimits.maxCollectionLength);
  assert.throws(() => validateFrontendGenericPropertyLoopPolicy({}), /exactly/);
  assert.throws(() => validateFrontendGenericPropertyLoopPolicy({
    format: policy.genericPropertyLoopFormat,
    maxProperties: 0,
    sourceProfile: policy.genericPropertyLoopSourceProfile,
  }), /positive/);
  assert.throws(() => validateFrontendGenericPropertyLoopPolicy({
    format: policy.genericPropertyLoopFormat,
    maxProperties: policy.runtimeLimits.maxCollectionLength,
    sourceProfile: policy.genericPropertyLoopSourceProfile,
  }), /runtime collection/);
});

test('native composition is singular and host delegation is rejected', () => {
  const source = loadGenericPropertyLoopSource();
  assert.equal(validateNativeGenericPropertyLoopSource(source), source);
  const member = source.slice(source.lastIndexOf('fn name=observegenericpropertyloop'));
  assert.throws(() => validateNativeGenericPropertyLoopSource(`${source}\n${member}`), /exactly one/);
  assert.throws(() => validateNativeGenericPropertyLoopSource(replaceMemberOnce(
    source,
    'observegenericpropertyadmission(content,',
    'observegenericpropertyadmission_omitted(content,',
  )), /exactly once/);
  assert.throws(() => validateNativeGenericPropertyLoopSource(`${source}\n# parseProp`), /delegation/);
});

test('outer parser rejects header, write, property, authentication, and seal corruption', () => {
  const content = 'screen a=one b="two" a=three';
  const consumed = consumeMutableNodeTypeRegistryParseEvidence(evidenceFor(content));
  const fields = textFields(executeGenericPropertyLoopFields(
    content, consumed.snapshot, policy, loadGenericPropertyLoopSource(),
  ));
  const writeCount = Number(fields[5]);
  const propertyCount = Number(fields[6]);
  const duplicateCount = Number(fields[7]);
  const variableEnd = 21 + (writeCount + propertyCount + duplicateCount) * 20;
  const admissionCount = Number(fields[14]);
  const admissionRecords = Math.ceil(admissionCount / 16);
  const streamAuthStart = variableEnd + admissionRecords * 20;
  const sealStart = fields.length - 20;
  const corruptions = [
    ['truncation', fields.slice(0, -1)],
    ['duplicated write record', [...fields.slice(0, 41), ...fields.slice(21, 41), ...fields.slice(41)]],
    ['state', { index: 2, value: 'dropped' }],
    ['write count', { index: 5, value: '99' }],
    ['write key', { index: 23, value: 'forged' }],
    ['write padding', { index: 39, value: 'forged' }],
    ['property value', { index: 21 + writeCount * 20 + 4, value: 'forged' }],
    ['admission chunk', { index: variableEnd + 1, value: '01' }],
    ['stream chunk', { index: streamAuthStart + 3, value: '17' }],
    ['source seal', { index: sealStart + 12, value: 'other' }],
  ];
  for (const [label, corruption] of corruptions) {
    const mutated = Array.isArray(corruption) ? corruption : [...fields];
    if (!Array.isArray(corruption)) mutated[corruption.index] = corruption.value;
    assert.throws(
      () => parseGenericPropertyLoopEnvelope(content, consumed.snapshot, textList(mutated), policy),
      /rejection|invalid|drift|canonical|Expected values/,
      label,
    );
  }
});

test('reachable inherited failures propagate atomically', () => {
  const source = loadGenericPropertyLoopSource();
  for (const [content, code] of [
    ['', 'EMPTY_RETAINED_CODE'],
    ['é', 'UNSUPPORTED_UNKNOWN'],
    ['a'.repeat(policy.profileLimits.maxCodePoints + 1), 'CODE_POINTS_LIMIT'],
  ]) {
    const result = executeGenericPropertyLoop(evidenceFor(content), policy, source);
    assert.deepEqual(result, { code, detail: '', status: 'failure' });
  }
});

test('fused evidence is one-time and stale runtime epochs fail closed', () => {
  const source = loadGenericPropertyLoopSource();
  const runtime = new KernRuntime();
  const stale = evidenceFor('screen a=one', runtime);
  evidenceFor('screen a=two', runtime);
  assert.throws(() => executeGenericPropertyLoop(stale, policy, source), /stale|epoch|evidence/);
  const current = evidenceFor('screen a=one a=two', runtime);
  assert.throws(() => executeGenericPropertyLoop({ ...current }, policy, source), /forged|evidence/);
  assert.equal(executeGenericPropertyLoop(current, policy, source).diagnostics.length, 1);
  assert.throws(() => executeGenericPropertyLoop(current, policy, source), /replay|consumed|evidence/);
});

test('named loop, last-write, duplicate, and quote-order mutations are killed', () => {
  assertMutantKilled(
    'two-distinct',
    String.raw`assign target=propertyPhase value="\"handoff\""`,
    String.raw`assign target=propertyPhase value="\"equals\""`,
  );
  assertMutantKilled('duplicate-last-write', 'let name=isDuplicate value="uniqueIndex >= 0"', 'let name=isDuplicate value="false"');
  assertMutantKilled(
    'duplicate-last-write',
    'assign target=finalValue value="writeValues[writeIndex]"',
    String.raw`assign target=finalValue value="\"forged\""`,
  );
  assertMutantKilled('quoted-delete-readd', 'assign target=quoteGeneration value="writeCount + 1"', 'assign target=quoteGeneration value="1"');
  assertMutantKilled(
    'expression-and-bare',
    'assign target=valueKind value="tokenKind"',
    String.raw`assign target=valueKind value="\"bare\""`,
  );
  assertMutantKilled('three-duplicate-coordinates', 'assign target=diagnosticColText value="String(1 + propertyStart)"', 'assign target=diagnosticColText value="String(propertyStart)"');
  assertMutantKilled('terminal-whitespace', 'assign target=terminalCursor value="realTokenCount"', 'assign target=terminalCursor value="realTokenCount - 1"');
});
