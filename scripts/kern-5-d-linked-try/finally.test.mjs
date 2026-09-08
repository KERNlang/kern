import assert from 'node:assert/strict';
import test from 'node:test';

import { GATED_COMMIT_TAG, USER_THROW_CLASS } from './pins.mjs';
import {
  TRY_POSITIONS,
  TRY_TABLE_ROWS,
  assertLinkLabel,
  assertTryAdmitted,
  executeKernKir,
  integerSlot,
  loopStepBudget,
  occurrencesOf,
  project,
  provider,
  runtimeRequest,
  stepRequest,
  tryArtifact,
  tryTwoLegBytes,
} from './k0-support.mjs';

const ABRUPT = 'KIR_ABRUPT_FINALLY_UNSUPPORTED';
const CROSS_TRY = 'KIR_LOOP_JUMP_CROSSES_TRY';

// D-7a. Cleanup-only, which is what removes the tribunal's stated residual risk: with no abrupt
// completion possible inside a finally, the return-through-finally pending-completion protocol is
// unnecessary rather than merely unimplemented.
const ABRUPT_REFUSALS = Object.freeze([
  'neg-finally-return',
  'neg-finally-throw',
  'neg-finally-break',
  'neg-finally-continue',
  'neg-finally-nested-throw',
]);

const CLAUSE_REFUSALS = Object.freeze([
  ['neg-duplicate-finally', 'KIR_DUPLICATE_FINALLY'],
  ['neg-catch-after-finally', 'KIR_CATCH_AFTER_FINALLY'],
  ['neg-finally-stray', 'KIR_FINALLY_WITHOUT_TRY'],
]);

const FINALLY_ROWS = TRY_TABLE_ROWS.filter((row) => row.commit === GATED_COMMIT_TAG);

for (const position of ABRUPT_REFUSALS) {
  test(`${position} is refused at link with ${ABRUPT}`, async () => {
    await assertLinkLabel(TRY_POSITIONS[position](), ABRUPT);
  });
}

for (const [position, label] of CLAUSE_REFUSALS) {
  test(`${position} is refused at link with ${label}`, async () => {
    await assertLinkLabel(TRY_POSITIONS[position](), label);
  });
}

test('try{}finally{} with no catch links only once the finally commit lands', async () => {
  await assertTryAdmitted('try-finally-no-catch', TRY_POSITIONS['try-finally-no-catch']());
});

test('a while inside a finally is admitted, which is the linker half of the F5 asymmetry', async () => {
  await assertTryAdmitted('try-finally-while', TRY_POSITIONS['try-finally-while']());
});

// D-4d/D-4f, and the half a one-sided oracle would let through on assertion alone. Both shapes are
// if-wrapped, because F5 refuses a finally clause directly inside a loop body.
test('a jump crossing a finally-bearing try is refused with the cross-try label', async () => {
  await assertLinkLabel(TRY_POSITIONS['neg-break-crosses-finally'](), CROSS_TRY);
  await assertLinkLabel(TRY_POSITIONS['neg-continue-crosses-finally'](), CROSS_TRY);
});

// D-4g's third case: a loop INSIDE the finally-bearing try has equal entry and body finallyDepth,
// so its own break is legal. The comparison must get this right or the refusal is a blunt ban.
test('a loop inside a finally-bearing try still permits its own break, because the depths are equal', async () => {
  await assertTryAdmitted(
    'for-inside-finally-bearing-try-break',
    TRY_POSITIONS['for-inside-finally-bearing-try-break'](),
  );
});

// The ordering row: the existing `loopDepth === 0` check runs FIRST, so a bare break inside a try at
// handler top level is refused for its depth, not for crossing a finally it does not cross.
test('a bare break inside a try at handler top level is refused for its loop depth, not the cross-try label', async () => {
  const message = await assertLinkLabel(TRY_POSITIONS['neg-break-in-try-top-level'](), 'KIR_BREAK_OUTSIDE_LOOP');
  assert.equal(
    message.includes(CROSS_TRY),
    false,
    'D_GATE_ORDER: the loopDepth check must fire before the finally-crossing comparison',
  );
  const continueMessage = await assertLinkLabel(
    TRY_POSITIONS['neg-continue-in-try-top-level'](),
    'KIR_CONTINUE_OUTSIDE_LOOP',
  );
  assert.equal(continueMessage.includes(CROSS_TRY), false);
});

for (const row of FINALLY_ROWS) {
  test(`${row.name} runs its finally body exactly once and returns the frozen ${row.expected}`, async () => {
    const { legs } = await tryTwoLegBytes(TRY_POSITIONS[row.name](), runtimeRequest(`d-finally-${row.name}`, {}));
    assert.equal(legs.direct.envelope.outcome, 'success', `D_FINALLY_EXIT: ${row.name} must complete`);
    assert.deepEqual(
      legs.direct.envelope.result,
      integerSlot(row.expected),
      `D_FINALLY_EXIT: ${row.program} must equal the frozen ${row.expected}, so the finally ran exactly once`,
    );
  });
}

