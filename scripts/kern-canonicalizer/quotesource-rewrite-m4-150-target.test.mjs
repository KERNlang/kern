import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadCoveragePolicy } from './coverage.mjs';
import {
  M4150_CANDIDATE_PREDICATE,
  M4150_CURRENT_PREDICATE,
  PRE_M4150_COVERAGE_POLICY_DIGEST,
  PRE_M4150_EXPRESSION_HELPERS_DIGEST,
  QUOTESOURCE_M4150_SOURCE_REPLACEMENT,
  readExactM4150ExpressionHelpers,
  reconstructPreM4150CoverageInputs,
  reconstructPreM4150ExpressionHelpers,
} from './quotesource-rewrite-m4-150-target.mjs';
import { assertM4150QuotesourceRewrite } from './quotesource-rewrite-m4-150.mjs';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('M4.150 authenticates one reversible source and policy transition', () => {
  const currentSource = readExactM4150ExpressionHelpers();
  assert.equal(
    digest(reconstructPreM4150ExpressionHelpers(currentSource)),
    PRE_M4150_EXPRESSION_HELPERS_DIGEST,
  );
  assert.equal(
    QUOTESOURCE_M4150_SOURCE_REPLACEMENT.current,
    `                if cond=${JSON.stringify(M4150_CANDIDATE_PREDICATE)}\n`,
  );
  assert.equal(
    QUOTESOURCE_M4150_SOURCE_REPLACEMENT.historical,
    `                if cond=${JSON.stringify(M4150_CURRENT_PREDICATE)}\n`,
  );
  const policySource = readFileSync(
    new URL('./coverage-policy.json', import.meta.url),
    'utf8',
  );
  const historical = reconstructPreM4150CoverageInputs(
    loadCoveragePolicy(),
    policySource,
  );
  assert.equal(digest(historical.policySource), PRE_M4150_COVERAGE_POLICY_DIGEST);
  assert.equal(
    historical.policy.corpus.find(({ path }) =>
      path === 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern').digest,
    PRE_M4150_EXPRESSION_HELPERS_DIGEST,
  );
});

test('M4.150 rewrite handoff binds exact input, source, composition, and next action', () => {
  assert.deepEqual(assertM4150QuotesourceRewrite(), {
    format: 'kern.kir-canonicalizer.quotesource-rewrite.1',
    input: {
      m4149Digest: 'bca47b2e75cd13cbbaa3b54e7e98e92f515e44f15cf92e3edea8c8c6bf59dc1d',
      m4149InputCommit: '44ca4feda2901c16f79c7c5c40ede69394e60404',
      m4150InputCommit: '864017b4200a6a3bc51b8d9e30cc61145eef6951',
    },
    parameterMigration: {
      completeFunctions: 1,
      completeTools: 1,
      migratedParameterRows: 2,
      witnesses: [{
        id: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
        parameterRows: 2,
        profileRows: { nodes: 54, properties: 82, values: 932 },
        tool: 'canonicalizer',
      }],
    },
    selectedNextAction: {
      action: 'consume-exact-parameter-queue',
      milestone: 'M4.151',
      witness: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
    },
    source: {
      afterDigest: '2073ed0c915c0375a43accc202e1c99ceacef84ec1972ef2fc6d25ebcdf7986a',
      beforeDigest: PRE_M4150_EXPRESSION_HELPERS_DIGEST,
      path: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
      predicate: M4150_CANDIDATE_PREDICATE,
    },
  });
});

test('M4.150 historical reconstruction rejects source and policy drift', () => {
  const currentSource = readExactM4150ExpressionHelpers();
  assert.throws(
    () => reconstructPreM4150ExpressionHelpers(
      Buffer.concat([currentSource, Buffer.from('# drift\n')]),
    ),
    /pre-M4\.150 expression helpers historical source rejection/u,
  );
  const policy = loadCoveragePolicy();
  const source = readFileSync(new URL('./coverage-policy.json', import.meta.url), 'utf8');
  const drifted = structuredClone(policy);
  drifted.corpus[0].tool = 'future';
  assert.throws(
    () => reconstructPreM4150CoverageInputs(drifted, source),
    /M4\.150 quotesource target rejection/u,
  );
  assert.throws(
    () => reconstructPreM4150CoverageInputs(policy, `${source} `),
    /M4\.150 quotesource target rejection/u,
  );
});
