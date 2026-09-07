import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  WHILE_METER_POSITIONS,
  WHILE_POSITIONS,
  WHILE_TWINS,
  between,
  countOccurrences,
  javascriptArtifact,
} from './k0-support.mjs';

const RT1_EVALUATOR_URL = new URL('../../packages/core/src/kir-runtime/expression.ts', import.meta.url);

const CHECKPOINT = '__checkAbort()';
const SUSPENSION_TOKENS = Object.freeze(['setImmediate', 'queueMicrotask', 'new Promise', 'asyncio.create_task']);

// Three nested extractions, because each answers a different question: the whole artifact carries
// the kernel, the specialized handler carries a prologue that defines the checkpoint, and only the
// statement region is the code this slice emits.
async function region(source) {
  const artifact = await javascriptArtifact(source);
  const specialized = between(
    artifact,
    'const __runSpecialized=',
    'const execute=async(input,executionOptions)',
    'the emitted JavaScript specialized handler',
  );
  return {
    kernel: between(artifact, 'function __module()', 'const __runSpecialized=', 'the JavaScript target kernel'),
    statements: between(specialized, '    try {', '    } finally {', 'the JavaScript statement region'),
  };
}

async function checkpoints(source) {
  return countOccurrences((await region(source)).statements, CHECKPOINT);
}

// The reconciliation this slice owes, asserted on the interpreter itself rather than on emitted
// code. `for` charges its head inside the successful trip, not on the failed final probe, so a
// `while` that adopts the same placement needs no new site — and this pin is what says so. It is
// GREEN at base and must stay GREEN: a third site means the tick-discipline decision was changed.
test('RT-1 still carries exactly two checkAbort sites, and while adds none', async () => {
  const source = await readFile(RT1_EVALUATOR_URL, 'utf8');
  assert.equal(
    countOccurrences(source, CHECKPOINT.replace('__', '')),
    2,
    'RT11W_CHECKPOINT_CREEP: the statement-boundary and the loop-head checkpoints are the only two',
  );
});

test('the RT-1 statement-boundary site checks abort exactly once', async () => {
  const source = await readFile(RT1_EVALUATOR_URL, 'utf8');
  const boundary = between(
    source,
    'const statement = frame.statements[frame.index];',
    "if (statement.kind === 'let')",
    'the statement-boundary checkpoint site',
  );
  assert.equal(countOccurrences(boundary, 'checkAbort()'), 1, 'the statement-boundary site must check abort once');
});

// The loop-head site is where `while` must live. The region boundaries are the same ones rt10-pre
// isolates, so a `whileContinues` helper dropped into this window carrying its own checkpoint would
// keep the total at two and still break this row.
test('the RT-1 loop-head site checks abort exactly once and is shared by both loop forms', async () => {
  const source = await readFile(RT1_EVALUATOR_URL, 'utf8');
  const loopHead = between(
    source,
    'const enterTrip = (loop: LoopState): void => {',
    'while (frames.length > 0) {',
    'the loop-head checkpoint site',
  );
  assert.equal(countOccurrences(loopHead, 'checkAbort()'), 1, 'the loop-head site must check abort exactly once');
});

// A loop is the first construct whose statement count is not bounded by the program text, so its
// head must carry a checkpoint. The claim is a difference against the straight-line twin with the
// identical body, so it pins "exactly one new site" without hardcoding an absolute census.
test('a while adds exactly one checkpoint over the same body written straight-line', async () => {
  const loop = await checkpoints(WHILE_METER_POSITIONS['meter-trips-3']());
  const straight = await checkpoints(WHILE_TWINS['twin-two-lets-assign']());
  assert.equal(
    loop - straight,
    1,
    'RT11W_CHECKPOINT_DRIFT: the JavaScript while head must carry exactly one checkpoint',
  );
});

test('a nested while carries one checkpoint per head, so nesting cannot lose one', async () => {
  const single = await checkpoints(WHILE_METER_POSITIONS['meter-trips-3']());
  const nested = await checkpoints(WHILE_METER_POSITIONS['meter-nested-2x2']());
  assert.equal(nested - single, 1, 'the inner head is a second checkpoint site');
});

