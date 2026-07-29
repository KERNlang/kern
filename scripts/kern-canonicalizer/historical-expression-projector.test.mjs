import assert from 'node:assert/strict';
import test from 'node:test';

import { StructuralKirError } from '../../packages/core/dist/kir-structural/types.js';
import { projectCoverageExpression } from './historical-expression-projector.mjs';

test('pre-M4.135 expression projection normalizes parser failures', () => {
  assert.throws(
    () => projectCoverageExpression('(', '$.expression', true),
    (error) =>
      error instanceof StructuralKirError &&
      error.code === 'invalid-expression' &&
      error.path === '$.expression',
  );
});
