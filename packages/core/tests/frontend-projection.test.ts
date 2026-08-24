import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { normalizeProjectionRequest } from '../dist/frontend-projection/contracts.js';
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
const require = createRequire(import.meta.url);
const assetLimits = require('../dist/frontend-projection-assets/adapter.cjs').limits;

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

test('verification rejects an exact detached substitute that was never issued by projectKernModules', async () => {
  const projected = await projectKernModules(request);
  assert.equal(projected.status, 'projected');
  if (projected.status !== 'projected') return;
  const changedRequest = structuredClone(request);
  changedRequest.modules[0].source += '# request substitution\n';
  await assert.rejects(() => verifyKernProjection(changedRequest, projected));
  const substitute = {
    ...projected,
    bytes: new Uint8Array(projected.bytes),
    artifact: structuredClone(projected.artifact),
    receipt: structuredClone(projected.receipt),
  };
  await assert.rejects(() => verifyKernProjection(request, substitute));
});

test('wrapper admission rejects unsafe and over-limit input before the private worker', async () => {
  assert.ok(assetLimits.wrapper, 'generated adapter exposes wrapper admission limits');
  const maxModules = assetLimits.wrapper.maxModules;
  const tooMany = Array.from({ length: maxModules + 1 }, (_, index) => ({
    moduleId: `generated/${index}.kern`,
    source: '',
  }));
  const excessiveSource = 'x'.repeat(assetLimits.wrapper.maxSourceScalars + 1);
  for (const modules of [
    tooMany,
    [{ moduleId: '../unsafe.kern', source: '' }],
    [{ moduleId: 'large.kern', source: excessiveSource }],
  ]) {
    const result = await projectKernModules({ modules });
    assert.equal(result.status, 'rejected');
    assert.deepEqual(
      result.diagnostics.map(({ code }) => code),
      ['projection-request-invalid'],
    );
  }
});

test('generated adapter IPC limits are finite and policy-derived', () => {
  for (const section of ['ipc', 'wrapper']) {
    const limits = assetLimits[section];
    assert.ok(limits, `generated adapter exposes ${section} limits`);
    for (const [key, value] of Object.entries(limits)) {
      assert.ok(Number.isSafeInteger(value) && value > 0, `${section}.${key}`);
    }
  }
});

test('wrapper admission enforces UTF-8 byte and aggregate limits without large allocations', () => {
  const profileLimits = Object.fromEntries(
    [
      'maxModules',
      'maxInstructionScalars',
      'maxWorkSteps',
      'maxNodes',
      'maxDepth',
      'maxCollectionLength',
      'maxStringCodePoints',
    ].map((key) => [key, 100]),
  ) as Parameters<typeof normalizeProjectionRequest>[1];
  const limits = {
    maxModules: 2,
    maxModuleIdScalars: 100,
    maxModuleIdUtf8Bytes: 100,
    maxModuleIdSegments: 10,
    maxSourceScalars: 100,
    maxSourceUtf8Bytes: 3,
    maxAggregateInputScalars: 15,
    maxAggregateInputBytes: 100,
  };
  assert.throws(() =>
    normalizeProjectionRequest(
      {
        modules: [{ moduleId: 'a.kern', source: 'éé' }],
      },
      profileLimits,
      limits,
    ),
  );
  assert.throws(() =>
    normalizeProjectionRequest(
      {
        modules: [
          { moduleId: 'a.kern', source: 'xx' },
          { moduleId: 'b.kern', source: 'xx' },
        ],
      },
      profileLimits,
      { ...limits, maxSourceUtf8Bytes: 100 },
    ),
  );
  assert.throws(() =>
    normalizeProjectionRequest({ modules: [{ moduleId: 'unsafe\u0000.kern', source: '' }] }, profileLimits, limits),
  );
});
