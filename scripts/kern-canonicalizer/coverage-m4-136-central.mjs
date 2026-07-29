import assert from 'node:assert/strict';

import { assertM4135BoundedNewExpression } from './coverage-m4-135-central.mjs';
import { loadCanonicalizerNewExpressionPrerequisiteProvenance } from
  './coverage-prerequisite-provenance.mjs';
import { formatM4136NewExpressionHandoffStatus } from './coverage-status-m4-136.mjs';

export function assertM4136NewExpressionHandoff(coverage, prerequisite) {
  assert.match(
    assertM4135BoundedNewExpression(coverage, prerequisite),
    /^M4\.135 publishes bounded new-expression/u,
  );
  const handoff = loadCanonicalizerNewExpressionPrerequisiteProvenance();
  assert.deepEqual(handoff.record.source, {
    commit: '5c5e80fe03f9664ffb2cd87b513b7dfe3d9d867c',
    coverageSummaryFormat: 'kern.kir-canonicalizer.coverage-summary.6',
    coverageSummarySha256: 'b54ea0da184be397ff995d3ffce4ee4be425cd2751de5089543a246be3c7c522',
    prerequisiteSummaryFormat: 'kern.kir-canonicalizer.prerequisite-summary.3',
    prerequisiteSummarySha256: '019ca1548ad46208c8b34b31cbd5d9bb4d140b4888a9992731a286cfde464a5b',
  });
  assert.equal(coverage.base.id, 'kern.kir-canonicalizer.profile.m4.60');
  assert.deepEqual(coverage.base.expressionKinds.includes('new'), false);
  assert.deepEqual(coverage.selection.winner?.id, 'new-expression');
  assert.deepEqual(prerequisite.selectedPrerequisite, {
    catalogFacts: 1,
    family: 'new-expression',
    occurrences: 41,
  });
  return formatM4136NewExpressionHandoffStatus(handoff);
}
