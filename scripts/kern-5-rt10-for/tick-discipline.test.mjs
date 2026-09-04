import assert from 'node:assert/strict';
import test from 'node:test';

import { METER_POSITIONS, POSITIONS, TWINS, between, countOccurrences, emittedArtifacts } from './k0-support.mjs';

const JAVASCRIPT_CHECKPOINT = '__checkAbort()';
const PYTHON_CHECKPOINT = '_check_abort()';

const SUSPENSION_TOKENS = Object.freeze(['setImmediate', 'queueMicrotask', 'new Promise', 'asyncio.create_task']);

// Four nested extractions, because each answers a different question and a wider one would answer
// it wrongly: the whole artifact carries the kernel, the specialized handler carries a prologue that
// defines the checkpoint and an external-signal watcher that legitimately awaits, and only the
// statement region is the code this slice emits.
async function regions(source) {
  const artifacts = await emittedArtifacts(source);
  const javascriptSpecialized = between(
    artifacts.javascript,
    'const __runSpecialized=',
    'const execute=async(input,executionOptions)',
    'the emitted JavaScript specialized handler',
  );
  const pythonSpecialized = between(
    artifacts.python,
    'async def _run_specialized(',
    'async def execute(',
    'the emitted Python specialized handler',
  );
  return {
    javascript: between(javascriptSpecialized, '    try {', '    } finally {', 'the JavaScript statement region'),
    javascriptKernel: between(
      artifacts.javascript,
      'function __module()',
      'const __runSpecialized=',
      'the JavaScript target kernel',
    ),
    python: between(pythonSpecialized, '    try:', '    finally:', 'the Python statement region'),
    pythonKernel: between(artifacts.python, 'class _Fault', 'async def _run_specialized(', 'the Python target kernel'),
  };
}

function checkpoints(region) {
  return {
    javascript: countOccurrences(region.javascript, JAVASCRIPT_CHECKPOINT),
    python: countOccurrences(region.python, PYTHON_CHECKPOINT),
  };
}

function awaits(region) {
  return {
    javascript: countOccurrences(region.javascript, 'await '),
    python: countOccurrences(region.python, 'await '),
  };
}

// A loop is the first construct on this base whose statement count is not bounded by the program
// text, so its head must carry a checkpoint or a long loop is uninterruptible for its whole run.
// The claim is a difference against the straight-line twin with the identical body, so it pins
// "exactly one new site" without hardcoding either leg's absolute census.
test('a loop adds exactly one checkpoint over the same body written straight-line', async () => {
  const loop = checkpoints(await regions(METER_POSITIONS['meter-trips-3']()));
  const straight = checkpoints(await regions(TWINS['twin-assign-one']()));
  assert.equal(
    loop.javascript - straight.javascript,
    1,
    'RT10F_CHECKPOINT_DRIFT: the JavaScript loop head must carry exactly one checkpoint',
  );
  assert.equal(
    loop.python - straight.python,
    1,
    'RT10F_CHECKPOINT_DRIFT: the Python loop head must carry exactly one checkpoint',
  );
});

// Neither `print` nor `capability` is admissible in a loop body, and those are the only two
// statements whose two lowerings differ in checkpoint count, so every loop fixture must carry the
// same census on both legs. A leg that grew a checkpoint of its own separates here.
test('both emitted legs carry the identical statement-region checkpoint census for every loop', async () => {
  for (const name of ['for-sum-0-3', 'for-nested-acc', 'for-if-in-body', 'for-early-return', 'for-helper-in-body']) {
    const census = checkpoints(await regions(POSITIONS[name]()));
    assert.equal(census.javascript, census.python, `${name}: the two legs must charge the same checkpoints`);
  }
});

test('a nested loop carries one checkpoint per loop head, so nesting cannot lose one', async () => {
  const single = checkpoints(await regions(METER_POSITIONS['meter-trips-3']()));
  const nested = checkpoints(await regions(METER_POSITIONS['meter-nested-3x4']()));
  assert.equal(nested.javascript - single.javascript, 1, 'the inner head is a second checkpoint site');
  assert.equal(nested.python - single.python, 1, 'the Python inner head is a second checkpoint site');
});

// Zero new await points is the half of the standing review question this slice keeps: because
// `for`'s allowedChildren admits no capability, a loop body contains no suspension point at all.
test('no emitted loop introduces a suspension point into its statement region', async () => {
  for (const name of ['for-sum-0-3', 'for-nested-acc', 'for-helper-in-body', 'for-early-return']) {
    const region = await regions(POSITIONS[name]());
    for (const token of SUSPENSION_TOKENS) {
      assert.equal(region.javascript.includes(token), false, `${name}: the JavaScript loop must not use ${token}`);
      assert.equal(region.python.includes(token), false, `${name}: the Python loop must not use ${token}`);
    }
    assert.equal(
      region.javascript.includes('await '),
      false,
      `RT10F_AWAIT_LEAK: ${name} has no capability in its body, so its region must carry no await`,
    );
    assert.equal(
      region.python.includes('await '),
      false,
      `RT10F_AWAIT_LEAK: ${name}'s Python region must carry no await either`,
    );
  }
});

