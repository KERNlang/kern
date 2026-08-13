import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';

const sourceUrl = new URL('../../examples/kern-frontend/runtime-rewrite-gate0.kern', import.meta.url);
const limits = {
  maxBytes: 1048576,
  maxCollectionLength: 8192,
  maxDepth: 64,
  maxDiagnostics: 8,
  maxEvents: 8,
  maxStringBytes: 65536,
};

function execute(input) {
  const source = readFileSync(sourceUrl, 'utf8');
  assert.doesNotMatch(source, /parseExpression|projectExpressionText|capability/u);
  return executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [input],
    identity: {
      handlerName: 'proberewritematerialization',
      sourcePath: 'examples/kern-frontend/runtime-rewrite-gate0.kern',
    },
    source,
  }, { enabled: true, limits });
}

test('existing runtime materializes a helper result from loop-mutated scalar bindings', () => {
  const input = 'left*right';
  const envelope = execute(input);
  assert.equal(envelope.outcome, 'success', JSON.stringify(envelope.diagnostics));
  assert.equal(envelope.result.presence, 'value');
  assert.deepEqual(envelope.result.value, {
    tag: 'list',
    value: [
      { tag: 'text', value: 'kern.frontend.runtime-rewrite-gate0.1' },
      { tag: 'text', value: 'ok' },
      { tag: 'text', value: '4:left*5:right' },
      { tag: 'text', value: 'seal' },
      { tag: 'text', value: input },
    ],
  });
});

test('materialization remains source-sensitive', () => {
  const left = execute('a*bc').result.value;
  const right = execute('ab*c').result.value;
  assert.notDeepEqual(left, right);
});
