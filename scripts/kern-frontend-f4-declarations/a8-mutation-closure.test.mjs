import assert from 'node:assert/strict';
import test from 'node:test';

import {
  A8_FAMILY_IDS,
  runA8AdditionalControls,
  runA8MutationMatrix,
} from './a8-test-support.mjs';

const EXPECTED_KILLERS = Object.freeze({
  'A8-F1': 'F4_F2B_DRIFT',
  'A8-F2': 'source-ownership-rejection',
  'A8-F3': 'source-closure-rejection',
  'A8-F4': 'F4_AUTHORITY_DRIFT',
  'A8-F5': 'independent-oracle-mismatch',
  'A8-F6': 'decoder-atomicity-rejection',
  'A8-F7': 'm2-reference-mismatch',
  'A8-F8': 'resource-and-source-rejection',
  'A8-F9': 'decoder-seal-rejection',
});

test('A8 RED: every mutation family is reached and killed only by its designated oracle', async () => {
  const expectedIds = Object.keys(EXPECTED_KILLERS);
  assert.deepEqual(A8_FAMILY_IDS, expectedIds, 'the executable registry is exactly A8-F1 through A8-F9');
  const reports = await runA8MutationMatrix();
  assert.deepEqual(reports.map(({ id }) => id), expectedIds, 'every registered family is attempted exactly once');
  for (const report of reports) {
    assert.equal(report.control, 'passed', `${report.id}: pristine control`);
    assert.equal(report.sentinel, 'reached', `${report.id}: target reachability`);
    assert.ok(report.envelope === 'success' || report.envelope === 'not-applicable',
      `${report.id}: runtime crashes cannot count as kills`);
    assert.equal(report.killedBy, EXPECTED_KILLERS[report.id], `${report.id}: exact designated killer`);
  }
});

test('A8 RED: permutation, skew, stale authority, C13, and oracle canaries are complete', async () => {
  assert.deepEqual(await runA8AdditionalControls(), {
    permutationsGenerated: 20,
    permutationsAttempted: 20,
    permutationsMatched: 20,
    compositionSkewRejected: true,
    staleAuthorityRejected: true,
    c13ClaimMutationsRejected: 6,
    oracleCanariesRejected: 4,
  });
});
