import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  corpusLines,
  executeTokenizer,
  loadTokenizerSource,
  normalizeBootstrap,
  validateNativeTokenizerSource,
  validateScalarSafeCorpus,
} from '../check-kern-frontend-tokenizer.mjs';
import {
  loadFrontendTokenizerPolicy,
  resolveFrontendTokenizerCorpusPath,
  validateFrontendTokenizerPolicy,
} from './policy.mjs';

test('frontend tokenizer policy rejects unknown and unsafe fields', () => {
  const policy = loadFrontendTokenizerPolicy();
  assert.throws(() => validateFrontendTokenizerPolicy({ ...policy, extra: true }), /must contain exactly/u);
  assert.throws(
    () => validateFrontendTokenizerPolicy({ ...policy, profileLimits: { ...policy.profileLimits, maxTokens: 0 } }),
    /positive safe integer/u,
  );
  assert.throws(
    () => validateFrontendTokenizerPolicy({
      ...policy,
      runtimeLimits: { ...policy.runtimeLimits, maxCollectionLength: 4 },
    }),
    /must cover records plus the terminal seal/u,
  );
  assert.throws(
    () => validateFrontendTokenizerPolicy({
      ...policy,
      profileLimits: { ...policy.profileLimits, maxRecords: policy.profileLimits.maxTokens },
    }),
    /must cover tokens plus diagnostics/u,
  );
  assert.throws(
    () => validateFrontendTokenizerPolicy({
      ...policy,
      profileLimits: {
        ...policy.profileLimits,
        maxOutputJsonBytes: policy.runtimeLimits.maxBytes + 1,
      },
    }),
    /must not exceed runtimeLimits.maxBytes/u,
  );
  assert.throws(
    () => validateFrontendTokenizerPolicy({
      ...policy,
      corpus: [{ maxLines: 1, path: '../outside.kern' }],
    }),
    /contained examples/u,
  );
  for (const path of [
    'examples/%2e%2e/outside.kern',
    'examples/inside?ignored=.kern',
    'examples/inside#ignored=.kern',
  ]) {
    assert.throws(
      () => validateFrontendTokenizerPolicy({
        ...policy,
        corpus: [{ maxLines: 1, path }],
      }),
      /contained examples/u,
    );
  }
});

