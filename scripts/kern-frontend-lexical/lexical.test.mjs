import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDocument } from '../../packages/core/dist/index.js';
import {
  executeFrontendLexical,
  loadLexicalSource,
  parseLexicalEnvelope,
  validateNativeLexicalSource,
} from '../check-kern-frontend-lexical.mjs';
import { normalizeLexicalOracle } from './oracle.mjs';
import { loadFrontendLexicalPolicy, validateFrontendLexicalPolicy } from './policy.mjs';

const failed = (code) => ({ code, detail: '', status: 'failure' });

function policyWith(limit, value) {
  const policy = structuredClone(loadFrontendLexicalPolicy());
  if (limit === 'maxCheckpoints' || limit === 'maxLexicalDepth') policy[limit] = value;
  else policy.profileLimits[limit] = value;
  return policy;
}

function mutate(source, from, to) {
  const mutated = source.replace(from, to);
  assert.notEqual(mutated, source, `mutation anchor missing: ${from}`);
  return mutated;
}

function mutateLexical(source, from, to) {
  const start = source.indexOf('fn name=observelexical');
  assert.notEqual(start, -1, 'observelexical scope missing');
  return source.slice(0, start) + mutate(source.slice(start), from, to);
}

function textEnvelope(fields) {
  return { tag: 'list', value: fields.map((value) => ({ tag: 'text', value })) };
}

function record(tag, ...fields) {
  return [tag, ...fields, ...Array(11 - fields.length).fill('')];
}

test('KERN emits one conditional checkpoint per admitted physical record', () => {
  const source = ['screen', '  text value="one\\', 'two"  # payload with " {{ \\'].join('\n');
  const result = executeFrontendLexical(source);
  assert.deepEqual(
    result.checkpoints.map(({ physicalIndex, quote, escapePending, stop, markerOffset }) => ({
      escapePending, markerOffset, physicalIndex, quote, stop,
    })),
    [
      { escapePending: false, markerOffset: null, physicalIndex: 0, quote: 'none', stop: 'record-end' },
      { escapePending: true, markerOffset: null, physicalIndex: 1, quote: 'double', stop: 'record-end' },
      { escapePending: false, markerOffset: 6, physicalIndex: 2, quote: 'none', stop: 'eligible-marker' },
    ],
  );
});

test('eligible marker freezes state before hostile comment payload', () => {
  const source = 'text value=ok  # payload with " {{ \\';
  const checkpoint = executeFrontendLexical(source).checkpoints[0];
  assert.equal(checkpoint.stop, 'eligible-marker');
  assert.equal(checkpoint.markerOffset, 15);
  assert.equal(checkpoint.quote, 'none');
  assert.equal(checkpoint.expressionDepth, 0);
  assert.equal(checkpoint.styleDepth, 0);
  assert.equal(checkpoint.escapePending, false);
  assert.equal(checkpoint.content, source);
});

test('quote, expression, and style precedence keeps nested markers inert', () => {
  for (const source of [
    'text value="hello # // world"',
    "text value='hello # // world'",
    'text value={{ value # still expression // still expression }}',
    'text { color: #fff, url: //asset }',
    "text { value: 'a } # //', other: \"b }\" }",
  ]) {
    const checkpoint = executeFrontendLexical(source).checkpoints[0];
    assert.equal(checkpoint.stop, 'record-end', source);
    assert.equal(checkpoint.markerOffset, null, source);
    assert.equal(checkpoint.quote, 'none', source);
    assert.equal(checkpoint.expressionDepth, 0, source);
    assert.equal(checkpoint.styleDepth, 0, source);
  }
});

test('multiline expression checkpoints preserve depth and recognize only the final marker', () => {
  const source = ['text value={{', '  inner({{ value }})', '}} // done'].join('\n');
  const checkpoints = executeFrontendLexical(source).checkpoints;
  assert.deepEqual(checkpoints.map(({ expressionDepth, markerOffset }) => [expressionDepth, markerOffset]), [
    [1, null], [1, null], [0, 3],
  ]);
});

test('inserted LF consumes a pending quote escape before the next record', () => {
  const checkpoints = executeFrontendLexical('text value="one\\\ntwo"').checkpoints;
  assert.equal(checkpoints[0].quote, 'double');
  assert.equal(checkpoints[0].escapePending, true);
  assert.equal(checkpoints[1].quote, 'none');
  assert.equal(checkpoints[1].escapePending, false);
});

test('marker offsets count Unicode scalars and only ASCII space or tab qualifies', () => {
  const astral = executeFrontendLexical('text value="😀"  # note').checkpoints[0];
  assert.equal(astral.markerOffset, [...'text value="😀"  '].length);
  for (const checkpoint of executeFrontendLexical('text\u000b#no\ntext\u000c//no').checkpoints) {
    assert.equal(checkpoint.markerOffset, null);
  }
  assert.deepEqual(executeFrontendLexical('text\u00a0#no'), failed('UNSUPPORTED_UNKNOWN'));
});

