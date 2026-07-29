import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../../packages/core/dist/runtime-handler.js';

import {
  CANONICALIZER_COMPOSITE_PATH,
  verifyCanonicalizerComposition,
} from './composition.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const COMPOSITION = verifyCanonicalizerComposition();
const RUNTIME_LIMITS = loadCanonicalizerPolicy().runtimeLimits;

function executeTypeFields(parent, valueParent, valueRole) {
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [parent, valueParent, valueRole],
    identity: { handlerName: 'typefields', sourcePath: CANONICALIZER_COMPOSITE_PATH },
    source: COMPOSITION.source,
  }, {
    enabled: true,
    limits: RUNTIME_LIMITS,
  });
  assert.equal(envelope.outcome, 'success', JSON.stringify(envelope));
  assert.deepEqual(envelope.diagnostics, []);
  assert.deepEqual(envelope.completion, { kind: 'return' });
  assert.equal(envelope.result.presence, 'value');
  assert.equal(envelope.result.value.tag, 'list');
  return envelope.result.value.value.map((value) => {
    assert.equal(value.tag, 'integer');
    return Number(value.value);
  });
}

test('M4.117 typefields preserves counts, recognized roles, and missing roles', () => {
  assert.deepEqual(
    executeTypeFields(
      1,
      [0, 1, 1, 1],
      ['', 'record:kind', 'record:unknown', 'record:element'],
    ),
    [3, 2, 4],
  );
  assert.deepEqual(executeTypeFields(2, [0, 1], ['', 'record:kind']), [0, 0, 0]);
});

test('M4.117 typefields preserves duplicate-role rejection sentinels', () => {
  assert.deepEqual(
    executeTypeFields(1, [1, 1], ['record:kind', 'record:kind']),
    [-1, -1, -1],
  );
  assert.deepEqual(
    executeTypeFields(1, [1, 1], ['record:element', 'record:element']),
    [-1, -1, -1],
  );
});

test('M4.117 typefields preserves exported behavior outside admitted parent bounds', () => {
  assert.deepEqual(executeTypeFields(100, [100], ['record:kind']), [1, 1, 0]);
  assert.deepEqual(
    executeTypeFields(-2, [-2, -2], ['record:kind', 'record:element']),
    [2, 1, 2],
  );
});
