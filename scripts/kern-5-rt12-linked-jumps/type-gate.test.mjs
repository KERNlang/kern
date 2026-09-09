import assert from 'node:assert/strict';
import test from 'node:test';

import { POSITIONS } from '../kern-5-rt10-for/k0-support.mjs';
import {
  JUMP_POSITIONS,
  JUMP_TABLE_ROWS,
  WHILE_POSITIONS,
  assertJumpAdmitted,
  assertLinkLabel,
  pythonLegAdmissionColumn,
} from './k0-support.mjs';

const BREAK_LABEL = 'KIR_BREAK_OUTSIDE_LOOP';
const CONTINUE_LABEL = 'KIR_CONTINUE_OUTSIDE_LOOP';
const LEAF_LABEL = 'statement must be a leaf';

// Every row is (position, label). The link code is closed and identical for all of them, so the
// label text is the only thing that says which gate fired.
const REFUSALS = Object.freeze([
  ['neg-break-top-level', BREAK_LABEL],
  ['neg-continue-top-level', CONTINUE_LABEL],
  ['neg-break-in-if-outside-loop', BREAK_LABEL],
  ['neg-continue-in-if-outside-loop', CONTINUE_LABEL],
  ['neg-break-in-if-else-outside-loop', BREAK_LABEL],
  ['neg-break-after-loop', BREAK_LABEL],
  ['neg-continue-after-loop', CONTINUE_LABEL],
  ['neg-break-in-helper-from-loop', BREAK_LABEL],
  ['neg-continue-in-helper-from-loop', CONTINUE_LABEL],
  ['neg-return-then-break-top-level', BREAK_LABEL],
  ['neg-return-then-continue-top-level', CONTINUE_LABEL],
  ['neg-break-with-children-in-loop', LEAF_LABEL],
  ['neg-break-with-children-top-level', LEAF_LABEL],
  ['neg-continue-with-children-in-loop', LEAF_LABEL],
  ['neg-void-return-in-for-body', 'KIR_VOID_HANDLER_VALUE_RETURN'],
]);

const ADMITTED = Object.freeze([
  ...JUMP_TABLE_ROWS.map((row) => row.name),
  'for-break-bound-1',
  'for-break-bound-3',
  'for-break-bound-10',
  'void-break-in-loop',
  'while-continue-skips-increment',
]);

for (const [position, label] of REFUSALS) {
  test(`${position} is refused at link with ${label}`, async () => {
    await assertLinkLabel(JUMP_POSITIONS[position](), label);
  });
}

test('every admitted jump position links on RT-1 and the JavaScript leg', async () => {
  for (const position of ADMITTED) {
    await assertJumpAdmitted(position, JUMP_POSITIONS[position]());
  }
});

// The per-kind labels, and the reason there are two of them: every landed type-gate oracle
// discriminates fixtures by label text, so a `break` row and a `continue` row have to separate
// without parsing the label path. A single shared label would pass both halves of this row.
test('the two jump kinds carry distinct outside-loop labels that cannot be confused', async () => {
  const broke = await assertLinkLabel(JUMP_POSITIONS['neg-break-top-level'](), BREAK_LABEL);
  assert.ok(
    !broke.includes(CONTINUE_LABEL),
    'RT12J_LABEL_DRIFT: a break must not report the continue label',
  );
  const kept = await assertLinkLabel(JUMP_POSITIONS['neg-continue-top-level'](), CONTINUE_LABEL);
  assert.ok(!kept.includes(BREAK_LABEL), 'RT12J_LABEL_DRIFT: a continue must not report the break label');
  for (const message of [broke, kept]) {
    assert.ok(
      !message.includes('is outside RT-1'),
      'RT12J_ROUTE_GAP: a jump must be routed, so the kind fallthrough cannot be what refuses',
    );
    assert.ok(!message.includes(LEAF_LABEL), 'RT12J_ROUTE_GAP: a childless jump is not a leaf-gate refusal');
  }
});