test('frontend tokenizer corpus resolution rejects a symlink escape', () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'kern-frontend-tokenizer-'));
  try {
    const examplesRoot = join(repositoryRoot, 'examples');
    const outsideRoot = join(repositoryRoot, 'outside');
    mkdirSync(examplesRoot);
    mkdirSync(outsideRoot);
    writeFileSync(join(outsideRoot, 'escape.kern'), 'fn name=escape\n');
    symlinkSync(outsideRoot, join(examplesRoot, 'link'));
    assert.throws(
      () => resolveFrontendTokenizerCorpusPath('examples/link/escape.kern', repositoryRoot),
      /must resolve beneath/u,
    );
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test('frontend tokenizer corpus is bounded before tokenization and cannot shrink silently', () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'kern-frontend-tokenizer-bounds-'));
  try {
    const examplesRoot = join(repositoryRoot, 'examples');
    mkdirSync(examplesRoot);
    const policy = loadFrontendTokenizerPolicy();
    policy.corpus = [{ maxLines: 2, path: 'examples/corpus.kern' }];

    writeFileSync(join(examplesRoot, 'corpus.kern'), 'alpha');
    assert.throws(() => corpusLines(policy, repositoryRoot), /supplies fewer than 2 lines/u);

    policy.corpus[0].maxLines = 1;
    writeFileSync(
      join(examplesRoot, 'corpus.kern'),
      'x'.repeat(policy.profileLimits.maxSourceBytes + 2),
    );
    assert.throws(() => corpusLines(policy, repositoryRoot), /derived file byte ceiling/u);

    policy.corpus[0].maxLines = 2;
    writeFileSync(
      join(examplesRoot, 'corpus.kern'),
      `${'x'.repeat(policy.profileLimits.maxSourceBytes + 1)}\n`,
    );
    assert.throws(() => corpusLines(policy, repositoryRoot), /selected line above maxSourceBytes/u);
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test('frontend tokenizer source is native KERN and contains no host delegation', () => {
  const source = loadTokenizerSource();
  assert.match(source, /fn name=tokenizeline/u);
  assert.doesNotMatch(source, /tokenizeLineInternal|parseDocument|executeKernRuntimeHandler|capability/u);
  assert.throws(
    () => validateNativeTokenizerSource(source.replace('handler lang="kern"', 'handler')),
    /every source handler must be native KERN/u,
  );
});

test('scalar-safe admission rejects malformed bootstrap token slices', () => {
  assert.deepEqual(
    executeTokenizer('{{😀'),
    { code: 'UNSUPPORTED_UTF16_SLICE', detail: '', status: 'failure' },
  );
});

test('policy-owned corpus admission fails instead of silently filtering', () => {
  assert.deepEqual(validateScalarSafeCorpus(['alpha']), ['alpha']);
  assert.throws(
    () => validateScalarSafeCorpus(['alpha', 'é']),
    /policy-selected lines are outside the scalar-safe profile/u,
  );
});

test('expression values use the complete ECMAScript trim set', () => {
  const trimCodePoints = [
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680,
    0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
    0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
    0x205f, 0x3000, 0xfeff,
  ];
  for (const codePoint of trimCodePoints) {
    const whitespace = String.fromCodePoint(codePoint);
    const source = `{{${whitespace}value${whitespace}}}`;
    assert.deepEqual(
      executeTokenizer(source),
      { ...normalizeBootstrap(source), status: 'success' },
      `U+${codePoint.toString(16).padStart(4, '0')}`,
    );
  }
});

test('ASCII controls and DEL preserve bootstrap token parity', () => {
  for (const codePoint of [...Array.from({ length: 32 }, (_, value) => value), 0x7f]) {
    const source = String.fromCodePoint(codePoint);
    assert.deepEqual(
      executeTokenizer(source),
      { ...normalizeBootstrap(source), status: 'success' },
      `U+${codePoint.toString(16).padStart(4, '0')}`,
    );
  }
});

test('token-kind and diagnostic mutations cannot masquerade as parity', () => {
  const policy = loadFrontendTokenizerPolicy();
  const source = loadTokenizerSource();
  const kindMutation = source.replace('out.push(\\"identifier\\")', 'out.push(\\"unknown\\")');
  assert.notEqual(kindMutation, source);
  const kindResult = executeTokenizer('alpha', policy, kindMutation);
  assert.notDeepEqual(kindResult, { ...normalizeBootstrap('alpha'), status: 'success' });

  const diagnosticMutation = source.replace('UNCLOSED_STRING', 'UNCLOSED_STYLE');
  assert.notEqual(diagnosticMutation, source);
  const diagnosticResult = executeTokenizer('"open', policy, diagnosticMutation);
  assert.notDeepEqual(diagnosticResult, { ...normalizeBootstrap('"open'), status: 'success' });
});

test('constant, reordered, and dropped-diagnostic mutations cannot masquerade as parity', () => {
  const policy = loadFrontendTokenizerPolicy();
  const source = loadTokenizerSource();
  const constantMutation = source.replace(
    /    return value="out"\n$/u,
    '    return value="[\\"kern.frontend.tokenizer-shadow.2\\"]"\n',
  );
  assert.notEqual(constantMutation, source);
  assert.throws(() => executeTokenizer('alpha', policy, constantMutation), /terminal seal/u);

  const reorderedMutation = source.replace(
    'do value="out.push(identifierValue)"\n        do value="out.push(Text.slice(line, boundaryStart, identifierStart))"',
    'do value="out.push(Text.slice(line, boundaryStart, identifierStart))"\n        do value="out.push(identifierValue)"',
  );
  assert.notEqual(reorderedMutation, source);
  assert.throws(() => executeTokenizer('alpha', policy, reorderedMutation), /record rejection/u);

  const droppedDiagnosticMutation = source.replace('if cond="i >= n"', 'if cond="i > n"');
  assert.notEqual(droppedDiagnosticMutation, source);
  assert.notDeepEqual(
    executeTokenizer('"open', policy, droppedDiagnosticMutation),
    { ...normalizeBootstrap('"open'), status: 'success' },
  );
});

test('many consecutive style tokens remain inside the declared runtime envelope', () => {
  const policy = loadFrontendTokenizerPolicy();
  const source = '{}'.repeat(64);
  assert.deepEqual(
    executeTokenizer(source, policy),
    { ...normalizeBootstrap(source), status: 'success' },
  );
});

test('maximum-token output stays inside the encoded envelope ceiling', () => {
  const policy = loadFrontendTokenizerPolicy();
  const source = '$a'.repeat(policy.profileLimits.maxTokens);
  const metrics = {};
  const result = executeTokenizer(source, policy, undefined, metrics);
  assert.equal(result.status, 'success');
  assert.equal(result.tokens.length, policy.profileLimits.maxTokens);
  assert.equal(metrics.coveredSourceBytes, Buffer.byteLength(source, 'utf8'));
  assert.ok(metrics.outputJsonBytes <= policy.profileLimits.maxOutputJsonBytes);

  const exactPolicy = structuredClone(policy);
  exactPolicy.profileLimits.maxOutputJsonBytes = metrics.outputJsonBytes;
  assert.equal(executeTokenizer(source, exactPolicy).status, 'success');
  const belowPolicy = structuredClone(exactPolicy);
  belowPolicy.profileLimits.maxOutputJsonBytes -= 1;
  assert.throws(() => executeTokenizer(source, belowPolicy), /OUTPUT_JSON_BYTES_LIMIT/u);
});

test('maximum record mix and boundary-tape mutations fail closed', () => {
  const policy = loadFrontendTokenizerPolicy();
  const diagnosticCount = policy.profileLimits.maxDiagnostics;
  const source = `${'1.2n'.repeat(diagnosticCount)}${'@'.repeat(policy.profileLimits.maxTokens - diagnosticCount)}`;
  const metrics = {};
  const result = executeTokenizer(source, policy, undefined, metrics);
  assert.equal(result.tokens.length, policy.profileLimits.maxTokens);
  assert.equal(result.diagnostics.length, diagnosticCount);
  assert.equal(result.tokens.length + result.diagnostics.length, policy.profileLimits.maxRecords);
  assert.equal(metrics.coveredSourceBytes, Buffer.byteLength(source, 'utf8'));
  assert.ok(metrics.outputJsonBytes <= policy.profileLimits.maxOutputJsonBytes);

  const kernSource = loadTokenizerSource();
  const changedDelta = kernSource.replace(
    'out.push(Text.slice(line, boundaryStart, identifierStart))',
    'out.push(\\"x\\")',
  );
  assert.notEqual(changedDelta, kernSource);
  assert.throws(() => executeTokenizer('alpha', policy, changedDelta), /start delta/u);

  const changedSeal = kernSource.replace(
    'out.push(Text.slice(line, boundaryStart, n))',
    'out.push(\\"x\\")',
  );
  assert.notEqual(changedSeal, kernSource);
  assert.throws(() => executeTokenizer('alpha', policy, changedSeal), /seal does not cover/u);
});
