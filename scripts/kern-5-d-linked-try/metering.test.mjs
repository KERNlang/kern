import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIMITS,
  TRY_METER_POSITIONS,
  TRY_POSITIONS,
  TRY_THRESHOLD_POSITIONS,
  TRY_TWINS,
  assertTryAdmitted,
  assertTryStepThreshold,
  compileJavaScript,
  failingProvider,
  executeJavaScriptChild,
  executeKernKir,
  loopStepBudget,
  occurrencesOf,
  project,
  provider,
  runtimeRequest,
  stepRequest,
  tryArtifact,
  tryPositionArguments,
  tryTwoLegs,
} from './k0-support.mjs';

// Every row below is a difference against a hand-counted twin measured in the SAME run: rt11's
// [RT11W-TD1] and rt12's [RT12J-TD9] both shipped derived integers that went RED against a correct
// implementation. The twin's measured cost goes into every assertion message, so a wrong pin is
// separable from a wrong implementation on sight.
//
// The hand count, statement by statement, from the RT-1 walk: `meter.step()` fires once per
// statement boundary, once per entered loop trip (`enterTrip`), once when a loop's condition finally
// fails, once more on a `break`, once per EVALUATED expression node (`evaluateExpression` charges on
// entry), and -- new in D -- once per ENTERED block (try body, catch body, finally body) on top of
// the `try` statement's own boundary charge.
//
// OQ-D2's promotion: every integer below was MEASURED against its twin in the same run on
// 2026-09-08 and the two that moved carry their derivation. Both had assumed a leaf statement or a
// record expression costs one charge; a leaf assign costs two (boundary + value expression) and a
// record costs one per node.
const TWIN_DELTAS = Object.freeze({
  // try boundary (1) + entered try body (1); the catch is never entered, so it charges nothing.
  'meter-try-leaf': { delta: 2, twin: 'twin-leaf' },
  // try boundary (1) + entered try body (1) + throw boundary (1) + entered catch body (1) = 4,
  // against the twin's `let` boundary (1) -- and the payload does NOT cancel: D-1a1 has the linker
  // insert `code: null`, so the fixture's two-entry record pays three `evaluateExpression` charges
  // where the twin's written one-entry record pays two. 4 + 1 - 1 = 4, measured 13 against 9.
  // The spec predicted 4, then its Corrections Log re-derived 3 on the cancellation that the
  // inserted default breaks.
  'meter-try-throw-catch-leaf': { delta: 4, twin: 'twin-let-and-leaf' },
  // Three trips, each paying the try boundary plus the entered try body: 3 x 2.
  'meter-for-3-try-leaf': { delta: 6, twin: 'twin-for-3-leaf' },
  // entered finally body (1) + the finally leaf's statement boundary (1) + that leaf's own value
  // expression (1), against the finally-less try. The spec's 2 counted the leaf once; a leaf assign
  // costs two. Measured 11 against 8.
  'meter-try-leaf-finally-leaf': { delta: 3, twin: 'twin-try-catch-leaf' },
});

async function cost(table, name, requestId) {
  const source = table[name]();
  await assertTryAdmitted(name, source);
  return loopStepBudget(source, tryPositionArguments(name), requestId);
}

async function twinCost(name) {
  const source = TRY_TWINS[name]();
  await assertTryAdmitted(name, source);
  return loopStepBudget(source, {}, `d-twin-${name}`);
}

for (const [name, { delta, twin }] of Object.entries(TWIN_DELTAS)) {
  test(`${name} charges exactly ${delta} steps more than its hand-counted twin ${twin}`, async () => {
    const measuredTwin = await twinCost(twin);
    const measured = await cost(TRY_METER_POSITIONS, name, `d-meter-${name}`);
    assert.equal(
      measured.execution - measuredTwin.execution,
      delta,
      `D_METER_DRIFT: ${name} charged ${measured.execution} against twin ${twin}'s measured ${measuredTwin.execution}; the hand count says the difference is ${delta}`,
    );
  });
}

// The paired half of every metering row: RT-1 and the emitted artifact must share one threshold, not
// merely agree on a bound. Pinned from both sides -- succeeds at RT-1's execution count, fails one
// step under it.
for (const name of TRY_THRESHOLD_POSITIONS) {
  test(`${name} charges identically on RT-1 and the JavaScript leg at every budget`, async () => {
    await assertTryStepThreshold(name, TRY_POSITIONS[name](), tryPositionArguments(name));
  });
}

