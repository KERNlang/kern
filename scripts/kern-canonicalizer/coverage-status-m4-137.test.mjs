import assert from 'node:assert/strict';
import test from 'node:test';

import { measureCanonicalizerCoverage } from './coverage.mjs';
import { assertM4137NewExpressionPromotion } from './coverage-m4-137-central.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';

test('M4.137 status binds the exact promoted base and exception-flow handoff', () => {
  assert.equal(
    assertM4137NewExpressionPromotion(
      measureCanonicalizerCoverage(),
      measureCanonicalizerPrerequisite(),
    ),
    'M4.137 promotes new-expression through the exact M4.136 provenance and advances ' +
      'the cumulative base to 109/112; exception-flow is the sole selected prerequisite ' +
      '(2 catalog facts/34 occurrences; 1 canonicalize function/15 rows); ' +
      'M4.138 owns the exception-flow prerequisite handoff.',
  );
});
