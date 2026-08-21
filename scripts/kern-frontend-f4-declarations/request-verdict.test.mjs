import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runScan } from '../kern-frontend-f1-scan/worker.mjs';
import { runBatchWithScan } from '../kern-frontend-f2-batch/worker.mjs';
import { runDocument as runF3Document } from '../kern-frontend-f3-line-tree/worker.mjs';
import { __test, loadPolicy, runDocument, validatePolicy } from './worker.mjs';
import { attempt, observeF3ThroughF4, runRequestVerdict } from './request-verdict-test-support.mjs';

const POLICY_URL = new URL('./policy.json', import.meta.url);
const VALID_SOURCE = 'fn name=main export=true\n';
const F1_FAILURE_SOURCE = 'text value="open';
const F2B_FAILURE_SOURCE = 'value={{(}}\n';
const AAA = ['available', 'available', 'available'];
const FNN = ['failed', 'not-attempted', 'not-attempted'];
const AFN = ['available', 'failed', 'not-attempted'];
const AAF = ['available', 'available', 'failed'];

function assertAtomicFatal(attempted, code, label) {
  assert.equal(attempted.kind, 'receipt', `${label}: F4A must return one receipt, not ${attempted.message}`);
  const { receipt, runtimeInvocations } = attempted.result;
  assert.equal(runtimeInvocations, 1, `${label}: exactly one actual F4 execution`);
  assert.equal(receipt.status, 'fatal', `${label}: fatal status`);
  assert.deepEqual(receipt.diagnostics.map((row) => row.code), [code], `${label}: winning code`);
  for (const section of [
    'declarations', 'propertyOccurrences', 'propertyPresence', 'attachments', 'decorators',
    'symbols', 'bindings', 'facts', 'detachedLogicalOrdinals', 'expressionEvidence',
  ]) assert.deepEqual(receipt[section], [], `${label}: ${section}`);
}

function assertActualEnvelope(attempted, states, label, expectCanonicalPayload = true) {
  assert.equal(attempted.kind, 'receipt', `${label}: actual F4 input must exist`);
  const args = attempted.result.__testActualArgs;
  assert.deepEqual(attempted.result.__testInput.prerequisiteStates, states,
    `${label}: buildInput carries the explicit prerequisite states`);
  assert.ok(Array.isArray(args), `${label}: __test exposes actual built args`);
  assert.equal(args.length, 109, `${label}: policy .3 ABI has 109 inputs`);
  assert.deepEqual(args.slice(103, 106), states, `${label}: fixed F1/F2B/F3 state order`);
  const { profileLimits } = loadPolicy().policy;
  assert.deepEqual({
    f4MaxSourceScalars: args[106], f4MaxRecords: args[107], f4MaxLogicalLines: args[108],
  }, {
    f4MaxSourceScalars: profileLimits.maxSourceScalars,
    f4MaxRecords: profileLimits.maxRecords,
    f4MaxLogicalLines: profileLimits.maxLogicalLines,
  }, `${label}: named F4 admission-limit slots follow the state tags`);
  for (const [state, fields, stage] of [
    [states[0], [2, 3, 4, 5, 6], 'F1'],
    [states[1], [7, 8, 9, 10, 11, 12, 15, 16, 17, 18], 'F2B'],
    [states[2], [13, ...Array.from({ length: 26 }, (_, index) => index + 39)], 'F3'],
  ]) {
    if (!expectCanonicalPayload || state === 'available') continue;
    for (const index of fields) assert.deepEqual(args[index], index === 6 ? '' : [], `${label}: ${stage} canonical empty ${index}`);
  }
  if (attempted.result.__testOutcome !== 'returned') {
    assert.equal(attempted.result.__testOutcome, 'runtime-envelope-rejection', `${label}: first-stage ABI outcome`);
    assert.match(attempted.result.__testError, /runtime envelope.*invalid-handler-arguments/iu,
      `${label}: 109 actual args reach the current 103-parameter handler`);
    assert.fail(`${label}: first-stage ABI RED; semantic verdict waits for the 109-parameter KERN handler`);
  }
}

function assertActualUpstreamFailures() {
  const f1 = runScan(F1_FAILURE_SOURCE).decoded;
  assert.equal(f1.status, 'failure');
  assert.equal(f1.diagnostic.code, 'UNCLOSED_STRING');
  const f2bScan = runScan(F2B_FAILURE_SOURCE);
  assert.equal(f2bScan.decoded.status, 'scanned');
  const f2b = runBatchWithScan(F2B_FAILURE_SOURCE, f2bScan).receipt;
  assert.equal(f2b.status, 'failure');
  assert.equal(f2b.diagnostic.code, 'BATCH_EXPRESSION_REJECTED');
  const f3 = runF3Document(VALID_SOURCE, { forceLateFailure: true }).receipt;
  assert.equal(f3.status, 'failure');
  assert.equal(f3.diagnostics[0].code, 'FORCED_LATE_FAILURE');
}

