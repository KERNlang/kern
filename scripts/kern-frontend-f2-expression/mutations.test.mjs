import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeExpression, loadPolicy } from './decoder.mjs';
import {
  decoderRejects,
  receiptMutations,
  runSourceMutant,
  semanticPayloadSubstitutionMutations,
  sourceMutants,
} from './mutations.mjs';
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

test('strict decoder rejects same-schema semantic payload substitutions', () => {
  const mutants = semanticPayloadSubstitutionMutations();
  assert.equal(mutants.length, 6);
  for (const mutant of mutants) {
    assert.equal(decoderRejects(mutant, mutant.source), true, mutant.id);
  }
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

test('decoder closes failure taxonomy, authenticates every path, and rejects ill-formed source', () => {
  const policy = loadPolicy();
  const parsed = runExpression('a');
  const failure = runExpression('a = b');
  const badLedger = { ...policy, sourceLedgerSha256: '0'.repeat(64) };
  assert.throws(() => decodeExpression(parsed.fields, 'a', badLedger), /ledger/u);
  assert.throws(() => decodeExpression(failure.fields, 'a = b', badLedger), /ledger/u);
  const unknown = [...failure.fields];
  unknown[2] = 'C5:FALSES1:0E1:0';
  assert.throws(() => decodeExpression(unknown, 'a = b', policy), /taxonomy/u);
  assert.throws(() => runExpression(String.fromCharCode(0xd800)), /ill-formed/u);
});

test('worker provenance classifies semantic and policy failures outside the frozen receipt', () => {
  for (const [run, phase] of [
    [runExpression('a = b'), 'parser-semantic'],
    [runExpression('a+b', { profileLimits: { maxWorkSteps: 1 } }), 'resource-policy'],
    [runExpression('abcd', { profileLimits: { maxSourceScalars: 3 } }), 'source-admission'],
    [runExpression('a+b', { profileLimits: { maxTapeScalars: 1 } }), 'transport-policy'],
  ]) {
    assert.equal(run.fields.length, 9);
    assert.equal(run.provenance.authority, 'worker');
    assert.equal(run.provenance.phase, phase);
  }
});

test('prototype-looking record keys remain data while duplicates fail closed', () => {
  const safe = runExpression('{__proto__: 1, constructor: 2, prototype: 3}').decoded;
  assert.equal(safe.status, 'parsed');
  assert.deepEqual(safe.root.payload, ['__proto__', 'constructor', 'prototype']);
  assert.equal(runExpression('{"\\u0061": 1, a: 2}').decoded.status, 'failure');
});