// A `while` and a `for` over the same body must carry the same emitted checkpoint census: one head
// each. A leg that charged the failed final probe would carry two for the while and one for the for.
test('a while and a for carry the identical emitted checkpoint census for one head', async () => {
  const viaWhile = await checkpoints(WHILE_METER_POSITIONS['meter-trips-3']());
  const viaFor = await checkpoints(WHILE_METER_POSITIONS['meter-for-trips-3']());
  const increment = await checkpoints(WHILE_TWINS['twin-two-lets-assign']());
  const plain = await checkpoints(WHILE_TWINS['twin-assign-one']());
  assert.equal(
    viaWhile - viaFor,
    increment - plain,
    'RT11W_CHECKPOINT_DRIFT: the two loop forms must differ only by the counter statement',
  );
});

// The tribunal pinned native jumps. `while(true)` plus a `break` is one, and it is the minimal
// shape that can unwrap a tagged condition and tag-check it before believing it.
test('the JavaScript leg lowers the loop to a host while with a native break', async () => {
  const statements = (await region(WHILE_POSITIONS['while-counted-3']())).statements;
  assert.match(statements, /while\s*\(/u, 'RT11W_JS_SHAPE: the loop must be a host while statement');
  assert.match(statements, /\bbreak\b/u, 'RT11W_JS_SHAPE: the exit must be a native jump, not a signal object');
  assert.equal(statements.includes('__Break'), false, 'RT11W_JS_SHAPE: no signal-object lowering');
  assert.equal(statements.includes('__Continue'), false, 'RT11W_JS_SHAPE: no signal-object lowering');
});

// Item 4b, and the constraint a later native `break`/`continue` depends on: the body is emitted
// INLINE inside the host loop, never wrapped in a function or a per-trip closure. Asserted
// structurally rather than by formatting — the same body under `for` is the control, so the claim is
// that the while lowering introduces no callable of its own, whatever the surrounding census is.
test('the while lowering keeps the body inline and introduces no function or arrow of its own', async () => {
  const viaWhile = (await region(WHILE_METER_POSITIONS['meter-trips-3']())).statements;
  const viaFor = (await region(WHILE_METER_POSITIONS['meter-for-trips-3']())).statements;
  for (const token of ['function', '=>']) {
    assert.equal(
      countOccurrences(viaWhile, token),
      countOccurrences(viaFor, token),
      `RT11W_BODY_WRAPPED: the while lowering must not add a ${token} the for lowering does not have`,
    );
  }
  const head = viaWhile.slice(viaWhile.search(/while\s*\(/u));
  assert.equal(
    countOccurrences(head, 'function'),
    0,
    'RT11W_BODY_WRAPPED: nothing from the loop head onwards may be a function body',
  );
  assert.equal(countOccurrences(head, '=>'), 0, 'RT11W_BODY_WRAPPED: the body must not be a per-trip closure');
});

// Zero new host patterns, and zero new suspension points. `while`'s allowedChildren admits no
// capability and an async condition is refused at link, so a while region has nothing to await.
test('the emitted while region introduces no suspension point and no forbidden host pattern', async () => {
  for (const name of ['while-counted-3', 'while-nested-while', 'while-if-in-body', 'while-early-return']) {
    const statements = (await region(WHILE_POSITIONS[name]())).statements;
    for (const token of SUSPENSION_TOKENS) {
      assert.equal(statements.includes(token), false, `${name}: the while must not use ${token}`);
    }
    assert.equal(
      statements.includes('await '),
      false,
      `RT11W_AWAIT_LEAK: ${name} has no capability in its body, so its region must carry no await`,
    );
    for (const token of ['JSON.', 'process', 'eval(', 'Function(', 'require(', 'node:']) {
      assert.equal(statements.includes(token), false, `RT11W_HOST_PATTERN: ${name} must not reach for ${token}`);
    }
  }
});

// The whole point of reusing the `if` arm's tag check and the existing meter helpers: the loop is
// per-program code and no kernel byte moves. If this fires, every emitted-artifact digest moved.
test('the while lowering adds no line to the JavaScript target kernel', async () => {
  const parts = await region(WHILE_POSITIONS['while-counted-3']());
  assert.equal(
    countOccurrences(parts.kernel, 'while(true)'),
    0,
    'RT11W_KERNEL_TOUCH: the loop head belongs to the specialized handler',
  );
  assert.ok(parts.kernel.includes('__checkAbort'), 'the kernel helper the loop reuses must already be there');
  assert.ok(parts.kernel.includes('__Fault'), 'the fault class the tag check raises must already be there');
});