// D-5a's negative half: a catch body that is never entered charges nothing, so the finally-less
// try-catch and the plain leaf differ by exactly the two charges the try itself owns.
test('a catch body that is never entered charges nothing at all', async () => {
  const withCatch = await cost(TRY_METER_POSITIONS, 'meter-try-leaf', 'd-catch-unentered');
  const twin = await twinCost('twin-leaf');
  assert.equal(
    withCatch.execution - twin.execution,
    TWIN_DELTAS['meter-try-leaf'].delta,
    `D_METER_DRIFT: an unentered catch must charge zero; measured ${withCatch.execution} against twin ${twin.execution}`,
  );
});

// D-5d, the one pinned TS divergence. The envelope is a hard boundary: an exhausted step budget
// inside a try that HAS a catch still produces runtime-limit-exceeded, and the catch body does not
// run. On RT-1 the mechanism is the enforcement -- the fault leaves the generator and discards the
// frame stack, trap frames included.
test('maxSteps exhausted inside a try with a catch produces runtime-limit-exceeded, catch skipped', async () => {
  const source = TRY_POSITIONS['try-catch-caught-throw']();
  await assertTryAdmitted('try-catch-caught-throw', source);
  const verified = await project(source);
  const full = await loopStepBudget(source, {}, 'd-limit-full');
  const envelope = await executeKernKir(
    verified,
    stepRequest('d-limit-starved', {}, full.link + full.execution - 1),
    provider([]),
  );
  assert.equal(envelope.outcome, 'failure', 'D_ENVELOPE_CATCHABLE: a starved budget must fail');
  assert.deepEqual(
    envelope.diagnostics.map((diagnostic) => diagnostic.code),
    ['runtime-limit-exceeded'],
    'D_ENVELOPE_CATCHABLE: a step-budget fault must never be converted into a caught user throw',
  );
});

// Both legs, driven: these two rows claimed "on both legs" while executing RT-1 alone, so the
// emitted leg's own abort path -- a different mechanism, `__deadline`/`AbortController` rather than
// the walk's `checkAbort` -- was asserted by the title and by nothing else.
async function abortLegs(name, control, requestId, limits) {
  const source = TRY_POSITIONS[name]();
  await assertTryAdmitted(name, source);
  const verified = await project(source);
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `D_LINK_REFUSED: ${name} must emit an artifact`);
  const base = runtimeRequest(requestId, {});
  const request = limits === undefined ? { ...base, control } : { ...base, control, limits };
  return {
    direct: await executeKernKir(verified, request, provider([])),
    emitted: (await executeJavaScriptChild(javascript.artifact.bytes, request)).envelope,
  };
}

function abortCodes(envelope) {
  return envelope.diagnostics.map((diagnostic) => diagnostic.code);
}

test('cancellation inside a try produces execution-cancelled with the catch body skipped, on both legs', async () => {
  const legs = await abortLegs('try-catch-caught-throw', { preCancelled: true, timeoutMs: null }, 'd-cancelled');
  for (const [leg, envelope] of Object.entries(legs)) {
    assert.equal(envelope.outcome, 'failure', `D_ENVELOPE_CATCHABLE: ${leg} must fail on cancellation`);
    assert.deepEqual(
      abortCodes(envelope),
      ['execution-cancelled'],
      `D_ENVELOPE_CATCHABLE: cancellation must bypass the catch entirely on the ${leg} leg`,
    );
    assert.deepEqual(envelope.events, [], `D_ENVELOPE_CATCHABLE: ${leg} must commit no event`);
  }
});

test('a timeout inside a try produces execution-timeout with the catch body skipped, on both legs', async () => {
  // maxSteps is raised so the deadline is the only limit that can fire; otherwise the row races the
  // step budget and could report runtime-limit-exceeded on a fast host.
  const legs = await abortLegs(
    'try-catch-slow-loop',
    { preCancelled: false, timeoutMs: 1 },
    'd-timeout',
    { ...LIMITS, maxSteps: 1_000_000 },
  );
  for (const [leg, envelope] of Object.entries(legs)) {
    assert.equal(envelope.outcome, 'failure', `D_ENVELOPE_CATCHABLE: ${leg} must fail on a timeout`);
    assert.deepEqual(
      abortCodes(envelope),
      ['execution-timeout'],
      `D_ENVELOPE_CATCHABLE: a timeout must bypass the catch entirely on the ${leg} leg`,
    );
  }
});

