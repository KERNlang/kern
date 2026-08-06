import assert from 'node:assert/strict';
import test from 'node:test';

import { executeTokenizer } from '../check-kern-frontend-tokenizer.mjs';
import {
  executeFrontendRetainedTokenStream,
  loadRetainedTokenStreamSource,
  validateNativeRetainedTokenStreamSource,
} from '../check-kern-frontend-retained-token-stream.mjs';
import { EMPTY_RETAINED_FIXTURES, RETAINED_TOKEN_STREAM_FIXTURES } from './fixtures.mjs';
import { normalizeRetainedTokenStreamOracle } from './oracle.mjs';
import {
  loadFrontendRetainedTokenStreamPolicy,
  validateFrontendRetainedTokenStreamPolicy,
} from './policy.mjs';

function mutate(source, from, to) {
  const changed = source.replace(from, to);
  assert.notEqual(changed, source, `mutation target missing: ${from}`);
  return changed;
}

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

test('KERN composes the exact retained boundary into ordered tokens and diagnostics', () => {
  const policy = loadFrontendRetainedTokenStreamPolicy();
  const source = loadRetainedTokenStreamSource();
  for (const fixture of RETAINED_TOKEN_STREAM_FIXTURES) {
    assert.deepEqual(
      executeFrontendRetainedTokenStream(fixture.source, policy, source),
      normalizeRetainedTokenStreamOracle(fixture.source, policy),
      fixture.id,
    );
  }
});

test('discarded Unicode suffix and payload widen only the composed retained profile', () => {
  const policy = loadFrontendRetainedTokenStreamPolicy();
  const content = 'text value=ok\u00a0 # payload😀é';
  assert.deepEqual(executeTokenizer(content), failure('UNSUPPORTED_UNKNOWN'));
  const result = executeFrontendRetainedTokenStream(content, policy);
  assert.equal(result.boundary.codeEndOffset, [...'text value=ok'].length);
  assert.equal(result.boundary.rawPayload, ' payload😀é');
  assert.deepEqual(result, normalizeRetainedTokenStreamOracle(content, policy));
});

test('empty, ASCII whitespace-only, and comment-only retained inputs fail atomically', () => {
  for (const fixture of EMPTY_RETAINED_FIXTURES) {
    assert.deepEqual(executeFrontendRetainedTokenStream(fixture.source), failure('EMPTY_RETAINED_CODE'), fixture.id);
  }
  assert.deepEqual(executeFrontendRetainedTokenStream('\u00a0'), failure('UNSUPPORTED_UNKNOWN'));
});

test('token starts are source-derived for evolved names, astral prefixes, and normalized values', () => {
  const evolved = executeFrontendRetainedTokenStream('evolved:name value=1');
  assert.equal(evolved.tokens[0].value, 'name');
  assert.equal(evolved.tokens[0].startScalar, 0);
  assert.equal(evolved.tokens[1].startDelta, 'evolved:name');

  const astral = executeFrontendRetainedTokenStream('text value="😀" name=after');
  const name = astral.tokens.find((token) => token.value === 'name');
  assert.equal(name.startScalar, [...'text value="😀" '].length);
  assert.equal(name.startByte, Buffer.byteLength('text value="😀" ', 'utf8'));
});

test('diagnostics retain independent scalar and byte spans and may share token starts', () => {
  const result = executeFrontendRetainedTokenStream('text first=1.2n second="open');
  assert.deepEqual(result, normalizeRetainedTokenStreamOracle('text first=1.2n second="open', loadFrontendRetainedTokenStreamPolicy()));
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ['INVALID_BIGINT', 'UNCLOSED_STRING']);
  for (const diagnostic of result.diagnostics) {
    assert.ok(result.tokens.some((token) => token.startScalar === diagnostic.startScalar));
    assert.ok(diagnostic.endScalar >= diagnostic.startScalar);
    assert.ok(diagnostic.endByte >= diagnostic.startByte);
  }
});

test('policy is exact and the maximum fixed-width stream fits the runtime collection', () => {
  const policy = loadFrontendRetainedTokenStreamPolicy();
  assert.equal(policy.maxStreamRecords, policy.profileLimits.maxTokens + policy.profileLimits.maxDiagnostics);
  assert.ok(1 + (policy.maxStreamRecords + 2) * 10 <= policy.runtimeLimits.maxCollectionLength);
  assert.throws(
    () => validateFrontendRetainedTokenStreamPolicy({ format: policy.retainedTokenStreamFormat }),
    /must contain exactly/u,
  );
  assert.throws(
    () => validateFrontendRetainedTokenStreamPolicy(
      { format: policy.retainedTokenStreamFormat, sourceProfile: policy.retainedTokenStreamSourceProfile },
      { ...policy, runtimeLimits: { ...policy.runtimeLimits, maxCollectionLength: (policy.maxStreamRecords + 2) * 10 } },
    ),
    /must fit runtime/u,
  );
});

