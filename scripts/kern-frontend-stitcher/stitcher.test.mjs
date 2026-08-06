import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  executeFrontendStitcher,
  loadStitcherSource,
  parseEnvelope,
  validateNativeStitcherSource,
} from '../check-kern-frontend-stitcher.mjs';
import { corpusDocuments, resolveStitcherCorpusPath } from './corpus.mjs';
import { normalizeStitchOracle } from './oracle.mjs';
import {
  loadFrontendStitcherPolicy,
  validateFrontendStitcherPolicy,
} from './policy.mjs';

const failed = (code) => ({ code, detail: '', status: 'failure' });

function policyWith(limit, value) {
  const policy = structuredClone(loadFrontendStitcherPolicy());
  policy.profileLimits[limit] = value;
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

function envelopeRecord(tag, ...fields) {
  return [tag, ...fields, ...Array(7 - fields.length).fill('')];
}

test('KERN owns a lossless multiline stitch decision and document-relative token tape', () => {
  const source = ['button disabled={{', '  ready', '}}'].join('\n');
  const result = executeFrontendStitcher(source);
  assert.equal(result.format, 'kern.frontend.stitch-shadow.1');
  assert.deepEqual(result.physical.map((record) => record.content), ['button disabled={{', '  ready', '}}']);
  assert.deepEqual(result.groups.map((group) => group.physicalIndexes), [[0, 1, 2]]);
  assert.equal(result.groups[0].termination, 'complete');
  assert.equal(result.groups[0].tokenizer.tokens[0].documentStartByte, 0);
});

test('policy rejects unknown fields, mutable raw profiles, and inconsistent bounds', () => {
  const policy = loadFrontendStitcherPolicy();
  assert.throws(() => validateFrontendStitcherPolicy({ ...policy, extra: true }), /exactly/u);
  assert.throws(
    () => validateFrontendStitcherPolicy({ ...policy, rawOpenerTypes: ['logic', 'handler'] }),
    /unique sorted/u,
  );
  assert.throws(
    () => validateFrontendStitcherPolicy({
      ...policy,
      profileLimits: { ...policy.profileLimits, maxGroupRecords: policy.profileLimits.maxPhysicalRecords + 1 },
    }),
    /fit maxPhysicalRecords/u,
  );
  assert.throws(
    () => validateFrontendStitcherPolicy({
      ...policy,
      corpus: [{ maxLines: 1, path: '../escape.kern', sha256: '0'.repeat(64) }],
    }),
    /contained examples/u,
  );
});

test('source-hashed corpus rejects digest drift, truncation, and symlink escape', () => {
  const root = mkdtempSync(join(tmpdir(), 'kern-stitch-corpus-'));
  try {
    const examples = join(root, 'examples');
    const outside = join(root, 'outside');
    mkdirSync(examples);
    mkdirSync(outside);
    writeFileSync(join(examples, 'corpus.kern'), 'one\ntwo\n');
    writeFileSync(join(outside, 'escape.kern'), 'escape\n');
    symlinkSync(outside, join(examples, 'link'));
    const policy = structuredClone(loadFrontendStitcherPolicy());
    policy.corpus = [{
      maxLines: 2,
      path: 'examples/corpus.kern',
      sha256: createHash('sha256').update('one\ntwo\n').digest('hex'),
    }];
    assert.equal(corpusDocuments(policy, root)[0].source, 'one\ntwo');
    policy.corpus[0].maxLines = 5;
    assert.throws(() => corpusDocuments(policy, root), /fewer than/u);
    policy.corpus[0].maxLines = 2;
    policy.corpus[0].sha256 = '0'.repeat(64);
    assert.throws(() => corpusDocuments(policy, root), /digest changed/u);
    assert.throws(() => resolveStitcherCorpusPath('examples/link/escape.kern', root), /beneath examples/u);
    writeFileSync(join(examples, 'corpus.kern'), 'one\nü\n');
    policy.corpus[0].sha256 = createHash('sha256').update('one\nü\n').digest('hex');
    assert.throws(() => corpusDocuments(policy, root), /outside the scalar-safe profile/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('native sources reject host delegation text and non-KERN handlers', () => {
  const source = loadStitcherSource();
  assert.doesNotMatch(source, /tokenizeLineInternal|parseDocument|executeKernRuntimeHandler|scanLineState/u);
  assert.throws(() => validateNativeStitcherSource(`${source}\n// parseDocument`), /delegation rejection/u);
  assert.throws(
    () => validateNativeStitcherSource(source.replace('handler lang="kern"', 'handler')),
    /every source handler/u,
  );
});

test('host admission fails closed for malformed strings and byte bounds', () => {
  assert.deepEqual(executeFrontendStitcher('\ud800'), failed('MALFORMED_UTF16'));
  assert.equal(executeFrontendStitcher('abc', policyWith('maxSourceBytes', 3)).format, 'kern.frontend.stitch-shadow.1');
  assert.deepEqual(executeFrontendStitcher('abcd', policyWith('maxSourceBytes', 3)), failed('SOURCE_BYTES_LIMIT'));
  assert.equal(executeFrontendStitcher('# 😀', policyWith('maxPhysicalRecordBytes', 6)).format, 'kern.frontend.stitch-shadow.1');
  assert.deepEqual(
    executeFrontendStitcher('# 😀a', policyWith('maxPhysicalRecordBytes', 6)),
    failed('PHYSICAL_RECORD_BYTES_LIMIT'),
  );
});

test('envelope ranges reject before allocation and token fields cannot precede their group', () => {
  const checkerUrl = new URL('../check-kern-frontend-stitcher.mjs', import.meta.url).href;
  const policyUrl = new URL('./policy.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, [
    '--max-old-space-size=32',
    '--input-type=module',
    '-e',
    [
      `import { parseEnvelope } from ${JSON.stringify(checkerUrl)};`,
      `import { loadFrontendStitcherPolicy } from ${JSON.stringify(policyUrl)};`,
      `const fields = ['kern.frontend.stitch-shadow.1',`,
      `  ...${JSON.stringify(envelopeRecord('physical', '0', 'a', '', '0', 'ordinary', 'a'))},`,
      `  ...${JSON.stringify(envelopeRecord('group', '0', '0', '4294967294', 'eof-unclosed', '1', '0'))},`,
      `  ...${JSON.stringify(envelopeRecord('seal', 'a'))}];`,
      `const value = { tag: 'list', value: fields.map((entry) => ({ tag: 'text', value: entry })) };`,
      `try { parseEnvelope('a', value, loadFrontendStitcherPolicy()); process.exitCode = 2; }`,
      `catch (error) { if (!/invalid group record/u.test(String(error))) throw error; }`,
    ].join('\n'),
  ], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.status, 0, child.stderr || `subprocess terminated by ${child.signal}`);

  const tokenizerFields = [
    'kern.frontend.tokenizer-shadow.2',
    'token', 'word', 'a', '',
    'seal', 'a', '', '',
  ];
  const reordered = [
    'kern.frontend.stitch-shadow.1',
    ...envelopeRecord('physical', '0', 'a', '', '0', 'ordinary', 'a'),
    ...tokenizerFields.flatMap((field, ordinal) => envelopeRecord('token-field', '0', String(ordinal), field)),
    ...envelopeRecord('group', '0', '0', '0', 'complete', '0', '0'),
    ...envelopeRecord('seal', 'a'),
  ];
  assert.throws(
    () => parseEnvelope('a', textEnvelope(reordered), loadFrontendStitcherPolicy()),
    /token fields must follow their group/u,
  );
});

test('classification matches ECMAScript trim-start whitespace at structural boundaries', () => {
  const policy = loadFrontendStitcherPolicy();
  const whitespace = [
    '\u0009', '\u000b', '\u000c', ' ', '\u00a0', '\u1680', '\u2000', '\u2001', '\u2002',
    '\u2003', '\u2004', '\u2005', '\u2006', '\u2007', '\u2008', '\u2009', '\u200a',
    '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff',
  ];
  for (const prefix of whitespace) {
    const commentSource = `text value="open\n${prefix}# boundary\nclose"`;
    const commentResult = executeFrontendStitcher(commentSource, policy);
    assert.deepEqual(commentResult, normalizeStitchOracle(commentSource, policy.rawOpenerTypes));
    assert.equal(commentResult.groups[0].termination, 'comment-boundary');

    const rawSource = `text value="open\n${prefix}handler${prefix}<<<\nclose"`;
    const rawResult = executeFrontendStitcher(rawSource, policy);
    assert.deepEqual(rawResult, normalizeStitchOracle(rawSource, policy.rawOpenerTypes));
    assert.equal(rawResult.groups[0].termination, 'raw-opener-boundary');
  }
});

test('KERN bounds physical framing at the exact admitted edge', () => {
  assert.equal(executeFrontendStitcher('abc', policyWith('maxCodePoints', 3)).format, 'kern.frontend.stitch-shadow.1');
  assert.deepEqual(executeFrontendStitcher('abcd', policyWith('maxCodePoints', 3)), failed('CODE_POINTS_LIMIT'));
  assert.equal(
    executeFrontendStitcher('abc', policyWith('maxPhysicalRecordCodePoints', 3)).format,
    'kern.frontend.stitch-shadow.1',
  );
  assert.deepEqual(
    executeFrontendStitcher('abcd', policyWith('maxPhysicalRecordCodePoints', 3)),
    failed('PHYSICAL_RECORD_CODE_POINTS_LIMIT'),
  );
  assert.equal(executeFrontendStitcher('a\nb', policyWith('maxPhysicalRecords', 2)).physical.length, 2);
  assert.deepEqual(
    executeFrontendStitcher('a\nb\nc', policyWith('maxPhysicalRecords', 2)),
    failed('PHYSICAL_RECORD_LIMIT'),
  );
});

test('KERN bounds groups, group records, depth, and raw opener candidates', () => {
  assert.equal(executeFrontendStitcher('a\nb', policyWith('maxGroups', 2)).groups.length, 2);
  assert.deepEqual(executeFrontendStitcher('a\nb\nc', policyWith('maxGroups', 2)), failed('GROUP_LIMIT'));
  assert.equal(executeFrontendStitcher('text value="\nopen', policyWith('maxGroupRecords', 2)).groups[0].physicalIndexes.length, 2);
  assert.deepEqual(
    executeFrontendStitcher('text value="\nopen\nstill', policyWith('maxGroupRecords', 2)),
    failed('GROUP_RECORD_LIMIT'),
  );
  assert.equal(executeFrontendStitcher('text value={{{{', policyWith('maxStitchDepth', 2)).groups[0].exprDepth, 2);
  assert.deepEqual(
    executeFrontendStitcher('text value={{{{{{', policyWith('maxStitchDepth', 2)),
    failed('STITCH_DEPTH_LIMIT'),
  );
  assert.equal(executeFrontendStitcher('handler <<<', policyWith('maxRawOpeners', 1)).physical.length, 1);
  assert.deepEqual(
    executeFrontendStitcher('handler <<<\nlogic <<<', policyWith('maxRawOpeners', 1)),
    failed('RAW_OPENER_LIMIT'),
  );
});

test('aggregate token, diagnostic, and envelope limits cannot reset per group', () => {
  assert.equal(executeFrontendStitcher('a\nb', policyWith('maxTokens', 2)).groups.length, 2);
  assert.deepEqual(executeFrontendStitcher('a\nb\nc', policyWith('maxTokens', 2)), failed('TOKEN_LIMIT'));
  assert.equal(executeFrontendStitcher('1.2n', policyWith('maxDiagnostics', 1)).groups.length, 1);
  assert.deepEqual(
    executeFrontendStitcher('1.2n\n2.3n', policyWith('maxDiagnostics', 1)),
    failed('DIAGNOSTIC_LIMIT'),
  );
  assert.equal(executeFrontendStitcher('a', policyWith('maxEnvelopeRecords', 12)).groups.length, 1);
  assert.deepEqual(
    executeFrontendStitcher('a', policyWith('maxEnvelopeRecords', 11)),
    failed('ENVELOPE_RECORD_LIMIT'),
  );
});

test('physical tape mutations are rejected before differential comparison', () => {
  const source = loadStitcherSource();
  assert.throws(
    () => executeFrontendStitcher('a\nb', undefined, mutate(source, 'for name=p from=0', 'for name=p from=1')),
    /invalid physical record shape or order|source reconstruction mismatch/u,
  );
  assert.throws(
    () => executeFrontendStitcher('a\nb', undefined, mutate(
      source,
      'assign target=extent value="extent + \\"\\\\n\\""',
      'assign target=extent value="extent"',
    )),
    /physical tape drift|source reconstruction/u,
  );
  assert.throws(
    () => executeFrontendStitcher('a\nb', undefined, mutate(
      source,
      'do value="out.push(String(p))"',
      'do value="out.push(String(contents.length - p - 1))"',
    )),
    /physical record shape or order|runtime rejection/u,
  );
});

test('stitch-decision mutations are killed for membership and structural boundaries', () => {
  const policy = loadFrontendStitcherPolicy();
  const source = loadStitcherSource();
  const multiline = 'text value="one\ntwo"';
  const noContinuation = mutate(
    source,
    'let name=state value="stitchscan(contents[recordIndex], 0)"',
    'let name=state value="0"',
  );
  assert.notDeepEqual(executeFrontendStitcher(multiline, policy, noContinuation), normalizeStitchOracle(multiline, policy.rawOpenerTypes));
  const commentSwallow = mutate(
    source,
    'if cond="nextClass == \\"file-comment-candidate\\""',
    'if cond="nextClass == \\"never-comment\\""',
  );
  assert.throws(
    () => executeFrontendStitcher('text value="open\n# " close\nnext', policy, commentSwallow),
    /swallowed a structural boundary/u,
  );
  const rawSwallow = mutate(
    source,
    'if cond="nextClass == \\"raw-opener-candidate\\""',
    'if cond="nextClass == \\"never-raw\\""',
  );
  assert.throws(
    () => executeFrontendStitcher('text value="open\nhandler <<<\nnext', policy, rawSwallow),
    /swallowed a structural boundary/u,
  );
});

test('constant, stale, and aggregate-limit mutations are killed', () => {
  const source = loadStitcherSource();
  const constantSource = [
    'fn name=stitchdocument returns="string[]" export=true',
    ...[
      ['source', 'string'], ['rawProfile', 'string'], ['maxCodePoints', 'number'],
      ['maxPhysicalRecords', 'number'], ['maxPhysicalRecordCodePoints', 'number'], ['maxGroups', 'number'],
      ['maxGroupRecords', 'number'], ['maxStitchDepth', 'number'], ['maxTokens', 'number'],
      ['maxDiagnostics', 'number'], ['maxEnvelopeRecords', 'number'], ['maxRawOpeners', 'number'],
    ].map(([name, type]) => `  param name=${name} type=${type}`),
    '  handler lang="kern"',
    '    return value="[\\"kern.frontend.stitch-shadow.1\\", \\"seal\\", \\"\\", \\"\\", \\"\\", \\"\\", \\"\\", \\"\\", \\"\\"]"',
  ].join('\n');
  assert.throws(
    () => executeFrontendStitcher('a', undefined, constantSource),
    /invalid terminal seal|source reconstruction mismatch/u,
  );
  const stale = mutate(source, 'do value="out.push(source)"', 'do value="out.push(\\"stale\\")"');
  assert.throws(() => executeFrontendStitcher('a', undefined, stale), /invalid terminal seal/u);
  const unlimited = mutate(
    source,
    'if cond="totalTokens > maxTokens"',
    'if cond="false"',
  );
  assert.throws(
    () => executeFrontendStitcher('a\nb\nc', policyWith('maxTokens', 2), unlimited),
    /aggregate token limit/u,
  );
  const unlimitedPhysical = mutate(
    source,
    'if cond="physicalIndex >= maxPhysicalRecords"',
    'if cond="false"',
  );
  assert.throws(
    () => executeFrontendStitcher('a\nb\nc', policyWith('maxPhysicalRecords', 2), unlimitedPhysical),
    /physical record limit/u,
  );
  const unlimitedRaw = mutate(
    source,
    'if cond="rawOpeners > maxRawOpeners"',
    'if cond="false"',
  );
  assert.throws(
    () => executeFrontendStitcher('handler <<<\nlogic <<<', policyWith('maxRawOpeners', 1), unlimitedRaw),
    /raw opener limit/u,
  );
});