test('request-verdict RED: actual F1/F2B/F3 failure reaches one F4 drift receipt', async (t) => {
  assertActualUpstreamFailures();
  for (const [label, observed, code] of [
    ['FNN actual F1', observeF3ThroughF4('actual-f1.kern', F1_FAILURE_SOURCE), 'F4_F1_DRIFT'],
    ['AFN actual F2B', observeF3ThroughF4('actual-f2b.kern', F2B_FAILURE_SOURCE), 'F4_F2B_DRIFT'],
    ['AAF actual F3', observeF3ThroughF4('actual-f3.kern', VALID_SOURCE, { forceLateFailure: true }), 'F4_F3_DRIFT'],
  ]) await t.test(label, () => assertAtomicFatal(observed, code, label));
});

test('request-verdict RED: invalid module ID dominates every actual upstream failure', async (t) => {
  for (const [label, observed] of [
    ['F1', observeF3ThroughF4('not-a-module-id', F1_FAILURE_SOURCE)],
    ['F2B', observeF3ThroughF4('not-a-module-id', F2B_FAILURE_SOURCE)],
    ['F3', observeF3ThroughF4('not-a-module-id', VALID_SOURCE, { forceLateFailure: true })],
  ]) await t.test(label, () => assertAtomicFatal(observed, 'F4_INVALID_REQUEST', `invalid ID plus ${label}`));
});

test('request-verdict RED: three explicit legal vectors map to their only drift', async (t) => {
  for (const [vector, states, code] of [['FNN', FNN, 'F4_F1_DRIFT'], ['AFN', AFN, 'F4_F2B_DRIFT'], ['AAF', AAF, 'F4_F3_DRIFT']]) {
    const attempted = attempt(() => runRequestVerdict(`legal-${vector}.kern`, VALID_SOURCE, states));
    await t.test(vector, () => {
      assertActualEnvelope(attempted, states, vector);
      assertAtomicFatal(attempted, code, vector);
    });
  }
});

test('request-verdict RED: illegal explicit vectors are request-invalid before authority', async (t) => {
  for (const [vector, states] of [
    ['NAA', ['not-attempted', 'available', 'available']],
    ['FNF', ['failed', 'not-attempted', 'failed']],
    ['AFF', ['available', 'failed', 'failed']],
  ]) await t.test(vector, () => {
    const attempted = attempt(() => runRequestVerdict(`illegal-${vector}.kern`, VALID_SOURCE, states));
    assertActualEnvelope(attempted, states, vector);
    assertAtomicFatal(attempted, 'F4_INVALID_REQUEST', vector);
  });
});

test('request-verdict RED: request limits and authority dominate legal unavailable vectors', async (t) => {
  const { policy } = loadPolicy();
  const oversizedId = `${'a'.repeat(policy.profileLimits.maxModuleIdScalars)}.kern`;
  for (const [label, states] of [['FNN', FNN], ['AFN', AFN], ['AAF', AAF]]) {
    await t.test(`limit ${label}`, () => {
      const attempted = attempt(() => runRequestVerdict(oversizedId, VALID_SOURCE, states));
      assertActualEnvelope(attempted, states, `limit ${label}`);
      assertAtomicFatal(attempted, 'F4_LIMIT', `limit ${label}`);
    });
    await t.test(`authority ${label}`, () => {
      const attempted = attempt(() => runRequestVerdict('authority-first.kern', VALID_SOURCE, states,
        { mutation: 'authority-row-reorder' }));
      assertActualEnvelope(attempted, states, `authority ${label}`);
      assertAtomicFatal(attempted, 'F4_AUTHORITY_DRIFT', `authority ${label}`);
    });
  }
});

test('request-verdict RED: available-empty differs from unavailable F2B and F3', async (t) => {
  await t.test('AAA empty', () => {
    const available = attempt(() => runRequestVerdict('available-empty.kern', '', AAA));
    assertActualEnvelope(available, AAA, 'AAA empty');
    assert.equal(available.kind, 'receipt');
    assert.equal(available.result.receipt.status, 'classified');
  });
  for (const [label, states, code] of [
    ['AFN empty F2B', AFN, 'F4_F2B_DRIFT'],
    ['AAF empty F3', AAF, 'F4_F3_DRIFT'],
  ]) await t.test(label, () => {
    const available = attempt(() => runRequestVerdict('available-empty.kern', '', AAA));
    const unavailable = attempt(() => runRequestVerdict('available-empty.kern', '', states));
    assertActualEnvelope(unavailable, states, label);
    assertAtomicFatal(unavailable, code, label);
    assert.notEqual(available.result.receipt.seal, unavailable.result.receipt.seal, label);
  });
});

