import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithGenericPropertyStyleThemeSafety,
  parseWithGenericPropertyThemeRefsSafety,
} from '../../packages/core/dist/mutable-node-type-registry-snapshot.js';
import { KernRuntime } from '../../packages/core/dist/runtime-state.js';
import {
  evaluateGenericPropertyStyleThemeFixture,
  executeGenericPropertyStyleTheme,
  executeGenericPropertyStyleThemeFields,
  loadGenericPropertyStyleThemeSource,
  parseGenericPropertyStyleThemeEnvelope,
  validateNativeGenericPropertyStyleThemeSource,
} from '../check-kern-frontend-generic-property-style-theme.mjs';
import { GENERIC_PROPERTY_STYLE_THEME_FIXTURES } from './fixtures.mjs';
import {
  loadFrontendGenericPropertyStyleThemePolicy,
  validateFrontendGenericPropertyStyleThemePolicy,
} from './policy.mjs';

const policy = loadFrontendGenericPropertyStyleThemePolicy();
const snapshotLimits = Object.freeze({
  maxNameBytes: policy.maxNameBytes,
  maxNameCodePoints: policy.maxNameCodePoints,
  maxRegistryEntries: policy.maxRegistryEntries,
});

function evidenceFor(source, runtime = new KernRuntime()) {
  return parseWithGenericPropertyStyleThemeSafety(source, runtime, snapshotLimits);
}

function fixture(id) {
  const found = GENERIC_PROPERTY_STYLE_THEME_FIXTURES.find((entry) => entry.id === id);
  assert.ok(found, `missing fixture ${id}`);
  return found;
}

function textFields(value) {
  return value.value.map((entry) => entry.value);
}

function textList(fields) {
  return { tag: 'list', value: fields.map((value) => ({ tag: 'text', value })) };
}

