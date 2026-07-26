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

function execute(handlerName, arguments_) {
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: arguments_,
    identity: { handlerName, sourcePath: CANONICALIZER_COMPOSITE_PATH },
    source: COMPOSITION.source,
  }, {
    enabled: true,
    limits: RUNTIME_LIMITS,
  });
  assert.equal(envelope.outcome, 'success', JSON.stringify(envelope));
  assert.deepEqual(envelope.diagnostics, []);
  assert.deepEqual(envelope.completion, { kind: 'return' });
  assert.equal(envelope.result.presence, 'value');
  return envelope.result.value;
}

const malformedTables = [
  {
    label: 'forward parent',
    tables: [
      ['record', 'text'],
      [0, 2],
      ['', 'record:value'],
      [0, 0],
      ['', 'x'],
      [0, 0],
    ],
  },
  {
    label: 'duplicate sibling order',
    tables: [
      ['record', 'text', 'text'],
      [0, 1, 1],
      ['', 'record:a', 'record:b'],
      [0, 0, 0],
      ['', 'a', 'b'],
      [0, 0, 0],
    ],
  },
  {
    label: 'duplicate record role',
    tables: [
      ['record', 'text', 'text'],
      [0, 1, 1],
      ['', 'record:a', 'record:a'],
      [0, 0, 1],
      ['', 'a', 'b'],
      [0, 0, 0],
    ],
  },
];

for (const { label, tables } of malformedTables) {
  test(`M4.89 expressionsources fails closed with a typed empty list for ${label}`, () => {
    assert.deepEqual(execute('expressionsources', tables), { tag: 'list', value: [] });
    assert.deepEqual(execute('exprsource', [1, ...tables]), { tag: 'text', value: '' });
  });
}
