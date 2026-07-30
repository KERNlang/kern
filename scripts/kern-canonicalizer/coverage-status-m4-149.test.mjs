import assert from 'node:assert/strict';
import test from 'node:test';

import { formatM4149CanonicalSurfaceStatus } from './coverage-status-m4-149.mjs';

const action = {
  action: 'replace-exact-quotesource-predicate',
  id: 'quotesource-neighbor-sentinel-rewrite',
  milestone: 'M4.150',
};
const equivalence = { mismatches: 0, scalarValuesEvaluated: 1_112_064 };

test('M4.149 status reports the exact M4.150 source-rewrite handoff', () => {
  assert.equal(
    formatM4149CanonicalSurfaceStatus(action, equivalence),
    'M4.149 selects the exact quotesource neighbor-sentinel rewrite with zero profile blockers ' +
      'and 0 mismatches across 1112064 Unicode scalar values; M4.150 owns the KERN source rewrite.',
  );
  for (const [nextAction, nextEquivalence] of [
    [null, equivalence],
    [{ ...action, id: 'new-text-primitive' }, equivalence],
    [{ ...action, milestone: 'M4.151' }, equivalence],
    [action, { ...equivalence, mismatches: 1 }],
    [action, { ...equivalence, scalarValuesEvaluated: 1_112_063 }],
  ]) {
    assert.throws(
      () => formatM4149CanonicalSurfaceStatus(nextAction, nextEquivalence),
      /M4\.149 canonical-surface analysis must select the exact M4\.150 rewrite/u,
    );
  }
});
