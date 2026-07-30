import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadCoveragePolicy } from './coverage.mjs';
import {
  loadPreM4124CoverageInputs,
  loadPreM4131CoverageInputs,
  loadPreM4142CoverageInputs,
} from './historical-parameter-sources.mjs';

const CANONICALIZER_PATH = 'examples/kern-canonicalizer/canonicalizer.kern';
const PRE_M4142_CANONICALIZER_DIGEST =
  '959481ea210be8b1740400fe53ed999f08c61232de7855457f54a21f43213b0c';
const PRE_M4142_POLICY_DIGEST =
  '2091c8c213efd5b006bc22f183f47bd7a651ec21779efe66b1670b1019fbaaf0';
const CHECKER_PATH = 'examples/capstone-checker-subset/checker.kern';
const PRE_M4124_CHECKER_DIGEST =
  '934608ea0793197402a48e331142129edb98b26256f48fa897285badbd1d4add';
const PRE_M4124_POLICY_DIGEST =
  'bb64551fcdbacd85759a86f9cd7703ffe7fa14505cfe1a935223d7fe2b953534';
const VALIDATOR_PATH = 'examples/selfhost-validator/validator.kern';
const PRE_M4131_VALIDATOR_DIGEST =
  '96a1c96800132f2401d743eac02f0efe8cb0717980ceb56c2af531798790eaac';
const PRE_M4131_POLICY_DIGEST =
  'dcc9cc2db3478bd92370a373cf519ef192365bc8181bc5c726a9cce5bd4d80d6';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('pre-M4.142 inputs reconstruct only the archived canonicalize signature', () => {
  const currentPolicy = loadCoveragePolicy();
  const historical = loadPreM4142CoverageInputs(currentPolicy);
  const currentSource = readFileSync(new URL(`../../${CANONICALIZER_PATH}`, import.meta.url));
  const historicalSource = historical.sourceOverrides.get(CANONICALIZER_PATH);

  assert.equal(historical.coveragePolicyDigest, PRE_M4142_POLICY_DIGEST);
  assert.equal(digest(historical.coveragePolicySource), PRE_M4142_POLICY_DIGEST);
  assert.equal(
    historical.policy.corpus.find(({ path }) => path === CANONICALIZER_PATH)?.digest,
    PRE_M4142_CANONICALIZER_DIGEST,
  );
  assert.equal(digest(historicalSource), PRE_M4142_CANONICALIZER_DIGEST);
  assert.match(
    currentSource.toString('utf8'),
    /fn name=canonicalize returns=string\[\] export=true\n  param name=nodeKind/u,
  );
  assert.match(
    historicalSource.toString('utf8'),
    /fn name=canonicalize params="nodeKind:string\[\],nodeParent:number\[\]/u,
  );
  assert.doesNotMatch(
    historicalSource.toString('utf8'),
    /fn name=canonicalize returns=string\[\] export=true\n  param name=nodeKind/u,
  );
});

test('pre-M4.131 inputs reconstruct only the archived validate signature', () => {
  const currentPolicy = loadCoveragePolicy();
  const historical = loadPreM4131CoverageInputs(currentPolicy);
  const currentSource = readFileSync(new URL(`../../${VALIDATOR_PATH}`, import.meta.url));
  const historicalSource = historical.sourceOverrides.get(VALIDATOR_PATH);

  assert.equal(historical.coveragePolicyDigest, PRE_M4131_POLICY_DIGEST);
  assert.equal(digest(historical.coveragePolicySource), PRE_M4131_POLICY_DIGEST);
  assert.equal(
    historical.policy.corpus.find(({ path }) => path === VALIDATOR_PATH)?.digest,
    PRE_M4131_VALIDATOR_DIGEST,
  );
  assert.equal(digest(historicalSource), PRE_M4131_VALIDATOR_DIGEST);
  assert.match(
    currentSource.toString('utf8'),
    /fn name=validate returns=string\[\] export=true\n  param name=schemaVersion/u,
  );
  assert.match(
    historicalSource.toString('utf8'),
    /fn name=validate params="schemaVersion:number,moduleId:number\[\]/u,
  );
  assert.doesNotMatch(
    historicalSource.toString('utf8'),
    /fn name=validate returns=string\[\] export=true\n  param name=schemaVersion/u,
  );
});

test('pre-M4.131 inputs reject unrelated live policy drift', () => {
  for (const mutate of [
    (copy) => {
      copy.corpus.find(({ path }) => path === VALIDATOR_PATH).digest = '0'.repeat(64);
    },
    (copy) => { copy.base.id = `${copy.base.id}-drift`; },
    (copy) => { copy.corpus[0].tool = 'substituted'; },
  ]) {
    const drifted = structuredClone(loadCoveragePolicy());
    mutate(drifted);
    assert.throws(
      () => loadPreM4131CoverageInputs(drifted),
      /pre-M4\.142 coverage rejection: caller policy must match repository policy/u,
    );
  }
});

test('pre-M4.124 inputs reconstruct only the archived rejectLine signature', () => {
  const currentPolicy = loadCoveragePolicy();
  const historical = loadPreM4124CoverageInputs(currentPolicy);
  const currentSource = readFileSync(new URL(`../../${CHECKER_PATH}`, import.meta.url));
  const historicalSource = historical.sourceOverrides.get(CHECKER_PATH);

  assert.equal(historical.coveragePolicyDigest, PRE_M4124_POLICY_DIGEST);
  assert.equal(
    historical.policy.corpus.find(({ path }) => path === CHECKER_PATH)?.digest,
    PRE_M4124_CHECKER_DIGEST,
  );
  assert.equal(digest(historicalSource), PRE_M4124_CHECKER_DIGEST);
  assert.match(
    currentSource.toString('utf8'),
    /fn name=rejectLine returns=string export=true\n  param name=path/u,
  );
  assert.match(
    historicalSource.toString('utf8'),
    /fn name=rejectLine params="path:string,line:number,col:number,code:string,detail:string" returns=string/u,
  );
  assert.doesNotMatch(
    historicalSource.toString('utf8'),
    /fn name=rejectLine returns=string export=true\n  param name=path type=string/u,
  );
});

test('pre-M4.124 inputs reject unrelated live policy drift', () => {
  for (const mutate of [
    (copy) => {
      copy.corpus.find(({ path }) => path === CHECKER_PATH).digest = '0'.repeat(64);
    },
    (copy) => { copy.base.id = `${copy.base.id}-drift`; },
    (copy) => { copy.corpus[0].tool = 'substituted'; },
  ]) {
    const drifted = structuredClone(loadCoveragePolicy());
    mutate(drifted);
    assert.throws(
      () => loadPreM4124CoverageInputs(drifted),
      /pre-M4\.124 coverage rejection: caller policy must match repository policy/u,
    );
  }
});
