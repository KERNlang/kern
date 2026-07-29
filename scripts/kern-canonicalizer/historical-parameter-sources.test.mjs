import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadCoveragePolicy } from './coverage.mjs';
import { loadPreM4124CoverageInputs } from './historical-parameter-sources.mjs';

const CHECKER_PATH = 'examples/capstone-checker-subset/checker.kern';
const PRE_M4124_CHECKER_DIGEST =
  '934608ea0793197402a48e331142129edb98b26256f48fa897285badbd1d4add';
const PRE_M4124_POLICY_DIGEST =
  'bb64551fcdbacd85759a86f9cd7703ffe7fa14505cfe1a935223d7fe2b953534';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

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
