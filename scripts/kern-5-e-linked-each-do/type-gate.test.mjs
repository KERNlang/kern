import assert from 'node:assert/strict';
import test from 'node:test';

import { pythonLegAdmissionColumn } from '../kern-5-rt4-user-fn-call/k0-support.mjs';
import {
  POSITIONS,
  admission,
  assertEachAdmitted,
  assertLinkLabel,
  assertNotProjected,
} from './k0-support.mjs';
import { DO_LABELS, EACH_LABELS, F5_WALLED_POSITIONS } from './pins.mjs';

// Every row is (position, label). The link code is closed and identical for all of them, so the
// label text is the only thing that says which gate fired.
const DO_REFUSALS = Object.freeze([
  ['do-literal', 'KIR_DO_EXPRESSION_NOT_USER_CALL'],
  ['do-identifier', 'KIR_DO_EXPRESSION_NOT_USER_CALL'],
  ['do-binary', 'KIR_DO_EXPRESSION_NOT_USER_CALL'],
  ['do-unary', 'KIR_DO_EXPRESSION_NOT_USER_CALL'],
  ['do-member', 'KIR_DO_EXPRESSION_NOT_USER_CALL'],
  ['do-list-literal', 'KIR_DO_EXPRESSION_NOT_USER_CALL'],
  ['do-record-literal', 'KIR_DO_EXPRESSION_NOT_USER_CALL'],
  ['do-json-parse', 'KIR_DO_JSON_INTRINSIC_UNSUPPORTED'],
  ['do-json-stringify', 'KIR_DO_JSON_INTRINSIC_UNSUPPORTED'],
  ['do-member-call', 'KIR_DO_MEMBER_CALL_UNSUPPORTED'],
  ['do-void-call', 'KIR_VOID_HANDLER_NO_CALL_FORM'],
  ['do-async-in-argument', 'KIR_ASYNC_CALL_EXPRESSION_POSITION'],
]);

const EACH_REFUSALS = Object.freeze([
  ['each-source-let-list', 'KIR_EACH_SOURCE_NOT_PARAMETER'],
  ['each-source-scalar-parameter', 'KIR_EACH_SOURCE_NOT_LIST'],
  ['each-record-field', 'KIR_EACH_RECORD_FIELD_UNSUPPORTED'],
  ['each-pair-mode', 'KIR_EACH_PAIR_MODE_UNSUPPORTED'],
  ['each-pair-key-only', 'KIR_EACH_PAIR_MODE_UNSUPPORTED'],
  ['each-pair-value-only', 'KIR_EACH_PAIR_MODE_UNSUPPORTED'],
  ['each-entry-mode', 'KIR_EACH_ENTRY_MODE_UNSUPPORTED'],
  ['each-entry-key-only', 'KIR_EACH_ENTRY_MODE_UNSUPPORTED'],
  ['each-entry-value-only', 'KIR_EACH_ENTRY_MODE_UNSUPPORTED'],
  ['each-entries', 'KIR_EACH_ENTRIES_UNSUPPORTED'],
  ['each-await', 'KIR_EACH_AWAIT_UNSUPPORTED'],
  ['each-assign-item', 'KIR_ASSIGN_TO_EACH_BINDING'],
  ['each-assign-index', 'KIR_ASSIGN_TO_EACH_BINDING'],
  ['each-break-crosses-finally', 'KIR_LOOP_JUMP_CROSSES_TRY'],
  ['each-shadow-let', 'duplicate binding'],
  ['each-shadow-parameter', 'duplicate binding'],
  ['each-index-shadows-item', 'duplicate binding'],
  ['each-empty-body', 'branch block is empty'],
]);

const ADMITTED = Object.freeze([
  'do-async-call',
  'do-bare',
  'do-in-each',
  'do-in-for',
  'do-in-try',
  'do-in-while',
  'do-sync-call',
  'do-text-call',
  'each-bool-item-condition',
  'each-bool-item-cross-call',
  'each-break',
  'each-capability-body',
  'each-continue',
  'each-do-async-body',
  'each-in-try',
  'each-index',
  'each-index-as-for-bound',
  'each-int-item-as-for-bound',
  'each-int-item-sum',
  'each-nested-each',
  'each-nested-for-break',
  'each-nested-while-continue',
  'each-plain',
  'each-print-body',
  'each-text-item-cross-call',
  'each-try-finally-in-body',
]);

