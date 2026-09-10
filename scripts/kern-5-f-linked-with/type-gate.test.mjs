import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POSITIONS,
  WITH_POSITIONS,
  assertLinkLabel,
  assertNotProjected,
  assertWithAdmitted,
  pythonLegAdmissionColumn,
} from './k0-support.mjs';
import { DECLARED_WITH_LABELS, F5_WALLED_POSITIONS } from './pins.mjs';

// Every row is (position, label). The link code is closed and identical for all of them, so the
// label text is the only thing that says which gate fired.
const SURFACE_REFUSALS = Object.freeze([
  ['neg-with-in-helper', 'KIR_WITH_IN_HELPER'],
  ['neg-with-protocol-with', 'KIR_WITH_PROTOCOL_UNSUPPORTED'],
  ['neg-with-protocol-no-cleanup', 'KIR_WITH_PROTOCOL_UNSUPPORTED'],
  ['neg-with-no-cleanup', 'KIR_WITH_CLEANUP_REQUIRED'],
]);

const CLEANUP_REFUSALS = Object.freeze([
  ['neg-with-cleanup-member-call', 'KIR_WITH_CLEANUP_UNSUPPORTED'],
  ['neg-with-cleanup-json', 'KIR_WITH_CLEANUP_UNSUPPORTED'],
  ['neg-with-cleanup-literal', 'KIR_WITH_CLEANUP_UNSUPPORTED'],
  ['neg-with-cleanup-identifier', 'KIR_WITH_CLEANUP_UNSUPPORTED'],
  ['neg-with-cleanup-binary', 'KIR_WITH_CLEANUP_UNSUPPORTED'],
  ['neg-with-cleanup-void-call', 'KIR_VOID_HANDLER_NO_CALL_FORM'],
]);

const ASYNC_REFUSALS = Object.freeze([
  ['neg-with-flag-without-async-call', 'KIR_WITH_ASYNC_MISMATCH'],
  ['neg-with-async-value-no-flag', 'KIR_WITH_ASYNC_MISMATCH'],
  ['neg-with-async-cleanup-no-flag', 'KIR_WITH_ASYNC_MISMATCH'],
  ['neg-with-async-in-argument', 'KIR_ASYNC_CALL_EXPRESSION_POSITION'],
]);

const SCOPE_REFUSALS = Object.freeze([
  ['neg-with-assign-binding', 'KIR_ASSIGN_TO_WITH_BINDING'],
  ['neg-with-shadow-let', 'duplicate binding'],
  ['neg-with-shadow-parameter', 'duplicate binding'],
  ['neg-with-shadow-counter', 'duplicate binding'],
  ['neg-with-shadow-outer-with', 'duplicate binding'],
  ['neg-with-rebind-in-body', 'duplicate binding r'],
  ['neg-with-value-reads-own-binding', 'unknown identifier r'],
  ['neg-with-cleanup-reads-body-let', 'unknown identifier inner'],
  ['neg-with-read-after', 'unknown identifier r'],
  ['neg-with-body-let-read-after', 'unknown identifier inner'],
]);

const CONTROL_REFUSALS = Object.freeze([
  ['neg-with-empty-body', 'branch block is empty'],
  ['neg-with-break-crosses', 'KIR_LOOP_JUMP_CROSSES_TRY'],
  ['neg-with-continue-crosses', 'KIR_LOOP_JUMP_CROSSES_TRY'],
  ['neg-with-return-in-void-handler', 'KIR_VOID_HANDLER_VALUE_RETURN'],
]);

const REFUSALS = Object.freeze([
  ...SURFACE_REFUSALS,
  ...CLEANUP_REFUSALS,
  ...ASYNC_REFUSALS,
  ...SCOPE_REFUSALS,
  ...CONTROL_REFUSALS,
]);

for (const [position, label] of REFUSALS) {
  test(`${position} is refused at link with ${label}`, async () => {
    const message = await assertLinkLabel(POSITIONS[position](), label);
    for (const other of DECLARED_WITH_LABELS) {
      if (label.includes(other)) continue;
      assert.equal(
        message.includes(other),
        false,
        `F_LABEL_COMPOUND: ${position} must refuse for one cause, and the message also names ${other}`,
      );
    }
  });
}

test('every admitted fixture links on RT-1 and the JavaScript leg and stays Python-deferred', async () => {
  for (const position of Object.keys(WITH_POSITIONS)) {
    const row = await assertWithAdmitted(position, POSITIONS[position]());
    pythonLegAdmissionColumn(row, position);
  }
});

