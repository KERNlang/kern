import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDocument } from '../../packages/core/dist/index.js';
import {
  executeFrontendCommentBoundaries,
  loadCommentBoundarySource,
  parseCommentBoundaryEnvelope,
  validateNativeCommentBoundarySource,
} from '../check-kern-frontend-comment-boundaries.mjs';
import { executeFrontendLexical } from '../check-kern-frontend-lexical.mjs';
import { normalizeCommentBoundaryOracle } from './oracle.mjs';
import {
  loadFrontendCommentBoundaryPolicy,
  validateFrontendCommentBoundaryPolicy,
} from './policy.mjs';

const failed = (code) => ({ code, detail: '', status: 'failure' });

function policyWith(limit, value) {
  const policy = structuredClone(loadFrontendCommentBoundaryPolicy());
  if (limit === 'maxPartitions' || limit === 'maxCheckpoints' || limit === 'maxLexicalDepth') {
    policy[limit] = value;
  } else policy.profileLimits[limit] = value;
  return policy;
}

function mutate(source, from, to) {
  const mutated = source.replace(from, to);
  assert.notEqual(mutated, source, `mutation anchor missing: ${from}`);
  return mutated;
}

function mutateCommentBoundary(source, from, to) {
  const start = source.indexOf('fn name=observecommentboundaries');
  assert.notEqual(start, -1, 'observecommentboundaries scope missing');
  return source.slice(0, start) + mutate(source.slice(start), from, to);
}

function textEnvelope(fields) {
  return { tag: 'list', value: fields.map((value) => ({ tag: 'text', value })) };
}

function record(tag, ...fields) {
  return [tag, ...fields, ...Array(15 - fields.length).fill('')];
}

test('KERN partitions exact marker kinds and raw payloads without serializing code prefixes', () => {
  const source = [
    'text value="😀" # payload',
    'text value=ok //\tpayload',
    'text value=none  ',
  ].join('\n');
  const result = executeFrontendCommentBoundaries(source);
  assert.deepEqual(
    result.partitions.map(({ markerKind, markerText, rawPayload, markerOffset }) => ({
      markerKind, markerOffset, markerText, rawPayload,
    })),
    [
      { markerKind: 'hash', markerOffset: [...'text value="😀" '].length, markerText: '#', rawPayload: ' payload' },
      { markerKind: 'slash-slash', markerOffset: 14, markerText: '//', rawPayload: '\tpayload' },
      { markerKind: 'none', markerOffset: null, markerText: '', rawPayload: '' },
    ],
  );
  for (const partition of result.partitions) {
    assert.equal('code' in partition, false);
    assert.equal('trimmedSuffix' in partition, false);
  }
});

test('hostile payload is copied verbatim and never changes checkpoint state', () => {
  for (const source of [
    'text value=ok # " {{ }} // # \\',
    "text value=ok // ' {{ }} # // \\",
  ]) {
    const partition = executeFrontendCommentBoundaries(source).partitions[0];
    assert.equal(partition.quote, 'none');
    assert.equal(partition.expressionDepth, 0);
    assert.equal(partition.styleDepth, 0);
    assert.equal(partition.rawPayload, source.slice(source.indexOf(partition.markerText) + partition.markerText.length));
  }
});

test('inert and ineligible markers remain record-end partitions', () => {
  for (const source of [
    'text value="hello # // world"',
    "text value='hello # // world'",
    'text value={{ value # still expression // still expression }}',
    'text { color: #fff, url: //asset }',
    'text value=x#y',
    'text value=http://example.test',
    'text\u000b#not-a-marker',
    'text\u000c//not-a-marker',
  ]) {
    const partition = executeFrontendCommentBoundaries(source).partitions[0];
    assert.equal(partition.stop, 'record-end', source);
    assert.equal(partition.markerKind, 'none', source);
    assert.equal(partition.markerOffset, null, source);
    assert.equal(partition.rawPayload, '', source);
  }
});

test('policy is exact, positive, and contained by lexical and runtime limits', () => {
  const policy = loadFrontendCommentBoundaryPolicy();
  assert.equal(policy.commentBoundaryFormat, 'kern.frontend.inline-comment-boundary-shadow.1');
  assert.throws(
    () => validateFrontendCommentBoundaryPolicy({ format: policy.commentBoundaryFormat, maxPartitions: 1, extra: 1 }),
    /exactly/u,
  );
  assert.throws(
    () => validateFrontendCommentBoundaryPolicy({ format: policy.commentBoundaryFormat, maxPartitions: 0 }),
    /positive/u,
  );
  assert.throws(
    () => validateFrontendCommentBoundaryPolicy({
      format: policy.commentBoundaryFormat,
      maxPartitions: policy.maxCheckpoints + 1,
    }),
    /fit lexical maxCheckpoints/u,
  );
  const lexical = structuredClone(policy);
  lexical.runtimeLimits.maxCollectionLength = 32;
  assert.throws(
    () => validateFrontendCommentBoundaryPolicy({ format: policy.commentBoundaryFormat, maxPartitions: 1 }, lexical),
    /fit runtime maxCollectionLength/u,
  );
  lexical.runtimeLimits.maxCollectionLength = 33;
  assert.equal(
    validateFrontendCommentBoundaryPolicy(
      { format: policy.commentBoundaryFormat, maxPartitions: 1 },
      lexical,
    ).maxPartitions,
    1,
  );
});

