import assert from 'node:assert/strict';
import test from 'node:test';

import { boolArgs, compilePython, handlerSource, project, stepBudgets } from './k0-support.mjs';

const FLAGS = Object.freeze([
  { name: 'flag', type: 'boolean' },
  { name: 'other', type: 'boolean' },
]);

const RIGHT_HAND_SIDE = '((other == other) == (other == other))';
const RIGHT_HAND_SIDE_NODES = 7;
const CONTROL_EXECUTION_STEPS = 2;
const SHORT_CIRCUIT_EXECUTION_STEPS = 3;
const FULL_EXECUTION_STEPS = SHORT_CIRCUIT_EXECUTION_STEPS + RIGHT_HAND_SIDE_NODES;

const CONTROL_SOURCE = handlerSource('boolean', FLAGS, ['return value="flag"']);

function source(operator) {
  return handlerSource('boolean', FLAGS, [`return value="flag ${operator} ${RIGHT_HAND_SIDE}"`]);
}

const OPERATOR_CASES = Object.freeze([
  { operator: '&&', shortCircuit: { flag: false, other: true }, whole: { flag: true, other: true } },
  { operator: '||', shortCircuit: { flag: true, other: true }, whole: { flag: false, other: true } },
]);

for (const testCase of OPERATOR_CASES) {
  test(`RT-3 ${testCase.operator} neither evaluates nor meters the short-circuited right operand`, async () => {
    const control = await stepBudgets(CONTROL_SOURCE, boolArgs(testCase.whole), 'rt3-meter-control');
    const directInspection = control.direct - control.link - CONTROL_EXECUTION_STEPS;
    const emittedInspection = control.javascript - CONTROL_EXECUTION_STEPS;
    assert.equal(control.python, control.javascript, 'both targets must inspect the request identically');

    const whole = await stepBudgets(source(testCase.operator), boolArgs(testCase.whole), 'rt3-meter-whole');
    const short = await stepBudgets(source(testCase.operator), boolArgs(testCase.shortCircuit), 'rt3-meter-short');
    assert.equal(whole.link, short.link, 'both requests link the same program');

    assert.deepEqual(
      {
        javascript: short.javascript - emittedInspection,
        python: short.python - emittedInspection,
        rt1: short.direct - short.link - directInspection,
      },
      {
        javascript: SHORT_CIRCUIT_EXECUTION_STEPS,
        python: SHORT_CIRCUIT_EXECUTION_STEPS,
        rt1: SHORT_CIRCUIT_EXECUTION_STEPS,
      },
      'RT3_SHORT_CIRCUIT_METER: the short-circuited right operand must consume no step on any leg',
    );
    assert.deepEqual(
      {
        javascript: whole.javascript - emittedInspection,
        python: whole.python - emittedInspection,
        rt1: whole.direct - whole.link - directInspection,
      },
      {
        javascript: FULL_EXECUTION_STEPS,
        python: FULL_EXECUTION_STEPS,
        rt1: FULL_EXECUTION_STEPS,
      },
      'RT3_OPERAND_STEP_COUNT: each operand node must consume exactly one step on every leg',
    );
    assert.deepEqual(
      [whole.direct - short.direct, whole.javascript - short.javascript, whole.python - short.python],
      [RIGHT_HAND_SIDE_NODES, RIGHT_HAND_SIDE_NODES, RIGHT_HAND_SIDE_NODES],
      'RT3_SHORT_CIRCUIT_METER: all three legs must save the same right-operand step budget',
    );
  });
}

test('RT-3 Python lowering never emits an infix or chained comparison', async () => {
  const verified = await project(
    handlerSource('boolean', FLAGS, ['return value="(1 < 2) == (3 >= 4)"']),
  );
  const python = compilePython(verified);
  assert.equal(python.outcome, 'success', `python compile failed: ${python.code}`);
  const text = new TextDecoder().decode(python.artifact.bytes);
  const specialized = text.slice(text.indexOf('async def _run_specialized'));
  assert.ok(specialized.length > 0, 'the emitted Python must contain a specialized handler');
  assert.match(specialized, /_lt\(/u, 'ordering must lower to a named helper call');
  assert.doesNotMatch(
    specialized,
    /\)\s*(?:<=?|>=?|[!=]=)\s*_expression\(/u,
    'RT3_PYTHON_CHAINED_COMPARISON: binary lowering must never emit a Python infix comparison',
  );
});
