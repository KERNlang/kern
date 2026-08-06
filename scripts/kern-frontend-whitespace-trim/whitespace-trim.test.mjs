import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDocument } from '../../packages/core/dist/index.js';
import { executeFrontendCommentBoundaries } from '../check-kern-frontend-comment-boundaries.mjs';
import {
  executeFrontendTrimPredicate,
  executeFrontendWhitespaceTrim,
  loadWhitespaceTrimSource,
  parseWhitespaceTrimEnvelope,
  validateNativeWhitespaceTrimSource,
} from '../check-kern-frontend-whitespace-trim.mjs';
import {
  ECMASCRIPT_TRIM_CODE_POINTS,
  normalizeWhitespaceTrimOracle,
} from './oracle.mjs';
import {
  loadFrontendWhitespaceTrimPolicy,
  validateFrontendWhitespaceTrimPolicy,
} from './policy.mjs';

const failed = (code) => ({ code, detail: '', status: 'failure' });

function mutate(source, from, to) {
  const mutated = source.replace(from, to);
  assert.notEqual(mutated, source, `mutation anchor missing: ${from}`);
  return mutated;
}

function mutateFunction(source, functionName, from, to) {
  const start = source.indexOf(`fn name=${functionName}`);
  assert.notEqual(start, -1, `${functionName} scope missing`);
  const next = source.indexOf('\nfn name=', start + 1);
  const end = next === -1 ? source.length : next;
  return source.slice(0, start) + mutate(source.slice(start, end), from, to) + source.slice(end);
}

function policyWith(limit, value) {
  const policy = structuredClone(loadFrontendWhitespaceTrimPolicy());
  if (limit === 'maxLexicalDepth' || limit === 'tokenizerMaxRecords') policy[limit] = value;
  else policy.profileLimits[limit] = value;
  return policy;
}

function textEnvelope(fields) {
  return { tag: 'list', value: fields.map((value) => ({ tag: 'text', value })) };
}

function record(tag, ...fields) {
  return [tag, ...fields, ...Array(17 - fields.length).fill('')];
}

function successFields(source, result = normalizeWhitespaceTrimOracle(source, loadFrontendWhitespaceTrimPolicy())) {
  const trim = result.trim;
  return [
    result.format,
    ...record(
      'trim', String(trim.trimIndex), String(trim.checkpointIndex), String(trim.groupIndex),
      String(trim.groupRecordIndex), String(trim.physicalIndex), trim.content, trim.quote,
      trim.escapePending ? '1' : '0', String(trim.expressionDepth), String(trim.styleDepth),
      trim.stop, trim.markerOffset === null ? 'none' : String(trim.markerOffset), trim.markerKind,
      trim.markerText, trim.rawPayload, String(trim.codeEndOffset), String(trim.triviaEndOffset),
    ),
    ...record('seal', source),
  ];
}

test('KERN emits exact scalar code/trivia boundaries without serializing derived strings', () => {
  for (const [source, markerText] of [
    ['text value="😀" \u00a0 # note', '#'],
    ['text value=ok\t\u3000\t// payload', '//'],
  ]) {
    const trim = executeFrontendWhitespaceTrim(source).trim;
    const scalars = [...source];
    assert.equal(trim.markerText, markerText);
    assert.equal(trim.triviaEndOffset, trim.markerOffset);
    assert.ok(trim.codeEndOffset < trim.triviaEndOffset);
    assert.equal(scalars.slice(0, trim.codeEndOffset).join('').endsWith(' '), false);
    assert.equal(
      scalars.slice(0, trim.codeEndOffset).join('') +
        scalars.slice(trim.codeEndOffset, trim.triviaEndOffset).join('') + trim.markerText + trim.rawPayload,
      source,
    );
    assert.equal('code' in trim, false);
    assert.equal('trivia' in trim, false);
  }
});

test('the explicit ECMAScript table is exact and reachable members trim in integrated records', () => {
  const policy = loadFrontendWhitespaceTrimPolicy();
  const source = loadWhitespaceTrimSource();
  for (const codePoint of ECMASCRIPT_TRIM_CODE_POINTS) {
    const scalar = String.fromCodePoint(codePoint);
    assert.equal(executeFrontendTrimPredicate(scalar, policy, source), true);
    if (codePoint !== 0x0a && codePoint !== 0x0d) {
      const result = executeFrontendWhitespaceTrim(`text value=ok${scalar} # note`, policy, source);
      assert.equal(result.trim.stop, 'eligible-marker', `U+${codePoint.toString(16)}`);
      assert.equal([...result.trim.content].slice(result.trim.codeEndOffset, result.trim.triviaEndOffset).includes(scalar), true);
    }
  }
  for (const codePoint of [0x0085, 0x180e]) {
    const scalar = String.fromCodePoint(codePoint);
    assert.equal(executeFrontendTrimPredicate(scalar, policy, source), false);
    assert.deepEqual(executeFrontendWhitespaceTrim(`text value=ok${scalar} # note`, policy, source), failed('UNSUPPORTED_UNKNOWN'));
  }
});