for (const [position, label] of [...DO_REFUSALS, ...EACH_REFUSALS]) {
  test(`${position} is refused at link with ${label}`, async () => {
    const message = await assertLinkLabel(POSITIONS[position](), label);
    const others = [...DO_LABELS, ...EACH_LABELS].filter((other) => other !== label);
    for (const other of others) {
      assert.equal(
        message.includes(other),
        false,
        `E_LABEL_COMPOUND: ${position} must refuse for one cause, and the message also names ${other}`,
      );
    }
  });
}

test('every admitted fixture links on RT-1 and the JavaScript leg and stays Python-deferred', async () => {
  for (const position of ADMITTED) {
    const row = await assertEachAdmitted(position, POSITIONS[position]());
    pythonLegAdmissionColumn(row, position);
  }
});

test('the F5-walled fixtures never reach the linker, so no link label is credited to them', async () => {
  for (const position of F5_WALLED_POSITIONS) {
    await assertNotProjected(position, POSITIONS[position]());
  }
});

// Two gates that must not collapse into one. `each-source-let-list` binds a real list value, so an
// implementation that only checked "is this identifier bound?" would admit it; one that only checked
// "is this a parameter?" would give the not-a-list message for a scalar parameter.
test('the source gate distinguishes a non-parameter from a non-list parameter', async () => {
  const letList = await assertLinkLabel(POSITIONS['each-source-let-list'](), 'KIR_EACH_SOURCE_NOT_PARAMETER');
  assert.equal(letList.includes('KIR_EACH_SOURCE_NOT_LIST'), false);
  const scalar = await assertLinkLabel(POSITIONS['each-source-scalar-parameter'](), 'KIR_EACH_SOURCE_NOT_LIST');
  assert.equal(scalar.includes('KIR_EACH_SOURCE_NOT_PARAMETER'), false);
});

// The item and the index are both immutable, and both must carry the SAME label: an implementation
// that only excluded the item from `assignable` would let the index through with
// KIR_ASSIGN_TARGET_NOT_LET or admit it outright.
test('both each bindings are immutable under one label', async () => {
  for (const position of ['each-assign-item', 'each-assign-index']) {
    const message = await assertLinkLabel(POSITIONS[position](), 'KIR_ASSIGN_TO_EACH_BINDING');
    assert.equal(
      message.includes('KIR_ASSIGN_TARGET_NOT_LET'),
      false,
      `E_LABEL_COMPOUND: ${position} must not fall through to the generic not-a-let refusal`,
    );
    assert.equal(message.includes('KIR_ASSIGN_TO_LOOP_COUNTER'), false, position);
  }
});

// An async call is admitted as the WHOLE value of a `do` and refused inside an argument, which is
// the same split `let`/`print`/`return` already carry. One `statementValue` flag decides both, so a
// wrong flag flips exactly these two rows in opposite directions.
test('an async do is a statement position while its arguments are not', async () => {
  await assertEachAdmitted('do-async-call', POSITIONS['do-async-call']());
  await assertLinkLabel(POSITIONS['do-async-in-argument'](), 'KIR_ASYNC_CALL_EXPRESSION_POSITION');
});

test('a do of a void helper refuses on the existing void-call contract, not a new label', async () => {
  const message = await assertLinkLabel(POSITIONS['do-void-call'](), 'KIR_VOID_HANDLER_NO_CALL_FORM');
  for (const label of DO_LABELS) {
    assert.equal(message.includes(label), false, `E_LABEL_COMPOUND: a void do must not also name ${label}`);
  }
});

test('a bare do and its twin differ only by the do, and both link', async () => {
  await assertEachAdmitted('do-bare', POSITIONS['do-bare']());
  const twin = await admission(POSITIONS['do-bare-twin']());
  assert.equal(twin.rt1, 'admitted', 'E_TWIN_BROKEN: the bare-do twin must link at base and after');
});
