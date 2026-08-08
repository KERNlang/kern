import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithGenericPropertyLoopSafety,
  parseWithGenericPropertyThemeRefsSafety,
} from '../../packages/core/dist/mutable-node-type-registry-snapshot.js';
import { KernRuntime } from '../../packages/core/dist/runtime-state.js';
import {
  evaluateGenericPropertyThemeRefsFixture,
  executeGenericPropertyThemeRefs,
  executeGenericPropertyThemeRefsFields,
  loadGenericPropertyThemeRefsSource,
  parseGenericPropertyThemeRefsEnvelope,
  validateNativeGenericPropertyThemeRefsSource,
} from '../check-kern-frontend-generic-property-theme-refs.mjs';
import { GENERIC_PROPERTY_THEME_REFS_FIXTURES } from './fixtures.mjs';
import {
  loadFrontendGenericPropertyThemeRefsPolicy,
  validateFrontendGenericPropertyThemeRefsPolicy,
} from './policy.mjs';

const policy = loadFrontendGenericPropertyThemeRefsPolicy();
const snapshotLimits = Object.freeze({
  maxNameBytes: policy.maxNameBytes,
  maxNameCodePoints: policy.maxNameCodePoints,
  maxRegistryEntries: policy.maxRegistryEntries,
});

function evidenceFor(source, runtime = new KernRuntime()) {
  return parseWithGenericPropertyThemeRefsSafety(source, runtime, snapshotLimits);
}

function fixture(id) {
  const found = GENERIC_PROPERTY_THEME_REFS_FIXTURES.find((entry) => entry.id === id);
  assert.ok(found, `missing fixture ${id}`);
  return found;
}

function textFields(value) {
  return value.value.map((entry) => entry.value);
}

function textList(fields) {
  return { tag: 'list', value: fields.map((value) => ({ tag: 'text', value })) };
}

function replaceMemberOnce(source, from, to, occurrence = null) {
  const start = source.lastIndexOf('fn name=observegenericpropertythemerefs');
  assert.notEqual(start, -1);
  const prefix = source.slice(0, start);
  const member = source.slice(start);
  let target = -1;
  let seen = 0;
  for (let next = member.indexOf(from); next !== -1; next = member.indexOf(from, next + from.length)) {
    if (occurrence === null || seen === occurrence) {
      target = next;
      if (occurrence !== null) break;
    }
    seen += 1;
    if (occurrence === null && member.indexOf(from, next + from.length) !== -1) {
      assert.fail(`mutation target is not unique: ${from}`);
    }
  }
  assert.notEqual(target, -1, `missing mutation target ${from}`);
  return prefix + member.slice(0, target) + to + member.slice(target + from.length);
}

function assertMutantKilled(id, from, to, occurrence = null) {
  const mutant = replaceMemberOnce(loadGenericPropertyThemeRefsSource(), from, to, occurrence);
  assert.throws(() => evaluateGenericPropertyThemeRefsFixture(fixture(id), policy, mutant));
}

test('all theme-enabled loop fixtures match the independent oracle and bootstrap', () => {
  const source = loadGenericPropertyThemeRefsSource();
  assert.equal(GENERIC_PROPERTY_THEME_REFS_FIXTURES.length, 24);
  const results = new Map(GENERIC_PROPERTY_THEME_REFS_FIXTURES.map((current) => (
    [current.id, evaluateGenericPropertyThemeRefsFixture(current, policy, source)]
  )));
  assert.deepEqual(results.get('ordered-themes')?.themeRefs, ['base', 'accent']);
  assert.deepEqual(results.get('duplicate-themes')?.themeRefs, ['base', 'accent', 'base']);
  assert.deepEqual(results.get('properties-around-theme')?.transitions.map(({ type }) => type), [
    'property', 'theme', 'property',
  ]);
  assert.equal(results.get('bare-adjacent-theme')?.finalProperties[0]?.value, 'bare');
  assert.equal(results.get('empty-before-theme')?.writes[0]?.valueKind, 'bare');
  assert.deepEqual(results.get('quoted-theme-like-text')?.themeRefs, []);
  assert.deepEqual(results.get('expression-theme-like-text')?.themeRefs, []);
  assert.deepEqual(results.get('astral-duplicate-after-theme')?.diagnostics.map(({ col, endCol }) => [col, endCol]), [
    [27, 28],
  ]);
  for (const id of [
    'style-only-deferred', 'style-before-theme-deferred', 'style-value-deferred', 'style-bare-deferred',
    'unexpected-before-theme-deferred', 'missing-equals-before-theme-deferred',
  ]) assert.equal(results.get(id)?.code, 'THEME_PROFILE');
  for (const id of ['property-limit-before-style', 'theme-limit-before-style']) {
    assert.equal(results.get(id)?.code, 'THEME_LIMIT');
  }
  assert.equal(results.get('dropped-node')?.state, 'dropped');
});

test('property and theme bounds are independent and exact', () => {
  assert.equal(policy.maxGenericPropertyThemeRefsProperties, policy.maxGenericPropertyLoopProperties);
  assert.equal(policy.maxGenericPropertyThemeRefsThemeRefs, 8);
  assert.ok(policy.maxGenericPropertyThemeRefsEnvelopeFields <= policy.runtimeLimits.maxCollectionLength);
  assert.throws(() => validateFrontendGenericPropertyThemeRefsPolicy({}), /exactly/);
  assert.throws(() => validateFrontendGenericPropertyThemeRefsPolicy({
    format: policy.genericPropertyThemeRefsFormat,
    maxProperties: policy.maxGenericPropertyThemeRefsProperties,
    maxThemeRefs: 0,
    sourceProfile: policy.genericPropertyThemeRefsSourceProfile,
  }), /positive/);
  const source = loadGenericPropertyThemeRefsSource();
  const result = executeGenericPropertyThemeRefs(
    evidenceFor(`screen ${Array.from({ length: 9 }, (_, index) => `$t${index}`).join(' ')}`),
    policy,
    source,
  );
  assert.equal(result.code, 'THEME_LIMIT');
});