test('policy is exact, positive, and contained by inherited limits', () => {
  const policy = loadFrontendLexicalPolicy();
  assert.equal(policy.lexicalFormat, 'kern.frontend.lexical-checkpoint-shadow.1');
  assert.throws(
    () => validateFrontendLexicalPolicy({ format: policy.lexicalFormat, maxCheckpoints: 1, maxLexicalDepth: 1, extra: 1 }),
    /exactly/u,
  );
  assert.throws(
    () => validateFrontendLexicalPolicy({ format: policy.lexicalFormat, maxCheckpoints: 0, maxLexicalDepth: 1 }),
    /positive/u,
  );
  assert.throws(
    () => validateFrontendLexicalPolicy({
      format: policy.lexicalFormat,
      maxCheckpoints: policy.profileLimits.maxPhysicalRecords + 1,
      maxLexicalDepth: 1,
    }),
    /fit stitcher maxPhysicalRecords/u,
  );
});

test('native source composes stitchdocument and rejects host delegation', () => {
  const source = loadLexicalSource();
  assert.match(source, /stitchdocument\(source, rawProfile,/u);
  assert.doesNotMatch(source.slice(source.indexOf('fn name=observelexical')), /i == 0 \|\| prev ==/u);
  assert.doesNotMatch(source, /stripInlineComment|normalizeLexicalOracle|physicalOracle/u);
  assert.throws(() => validateNativeLexicalSource(`${source}\n// stripInlineComment`), /delegation rejection/u);
  assert.throws(
    () => validateNativeLexicalSource(source.replace('handler lang="kern"', 'handler')),
    /every source handler/u,
  );
});

test('host, checkpoint, lexical-depth, and inherited limits fail atomically', () => {
  assert.deepEqual(executeFrontendLexical('\ud800'), failed('MALFORMED_UTF16'));
  assert.deepEqual(executeFrontendLexical('abcd', policyWith('maxSourceBytes', 3)), failed('SOURCE_BYTES_LIMIT'));
  assert.deepEqual(executeFrontendLexical('a\nb', policyWith('maxCheckpoints', 1)), failed('CHECKPOINT_LIMIT'));
  assert.equal(executeFrontendLexical('a\nb', policyWith('maxCheckpoints', 2)).checkpoints.length, 2);
  assert.deepEqual(
    executeFrontendLexical('text value={{{{{{ x }}}}}}', policyWith('maxLexicalDepth', 2)),
    failed('LEXICAL_DEPTH_LIMIT'),
  );
  assert.deepEqual(executeFrontendLexical('a', policyWith('maxLexicalDepth', 0)), failed('INVALID_LIMITS'));
  assert.deepEqual(executeFrontendLexical('a\r\nb'), failed('UNSUPPORTED_LINE_ENDING'));
});

test('strict envelope validation rejects identity, state, marker, order, and seal drift', () => {
  const policy = loadFrontendLexicalPolicy();
  const source = 'text # note';
  const valid = [
    policy.lexicalFormat,
    ...record('checkpoint', '0', '0', '0', '0', source, 'none', '0', '0', '0', 'eligible-marker', '5'),
    ...record('seal', source),
  ];
  assert.equal(parseLexicalEnvelope(source, textEnvelope(valid), policy).checkpoints.length, 1);
  assert.throws(
    () => parseLexicalEnvelope(
      'screen',
      textEnvelope([policy.lexicalFormat, 'failure', 'CHECKPOINT_LIMIT', '', ...Array(9).fill('')]),
      policy,
    ),
    /failure envelope contradicts oracle success/u,
  );
  for (const [label, index, value] of [
    ['order', 2, '1'], ['group identity', 3, '1'], ['content', 6, 'x'], ['quote', 7, 'double'],
    ['escape', 8, '1'], ['expression', 9, '1'], ['style', 10, '1'], ['stop', 11, 'record-end'],
    ['marker', 12, '4'], ['seal', 14, 'stale'],
  ]) {
    const forged = [...valid];
    forged[index] = value;
    assert.throws(() => parseLexicalEnvelope(source, textEnvelope(forged), policy), /rejection/u, label);
  }
  assert.throws(
    () => parseLexicalEnvelope(source, textEnvelope([...valid, ...record('checkpoint')]), policy),
    /terminal seal|post-seal/u,
  );
});

test('bootstrap parser witnesses the same conditional marker boundaries', () => {
  const tab = String.fromCharCode(9);
  for (const [source, expected] of [
    ['text value=ok  # hostile " {{ \\', 'ok'],
    [`text value=ok${tab}// hostile ' }} \\`, 'ok'],
    ['text value="hello # world"', 'hello # world'],
  ]) {
    assert.equal(parseDocument(source).children?.[0]?.props?.value, expected, source);
  }
  assert.deepEqual(
    parseDocument('text value={{ value # inside }}').children?.[0]?.props?.value,
    { __expr: true, code: 'value # inside' },
  );
  assert.deepEqual(parseDocument('text { color: #fff }').children?.[0]?.props?.styles, { color: '#fff' });
});

test('boundary and EOF-unclosed groups emit no checkpoints', () => {
  const result = executeFrontendLexical([
    'text value="open',
    '# boundary',
    'screen',
    'handler <<<',
    'text value="still open',
  ].join('\n'));
  assert.deepEqual(result.checkpoints.map(({ physicalIndex }) => physicalIndex), [2]);
});

test('named source mutations cannot masquerade as checkpoint parity', () => {
  const source = loadLexicalSource();
  const markerBlind = mutateLexical(
    source,
    String.raw`if cond="precededByWs && (ch == \"#\" || (ch == \"/\" && next == \"/\"))"`,
    'if cond="false"',
  );
  assert.throws(() => executeFrontendLexical('text # payload with "', undefined, markerBlind), /state drift/u);

  const collapsedQuote = mutateLexical(
    source,
    String.raw`assign target=quote value="\"single\""`,
    String.raw`assign target=quote value="\"double\""`,
  );
  assert.throws(() => executeFrontendLexical("text value='open", undefined, collapsedQuote), /state drift/u);

  const resetAtBoundary = mutateLexical(
    source,
    'let name=content value="base[physicalOffset + 2]"',
    String.raw`let name=content value="base[physicalOffset + 2]"` + '\n' +
      String.raw`        assign target=quote value="\"none\""`,
  );
  assert.throws(() => executeFrontendLexical('text value="one\ntwo"', undefined, resetAtBoundary), /state drift/u);

  const disabledDepth = mutateLexical(
    source,
    'if cond="expressionDepth > maxLexicalDepth"',
    'if cond="false"',
  );
  assert.throws(
    () => executeFrontendLexical('text value={{{{ x }}}}', policyWith('maxLexicalDepth', 1), disabledDepth),
    /oracle failure|rejection/u,
  );

  const shiftedScalarOffset = mutateLexical(
    source,
    'assign target=markerOffset value="String(i)"',
    'assign target=markerOffset value="String(i + 1)"',
  );
  assert.throws(() => executeFrontendLexical('text value="😀" # note', undefined, shiftedScalarOffset), /state drift/u);

  const brokenEscapeParity = mutateLexical(
    source,
    String.raw`assign target=i value="i + 2"`,
    String.raw`assign target=i value="i + 3"`,
  );
  assert.throws(() => executeFrontendLexical('text value="two\\\\"', undefined, brokenEscapeParity), /state drift/u);

  const skippedLfConsumption = mutateLexical(
    source,
    String.raw`let name=escapePending value="0"`,
    String.raw`let name=escapePending value="0"` + '\n' +
      String.raw`        if cond="ordinal > 0"` + '\n' +
      String.raw`          assign target=escapePending value="1"`,
  );
  assert.throws(
    () => executeFrontendLexical('text value="one\\\ntwo"', undefined, skippedLfConsumption),
    /state drift/u,
  );

  const quotePrecedenceLost = mutateLexical(
    source,
    String.raw`if cond="quote != \"none\""`,
    String.raw`if cond="quote != \"none\" && expressionDepth == 0"`,
  );
  assert.throws(
    () => executeFrontendLexical('text value={{ "#" }} # end', undefined, quotePrecedenceLost),
    /state drift/u,
  );

  const firstBraceClosesExpression = mutateLexical(
    source,
    String.raw`if cond="ch == \"}\" && next == \"}\" && expressionDepth > 0"`,
    String.raw`if cond="ch == \"}\" && expressionDepth > 0"`,
  );
  assert.throws(
    () => executeFrontendLexical('text value={{ one } # inside }}', undefined, firstBraceClosesExpression),
    /state drift/u,
  );

  const expressionMarkerEnabled = mutateLexical(
    source,
    String.raw`if cond="expressionDepth > 0"`,
    String.raw`if cond="false"`,
  );
  assert.throws(
    () => executeFrontendLexical('text value={{ value # inside }}', undefined, expressionMarkerEnabled),
    /state drift/u,
  );

  const unicodeWhitespaceEnabled = mutateLexical(
    source,
    String.raw`prev == \" \" || prev == \"\\t\"`,
    String.raw`prev == \" \" || prev == \"\\t\" || prev == \"\\u000b\"`,
  );
  assert.throws(
    () => executeFrontendLexical('text\u000b#not-a-marker', undefined, unicodeWhitespaceEnabled),
    /state drift/u,
  );

  const scalarSizedCheckpointStep = mutateLexical(
    source,
    String.raw`assign target=checkpointIndex value="checkpointIndex + 1"`,
    String.raw`assign target=checkpointIndex value="checkpointIndex + n"`,
  );
  assert.throws(() => executeFrontendLexical('screen\ntext', undefined, scalarSizedCheckpointStep), /state drift/u);
});

test('oracle and KERN remain equal across the authored conditional-state corpus', () => {
  const policy = loadFrontendLexicalPolicy();
  for (const source of [
    '', 'screen\n', 'text value="a\\\nb"', "text value='single' # note",
    'text value={{{{ nested }}}}', 'text { outer: { inner: "}" } } // note',
  ]) {
    assert.deepEqual(
      executeFrontendLexical(source, policy),
      normalizeLexicalOracle(source, policy.rawOpenerTypes, policy),
      source,
    );
  }
});