test('native source composes observelexical and rejects host or bootstrap delegation', () => {
  const source = loadCommentBoundarySource();
  const ownSource = source.slice(source.indexOf('fn name=commentboundaryfailure'));
  assert.match(ownSource, /observelexical\(source, rawProfile,/u);
  assert.doesNotMatch(ownSource, /precededByWs|quote !=|expressionDepth >|styleDepth >/u);
  assert.doesNotMatch(source, /stripInlineComment|normalizeCommentBoundaryOracle/u);
  assert.throws(
    () => validateNativeCommentBoundarySource(`${source}\n// stripInlineComment`),
    /delegation rejection/u,
  );
  assert.throws(
    () => validateNativeCommentBoundarySource(source.replace('handler lang="kern"', 'handler')),
    /every source handler/u,
  );
});

test('host, inherited, and partition limits fail atomically with exact precedence', () => {
  assert.deepEqual(executeFrontendCommentBoundaries('\ud800'), failed('MALFORMED_UTF16'));
  assert.deepEqual(
    executeFrontendCommentBoundaries('abcd', policyWith('maxSourceBytes', 3)),
    failed('SOURCE_BYTES_LIMIT'),
  );
  assert.deepEqual(executeFrontendCommentBoundaries('a\nb', policyWith('maxPartitions', 1)), failed('PARTITION_LIMIT'));
  assert.equal(executeFrontendCommentBoundaries('a\nb', policyWith('maxPartitions', 2)).partitions.length, 2);
  const inheritedFirst = policyWith('maxPartitions', 1);
  inheritedFirst.maxCheckpoints = 1;
  assert.deepEqual(executeFrontendCommentBoundaries('a\nb', inheritedFirst), failed('CHECKPOINT_LIMIT'));
  assert.deepEqual(executeFrontendCommentBoundaries('a', policyWith('maxPartitions', 0)), failed('INVALID_LIMITS'));
  assert.deepEqual(executeFrontendCommentBoundaries('a\r\nb'), failed('UNSUPPORTED_LINE_ENDING'));
  assert.deepEqual(executeFrontendCommentBoundaries('text value=ok # 🧭'), failed('UNSUPPORTED_UNKNOWN'));
});

test('strict envelope validation rejects marker, payload, source, order, and seal drift', () => {
  const policy = loadFrontendCommentBoundaryPolicy();
  const source = 'text # note';
  const valid = [
    policy.commentBoundaryFormat,
    ...record('partition', '0', '0', '0', '0', '0', source, 'none', '0', '0', '0', 'eligible-marker', '5', 'hash', '#', ' note'),
    ...record('seal', source),
  ];
  assert.equal(parseCommentBoundaryEnvelope(source, textEnvelope(valid), policy).partitions.length, 1);
  for (const [label, index, value] of [
    ['order', 2, '1'], ['checkpoint', 3, '1'], ['group', 4, '1'], ['content', 7, 'x'],
    ['quote', 8, 'double'], ['stop', 12, 'record-end'], ['offset', 13, '4'],
    ['kind', 14, 'slash-slash'], ['marker', 15, '//'], ['payload', 16, ' forged'],
    ['seal', 18, 'stale'],
  ]) {
    const forged = [...valid];
    forged[index] = value;
    assert.throws(() => parseCommentBoundaryEnvelope(source, textEnvelope(forged), policy), /rejection/u, label);
  }
  assert.throws(
    () => parseCommentBoundaryEnvelope('screen', textEnvelope(valid), policy),
    /rejection/u,
  );
  assert.throws(
    () => parseCommentBoundaryEnvelope(source, textEnvelope([...valid, ...record('partition')]), policy),
    /terminal seal|post-seal/u,
  );
});

test('column-zero and UTF-16 code-unit forgeries fail closed', () => {
  const policy = loadFrontendCommentBoundaryPolicy();
  const columnZero = [
    policy.commentBoundaryFormat,
    ...record('partition', '0', '0', '0', '0', '0', '# comment', 'none', '0', '0', '0', 'eligible-marker', '0', 'hash', '#', ' comment'),
    ...record('seal', '# comment'),
  ];
  assert.throws(
    () => parseCommentBoundaryEnvelope('# comment', textEnvelope(columnZero), policy),
    /eligible partition marker|coverage drift/u,
  );

  const source = 'text value="😀" # note';
  const scalarOffset = [...'text value="😀" '].length;
  const codeUnitPayload = source.slice(scalarOffset + 1);
  const forgedUtf16 = [
    policy.commentBoundaryFormat,
    ...record(
      'partition', '0', '0', '0', '0', '0', source, 'none', '0', '0', '0',
      'eligible-marker', String(scalarOffset), 'hash', '#', codeUnitPayload,
    ),
    ...record('seal', source),
  ];
  assert.throws(
    () => parseCommentBoundaryEnvelope(source, textEnvelope(forgedUtf16), policy),
    /reconstruction drift|payload drift/u,
  );
});

test('bootstrap witnesses payload non-interference without becoming the oracle', () => {
  const first = parseDocument('text value=ok # name=hijack style={ bad: true }').children?.[0];
  const second = parseDocument('text value=ok # entirely different {{ " payload').children?.[0];
  assert.deepEqual(first?.props, second?.props);
  assert.equal(first?.props?.value, 'ok');
  assert.equal(parseDocument('text value="ok # data"').children?.[0]?.props?.value, 'ok # data');
  assert.deepEqual(
    parseDocument('text value={{ value // data }}').children?.[0]?.props?.value,
    { __expr: true, code: 'value // data' },
  );
});

test('full-line, raw, boundary, and EOF-unclosed records preserve inherited exclusion', () => {
  const source = [
    '# hash boundary',
    '// slash boundary',
    'screen',
    'handler <<<',
    'text value="open',
  ].join('\n');
  const result = executeFrontendCommentBoundaries(source);
  assert.deepEqual(result.partitions.map(({ physicalIndex }) => physicalIndex), [2]);
});

test('named source mutations cannot masquerade as marker and payload parity', () => {
  const source = loadCommentBoundarySource();

  const swappedHashKind = mutateCommentBoundary(
    source,
    'assign target=markerKind value="\\"hash\\""',
    'assign target=markerKind value="\\"slash-slash\\""',
  );
  assert.throws(
    () => executeFrontendCommentBoundaries('text # note', undefined, swappedHashKind),
    /marker|payload drift|inconsistent/u,
  );

  const oneSlashConsumption = mutateCommentBoundary(
    source,
    'assign target=payloadStart value="markerOffset + 2"',
    'assign target=payloadStart value="markerOffset + 1"',
  );
  assert.throws(
    () => executeFrontendCommentBoundaries('text // payload', undefined, oneSlashConsumption),
    /reconstruction drift|payload drift/u,
  );

  const offByOnePayload = mutateCommentBoundary(
    source,
    'assign target=rawPayload value="Text.slice(content, payloadStart, n)"',
    'assign target=rawPayload value="Text.slice(content, payloadStart + 1, n)"',
  );
  assert.throws(
    () => executeFrontendCommentBoundaries('text # payload', undefined, offByOnePayload),
    /reconstruction drift|payload drift/u,
  );

  const payloadMarkerText = mutateCommentBoundary(
    source,
    'assign target=markerText value="\\"//\\""',
    'assign target=markerText value="Text.slice(content, markerOffset + 1, markerOffset + 3)"',
  );
  assert.throws(
    () => executeFrontendCommentBoundaries('text // payload', undefined, payloadMarkerText),
    /marker|reconstruction drift/u,
  );

  const truncatedHostilePayload = mutateCommentBoundary(
    source,
    'assign target=rawPayload value="Text.slice(content, payloadStart, n)"',
    'assign target=rawPayload value="Text.slice(content, payloadStart, n - 1)"',
  );
  assert.throws(
    () => executeFrontendCommentBoundaries('text # " {{ }} // # \\', undefined, truncatedHostilePayload),
    /reconstruction drift|payload drift/u,
  );

  const constantContent = mutateCommentBoundary(
    source,
    'do value="out.push(content)"',
    'do value="out.push(\\"\\")"',
  );
  assert.throws(
    () => executeFrontendCommentBoundaries('text # note', undefined, constantContent),
    /identity|inconsistent|reconstruction drift/u,
  );

  const disabledPartitionLimit = mutateCommentBoundary(
    source,
    'if cond="partitionIndex >= maxPartitions"',
    'if cond="false"',
  );
  assert.throws(
    () => executeFrontendCommentBoundaries('a\nb', policyWith('maxPartitions', 1), disabledPartitionLimit),
    /success envelope contradicts oracle failure|partition limit/u,
  );

  const replacedInheritedFailure = mutateCommentBoundary(
    source,
    'commentboundaryfailure(base[2], base[3])',
    'commentboundaryfailure(\\\"PARTITION_LIMIT\\\", \\\"\\\")',
  );
  assert.throws(
    () => executeFrontendCommentBoundaries('a\r\nb', undefined, replacedInheritedFailure),
    /failure envelope drift/u,
  );
});

test('oracle and KERN remain equal across scalar and hostile boundary cases', () => {
  const policy = loadFrontendCommentBoundaryPolicy();
  for (const source of [
    '', 'screen\n', 'text #', 'text //', 'text value="😀" # payload',
    'text # " {{ }} // # \\', 'text value="a # b"', 'text\u000b#no',
  ]) {
    const lexical = executeFrontendLexical(source, policy);
    assert.deepEqual(
      executeFrontendCommentBoundaries(source, policy),
      normalizeCommentBoundaryOracle(source, policy.rawOpenerTypes, policy, lexical),
      source,
    );
  }
});