// `if` copies the enclosing scope, so depth is inherited in both directions: a jump inside an `if`
// inside a loop is admitted, and a jump inside an `if` that is not inside a loop is refused. A
// depth field that lived on `compileBlock` rather than on the scope would pass one half and fail
// the other.
test('an if inherits loop depth, so the same jump flips verdict with the if position', async () => {
  for (const [position, label] of [
    ['neg-break-in-if-outside-loop', BREAK_LABEL],
    ['neg-continue-in-if-outside-loop', CONTINUE_LABEL],
    ['neg-break-in-if-else-outside-loop', BREAK_LABEL],
  ]) {
    const message = await assertLinkLabel(JUMP_POSITIONS[position](), label);
    assert.match(message, /\.(then|else)\.children\[/u, `${position}: the refusal must be attributed to the branch`);
  }
  for (const position of ['for-break-under-if', 'for-continue-under-if', 'for-break-if-else', 'for-continue-if-else']) {
    await assertJumpAdmitted(position, JUMP_POSITIONS[position]());
  }
  for (const position of ['while-break-under-if', 'while-continue-under-if']) {
    await assertJumpAdmitted(position, JUMP_POSITIONS[position]());
  }
});

// The function boundary. `compileHandler` builds a fresh scope per function, so a helper compiled
// while the caller is inside a loop body still starts at depth zero — and it has to, because a
// native jump cannot cross a JavaScript function boundary and the artifact would not parse.
test('a jump in a helper body is refused even when the helper is called from inside a loop', async () => {
  for (const [position, label] of [
    ['neg-break-in-helper-from-loop', BREAK_LABEL],
    ['neg-continue-in-helper-from-loop', CONTINUE_LABEL],
  ]) {
    const message = await assertLinkLabel(JUMP_POSITIONS[position](), label);
    assert.match(
      message,
      /^helper\./u,
      `RT12J_BOUNDARY_LEAK: ${position} must be refused inside the helper, not attributed to the caller's loop`,
    );
  }
  await assertJumpAdmitted('jump-in-loop-in-helper', JUMP_POSITIONS['jump-in-loop-in-helper']());
});

// Loop depth is left, not only entered. A jump after the loop closes sits at depth zero again, so
// an implementation that incremented on entry and never restored would admit these two.
test('loop depth is restored when the loop closes, so a jump after it is outside every loop', async () => {
  for (const [position, label] of [
    ['neg-break-after-loop', BREAK_LABEL],
    ['neg-continue-after-loop', CONTINUE_LABEL],
  ]) {
    const message = await assertLinkLabel(JUMP_POSITIONS[position](), label);
    assert.ok(
      !message.includes('.body.children['),
      `RT12J_DEPTH_LEAK: ${position} is a handler-level statement, not a loop body child`,
    );
  }
});

// The leaf gate runs before every kind branch, so it wins whether or not the jump sits inside a
// loop. Both halves matter: inside a loop the depth gate would otherwise admit it, and outside one
// the depth gate would otherwise claim it.
test('the leaf gate wins over the depth gate, inside a loop and outside one', async () => {
  for (const position of [
    'neg-break-with-children-in-loop',
    'neg-break-with-children-top-level',
    'neg-continue-with-children-in-loop',
  ]) {
    const message = await assertLinkLabel(JUMP_POSITIONS[position](), LEAF_LABEL);
    for (const label of [BREAK_LABEL, CONTINUE_LABEL]) {
      assert.ok(
        !message.includes(label),
        `RT12J_GATE_ORDER: ${position} must be refused as a non-leaf before any depth decision`,
      );
    }
  }
});

// The sharp ordering discriminator for the single-return rule: `compileBlock` compiles every child
// before `compileHandler` reaches its return check, so a trailing top-level jump is refused for
// being outside a loop and never for breaking the one-final-return shape.
test('a top-level jump after the final return is refused for its depth, not for the return rule', async () => {
  for (const [position, label] of [
    ['neg-return-then-break-top-level', BREAK_LABEL],
    ['neg-return-then-continue-top-level', CONTINUE_LABEL],
  ]) {
    const message = await assertLinkLabel(JUMP_POSITIONS[position](), label);
    assert.ok(
      !message.includes('expected exactly one final return'),
      `RT12J_GATE_ORDER: ${position} must be decided by compileBlock before the return check runs`,
    );
  }
});

// `containsReturn` is a `.some` predicate over four kinds; an unrecognised kind is simply `false`
// and a jump owns no block that could hide a `return`, so no arm is needed. Both halves are here:
// the void handler with a jump links, the one with a nested return is still refused.
test('a void handler with a jump in its loop body links while a nested return is still refused', async () => {
  await assertJumpAdmitted('void-break-in-loop', JUMP_POSITIONS['void-break-in-loop']());
  const message = await assertLinkLabel(
    JUMP_POSITIONS['neg-void-return-in-for-body'](),
    'KIR_VOID_HANDLER_VALUE_RETURN',
  );
  assert.ok(
    !message.includes('did not return'),
    'RT12J_RETURN_BLIND: the refusal must come from the link-time return walk, not from execution',
  );
});

// A trailing comment is dropped by F5, so the property map a jump reaches the linker with is empty
// and the commented form has to link exactly like the bare one. The link-time property gate is
// therefore pure defence in depth, which this row settles either way.
test('a commented jump links exactly like a bare one', async () => {
  for (const position of ['for-break-trailing-comment', 'for-continue-trailing-comment']) {
    const row = await assertJumpAdmitted(position, JUMP_POSITIONS[position]());
    pythonLegAdmissionColumn(row, position);
  }
});

// Every loop form and nesting position a jump reaches: both loop kinds, a loop of each kind inside
// the other, and a nested pair of the same kind. A depth field wired into only one of the two loop
// compilers passes half of this row.
test('a jump links in every loop form and every nesting position', async () => {
  for (const position of [
    'for-break',
    'for-continue',
    'while-break',
    'while-continue',
    'while-true-break-counter',
    'nested-inner-break',
    'nested-inner-continue',
    'nested-outer-break',
    'for-in-while-break',
    'while-in-for-break',
  ]) {
    await assertJumpAdmitted(position, JUMP_POSITIONS[position]());
  }
});

// Unreachable code after a jump is admitted and never analysed, because refusing it would be the
// linker's first reachability rule and `return` would immediately make it inconsistent.
test('statements after an unconditional jump are admitted and not analysed', async () => {
  for (const position of ['for-break-dead-tail', 'for-continue-dead-tail', 'for-break-dead-return']) {
    await assertJumpAdmitted(position, JUMP_POSITIONS[position]());
  }
});

// The two suites this slice invalidates rows in, re-asserted from the other side: the fixtures
// rt10-for and rt11 pinned as *refused* are now admitted, and every neighbour gate they guard is
// untouched.
test('the for and while slices keep every one of their own admitted positions', async () => {
  for (const position of ['for-sum-0-3', 'for-nested-acc', 'for-if-in-body', 'for-early-return', 'for-in-helper-body']) {
    const row = await assertJumpAdmitted(position, POSITIONS[position]());
    assert.equal(row.python, 'admitted', `RT10F_REGRESSION: ${position} must still compile on the Python leg`);
  }
  for (const position of ['while-counted-3', 'while-nested-while', 'while-if-in-body']) {
    await assertJumpAdmitted(position, WHILE_POSITIONS[position]());
  }
  const counterMessage = await assertLinkLabel(POSITIONS['neg-assign-counter'](), 'KIR_ASSIGN_TO_LOOP_COUNTER');
  assert.ok(
    counterMessage.includes('KIR_ASSIGN_TO_LOOP_COUNTER'),
    'RT10F_REGRESSION: the for counter gate must still fire, so the jump slice did not widen assignable',
  );
  await assertLinkLabel(WHILE_POSITIONS['neg-while-empty-body'](), 'branch block is empty');
});
