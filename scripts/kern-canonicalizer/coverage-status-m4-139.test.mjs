import assert from 'node:assert/strict';
import test from 'node:test';

import { measureCanonicalizerCoverage } from './coverage.mjs';
import { assertM4139BoundedExceptionFlow } from './coverage-m4-139-central.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';

test('M4.139 binds bounded valued-throw implementation to the exact live frontier', () => {
  assert.equal(
    assertM4139BoundedExceptionFlow(
      measureCanonicalizerCoverage(),
      measureCanonicalizerPrerequisite(),
    ),
    'M4.139 publishes bounded valued-throw validation and canonical emission; ' +
      'the M4.137 base remains 109/112 and exception-flow remains the exact ' +
      '2-fact/34-occurrence prerequisite for canonicalize (1 function/15 rows); ' +
      'M4.140 owns the immutable implementation handoff.',
  );
});

test('M4.139 rejects live base and prerequisite drift', () => {
  const coverage = measureCanonicalizerCoverage();
  const prerequisite = measureCanonicalizerPrerequisite();
  const changedCoverage = structuredClone(coverage);
  changedCoverage.baseCompleteFunctions = 110;
  assert.throws(
    () => assertM4139BoundedExceptionFlow(changedCoverage, prerequisite),
  );
  const changedPrerequisite = structuredClone(prerequisite);
  changedPrerequisite.selectedPrerequisite.occurrences = 35;
  assert.throws(
    () => assertM4139BoundedExceptionFlow(coverage, changedPrerequisite),
  );
});