// The honest title for what this row drives: the provider SUCCEEDS here, so the failure it observes
// is the uncaught throw. It is kept because it pins that a resolved capability neither enters the
// catch nor changes the failing code -- but it exercises no capability fault, which is why the two
// rows below exist.
test('a resolved capability before an uncaught throw leaves the throw as the failing code', async () => {
  const source = TRY_POSITIONS['throw-uncaught-after-capability']();
  await assertTryAdmitted('throw-uncaught-after-capability', source);
  const legs = await tryTwoLegs(source, runtimeRequest('d-capability-resolved', {}));
  assert.equal(legs.direct.envelope.outcome, 'failure');
  assert.deepEqual(
    legs.direct.envelope.diagnostics.map((diagnostic) => diagnostic.code),
    ['uncaught-throw'],
    'D_ENVELOPE_CATCHABLE: the capability resolved, so the uncaught throw is what fails -- and the catch saw neither',
  );
});

// QD-1 option (a), driven rather than assumed: a provider that FAILS raises `capability-error` in
// the driver, which never re-enters the walk, so neither the catch body nor the finally body may run
// -- on both legs. The `failingProvider`/`capabilityFails` pair is the only way to reach this at all.
async function capabilityFaultLegs(name, requestId) {
  const source = TRY_POSITIONS[name]();
  await assertTryAdmitted(name, source);
  const verified = await project(source);
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `D_LINK_REFUSED: ${name} must emit an artifact`);
  const request = runtimeRequest(requestId, {});
  const calls = [];
  return {
    direct: await executeKernKir(verified, request, failingProvider(calls)),
    emitted: (await executeJavaScriptChild(javascript.artifact.bytes, request, { capabilityFails: true })).envelope,
  };
}

test('a failing capability inside a try with a catch stays an uncatchable fault on both legs', async () => {
  const legs = await capabilityFaultLegs('try-catch-capability', 'd-capability-fault-catch');
  for (const [leg, envelope] of Object.entries(legs)) {
    assert.equal(envelope.outcome, 'failure', `D_ENVELOPE_CATCHABLE: ${leg} must fail on a capability fault`);
    assert.deepEqual(
      envelope.diagnostics.map((diagnostic) => diagnostic.code),
      ['capability-error'],
      `D_ENVELOPE_CATCHABLE: the ${leg} leg must surface capability-error, never a caught user throw`,
    );
    assert.deepEqual(envelope.result, { presence: 'absent' }, `D_ENVELOPE_CATCHABLE: ${leg} must carry no result`);
  }
});

test('a failing capability inside a try with a finally skips the finally body on both legs', async () => {
  const legs = await capabilityFaultLegs('try-finally-capability', 'd-capability-fault-finally');
  for (const [leg, envelope] of Object.entries(legs)) {
    assert.deepEqual(
      envelope.diagnostics.map((diagnostic) => diagnostic.code),
      ['capability-error'],
      `D_ENVELOPE_CATCHABLE: the ${leg} leg must surface capability-error`,
    );
    assert.deepEqual(
      envelope.events,
      [],
      `D_FINALLY_ON_FAULT: the ${leg} leg must not run the finally body, so its print commits no event`,
    );
  }
});

// The tick fence: a try lowering that reached for a host suspension point would change the
// microtask shape RT-2 established and the emitted legs share. Counted against a twin so the
// baseline the emitter already has is subtracted out.
test('the emitted try region introduces no suspension point the finally-less twin does not have', async () => {
  const twin = await tryArtifact(TRY_TWINS['twin-leaf']());
  const fixture = await tryArtifact(TRY_POSITIONS['try-catch-caught-throw']());
  for (const token of ['await ', 'Promise', 'queueMicrotask', 'setImmediate', 'setTimeout']) {
    assert.equal(
      occurrencesOf(fixture.text, token),
      occurrencesOf(twin.text, token),
      `D_TICK_DRIFT: the try lowering changed the ${token} count against its finally-less twin`,
    );
  }
});