test('record-end content is never trimmed and inert markers remain marker-free', () => {
  for (const source of [
    'text value=ok   ', 'text value="hello # world"  ', 'text value={{ x # y }}  ',
    'text { color: #fff }  ', 'text value=x#y  ', 'text value=http://example.test  ',
  ]) {
    const trim = executeFrontendWhitespaceTrim(source).trim;
    assert.equal(trim.stop, 'record-end', source);
    assert.equal(trim.markerOffset, null, source);
    assert.equal(trim.codeEndOffset, [...source].length, source);
    assert.equal(trim.triviaEndOffset, [...source].length, source);
  }
});

test('discarded whitespace and payload widen only the pre-tokenization profile', () => {
  assert.equal(executeFrontendWhitespaceTrim('text value=ok \u00a0 # note').trim.stop, 'eligible-marker');
  assert.equal(executeFrontendWhitespaceTrim('text value=ok # 🧭 payload').trim.rawPayload, ' 🧭 payload');
  assert.deepEqual(executeFrontendCommentBoundaries('text value=ok \u00a0 # note'), failed('UNSUPPORTED_UNKNOWN'));
  assert.deepEqual(executeFrontendCommentBoundaries('text value=ok # 🧭 payload'), failed('UNSUPPORTED_UNKNOWN'));
  assert.deepEqual(executeFrontendWhitespaceTrim('é # note'), failed('UNSUPPORTED_UNKNOWN'));
  assert.deepEqual(executeFrontendWhitespaceTrim('text value=ok \ud800 # note'), failed('MALFORMED_UTF16'));
});

test('old-profile marker and state fields remain aligned with M4.157', () => {
  for (const source of [
    'text value=ok # note', 'text value=ok\t// note', 'text value="hello # world"',
    'text value={{ x # inert }}', 'text { color: #fff }', 'text value="😀" # note',
  ]) {
    const trim = executeFrontendWhitespaceTrim(source).trim;
    const boundary = executeFrontendCommentBoundaries(source).partitions[0];
    for (const key of [
      'checkpointIndex', 'content', 'escapePending', 'expressionDepth', 'groupIndex',
      'groupRecordIndex', 'markerKind', 'markerOffset', 'markerText', 'physicalIndex',
      'quote', 'rawPayload', 'stop', 'styleDepth',
    ]) assert.equal(trim[key], boundary[key], `${source}: ${key}`);
  }
});

test('bootstrap parser witnesses the widened suffix and payload ordering', () => {
  const unicodeSuffix = parseDocument('text value=ok \u00a0 # note');
  assert.equal(unicodeSuffix.children?.[0]?.props.value, 'ok');
  const unicodePayload = parseDocument('text value=ok # 🧭 payload');
  assert.equal(unicodePayload.children?.[0]?.props.value, 'ok');
});

test('policy is exact and the 37-field success envelope fits at its exact boundary', () => {
  const policy = loadFrontendWhitespaceTrimPolicy();
  assert.equal(policy.whitespaceTrimSourceProfile, 'single-parser-content-record-v1');
  assert.throws(
    () => validateFrontendWhitespaceTrimPolicy({ format: policy.whitespaceTrimFormat, sourceProfile: policy.whitespaceTrimSourceProfile, extra: true }),
    /exactly/u,
  );
  const lexical = structuredClone(policy);
  lexical.runtimeLimits.maxCollectionLength = 36;
  assert.throws(
    () => validateFrontendWhitespaceTrimPolicy({ format: policy.whitespaceTrimFormat, sourceProfile: policy.whitespaceTrimSourceProfile }, lexical),
    /fit runtime maxCollectionLength/u,
  );
  lexical.runtimeLimits.maxCollectionLength = 37;
  assert.equal(
    validateFrontendWhitespaceTrimPolicy(
      { format: policy.whitespaceTrimFormat, sourceProfile: policy.whitespaceTrimSourceProfile },
      lexical,
    ).whitespaceTrimFormat,
    policy.whitespaceTrimFormat,
  );
});

test('complete host bounds and native limits fail before partial trim evidence', () => {
  assert.deepEqual(executeFrontendWhitespaceTrim('\ud800'), failed('MALFORMED_UTF16'));
  assert.deepEqual(executeFrontendWhitespaceTrim('abcd', policyWith('maxSourceBytes', 3)), failed('SOURCE_BYTES_LIMIT'));
  assert.deepEqual(executeFrontendWhitespaceTrim('abcd', policyWith('maxCodePoints', 3)), failed('CODE_POINTS_LIMIT'));
  assert.deepEqual(executeFrontendWhitespaceTrim('a\nb'), failed('UNSUPPORTED_LINE_ENDING'));
  assert.deepEqual(executeFrontendWhitespaceTrim('a\rb'), failed('UNSUPPORTED_LINE_ENDING'));
  assert.deepEqual(executeFrontendWhitespaceTrim('a', policyWith('maxTokens', 0)), failed('INVALID_LIMITS'));
  assert.deepEqual(executeFrontendWhitespaceTrim('{{{{ x }}}}', policyWith('maxLexicalDepth', 1)), failed('LEXICAL_DEPTH_LIMIT'));
  assert.deepEqual(executeFrontendWhitespaceTrim('a b', policyWith('maxTokens', 1)), failed('TOKEN_LIMIT'));
});

