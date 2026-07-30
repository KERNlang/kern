import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatM4145CombinedHeadroomStatus,
} from './coverage-status-m4-145.mjs';
import {
  loadCanonicalizerCombinedHeadroomM4145,
} from './combined-headroom-m4-145.mjs';

const STATUS =
  'M4.145 authenticates combined KIR/profile structural safety and exact floor ' +
  '43054 with 6098 promotion-budget and 22482 production headroom; M4.146 ' +
  'promotes the exact candidate and publishes the expressionsources queue.';

test('M4.145 status reports exact promotion and queue handoff', () => {
  const RECEIPT = loadCanonicalizerCombinedHeadroomM4145();
  assert.equal(formatM4145CombinedHeadroomStatus(RECEIPT), STATUS);
});

test('M4.145 status rejects every material drift and decorated data', () => {
  const RECEIPT = loadCanonicalizerCombinedHeadroomM4145();
  for (const mutate of [
    (copy) => { copy.limits.candidateKir.maxDepth -= 1; },
    (copy) => { copy.limits.candidateProfile.maxValueRows -= 1; },
    (copy) => { copy.promotion.combinedPromotionApproved = false; },
    (copy) => { copy.promotion.promotionBudgetHeadroom -= 1; },
    (copy) => { copy.promotion.productionHeadroom -= 1; },
    (copy) => { copy.promotion.nextMilestone = 'M4.147'; },
    (copy) => { copy.summary.maxExactFloor -= 1; },
    (copy) => { copy.summary.totalParameterRows -= 1; },
    (copy) => { copy.witnesses[0].id = 'quotesource'; },
    (copy) => { copy.witnesses[0].floorOutcome = 'failure'; },
    (copy) => { copy.witnesses[0].roundTrip = false; },
    (copy) => { copy.witnesses[0].observerParityVerified = false; },
    (copy) => { copy.witnesses[0].publicParityVerified = false; },
  ]) {
    const copy = structuredClone(RECEIPT);
    mutate(copy);
    assert.throws(
      () => formatM4145CombinedHeadroomStatus(copy),
      /M4\.145 status requires the exact combined headroom GO/u,
    );
  }
  const decorated = structuredClone(RECEIPT);
  decorated.future = true;
  assert.throws(
    () => formatM4145CombinedHeadroomStatus(decorated),
    /M4\.145 status requires the exact combined headroom GO/u,
  );
});
