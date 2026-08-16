import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPolicy } from './decoder.mjs';
import { decoderRejects, receiptMutations, runSourceMutant, sourceMutants } from './mutations.mjs';
import { assertProductionSource, loadComposition, runExpression } from './worker.mjs';

test('authenticated semantic source mutants change or fail their witnesses', () => {
  const mutants = sourceMutants();
  assert.deepEqual(mutants.map((mutant) => mutant.id), ['precedence-drift', 'associativity-drift', 'constant-output']);
  for (const mutant of mutants) assert.equal(runSourceMutant(mutant), true, mutant.id);
});

test('strict decoder kills topology, schema, span, framing, seal, and atomicity mutations', () => {
  const source = 'a+b';
  const run = runExpression(source);
  const mutants = receiptMutations(run.fields);
  assert.equal(mutants.length, 13);
  for (const mutant of mutants) assert.equal(decoderRejects(mutant, source), true, mutant.id);
});

test('fragment and authority mutations fail before runtime execution', () => {
  const policy = loadPolicy();
  assert.throws(() => loadComposition({ ...policy, parserFragments: [...policy.parserFragments].reverse() }), /order/u);
  assert.throws(() => loadComposition({ ...policy, parserFragments: policy.parserFragments.slice(1) }), /order/u);
  assert.throws(() => loadComposition({ ...policy, parserFragments: [...policy.parserFragments, policy.parserFragments[0]] }), /order/u);
  assert.throws(
    () => loadComposition({ ...policy, parserCompositeSha256: '0'.repeat(64) }),
    /composite digest/u,
  );
  assert.throws(() => assertProductionSource('handler lang="typescript" code="return parseExpression(x)"', 'mutant.kern'));
});

test('prototype-looking record keys remain data while duplicates fail closed', () => {
  const safe = runExpression('{__proto__: 1, constructor: 2, prototype: 3}').decoded;
  assert.equal(safe.status, 'parsed');
  assert.deepEqual(safe.root.payload, ['__proto__', 'constructor', 'prototype']);
  assert.equal(runExpression('{"\\u0061": 1, a: 2}').decoded.status, 'failure');
});