test('native source composes M4.158 and M4.153 without host or parser delegation', () => {
  const source = loadRetainedTokenStreamSource();
  assert.match(source, /observewhitespacetrim/u);
  assert.match(source, /tokenizeline\(retainedCode/u);
  assert.match(source, /fn name=observeretainedtokenstream/u);
  assert.doesNotMatch(source, /tokenizeLineInternal|TokenStream|tryIdent|parseDocument|normalizeRetainedTokenStreamOracle/u);
  assert.throws(
    () => validateNativeRetainedTokenStreamSource(source.replace('handler lang="kern"', 'handler')),
    /every source handler must be native KERN/u,
  );
});

test('complete host and inherited bounds fail before partial stream evidence', () => {
  const policy = loadFrontendRetainedTokenStreamPolicy();
  assert.deepEqual(executeFrontendRetainedTokenStream('\ud800', policy), failure('MALFORMED_UTF16'));
  assert.deepEqual(executeFrontendRetainedTokenStream('text\nnext', policy), failure('UNSUPPORTED_LINE_ENDING'));

  const tokenPolicy = structuredClone(policy);
  tokenPolicy.profileLimits.maxTokens = 1;
  tokenPolicy.maxStreamRecords = tokenPolicy.profileLimits.maxTokens + tokenPolicy.profileLimits.maxDiagnostics;
  assert.deepEqual(executeFrontendRetainedTokenStream('text value=ok', tokenPolicy), failure('TOKEN_LIMIT'));

  const diagnosticPolicy = structuredClone(policy);
  diagnosticPolicy.profileLimits.maxDiagnostics = 1;
  diagnosticPolicy.maxStreamRecords = diagnosticPolicy.profileLimits.maxTokens + 1;
  assert.deepEqual(
    executeFrontendRetainedTokenStream('text first=1.2n second=2.3n', diagnosticPolicy),
    failure('DIAGNOSTIC_LIMIT'),
  );
});

test('named boundary, order, coordinate, byte, and seal mutations cannot masquerade as parity', () => {
  const policy = loadFrontendRetainedTokenStreamPolicy();
  const source = loadRetainedTokenStreamSource();
  const cases = [
    [
      'tokenize original content',
      'tokenizeline(retainedCode, maxCodePoints, maxTokens, maxDiagnostics, maxStreamRecords)',
      'tokenizeline(content, maxCodePoints, maxTokens, maxDiagnostics, maxStreamRecords)',
      'text value=ok # payload',
    ],
    ['shift token start', 'do value="out.push(String(tokenStart))"', 'do value="out.push(String(tokenStart + 1))"', 'text value=ok'],
    [
      'collapse astral bytes',
      'if cond="ch < \\"\\ud800\\" || ch >= \\"\\ue000\\""',
      'if cond="ch < \\"\\ud800\\" || ch >= \\"\\ud800\\""',
      'text value="😀" name=after',
    ],
    ['duplicate token index', 'assign target=tokenIndex value="tokenIndex + 1"', 'assign target=tokenIndex value="tokenIndex"', 'text value=ok'],
    ['forge source seal', 'do value="out.push(content)"', 'do value="out.push(retainedCode)"', 'text value=ok # payload'],
  ];
  for (const [label, from, to, content] of cases) {
    const changed = mutate(source, from, to);
    assert.throws(
      () => executeFrontendRetainedTokenStream(content, policy, changed),
      /record rejection|runtime rejection/u,
      label,
    );
  }
});

test('token-two corruption is detected even when the first token remains correct', () => {
  const policy = loadFrontendRetainedTokenStreamPolicy();
  const source = loadRetainedTokenStreamSource();
  const droppedSecond = mutate(
    source,
    'if cond="tokenTag == \\"token\\""',
    'if cond="tokenTag == \\"token\\" && tokenIndex != 1"',
  );
  assert.throws(
    () => executeFrontendRetainedTokenStream('text value=ok', policy, droppedSecond),
    /record rejection/u,
  );
});
