import assert from 'node:assert/strict';
import test from 'node:test';

import { isVerifiedKernProjection, projectKernModules, verifyKernProjection } from '../dist/frontend-projection.js';

const request = {
  modules: [
    {
      moduleId: 'projection-test.kern',
      source: [
        'fn name=projectionTest returns=string export=true',
        '  param name=id type=string',
        '  handler lang="kern"',
        '    return value="id"',
        '',
      ].join('\n'),
    },
  ],
};

test('supported frontend projection brands only receipt-verified immutable artifacts', async () => {
  const projected = await projectKernModules(request);
  assert.equal(projected.status, 'projected');
  if (projected.status !== 'projected') return;
  assert.equal(isVerifiedKernProjection(projected), false);

  const verified = await verifyKernProjection(request, projected);
  assert.equal(isVerifiedKernProjection(verified), true);
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(Object.isFrozen(verified.artifact), true);
  verified.bytes[0] ^= 1;
  assert.equal(isVerifiedKernProjection(verified), false);
});

test('supported frontend projection rejects invalid requests atomically', async () => {
  const result = await projectKernModules({ modules: [] });
  assert.equal(result.status, 'rejected');
  assert.equal(result.bytes, null);
  assert.equal(result.artifact, null);
  assert.deepEqual(
    result.diagnostics.map(({ code }) => code),
    ['projection-request-invalid'],
  );
});