test('strict envelope validation rejects offsets, membership, record-end trim, and seal drift', () => {
  const policy = loadFrontendWhitespaceTrimPolicy();
  const source = 'text value="😀" \u00a0 # note';
  const valid = successFields(source);
  assert.equal(parseWhitespaceTrimEnvelope(source, textEnvelope(valid), policy).trim.markerKind, 'hash');
  for (const [label, index, value] of [
    ['identity', 2, '1'], ['content', 7, 'stale'], ['marker', 13, '999'],
    ['kind', 14, 'slash-slash'], ['payload', 16, ' forged'], ['code-end', 17, '1'],
    ['trivia-end', 18, '1'], ['seal', 20, 'stale'],
  ]) {
    const forged = [...valid];
    forged[index] = value;
    assert.throws(() => parseWhitespaceTrimEnvelope(source, textEnvelope(forged), policy), /rejection/u, label);
  }
  const recordEndSource = 'text value=ok  ';
  const trimmedRecordEnd = successFields(recordEndSource);
  trimmedRecordEnd[17] = String([...recordEndSource].length - 2);
  assert.throws(
    () => parseWhitespaceTrimEnvelope(recordEndSource, textEnvelope(trimmedRecordEnd), policy),
    /record-end trim drift|offset drift/u,
  );
});

test('native source composes one shared scanner and forbids host whitespace delegation', () => {
  const source = loadWhitespaceTrimSource();
  assert.equal((source.match(/fn name=scanlexicalcontent\b/gu) ?? []).length, 1);
  assert.match(source, /scanlexicalcontent\(content, 0, 0, 0, maxLexicalDepth\)/u);
  assert.match(source, /tokenizeline\(retainedCode, maxCodePoints,/u);
  assert.doesNotMatch(source, /\.trimEnd\(|stripInlineComment|tokenizeLineInternal/u);
  assert.throws(
    () => validateNativeWhitespaceTrimSource(`${source}\nfn name=scanlexicalcontent`),
    /exactly one shared lexical scanner/u,
  );
});

test('named scanner, table, ordering, and offset mutations cannot masquerade as parity', () => {
  const source = loadWhitespaceTrimSource();
  const markerBlind = mutateFunction(
    source,
    'scanlexicalcontent',
    String.raw`if cond="precededByWs && (ch == \"#\" || (ch == \"/\" && next == \"/\"))"`,
    'if cond="false"',
  );
  assert.throws(() => executeFrontendWhitespaceTrim('text value=ok # note', undefined, markerBlind), /drift|rejection/u);

  const missingNbsp = mutateFunction(
    source,
    'frontendtrimspace',
    String.raw`c == \"\\u00a0\" || `,
    '',
  );
  assert.throws(() => executeFrontendWhitespaceTrim('text value=ok \u00a0 # note', undefined, missingNbsp), /drift|rejection/u);

  const admittedNel = mutateFunction(
    source,
    'frontendtrimspace',
    String.raw`return value="c == \"\\u2028\"`,
    String.raw`return value="c == \"\\u0085\" || c == \"\\u2028\"`,
  );
  assert.throws(() => executeFrontendWhitespaceTrim('text value=ok\u0085 # note', undefined, admittedNel), /failure envelope drift|rejection/u);

  const wrongDirection = mutateFunction(
    source,
    'observewhitespacetrim',
    'Text.charAt(content, codeEnd - 1)',
    'Text.charAt(content, codeEnd)',
  );
  assert.throws(() => executeFrontendWhitespaceTrim('text value=ok   # note', undefined, wrongDirection), /drift|rejection/u);

  const rawTokenization = mutateFunction(
    source,
    'observewhitespacetrim',
    'tokenizeline(retainedCode, maxCodePoints,',
    'tokenizeline(content, maxCodePoints,',
  );
  assert.throws(() => executeFrontendWhitespaceTrim('text value=ok \u00a0 # note', undefined, rawTokenization), /failure envelope drift|rejection/u);

  const shiftedCodeEnd = mutateFunction(
    source,
    'observewhitespacetrim',
    'out.push(String(codeEnd))',
    'out.push(String(codeEnd + 1))',
  );
  assert.throws(() => executeFrontendWhitespaceTrim('text value=ok # note', undefined, shiftedCodeEnd), /drift|rejection/u);
});

test('oracle and KERN remain equal across hostile scalar and state boundaries', () => {
  const policy = loadFrontendWhitespaceTrimPolicy();
  for (const source of [
    '', 'text value=ok', 'text value="open', "text value='open", 'text value={{ nested # inert }} # note',
    'text { outer: { inner: "}" } } // note', 'text value="😀"\u202f\t# 🧭',
  ]) {
    assert.deepEqual(executeFrontendWhitespaceTrim(source, policy), normalizeWhitespaceTrimOracle(source, policy), source);
  }
});