test('native composition is singular and host delegation is rejected', () => {
  const source = loadGenericPropertyThemeRefsSource();
  assert.equal(validateNativeGenericPropertyThemeRefsSource(source), source);
  const member = source.slice(source.lastIndexOf('fn name=observegenericpropertythemerefs'));
  assert.throws(() => validateNativeGenericPropertyThemeRefsSource(`${source}\n${member}`), /exactly one/);
  assert.throws(() => validateNativeGenericPropertyThemeRefsSource(replaceMemberOnce(
    source,
    'observegenericpropertyloop(content,',
    'observegenericpropertyloop_omitted(content,',
  )), /exactly once/);
  assert.throws(() => validateNativeGenericPropertyThemeRefsSource(`${source}\n# parseProp`), /delegation/);
});

test('outer parser rejects transition, authentication, cursor, count, and seal corruption', () => {
  const content = 'screen a=one $base b=two';
  const consumed = consumeMutableNodeTypeRegistryParseEvidence(evidenceFor(content));
  const fields = textFields(executeGenericPropertyThemeRefsFields(
    content, consumed.snapshot, policy, loadGenericPropertyThemeRefsSource(),
  ));
  const transitionCount = Number(fields[5]);
  const authStart = 21 + transitionCount * 20;
  const loopFields = Number(fields[13]);
  const streamAuthStart = authStart + Math.ceil(loopFields / 16) * 20;
  const sealStart = fields.length - 20;
  const corruptions = [
    ['truncation', fields.slice(0, -1)],
    ['transition count', { index: 5, value: '99' }],
    ['transition tag', { index: 21, value: 'theme' }],
    ['theme value', { index: 21 + 20 + 4, value: 'forged' }],
    ['transition padding', { index: 21 + 19, value: 'forged' }],
    ['first failure cursor', { index: 16, value: '1' }],
    ['predecessor state', { index: 17, value: 'success' }],
    ['loop auth', { index: authStart + 1, value: '01' }],
    ['stream auth', { index: streamAuthStart + 3, value: '17' }],
    ['source seal', { index: sealStart + 11, value: 'other' }],
  ];
  for (const [label, corruption] of corruptions) {
    const mutated = Array.isArray(corruption) ? corruption : [...fields];
    if (!Array.isArray(corruption)) mutated[corruption.index] = corruption.value;
    assert.throws(
      () => parseGenericPropertyThemeRefsEnvelope(content, consumed.snapshot, textList(mutated), policy),
      undefined,
      label,
    );
  }
});

test('mutations cannot skip, absorb, deduplicate, reorder, or widen theme transitions', () => {
  assertMutantKilled('one-theme', 'assign target=themeReady value="true"', 'assign target=themeReady value="false"', 0);
  assertMutantKilled('empty-before-theme', 'assign target=valueKind value="\\"bare\\""', 'assign target=valueKind value="\\"empty\\""', 0);
  assertMutantKilled('duplicate-themes', 'assign target=themeCount value="themeCount + 1"', 'assign target=themeCount value="themeCount"');
  assertMutantKilled('properties-around-theme', 'assign target=cursor value="tokenIndex + 1"', 'assign target=cursor value="tokenIndex"', 3);
  assertMutantKilled('style-before-theme-deferred', 'assign target=failureCode value="\\"THEME_PROFILE\\""', 'assign target=failureCode value="\\"\\""', 0);
  assertMutantKilled('unexpected-before-theme-deferred', 'assign target=failureCode value="\\"THEME_PROFILE\\""', 'assign target=failureCode value="\\"\\""', 0);
  assertMutantKilled('style-value-deferred', 'assign target=failureCode value="\\"THEME_PROFILE\\""', 'assign target=failureCode value="\\"\\""', 2);
  assertMutantKilled('style-bare-deferred', 'assign target=failureCode value="\\"THEME_PROFILE\\""', 'assign target=failureCode value="\\"\\""', 3);
  assertMutantKilled('property-limit-before-style', 'assign target=failureCode value="\\"THEME_LIMIT\\""', 'assign target=failureCode value="\\"\\""', 0);
  assertMutantKilled('theme-limit-before-style', 'assign target=failureCode value="\\"THEME_LIMIT\\""', 'assign target=failureCode value="\\"\\""', 1);
  assertMutantKilled('terminal-whitespace', 'assign target=terminalCursor value="realTokenCount"', 'assign target=terminalCursor value="realTokenCount - 1"');
});

test('the fused entry preserves inherited-key safety and one-shot evidence binding', () => {
  const runtime = new KernRuntime();
  assert.equal(evidenceFor('screen safe=one $base', runtime).snapshot.parseEpoch, 1);
  for (const source of ['screen constructor=one $base', 'screen safe=one toString=two $base', 'screen __proto__=three $base']) {
    assert.throws(() => evidenceFor(source, runtime), /(?:inherited|reserved) generic property key/);
  }
  const evidence = evidenceFor('screen safe=two $base', runtime);
  executeGenericPropertyThemeRefs(evidence, policy, loadGenericPropertyThemeRefsSource());
  assert.throws(() => consumeMutableNodeTypeRegistryParseEvidence(evidence), /forged, stale, or already consumed/);
  assert.doesNotThrow(() => parseWithGenericPropertyLoopSafety(
    'screen safe=legacy', runtime, snapshotLimits,
  ));
});