test('the F5-walled fixtures never reach the linker, so no link label is credited to them', async () => {
  for (const position of F5_WALLED_POSITIONS) {
    await assertNotProjected(position, POSITIONS[position]());
  }
});

// F-3a's whole content: the helper refusal must carry its OWN name. `KIR_TRY_FAMILY_IN_HELPER`
// exists and would fire if `with` were routed through the try family, which is the wrong reason.
test('a with in a helper names the with helper gate and never the try-family gate', async () => {
  const message = await assertLinkLabel(POSITIONS['neg-with-in-helper'](), 'KIR_WITH_IN_HELPER');
  assert.equal(
    message.includes('KIR_TRY_FAMILY_IN_HELPER'),
    false,
    'F_LABEL_BORROWED: a with in a helper must not be refused as the try family',
  );
});

// The refusal ORDER, which is what makes every negative single-cause: `protocol=with` with no
// cleanup satisfies two gates and must name the protocol one.
test('protocol is checked before the cleanup requirement, so protocol=with alone names protocol', async () => {
  const message = await assertLinkLabel(POSITIONS['neg-with-protocol-no-cleanup'](), 'KIR_WITH_PROTOCOL_UNSUPPORTED');
  assert.equal(
    message.includes('KIR_WITH_CLEANUP_REQUIRED'),
    false,
    'F_LABEL_COMPOUND: a protocol refusal must not also name the missing cleanup',
  );
});

// `protocol=""` is the property spelled as a no-op; the native codegen normalises it away, so the
// linker must treat it as absent rather than as a protocol request.
test('an empty protocol is absent, not a protocol request', async () => {
  await assertWithAdmitted('with-protocol-empty', POSITIONS['with-protocol-empty']());
  await assertLinkLabel(POSITIONS['neg-with-protocol-with'](), 'KIR_WITH_PROTOCOL_UNSUPPORTED');
});

// The async flag is bidirectional, and both directions must fire the SAME label: an implementation
// that only rejected a missing flag would admit the flag-without-async row and vice versa.
test('the async flag rule refuses in both directions and async=false is absent', async () => {
  for (const position of [
    'neg-with-flag-without-async-call',
    'neg-with-async-value-no-flag',
    'neg-with-async-cleanup-no-flag',
  ]) {
    await assertLinkLabel(POSITIONS[position](), 'KIR_WITH_ASYNC_MISMATCH');
  }
  await assertWithAdmitted('with-async-false', POSITIONS['with-async-false']());
});

// Two gates that must not collapse into one. The acquire follows the `let` rule, so an async call as
// the WHOLE acquire is a statement position and an async call inside an argument is not.
test('an async acquire is a statement position while its arguments are not', async () => {
  await assertWithAdmitted('with-async-acquire', POSITIONS['with-async-acquire']());
  const message = await assertLinkLabel(POSITIONS['neg-with-async-in-argument'](), 'KIR_ASYNC_CALL_EXPRESSION_POSITION');
  assert.equal(
    message.includes('KIR_WITH_ASYNC_MISMATCH'),
    false,
    'F_LABEL_COMPOUND: an async argument is a position refusal, not a flag mismatch',
  );
});

// The binding is immutable for a reason of its own. An implementation that merely left it out of
// `assignable` would refuse with the generic not-a-let label and lose the cause.
test('the with binding is immutable under its own label', async () => {
  const message = await assertLinkLabel(POSITIONS['neg-with-assign-binding'](), 'KIR_ASSIGN_TO_WITH_BINDING');
  for (const other of ['KIR_ASSIGN_TARGET_NOT_LET', 'KIR_ASSIGN_TO_EACH_BINDING', 'KIR_ASSIGN_TO_LOOP_COUNTER']) {
    assert.equal(message.includes(other), false, `F_LABEL_COMPOUND: the with binding must not be refused as ${other}`);
  }
  assert.ok(message.includes('r'), 'F_LABEL_SHAPE: the refusal must name the binding it protects');
});

// F-4c's scope discipline as three separate holes: the acquire is compiled OUTSIDE the with scope,
// the cleanup is compiled BEFORE the body, and nothing the node bound survives it.
test('the acquire cannot see its own binding, the cleanup cannot see a body let, and nothing escapes', async () => {
  await assertLinkLabel(POSITIONS['neg-with-value-reads-own-binding'](), 'unknown identifier r');
  await assertLinkLabel(POSITIONS['neg-with-cleanup-reads-body-let'](), 'unknown identifier inner');
  await assertLinkLabel(POSITIONS['neg-with-read-after'](), 'unknown identifier r');
  await assertLinkLabel(POSITIONS['neg-with-body-let-read-after'](), 'unknown identifier inner');
});
