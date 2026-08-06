import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeFrontendIndentation,
  loadIndentationSource,
  parseIndentationEnvelope,
  validateNativeIndentationSource,
} from '../check-kern-frontend-indentation.mjs';
import { normalizeIndentationOracle } from './oracle.mjs';
import {
  loadFrontendIndentationPolicy,
  validateFrontendIndentationPolicy,
} from './policy.mjs';

const failed = (code) => ({ code, detail: '', status: 'failure' });

function policyWith(limit, value) {
  const policy = structuredClone(loadFrontendIndentationPolicy());
  if (limit === 'maxObservations') policy.maxObservations = value;
  else policy.profileLimits[limit] = value;
  return policy;
}

function mutate(source, from, to) {
  const mutated = source.replace(from, to);
  assert.notEqual(mutated, source, `mutation anchor missing: ${from}`);
  return mutated;
}

function textEnvelope(fields) {
  return { tag: 'list', value: fields.map((value) => ({ tag: 'text', value })) };
}

function record(tag, ...fields) {
  return [tag, ...fields, ...Array(7 - fields.length).fill('')];
}

test('KERN owns one exact indentation observation per completed ordinary group', () => {
  const source = ['screen', '  text value="one', '      two"', '# note', ' button'].join('\n');
  const result = executeFrontendIndentation(source);
  assert.equal(result.format, 'kern.frontend.indentation-shadow.1');
  assert.deepEqual(result.observations.map(({ indentBytes, relation }) => ({ indentBytes, relation })), [
    { indentBytes: '', relation: 'initial' },
    { indentBytes: '  ', relation: 'deeper' },
    { indentBytes: ' ', relation: 'shallower' },
  ]);
  assert.deepEqual(result, normalizeIndentationOracle(source, loadFrontendIndentationPolicy().rawOpenerTypes));
});

test('observations expose source evidence but no tree, comment, diagnostic, AST, or KIR claim', () => {
  const observation = executeFrontendIndentation('  text').observations[0];
  assert.equal(observation.firstContentByte, 2);
  assert.equal(observation.firstContentCodeUnit, 2);
  assert.equal(observation.indentBytes + observation.firstRecordContent.slice(2), observation.firstRecordContent);
  assert.deepEqual(
    Object.keys(observation).filter((key) => /parent|child|comment|indentJump|ast|kir/iu.test(key)),
    [],
  );
});

test('content offsets are document-relative after earlier astral source', () => {
  const source = 'text value="😀"\n  button';
  const observation = executeFrontendIndentation(source).observations[1];
  assert.equal(observation.firstContentByte, Buffer.byteLength('text value="😀"\n  '));
  assert.equal(observation.firstContentCodeUnit, 'text value="😀"\n  '.length);
});

test('policy is exact, positive, and contained by the inherited group limit', () => {
  const policy = loadFrontendIndentationPolicy();
  assert.equal(policy.indentationFormat, 'kern.frontend.indentation-shadow.1');
  assert.throws(
    () => validateFrontendIndentationPolicy({ format: policy.indentationFormat, maxObservations: 1, extra: true }),
    /exactly/u,
  );
  assert.throws(
    () => validateFrontendIndentationPolicy({ format: policy.indentationFormat, maxObservations: 0 }),
    /positive/u,
  );
  assert.throws(
    () => validateFrontendIndentationPolicy({
      format: policy.indentationFormat,
      maxObservations: policy.profileLimits.maxGroups + 1,
    }),
    /fit stitcher maxGroups/u,
  );
});

