import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  JUMP_METER_POSITIONS,
  JUMP_POSITIONS,
  JUMP_TWINS,
  between,
  countOccurrences,
  jumpArtifact,
} from './k0-support.mjs';

const RT1_EVALUATOR_URL = new URL('../../packages/core/src/kir-runtime/expression.ts', import.meta.url);

const CHECKPOINT = '__checkAbort()';
const SUSPENSION_TOKENS = Object.freeze(['setImmediate', 'queueMicrotask', 'new Promise', 'asyncio.create_task']);
const HOST_PATTERNS = Object.freeze(['JSON.', 'process', 'eval(', 'Function(', 'require(', 'node:']);

const ALL_SOURCES = Object.freeze({ ...JUMP_POSITIONS, ...JUMP_METER_POSITIONS, ...JUMP_TWINS });

// Three nested extractions, because each answers a different question: the whole artifact carries
// the kernel, the specialized handler carries a prologue that defines the checkpoint, and only the
// statement region is the code this slice emits.
async function region(name) {
  const artifact = await jumpArtifact(ALL_SOURCES[name]());
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

async function checkpoints(name) {
  return countOccurrences((await region(name)).statements, CHECKPOINT);
}

function jumpTokens(source, keyword) {
  return [...source.matchAll(new RegExp(`\\b${keyword}\\s*;`, 'gu'))].length;
}

// GREEN at base and must stay GREEN. RT12J-D1 was chosen precisely so that `break` needs no head
// charge and `continue` reuses the existing frame-exhaustion branch, which means neither arm may
// introduce a third observation point.
test('RT-1 still carries exactly two checkAbort sites, and a jump adds none', async () => {
  const source = await readFile(RT1_EVALUATOR_URL, 'utf8');
  assert.equal(
    countOccurrences(source, CHECKPOINT.replace('__', '')),
    2,
    'RT12J_CHECKPOINT_CREEP: the statement-boundary and the loop-head checkpoints are the only two',
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

// The jump arms belong after `if (statement.kind === 'let')`, which puts them outside this window by
// construction; and any pop helper dropped into the loop-head window must carry no checkpoint of
// its own, or the total would stay at two and this row would still fire.
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

// J8. A jump is charged as an ordinary leaf and nothing more, asserted as a census difference
// against two twins rather than as an absolute count: one twin adds an ordinary statement to the
// same loop body, the other adds a jump. Both must add exactly one checkpoint, so the two
// differences are equal AND each is one. A jump lowered without the ordinary statement checkpoint
// gives zero; one that also emitted a head checkpoint gives two.
test('a jump adds exactly one emitted checkpoint, the same as an ordinary body statement', async () => {
  const base = await checkpoints('twin-for-1-leaf');
  const withLeaf = await checkpoints('twin-for-1-two-leaves');
  const withBreak = await checkpoints('meter-for-1-leaf-break');
  assert.equal(withLeaf - base, 1, 'the control twin must add exactly one checkpoint for its extra statement');
  assert.equal(
    withBreak - base,
    1,
    'RT12J_CHECKPOINT_DRIFT: a break must carry the ordinary statement checkpoint and no second one',
  );
  const continueBase = await checkpoints('twin-for-3-leaf');
  assert.equal(
    (await checkpoints('meter-for-3-leaf-continue')) - continueBase,
    1,
    'RT12J_CHECKPOINT_DRIFT: a continue must carry the ordinary statement checkpoint and no second one',
  );
});

// J9. Cancellation latency never widens: a jump may add a checkpoint but may never remove one, so
// every jump fixture carries at least as many as the jump-free twin of the same loop shape. A
// lowering that hoisted a jump above the loop head, or that replaced the head checkpoint with the
// jump's own, would show up here and nowhere else.
test('no jump lowering removes a checkpoint from the region it sits in', async () => {
  for (const [jump, twin] of [
    ['meter-for-1-leaf-break', 'twin-for-1-leaf'],
    ['meter-for-3-leaf-continue', 'twin-for-3-leaf'],
    ['meter-while-1-leaf-break', 'twin-while-1-leaf'],
    ['meter-while-3-leaf-continue', 'twin-while-3-leaf'],
    ['meter-nested-3x5-leaf-break', 'twin-nested-3x1-leaf'],
    ['meter-nested-3x2-leaf-continue', 'twin-nested-3x2-leaf'],
  ]) {
    assert.ok(
      (await checkpoints(jump)) >= (await checkpoints(twin)),
      `RT12J_CHECKPOINT_LOSS: ${jump} carries fewer checkpoints than ${twin}`,
    );
  }
});

// The tribunal pinned native jumps: a host keyword, never a signal object and never a throw. The
// fault channel rt4 owns is untouched, which is what keeps the whole slice free of a new host
// pattern and free of a new kernel byte.
test('both jump kinds lower to a native host keyword and never to a signal object', async () => {
  const withBreak = (await region('meter-for-1-leaf-break')).statements;
  assert.equal(jumpTokens(withBreak, 'break'), 1, 'RT12J_JS_SHAPE: a for body with one user break emits one break');
  const withContinue = (await region('meter-for-3-leaf-continue')).statements;
  assert.equal(jumpTokens(withContinue, 'continue'), 1, 'RT12J_JS_SHAPE: one user continue emits one continue');
  for (const source of [withBreak, withContinue]) {
    for (const token of ['__Break', '__Continue', '__Jump']) {
      assert.equal(source.includes(token), false, `RT12J_JS_SHAPE: no signal-object lowering (${token})`);
    }
  }
  const twinThrows = countOccurrences((await region('twin-for-1-leaf')).statements, 'throw ');
  assert.equal(
    countOccurrences(withBreak, 'throw '),
    twinThrows,
    'RT12J_JS_SHAPE: a break must add no throw the jump-free twin does not have',
  );
});

// The `while` lowering's own exit is a native break too, so the count is the discriminator rather
// than the presence: the emitted region for a condition loop with one user break carries exactly
// two break tokens, and its jump-free twin exactly one.
test('a while region carries the lowering exit break plus one per user break', async () => {
  const twin = (await region('twin-while-1-leaf')).statements;
  assert.equal(jumpTokens(twin, 'break'), 1, 'RT12J_JS_SHAPE: the while lowering carries its own exit break');
  const withBreak = (await region('meter-while-1-leaf-break')).statements;
  assert.equal(
    jumpTokens(withBreak, 'break'),
    2,
    'RT12J_JS_SHAPE: a while with one user break emits the exit break and the user break',
  );
});

// A native jump cannot cross a JavaScript function boundary, so the lowering may introduce no
// callable of its own — asserted as a token equality against the jump-free twin rather than as an
// absolute census, and then again from the loop head onwards where the jump actually sits.
test('a jump introduces no function and no arrow the jump-free twin does not have', async () => {
  for (const [jump, twin] of [
    ['meter-for-1-leaf-break', 'twin-for-1-leaf'],
    ['meter-for-3-leaf-continue', 'twin-for-3-leaf'],
    ['meter-while-1-leaf-break', 'twin-while-1-leaf'],
  ]) {
    const withJump = (await region(jump)).statements;
    const control = (await region(twin)).statements;
    for (const token of ['function', '=>']) {
      assert.equal(
        countOccurrences(withJump, token),
        countOccurrences(control, token),
        `RT12J_BODY_WRAPPED: ${jump} must not add a ${token} that ${twin} does not have`,
      );
    }
    const head = withJump.slice(withJump.search(/(for|while)\s*\(/u));
    assert.equal(countOccurrences(head, 'function'), 0, 'RT12J_BODY_WRAPPED: the loop body is not a function body');
    assert.equal(countOccurrences(head, '=>'), 0, 'RT12J_BODY_WRAPPED: the loop body is not a per-trip closure');
  }
});

// Zero new suspension points and zero new host patterns. Neither jump kind admits a capability as a
// sibling, so a jump-carrying region has nothing to await.
test('the emitted jump regions introduce no suspension point and no forbidden host pattern', async () => {
  for (const name of [
    'for-break',
    'for-continue',
    'while-break',
    'while-continue',
    'while-true-break-counter',
    'nested-inner-break',
  ]) {
    const statements = (await region(name)).statements;
    for (const token of SUSPENSION_TOKENS) {
      assert.equal(statements.includes(token), false, `${name}: a jump must not use ${token}`);
    }
    assert.equal(
      statements.includes('await '),
      false,
      `RT12J_AWAIT_LEAK: ${name} has no capability in its body, so its region must carry no await`,
    );
    for (const token of HOST_PATTERNS) {
      assert.equal(statements.includes(token), false, `RT12J_HOST_PATTERN: ${name} must not reach for ${token}`);
    }
  }
});

// The kernel is where a helper would have to live if a jump needed one. It does not, so the kernel
// region of a jump-carrying artifact must be byte-identical to that of a jump-free one — a stronger
// claim than a digest pin, because it is asserted per artifact rather than per source file.
test('a jump adds no line to the JavaScript target kernel', async () => {
  const control = (await region('twin-for-1-leaf')).kernel;
  for (const name of ['meter-for-1-leaf-break', 'meter-for-3-leaf-continue', 'while-true-break-counter']) {
    assert.equal(
      (await region(name)).kernel,
      control,
      `RT12J_KERNEL_TOUCH: ${name} moved a byte of the shared kernel`,
    );
  }
  assert.ok(control.includes('__Fault'), 'the fault class the loop gates raise must already be there');
});