// The one loop fixture whose body does admit an async call (RT-5's let-value gate, unchanged by
// nesting): the call site is emitted once in source and executed once per trip, so the await
// census must equal the same single call written straight-line, never scale with the trip count.
test('a for body carrying an admitted async call adds no await point over the same call straight-line', async () => {
  const straight = awaits(await regions(TWINS['twin-async-call']()));
  const loop = awaits(await regions(POSITIONS['for-async-let-in-body']()));
  assert.equal(loop.javascript, straight.javascript, 'RT10F_AWAIT_DRIFT: the JavaScript await census must not grow');
  assert.equal(loop.python, straight.python, 'RT10F_AWAIT_DRIFT: the Python await census must not grow');
});

// The tribunal pinned the JavaScript lowering as a `for` over BigInt. A `for` whose counter is a
// host number would carry no `n`-suffixed literal, and a lowering that re-entered a walk per
// iteration would carry no `for(` at all.
test('the JavaScript leg lowers the loop to a for over BigInt', async () => {
  const region = (await regions(POSITIONS['for-sum-0-3']())).javascript;
  assert.match(region, /for\s*\(/u, 'RT10F_JS_SHAPE: the JavaScript loop must be a host for statement');
  assert.match(region, /[0-9]n\b/u, 'RT10F_JS_SHAPE: the counter arithmetic must use BigInt literals');
  assert.ok(region.includes('__intOperand('), 'the bounds must be read through the existing kernel helper');
  assert.ok(region.includes('__intValue('), 'the counter must be materialized through the existing kernel helper');
});

// The tribunal pinned the Python lowering as an explicit `while` with a sign-selected comparator, no
// chained comparison and no `int()`. `range` is the specific shape that would reintroduce a host
// int bound and leak the counter past the loop.
test('the Python leg lowers the loop to an explicit while with no range and no coercion', async () => {
  const region = (await regions(POSITIONS['for-sum-0-3']())).python;
  assert.match(region, /while /u, 'RT10F_PY_SHAPE: the Python loop must be an explicit while');
  assert.equal(region.includes('range('), false, 'RT10F_PY_SHAPE: range would need a host int bound');
  assert.equal(region.includes('int('), false, 'RT10F_PY_SHAPE: the counter must never be coerced');
  assert.equal(region.includes('float('), false, 'RT10F_PY_SHAPE: the counter must never be coerced');
  assert.equal(region.includes('for '), false, 'RT10F_PY_SHAPE: a Python for statement implies an iterator protocol');
  assert.ok(region.includes('_int_operand('), 'the bounds must be read through the existing kernel helper');
  assert.ok(region.includes('_int_value('), 'the counter must be materialized through the existing kernel helper');
});

// A chained comparison is legal Python and means something different from the two-sided form the
// sign selection needs, so it is banned by shape rather than by outcome. The base statement region
// matches nothing, so this row is about what the loop adds.
test('the emitted Python contains no chained comparison in any loop region', async () => {
  for (const name of ['for-sum-0-3', 'for-negative-step', 'for-step-2', 'for-nested-acc']) {
    const region = (await regions(POSITIONS[name]())).python;
    assert.doesNotMatch(
      region,
      /[<>]=?\s*[^<>\n]+\s*[<>]=?/u,
      `RT10F_PY_SHAPE: ${name} must not chain two comparisons in one expression`,
    );
  }
});

// Every bound is read once, above the loop head, on both legs. A lowering that inlined a bound into
// the head expression would evaluate it per iteration; the metering suite catches that on RT-1 and
// this row catches it in the emitted text.
test('both emitted legs hoist every bound above the loop head', async () => {
  const region = await regions(POSITIONS['for-sum-0-3']());
  const javascriptHead = region.javascript.slice(region.javascript.search(/for\s*\(/u));
  assert.equal(
    countOccurrences(javascriptHead, '__intOperand('),
    0,
    'RT10F_BOUND_REREAD: no bound may be read inside or after the JavaScript loop head',
  );
  const beforeWhile = region.python.slice(0, region.python.indexOf('while '));
  assert.ok(
    countOccurrences(beforeWhile, '_int_operand(') >= 3,
    'RT10F_BOUND_REREAD: all three bounds must be read before the Python while',
  );
  assert.equal(
    countOccurrences(region.python.slice(region.python.indexOf('while ')), '_int_operand('),
    0,
    'RT10F_BOUND_REREAD: no bound may be read at or after the Python while',
  );
});

// The whole point of RT10F-C8: both kernels already carry the integer helpers, so the loop is
// per-program code and no kernel byte moves. If either of these fires, 70 artifact digests moved.
test('the loop lowering adds no line to either target kernel', async () => {
  const region = await regions(POSITIONS['for-sum-0-3']());
  assert.equal(
    region.javascriptKernel.includes('ERR_KIR_LOOP_ZERO_STEP'),
    false,
    'RT10F_KERNEL_TOUCH: the zero-step label belongs to the specialized handler',
  );
  assert.equal(
    region.pythonKernel.includes('ERR_KIR_LOOP_ZERO_STEP'),
    false,
    'RT10F_KERNEL_TOUCH: the zero-step label belongs to the specialized handler',
  );
  assert.ok(region.javascriptKernel.includes('__intValue'), 'the kernel helper the loop reuses must already be there');
  assert.ok(region.pythonKernel.includes('_int_value'), 'the kernel helper the loop reuses must already be there');
});