test('native source composes KERN stitchdocument and rejects host delegation', () => {
  const source = loadIndentationSource();
  assert.match(source, /stitchdocument\(source, rawProfile,/u);
  assert.doesNotMatch(source, /executeFrontendStitcher|normalizeStitchOracle|physicalOracle/u);
  assert.throws(
    () => validateNativeIndentationSource(`${source}\n// physicalOracle`),
    /delegation rejection/u,
  );
  assert.throws(
    () => validateNativeIndentationSource(source.replace('handler lang="kern"', 'handler')),
    /every source handler/u,
  );
});

test('host and inherited KERN limits fail closed without partial observations', () => {
  assert.deepEqual(executeFrontendIndentation('\ud800'), failed('MALFORMED_UTF16'));
  assert.deepEqual(executeFrontendIndentation('abcd', policyWith('maxSourceBytes', 3)), failed('SOURCE_BYTES_LIMIT'));
  assert.deepEqual(
    executeFrontendIndentation('a\nb', policyWith('maxPhysicalRecords', 1)),
    failed('PHYSICAL_RECORD_LIMIT'),
  );
  assert.equal(executeFrontendIndentation('a\nb', policyWith('maxObservations', 2)).observations.length, 2);
  assert.deepEqual(executeFrontendIndentation('a\nb', policyWith('maxObservations', 1)), failed('OBSERVATION_LIMIT'));
  assert.deepEqual(executeFrontendIndentation('a', policyWith('maxObservations', 0)), failed('INVALID_LIMITS'));
});

test('strict envelope validation rejects identity, indentation, relation, ordering, and seal drift', () => {
  const policy = loadFrontendIndentationPolicy();
  const valid = [
    policy.indentationFormat,
    ...record('observation', '0', '0', '0', '', 'initial', 'a'),
    ...record('seal', 'a'),
  ];
  assert.equal(parseIndentationEnvelope('a', textEnvelope(valid), policy).observations.length, 1);
  for (const [label, mutateFields] of [
    ['identity', (fields) => { fields[3] = '1'; }],
    ['indentation', (fields) => { fields[5] = ' '; }],
    ['relation', (fields) => { fields[6] = 'deeper'; }],
    ['content witness', (fields) => { fields[7] = 'x'; }],
    ['seal', (fields) => { fields[10] = 'stale'; }],
  ]) {
    const forged = [...valid];
    mutateFields(forged);
    assert.throws(() => parseIndentationEnvelope('a', textEnvelope(forged), policy), /rejection/u, label);
  }
  const postSeal = [...valid, ...record('observation', '1', '0', '0', '', 'same', 'a')];
  assert.throws(() => parseIndentationEnvelope('a', textEnvelope(postSeal), policy), /terminal seal|post-seal/u);
  const missing = [policy.indentationFormat, ...record('seal', 'a')];
  assert.throws(() => parseIndentationEnvelope('a', textEnvelope(missing), policy), /coverage drift/u);
});

test('blank, comment, raw, continuation, and incomplete records do not invent transitions', () => {
  const source = [
    'screen',
    '',
    '# note',
    '  text value="one',
    '          two"',
    'handler <<<',
    ' button',
    '   text value="open',
  ].join('\n');
  const result = executeFrontendIndentation(source);
  assert.deepEqual(result.observations.map((entry) => [entry.firstPhysicalIndex, entry.relation]), [
    [0, 'initial'],
    [3, 'deeper'],
    [6, 'shallower'],
  ]);
});

test('Unicode, physical-record, semantic-trim, and disabled-limit mutations are killed', () => {
  const source = loadIndentationSource();
  const indentAnchor = 'assign target=indent value="base[physicalOffset + 3]"';
  const unicodeTrim = mutate(
    source,
    indentAnchor,
    'assign target=indent value="Text.slice(base[physicalOffset + 2], 0, Text.length(base[physicalOffset + 2]) - Text.length(trimtoken(base[physicalOffset + 2])))"',
  );
  assert.throws(() => executeFrontendIndentation('\u000btext', undefined, unicodeTrim), /indentation .* drift/u);

  const semanticTrim = mutate(
    source,
    indentAnchor,
    'assign target=indent value="stitchindent(trimtoken(base[physicalOffset + 2]))"',
  );
  assert.throws(() => executeFrontendIndentation('  text', undefined, semanticTrim), /indentation .* drift/u);

  const physicalTransitions = mutate(
    source,
    'return value="tag == \\"group\\" && termination == \\"complete\\""',
    'return value="tag == \\"physical\\" || (tag == \\"group\\" && termination == \\"complete\\")"',
  );
  assert.throws(() => executeFrontendIndentation('a\n  b', undefined, physicalTransitions), /rejection|runtime/u);

  const unlimited = mutate(
    source,
    'if cond="observationIndex >= maxObservations"',
    'if cond="false"',
  );
  assert.throws(
    () => executeFrontendIndentation('a\nb', policyWith('maxObservations', 1), unlimited),
    /observation limit exceeded/u,
  );

  const partial = mutate(
    source,
    'for name=offset from=1 to="base.length" step=8',
    'for name=offset from=1 to="1" step=8',
  );
  assert.throws(() => executeFrontendIndentation('a', undefined, partial), /coverage drift/u);
});

test('first-record indentation changes evidence; continuation indentation does not add an observation', () => {
  const original = executeFrontendIndentation('  text value="one\n        two"');
  const firstChanged = executeFrontendIndentation(' text value="one\n        two"');
  const continuationChanged = executeFrontendIndentation('  text value="one\n two"');
  assert.notEqual(firstChanged.observations[0].indentBytes, original.observations[0].indentBytes);
  assert.equal(continuationChanged.observations.length, original.observations.length);
  assert.deepEqual(
    continuationChanged.observations.map((entry) => entry.relation),
    original.observations.map((entry) => entry.relation),
  );
});

test('standalone non-ASCII whitespace preserves the inherited tokenizer failure boundary', () => {
  assert.deepEqual(executeFrontendIndentation('\u00a0text'), failed('UNSUPPORTED_UNKNOWN'));
  assert.deepEqual(executeFrontendIndentation('\u2003text'), failed('UNSUPPORTED_UNKNOWN'));
});