test('request-verdict RED: available payload tampering maps to the owning prerequisite drift', async (t) => {
  for (const [label, source, mutation, code] of [
    ['F1', VALID_SOURCE, 'f1-record-kind', 'F4_F1_DRIFT'],
    ['F2B', 'value={{1}}\n', 'f2b-segment-span', 'F4_F2B_DRIFT'],
    ['F3', 'fn name=main\n  return 1\n', 'f3-parent-edge', 'F4_F3_DRIFT'],
  ]) await t.test(label, () => {
    const attempted = attempt(() => runRequestVerdict(`tamper-${label}.kern`, source, AAA, { mutation }));
    assertActualEnvelope(attempted, AAA, label);
    assertAtomicFatal(attempted, code, label);
  });
});

test('request-verdict RED: a malformed well-arity state envelope is invalid, not drift', () => {
  const attempted = attempt(() => runRequestVerdict('malformed-envelope.kern', VALID_SOURCE, FNN,
    { mutation: 'f1-record-kind' }));
  assertActualEnvelope(attempted, FNN, 'non-empty F1 payload under FNN', false);
  assertAtomicFatal(attempted, 'F4_INVALID_REQUEST', 'non-empty F1 payload under FNN');
});

test('request-verdict: wrong outer type at 109 inputs is a runtime-envelope rejection, not an F4 receipt', () => {
  const result = __test.runDocumentWithTestInput('outer-type.kern', VALID_SOURCE, {
    prerequisiteStates: AAA,
    mutateInput(input) { input.recordKinds = ''; },
  });
  assert.equal(result.__testActualArgs.length, 109, 'the actual private invocation retains its 109 slots');
  assert.equal(result.__testOutcome, 'runtime-envelope-rejection');
  assert.match(result.__testError, /runtime envelope.*invalid-handler-arguments/iu);
  assert.equal(Object.hasOwn(result, 'receipt'), false, 'outer type failures never fabricate an F4 receipt');
});

test('request-verdict RED: actual stage observer proves missing F4 handoff after first failure', async (t) => {
  for (const [label, observed, expected] of [
    ['F1', observeF3ThroughF4('observe-f1.kern', F1_FAILURE_SOURCE), ['f1', 'f4']],
    ['F2B', observeF3ThroughF4('observe-f2b.kern', F2B_FAILURE_SOURCE), ['f1', 'f2b', 'f4']],
    ['F3', observeF3ThroughF4('observe-f3.kern', VALID_SOURCE, { forceLateFailure: true }), ['f1', 'f2b', 'f3', 'f4']],
  ]) await t.test(label, () => assert.deepEqual(observed.stages, expected,
    `${label}: actual calls then one F4 handoff`));
});

test('request-verdict does not attribute distinct upstream rejection text to the F4 receipt', () => {
  const stringSource = 'text value="openxx';
  const expressionSource = 'text value={{ open';
  assert.equal(Array.from(stringSource).length, Array.from(expressionSource).length);
  assert.equal(runScan(stringSource).decoded.diagnostic.code, 'UNCLOSED_STRING');
  assert.equal(runScan(expressionSource).decoded.diagnostic.code, 'UNCLOSED_EXPR');
  const stringFailure = observeF3ThroughF4('string-failure.kern', stringSource);
  const expressionFailure = observeF3ThroughF4('expression-failure.kern', expressionSource);
  assertAtomicFatal(stringFailure, 'F4_F1_DRIFT', 'string rejection');
  assertAtomicFatal(expressionFailure, 'F4_F1_DRIFT', 'expression rejection');
  assert.deepEqual(stringFailure.result.fields, expressionFailure.result.fields);
  assert.equal(stringFailure.result.receipt.seal, expressionFailure.result.receipt.seal);
});

test('request-verdict ABI boundary: direct 103/108/110 calls produce no F4 receipt', async (t) => {
  for (const count of [103, 108, 110]) {
    const attempted = attempt(() => __test.runDocumentWithArgumentCount('arity.kern', VALID_SOURCE, count));
    await t.test(String(count), () => {
      assert.equal(attempted.kind, 'exception', `${count}: host/runtime envelope, not F4 receipt`);
      assert.equal(Object.hasOwn(attempted, 'result'), false, `${count}: no receipt`);
    });
  }
});

test('request-verdict RED: target .3 policy rejects its cloned .2 predecessor', () => {
  const target = JSON.parse(readFileSync(POLICY_URL, 'utf8'));
  target.format = 'kern.frontend.f4-declarations-policy.3';
  const stale = structuredClone(target);
  stale.format = 'kern.frontend.f4-declarations-policy.2';
  assert.throws(() => validatePolicy(stale), /policy identity/u);
});

test('request-verdict keeps a genuine infrastructure exception outside receipts', () => {
  const malformed = attempt(() => runDocument(null, ''));
  assert.equal(malformed.kind, 'exception');
  assert.match(malformed.message, /request shape/u);
  assert.equal(Object.hasOwn(malformed, 'result'), false);
});