function replaceFunctionOnce(source, functionName, from, to, occurrence = null) {
  const start = source.indexOf(`fn name=${functionName}`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const next = source.indexOf('\nfn name=', start + 1);
  const end = next === -1 ? source.length : next;
  const member = source.slice(start, end);
  let target = -1;
  let seen = 0;
  for (let index = member.indexOf(from); index !== -1; index = member.indexOf(from, index + from.length)) {
    if (occurrence === null || seen === occurrence) {
      target = index;
      if (occurrence !== null) break;
    }
    seen += 1;
    if (occurrence === null && member.indexOf(from, index + from.length) !== -1) {
      assert.fail(`mutation target is not unique in ${functionName}: ${from}`);
    }
  }
  assert.notEqual(target, -1, `missing mutation target in ${functionName}: ${from}`);
  return source.slice(0, start) + member.slice(0, target) + to + member.slice(target + from.length) + source.slice(end);
}

function assertMutantKilled(id, functionName, from, to, occurrence = null) {
  const mutant = replaceFunctionOnce(loadGenericPropertyStyleThemeSource(), functionName, from, to, occurrence);
  assert.throws(() => evaluateGenericPropertyStyleThemeFixture(fixture(id), policy, mutant));
}

test('all style/theme fixtures match the independent oracle and bootstrap parser', () => {
  const source = loadGenericPropertyStyleThemeSource();
  assert.equal(GENERIC_PROPERTY_STYLE_THEME_FIXTURES.length, 32);
  const results = new Map(GENERIC_PROPERTY_STYLE_THEME_FIXTURES.map((current) => (
    [current.id, evaluateGenericPropertyStyleThemeFixture(current, policy, source)]
  )));
  assert.deepEqual(results.get('properties-around-style')?.transitions.map(({ type }) => type), [
    'property', 'style', 'property',
  ]);
  assert.deepEqual(results.get('themes-around-style')?.transitions.map(({ type }) => type), [
    'theme', 'style', 'theme',
  ]);
  assert.deepEqual(results.get('cross-block-last-write')?.finalStyles, [
    { key: 'a', orderIndex: 0, value: '2' },
  ]);
  assert.deepEqual(results.get('cross-block-last-write')?.finalPseudoStyles, [
    { entries: [{ key: 'bg', orderIndex: 0, value: 'blue' }], pseudo: 'press' },
  ]);
  assert.deepEqual(results.get('quoted-commas')?.finalStyles.map(({ value }) => value), ['x,y', 'rgb(1,2,3)']);
  assert.deepEqual(results.get('integer-key-order')?.finalStyles.map(({ key }) => key), [
    '0', '1', '2', '4294967294', 'b', '01', '4294967295', '-0', 'a',
  ]);
  assert.deepEqual(results.get('unsafe-visible-state')?.finalStyles.map(({ key }) => key), [
    'constructor', 'toString',
  ]);
  assert.deepEqual(results.get('empty-segments')?.segments.map(({ retained }) => retained), [
    false, true, false, false, true, false,
  ]);
  assert.equal(results.get('dropped-node')?.state, 'dropped');
  for (const id of ['unexpected-before-style', 'missing-equals-before-style']) {
    assert.equal(results.get(id)?.code, 'STYLE_PROFILE');
  }
  assert.equal(results.get('property-limit-before-style')?.code, 'THEME_LIMIT');
  assert.equal(results.get('theme-limit-before-style')?.code, 'THEME_LIMIT');
});

test('style policy is exact, inherited, independently bounded, and collection-safe', () => {
  assert.equal(policy.maxGenericPropertyStyleThemeProperties, policy.maxGenericPropertyThemeRefsProperties);
  assert.equal(policy.maxGenericPropertyStyleThemeThemeRefs, policy.maxGenericPropertyThemeRefsThemeRefs);
  assert.equal(policy.maxGenericPropertyStyleThemeStyleTokens, 8);
  assert.ok(policy.maxGenericPropertyStyleThemeReplayEnvelopeFields <= policy.runtimeLimits.maxCollectionLength);
  assert.ok(policy.maxGenericPropertyStyleThemeEnvelopeFields <= policy.runtimeLimits.maxCollectionLength);
  assert.throws(() => validateFrontendGenericPropertyStyleThemePolicy({}), /exactly/);
  const invalid = {
    format: policy.genericPropertyStyleThemeFormat,
    maxEnvelopeBytes: policy.maxGenericPropertyStyleThemeEnvelopeBytes,
    maxProperties: policy.maxGenericPropertyStyleThemeProperties,
    maxStyleBlockBytes: policy.maxGenericPropertyStyleThemeStyleBlockBytes,
    maxStyleBlockCodePoints: policy.maxGenericPropertyStyleThemeStyleBlockCodePoints,
    maxStyleBlockUtf16Units: policy.maxGenericPropertyStyleThemeStyleBlockUtf16Units,
    maxStylePairs: 2,
    maxStyleParenDepth: policy.maxGenericPropertyStyleThemeStyleParenDepth,
    maxStyleSegments: 1,
    maxStyleTokens: policy.maxGenericPropertyStyleThemeStyleTokens,
    maxStyleWrites: 2,
    maxThemeRefs: policy.maxGenericPropertyStyleThemeThemeRefs,
    replayFormat: policy.genericPropertyStyleThemeReplayFormat,
    sourceProfile: policy.genericPropertyStyleThemeSourceProfile,
    styleFormat: policy.styleBlockEvidenceFormat,
  };
  assert.throws(() => validateFrontendGenericPropertyStyleThemePolicy(invalid), /maxStylePairs/);
});

test('native composition is singular, bounded, and independent from production style parsing', () => {
  const source = loadGenericPropertyStyleThemeSource();
  const extension = source.slice(source.indexOf('fn name=styletrimspace'));
  assert.equal(validateNativeGenericPropertyStyleThemeSource(extension), extension);
  const member = extension.slice(extension.lastIndexOf('fn name=observegenericpropertystyletheme'));
  assert.throws(() => validateNativeGenericPropertyStyleThemeSource(`${extension}\n${member}`), /function surface/);
  assert.throws(() => validateNativeGenericPropertyStyleThemeSource(replaceFunctionOnce(
    extension,
    'observegenericpropertystyletheme',
    'replaygenericpropertystyletheme(content,',
    'replaygenericpropertystyletheme_omitted(content,',
  )), /exactly once/);
  assert.throws(() => validateNativeGenericPropertyStyleThemeSource(replaceFunctionOnce(
    extension,
    'styletrimspace',
    'handler lang="kern"',
    'handler lang="kern"\n    do value="parseStyleBlock(value)"',
  )), /contains parseStyleBlock/);
  assert.throws(() => validateNativeGenericPropertyStyleThemeSource(`${extension}\n\nfn name=extrastylehelper returns=string export=true\n  handler lang="kern"\n    return value="\"\""\n`), /function surface/);
  for (const forbidden of ['parseStyleBlock', 'splitStylePairs', 'normalizeGenericPropertyStyleThemeOracle']) {
    assert.doesNotMatch(source, new RegExp(forbidden, 'u'));
  }
  const oracleSource = readFileSync(new URL('./oracle.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(oracleSource, /^import\b/mu);
  assert.doesNotMatch(oracleSource, /parser|tokenizer|parseStyleBlock|splitStylePairs/u);
});

test('replay and outer failure envelopes remain inside caller-supplied bounds', () => {
  const content = 'screen {a:1}';
  const consumed = consumeMutableNodeTypeRegistryParseEvidence(evidenceFor(content));
  const replayFieldPolicy = {
    ...policy,
    maxGenericPropertyStyleThemeReplayEnvelopeFields: 48,
  };
  const replayFieldResult = textFields(executeGenericPropertyStyleThemeFields(
    content, consumed.snapshot, replayFieldPolicy, loadGenericPropertyStyleThemeSource(),
  ));
  assert.ok(Number(replayFieldResult[8]) <= 48, 'replay failure exceeded maxReplayFields');

  const outerFieldPolicy = {
    ...policy,
    maxGenericPropertyStyleThemeEnvelopeFields: 41,
    maxGenericPropertyStyleThemeStyleTokens: 0,
  };
  const outerFieldResult = textFields(executeGenericPropertyStyleThemeFields(
    content, consumed.snapshot, outerFieldPolicy, loadGenericPropertyStyleThemeSource(),
  ));
  assert.equal(outerFieldResult.length, 41);
  assert.equal(outerFieldResult[2], 'STYLE_ENVELOPE_FIELDS_LIMIT');

  const longContent = `screen label=${'x'.repeat(1000)}`;
  const longConsumed = consumeMutableNodeTypeRegistryParseEvidence(evidenceFor(longContent));
  const bytePolicy = {
    ...policy,
    maxGenericPropertyStyleThemeEnvelopeBytes: 1500,
  };
  const byteResult = textFields(executeGenericPropertyStyleThemeFields(
    longContent, longConsumed.snapshot, bytePolicy, loadGenericPropertyStyleThemeSource(),
  ));
  assert.ok(byteResult.reduce((total, field) => total + Buffer.byteLength(field), 0) <= 1500);
  assert.equal(Number(byteResult[8]), 0, 'replay failure exceeded maxEnvelopeBytes');
});

test('outer parser rejects count, authentication, source, format, and seal corruption', () => {
  const content = 'screen a=one {bg:red,p:16} $base b=two';
  const consumed = consumeMutableNodeTypeRegistryParseEvidence(evidenceFor(content));
  const fields = textFields(executeGenericPropertyStyleThemeFields(
    content, consumed.snapshot, policy, loadGenericPropertyStyleThemeSource(),
  ));
  const themeFields = Number(fields[5]);
  const streamFields = Number(fields[6]);
  const themeAuthRecords = Math.ceil(themeFields / 16);
  const streamAuthRecords = Math.ceil(streamFields / 16);
  const streamAuthStart = 21 + themeAuthRecords * 20;
  const replayAuthStart = streamAuthStart + streamAuthRecords * 20;
  const sealStart = fields.length - 20;
  const corruptions = [
    ['truncation', fields.slice(0, -1)],
    ['format', { index: 0, value: 'forged' }],
    ['theme count', { index: 5, value: '0' }],
    ['stream auth index', { index: streamAuthStart + 1, value: '01' }],
    ['replay auth count', { index: replayAuthStart + 3, value: '17' }],
    ['source seal', { index: sealStart + 7, value: 'other' }],
    ['style count seal', { index: sealStart + 11, value: '9' }],
  ];
  for (const [label, corruption] of corruptions) {
    const mutated = Array.isArray(corruption) ? corruption : [...fields];
    if (!Array.isArray(corruption)) mutated[corruption.index] = corruption.value;
    assert.throws(
      () => parseGenericPropertyStyleThemeEnvelope(content, consumed.snapshot, textList(mutated), policy),
      undefined,
      label,
    );
  }
});

test('an identical style fact displaced to a later retained token is rejected', () => {
  const content = 'screen {a:1} {a:1}';
  const consumed = consumeMutableNodeTypeRegistryParseEvidence(evidenceFor(content));
  const fields = textFields(executeGenericPropertyStyleThemeFields(
    content, consumed.snapshot, policy, loadGenericPropertyStyleThemeSource(),
  ));
  const themeAuthRecords = Math.ceil(Number(fields[5]) / 16);
  const streamAuthRecords = Math.ceil(Number(fields[6]) / 16);
  const replayAuthStart = 21 + (themeAuthRecords + streamAuthRecords) * 20;
  const replayFields = [];
  for (let record = replayAuthStart; replayFields.length < Number(fields[7]); record += 20) {
    replayFields.push(...fields.slice(record + 4, record + 4 + Number(fields[record + 3])));
  }
  const styleStarts = [];
  for (let index = 25; index < replayFields.length - 24; index += 24) {
    if (replayFields[index] === 'style') styleStarts.push(index);
  }
  assert.equal(styleStarts.length, 2);
  const mutated = [...fields];
  for (const offset of [3, 4, 6, 7]) {
    const replayIndex = styleStarts[0] + offset;
    const sourceIndex = styleStarts[1] + offset;
    const record = Math.floor(replayIndex / 16);
    const payload = replayIndex % 16;
    mutated[replayAuthStart + record * 20 + 4 + payload] = replayFields[sourceIndex];
  }
  assert.throws(
    () => parseGenericPropertyStyleThemeEnvelope(content, consumed.snapshot, textList(mutated), policy),
    /displaced|deep-equal|identity|drift/i,
  );
});

test('mutations cannot skip, split, reorder, hide, or displace style semantics', () => {
  assertMutantKilled('basic-style', 'observestyleblockvalue', 'assign target=segmentCount value="segmentCount + 1"', 'assign target=segmentCount value="segmentCount"');
  assertMutantKilled('quoted-commas', 'observestyleblockvalue', 'assign target=inQuote value="!inQuote"', 'assign target=inQuote value="inQuote"');
  assertMutantKilled('nested-parens', 'observestyleblockvalue', 'assign target=parenDepth value="parenDepth + 1"', 'assign target=parenDepth value="parenDepth"');
  assertMutantKilled('escaped-comma', 'observestyleblockvalue', 'assign target=i value="i + 1"', 'assign target=i value="i"', 0);
  assertMutantKilled('pair-precedence', 'interpretstylepair', 'assign target=kind value="\\"pseudo\\""', 'assign target=kind value="\\"normal\\""');
  assertMutantKilled('unsafe-visible-state', 'observestyleblockvalue', 'interpretation[2] != \\"__proto__\\"', 'interpretation[2] != \\"never\\"');
  assertMutantKilled('multiple-styles', 'replaygenericpropertystyletheme', 'assign target=styleCount value="styleCount + 1"', 'assign target=styleCount value="styleCount"');
  assertMutantKilled('properties-around-style', 'replaygenericpropertystyletheme', 'assign target=cursor value="tokenIndex + 1"', 'assign target=cursor value="tokenIndex"', 3);
  assertMutantKilled('themes-around-style', 'replaygenericpropertystyletheme', 'assign target=themeCount value="themeCount + 1"', 'assign target=themeCount value="themeCount"');
  assertMutantKilled('integer-key-order', 'stylearrayindex', 'value > 4294967294', 'value > 4294967295');
});

test('fused entry preserves inherited-key safety and one-shot evidence binding', () => {
  const runtime = new KernRuntime();
  assert.equal(evidenceFor('screen safe=one {bg:red} $base', runtime).snapshot.parseEpoch, 1);
  for (const source of [
    'screen constructor=one {bg:red}',
    'screen safe=one toString=two {bg:red}',
    'screen __proto__=three {bg:red}',
  ]) assert.throws(() => evidenceFor(source, runtime), /(?:inherited|reserved) generic property key/);
  const evidence = evidenceFor('screen safe=two {bg:red}', runtime);
  executeGenericPropertyStyleTheme(evidence, policy, loadGenericPropertyStyleThemeSource());
  assert.throws(() => consumeMutableNodeTypeRegistryParseEvidence(evidence), /forged, stale, or already consumed/);
  assert.doesNotThrow(() => parseWithGenericPropertyThemeRefsSafety(
    'screen safe=legacy $base', runtime, snapshotLimits,
  ));
});

test('every style limit succeeds exactly at its bound and fails on the first excess', () => {
  const source = loadGenericPropertyStyleThemeSource();
  const style = (inner) => `screen {${inner}}`;
  const cases = [
    {
      exact: `screen${' {a:1}'.repeat(policy.maxGenericPropertyStyleThemeStyleTokens)}`,
      over: `screen${' {a:1}'.repeat(policy.maxGenericPropertyStyleThemeStyleTokens + 1)}`,
      code: 'STYLE_TOKEN_LIMIT',
    },
    {
      exact: style(`a:${'x'.repeat(policy.maxGenericPropertyStyleThemeStyleBlockCodePoints - 2)}`),
      over: style(`a:${'x'.repeat(policy.maxGenericPropertyStyleThemeStyleBlockCodePoints - 1)}`),
      code: 'STYLE_BLOCK_CODE_POINTS_LIMIT',
    },
    {
      exact: style(`a:${'😀'.repeat(150)}${'x'.repeat(82)}`),
      over: style(`a:${'😀'.repeat(150)}${'x'.repeat(83)}`),
      code: 'STYLE_BLOCK_UTF16_LIMIT',
    },
    {
      exact: style(`a:${'€'.repeat(232)}xx`),
      over: style(`a:${'€'.repeat(232)}xxx`),
      code: 'STYLE_BLOCK_BYTES_LIMIT',
    },
    {
      exact: style(','.repeat(policy.maxGenericPropertyStyleThemeStyleSegments - 1)),
      over: style(','.repeat(policy.maxGenericPropertyStyleThemeStyleSegments)),
      code: 'STYLE_SEGMENT_LIMIT',
    },
    {
      exact: style(Array(policy.maxGenericPropertyStyleThemeStylePairs).fill('x').join(',')),
      over: style(Array(policy.maxGenericPropertyStyleThemeStylePairs + 1).fill('x').join(',')),
      code: 'STYLE_PAIR_LIMIT',
    },
    {
      exact: style(Array(policy.maxGenericPropertyStyleThemeStyleWrites).fill('a:1').join(',')),
      over: style(Array(policy.maxGenericPropertyStyleThemeStyleWrites + 1).fill('a:1').join(',')),
      code: 'STYLE_WRITE_LIMIT',
    },
    {
      exact: style(`a:${'('.repeat(policy.maxGenericPropertyStyleThemeStyleParenDepth)}x`),
      over: style(`a:${'('.repeat(policy.maxGenericPropertyStyleThemeStyleParenDepth + 1)}x`),
      code: 'STYLE_PAREN_DEPTH_LIMIT',
    },
  ];
  for (const current of cases) {
    assert.notEqual(
      evaluateGenericPropertyStyleThemeFixture({ source: current.exact }, policy, source).status,
      'failure',
      `${current.code} exact bound`,
    );
    assert.equal(
      evaluateGenericPropertyStyleThemeFixture({ source: current.over }, policy, source).code,
      current.code,
      `${current.code} first excess`,
    );
  }
});