// D-7b's two throw exits. A caught throw is covered by the frozen table; a RETHROWN throw leaves the
// handler with no result, so the only observable proof the finally ran is an event it committed --
// and a rethrown `__UserThrow` must leave the `__efN` flag false so the finally still runs.
test('the finally body runs on a rethrown exit, and the throw still escapes as uncaught', async () => {
  const source = TRY_POSITIONS['try-finally-rethrow-prints']();
  await assertTryAdmitted('try-finally-rethrow-prints', source);
  const { legs } = await tryTwoLegBytes(source, runtimeRequest('d-finally-rethrow', {}));
  assert.deepEqual(
    legs.direct.envelope.diagnostics.map((diagnostic) => diagnostic.code),
    ['uncaught-throw'],
    'D_FINALLY_EXIT: a rethrown throw must still escape as uncaught after the finally runs',
  );
  assert.deepEqual(
    legs.direct.envelope.events,
    [{ op: 'stdout', text: 'cleanup' }],
    'D_FINALLY_EXIT: a rethrown __UserThrow leaves the guard flag false, so the finally body must have run exactly once',
  );
});

// D-5d/D-5e, and the reason `finally` is NOT lowered to a bare native finally: native JavaScript
// would run it on a `__Fault`, silently violating the one divergence the tribunal pinned.
test('the finally body runs zero times on an exhausted step budget, even with a catch present', async () => {
  const source = TRY_POSITIONS['try-finally-caught-throw']();
  await assertTryAdmitted('try-finally-caught-throw', source);
  const verified = await project(source);
  const full = await loopStepBudget(source, {}, 'd-finally-limit-full');
  const envelope = await executeKernKir(
    verified,
    stepRequest('d-finally-limit-starved', {}, full.link + full.execution - 1),
    provider([]),
  );
  assert.deepEqual(
    envelope.diagnostics.map((diagnostic) => diagnostic.code),
    ['runtime-limit-exceeded'],
    'D_FINALLY_ON_FAULT: an envelope fault must bypass the finally as well as the catch',
  );
});

test('the finally body runs zero times on cancellation and on timeout', async () => {
  const source = TRY_POSITIONS['try-finally-caught-throw']();
  await assertTryAdmitted('try-finally-caught-throw', source);
  const verified = await project(source);
  for (const [control, code] of [
    [{ preCancelled: true, timeoutMs: null }, 'execution-cancelled'],
    [{ preCancelled: false, timeoutMs: 0 }, 'execution-timeout'],
  ]) {
    const envelope = await executeKernKir(verified, { ...runtimeRequest('d-finally-abort', {}), control }, provider([]));
    assert.deepEqual(
      envelope.diagnostics.map((diagnostic) => diagnostic.code),
      [code],
      `D_FINALLY_ON_FAULT: ${code} must bypass the finally body entirely`,
    );
  }
});

// D-5e's outer guard, which is what covers an envelope fault raised INSIDE the catch body. A bare
// native finally would run in that case too.
test('the emitted lowering carries an outer guard, so a fault inside the catch body also skips the finally', async () => {
  const artifact = await tryArtifact(TRY_POSITIONS['try-finally-caught-throw']());
  assert.ok(
    /__ef[0-9a-z]+/u.test(artifact.text),
    'D_FINALLY_GUARD: the __efN flag must be emitted, or a fault raised inside the catch body still runs the finally',
  );
  assert.ok(
    occurrencesOf(artifact.text, 'finally') >= 1,
    'D_FINALLY_GUARD: a native finally must still be emitted, guarded by the flag rather than bare',
  );
});

// D-5f. The `__efN` flag is what buys emitting the body once instead of duplicating it per exit
// edge, which is the difference between a lowering that scales and one that squares.
test('the emitted finally body appears exactly once, not duplicated per exit edge', async () => {
  const artifact = await tryArtifact(TRY_POSITIONS['try-finally']());
  const body = artifact.text.match(/=\{tag:'integer',value:'3'\}/gu) ?? [];
  assert.equal(
    body.length,
    1,
    `D_FINALLY_DUPLICATED: the finally body must be emitted once and guarded, not copied to every exit edge (found ${body.length})`,
  );
});

// The kernel's own finally-of-last-resort -- the wrapper's `try{}finally{}` that clears the timer and
// removes the listener -- is a different mechanism and must be unmoved.
test('the kernel-owned wrapper finally is unmoved, so the user finally is a separate mechanism', async () => {
  const artifact = await tryArtifact(TRY_POSITIONS['try-finally']());
  assert.ok(
    artifact.text.includes('__runSpecialized'),
    'D_WRAPPER_MOVED: the specialized wrapper must still exist',
  );
  assert.ok(
    artifact.text.includes(USER_THROW_CLASS),
    `D_UNCONDITIONAL_EMISSION: a finally-carrying program still carries ${USER_THROW_CLASS}`,
  );
});
