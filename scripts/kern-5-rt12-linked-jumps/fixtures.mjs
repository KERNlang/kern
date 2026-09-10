import { ENTRY, moduleSource } from '../kern-5-rt4-user-fn-call/k0-support.mjs';

const ACC = 'let name=acc value="0"';
const I0 = 'let name=i value="0"';
const BUMP_ACC = 'assign target="acc" value="acc + 1"';
const BUMP_ACC_TEN = 'assign target="acc" value="acc + 10"';
const BUMP_I = 'assign target="i" value="i + 1"';
const RET_ACC = 'return value="acc"';

const BREAK_HELPER = Object.freeze({
  body: Object.freeze(['break', 'return value="1"']),
  name: 'jb',
  parameters: Object.freeze([]),
  returns: 'integer',
});

const CONTINUE_HELPER = Object.freeze({
  body: Object.freeze(['continue', 'return value="1"']),
  name: 'jc',
  parameters: Object.freeze([]),
  returns: 'integer',
});

const LOOP_BREAK_HELPER = Object.freeze({
  body: Object.freeze([ACC, 'for name=i from="0" to="3"', `  ${BUMP_ACC}`, '  break', RET_ACC]),
  name: 'jl',
  parameters: Object.freeze([]),
  returns: 'integer',
});

export function jumpProgram(body, { helpers = [], parameters = [], returns = 'integer' } = {}) {
  return moduleSource([...helpers, { body, exported: 'true', name: ENTRY.handlerName, parameters, returns }]);
}

function indent(lines) {
  return lines.map((line) => `  ${line}`);
}

// A counted `for` whose body is `leaves` followed by `tail`. Every metering twin in this suite is
// built from this one shape so a twin and its jump partner differ by exactly the statements named.
export function forBody(bound, body) {
  return jumpProgram([ACC, `for name=i from="0" to="${bound}"`, ...indent(body), RET_ACC]);
}

// The `while` counterpart. The counter is spelled out, so `i` and the increment are body statements
// the twin carries too — the RT11W-TD1 defect was a twin that dropped one of them.
export function whileBody(bound, body) {
  return jumpProgram([ACC, I0, `while cond="i < ${bound}"`, ...indent(body), RET_ACC]);
}

export function nestedForBody(outerBound, innerBound, innerBody) {
  return jumpProgram([
    ACC,
    `for name=o from="0" to="${outerBound}"`,
    `  for name=n from="0" to="${innerBound}"`,
    ...innerBody.map((line) => `    ${line}`),
    RET_ACC,
  ]);
}

export const JUMP_POSITIONS = Object.freeze({
  'for-break': () => forBody(3, ['break']),
  'for-break-after-leaf': () => forBody(3, [BUMP_ACC, 'break']),
  'for-break-bound-1': () => forBody(1, [BUMP_ACC, 'break']),
  'for-break-bound-10': () => forBody(10, [BUMP_ACC, 'break']),
  'for-break-bound-3': () => forBody(3, [BUMP_ACC, 'break']),
  'for-break-dead-return': () => forBody(3, ['break', 'return value="99"']),
  'for-break-dead-tail': () => forBody(3, ['break', BUMP_ACC]),
  'for-break-if-else': () =>
    forBody(4, ['if cond="i == 2"', '  break', 'else', `  ${BUMP_ACC}`]),
  'for-break-trailing-comment': () => forBody(3, ['break # done']),
  'for-break-under-if': () => forBody(5, ['if cond="i == 2"', '  break', BUMP_ACC]),
  'for-continue': () => forBody(3, ['continue']),
  'for-continue-after-leaf': () => forBody(3, [BUMP_ACC, 'continue']),
  'for-continue-dead-tail': () => forBody(3, ['continue', BUMP_ACC]),
  'for-continue-if-else': () =>
    forBody(4, ['if cond="i == 2"', '  continue', 'else', `  ${BUMP_ACC}`]),
  'for-continue-last-trip': () =>
    forBody(3, [BUMP_ACC, 'if cond="i == 2"', '  continue', BUMP_ACC_TEN]),
  'for-continue-trailing-comment': () => forBody(3, ['continue # again']),
  'for-continue-under-if': () => forBody(4, ['if cond="i == 2"', '  continue', BUMP_ACC]),
  'for-in-while-break': () =>
    jumpProgram([
      ACC,
      I0,
      'while cond="i < 2"',
      '  for name=k from="0" to="3"',
      `    ${BUMP_ACC}`,
      '    break',
      `  ${BUMP_I}`,
      RET_ACC,
    ]),
  'jump-in-loop-in-helper': () => jumpProgram(['return value="jl()"'], { helpers: [LOOP_BREAK_HELPER] }),
  'nested-inner-break': () => nestedForBody(3, 5, [BUMP_ACC, 'break']),
  'nested-inner-continue': () => nestedForBody(3, 2, [BUMP_ACC, 'continue']),
  'nested-outer-break': () =>
    jumpProgram([
      ACC,
      'for name=o from="0" to="3"',
      '  for name=n from="0" to="2"',
      `    ${BUMP_ACC}`,
      '  break',
      RET_ACC,
    ]),
  'void-break-in-loop': () => jumpProgram([ACC, 'for name=i from="0" to="3"', '  break'], { returns: 'void' }),
  'while-break': () => whileBody(3, [BUMP_I, 'break']),
  'while-break-under-if': () => whileBody(5, [BUMP_I, 'if cond="i == 2"', '  break', BUMP_ACC]),
  'while-continue': () => whileBody(3, [BUMP_ACC, BUMP_I, 'continue']),
  'while-continue-skips-increment': () => whileBody(3, ['continue', BUMP_I]),
  'while-continue-under-if': () => whileBody(4, [BUMP_I, 'if cond="i == 2"', '  continue', BUMP_ACC]),
  'while-in-for-break': () =>
    jumpProgram([
      ACC,
      'for name=o from="0" to="2"',
      '  let name=j value="0"',
      '  while cond="j < 3"',
      `    ${BUMP_ACC}`,
      '    break',
      RET_ACC,
    ]),
  'while-true-break-counter': () =>
    jumpProgram([I0, 'while cond="true"', `  ${BUMP_I}`, '  if cond="i == 3"', '    break', 'return value="i"']),

  'neg-break-after-loop': () => jumpProgram([ACC, 'for name=i from="0" to="1"', `  ${BUMP_ACC}`, 'break', RET_ACC]),
  'neg-break-in-helper-from-loop': () =>
    jumpProgram([ACC, 'for name=i from="0" to="1"', '  assign target="acc" value="jb()"', RET_ACC], {
      helpers: [BREAK_HELPER],
    }),
  'neg-break-in-if-else-outside-loop': () =>
    jumpProgram([ACC, 'if cond="false"', `  ${BUMP_ACC}`, 'else', '  break', RET_ACC]),
  'neg-break-in-if-outside-loop': () => jumpProgram([ACC, 'if cond="true"', '  break', RET_ACC]),
  'neg-break-top-level': () => jumpProgram([ACC, 'break', RET_ACC]),
  'neg-break-with-children-in-loop': () =>
    jumpProgram([ACC, 'for name=i from="0" to="1"', '  break', `    ${BUMP_ACC}`, RET_ACC]),
  'neg-break-with-children-top-level': () => jumpProgram([ACC, 'break', `  ${BUMP_ACC}`, RET_ACC]),
  'neg-continue-after-loop': () =>
    jumpProgram([ACC, 'for name=i from="0" to="1"', `  ${BUMP_ACC}`, 'continue', RET_ACC]),
  'neg-continue-in-helper-from-loop': () =>
    jumpProgram([ACC, 'for name=i from="0" to="1"', '  assign target="acc" value="jc()"', RET_ACC], {
      helpers: [CONTINUE_HELPER],
    }),
  'neg-continue-in-if-outside-loop': () => jumpProgram([ACC, 'if cond="true"', '  continue', RET_ACC]),
  'neg-continue-top-level': () => jumpProgram([ACC, 'continue', RET_ACC]),
  'neg-continue-with-children-in-loop': () =>
    jumpProgram([ACC, 'for name=i from="0" to="1"', '  continue', `    ${BUMP_ACC}`, RET_ACC]),
  'neg-return-then-break-top-level': () => jumpProgram([ACC, RET_ACC, 'break']),
  'neg-return-then-continue-top-level': () => jumpProgram([ACC, RET_ACC, 'continue']),
  'neg-void-return-in-for-body': () =>
    jumpProgram([I0, 'for name=k from="0" to="2"', '  if cond="k > 0"', '    return value="1"', `  ${BUMP_I}`], {
      returns: 'void',
    }),
});

export const JUMP_POSITION_ARGUMENTS = Object.freeze({});

export function jumpPositionArguments(name) {
  return JUMP_POSITION_ARGUMENTS[name] === undefined ? {} : JUMP_POSITION_ARGUMENTS[name]();
}

// `trailingComment` is the only property either catalog node declares, and F5 drops it entirely
// rather than projecting it, so the *only* F5 fence a jump has is a foreign property key.
export const JUMP_FENCES = Object.freeze({
  'fence-break-property': () => forBody(3, ['break name=x']),
  'fence-continue-property': () => forBody(3, ['continue name=x']),
});

// Every entry here is one half of a hand-counted twin pair: the jump fixture carries its twin's
// body plus exactly the jump statements named in the test that measures it, and nothing else moves —
// not the bound expression's shape, not the counter, not the statement order before the jump.
export const JUMP_TWINS = Object.freeze({
  'twin-two-lets': () => jumpProgram([ACC, I0, RET_ACC]),
  'twin-for-1-leaf': () => forBody(1, [BUMP_ACC]),
  'twin-for-1-two-leaves': () => forBody(1, [BUMP_ACC, BUMP_ACC]),
  'twin-for-3-leaf': () => forBody(3, [BUMP_ACC]),
  'twin-nested-3x1-leaf': () => nestedForBody(3, 1, [BUMP_ACC]),
  'twin-nested-3x2-leaf': () => nestedForBody(3, 2, [BUMP_ACC]),
  'twin-while-1-leaf': () => whileBody(1, [BUMP_ACC, BUMP_I]),
  'twin-while-3-leaf': () => whileBody(3, [BUMP_ACC, BUMP_I]),
  'twin-while-never-entered': () => whileBody(0, [BUMP_ACC, BUMP_I]),
});

export const JUMP_METER_POSITIONS = Object.freeze({
  'meter-for-1-leaf-break': () => forBody(1, [BUMP_ACC, 'break']),
  'meter-for-3-break': () => forBody(3, ['break']),
  'meter-for-3-break-bound-10': () => forBody(10, [BUMP_ACC, 'break']),
  'meter-for-3-break-bound-3': () => forBody(3, [BUMP_ACC, 'break']),
  'meter-for-3-break-dead-tail': () => forBody(3, ['break', BUMP_ACC]),
  'meter-for-3-continue': () => forBody(3, ['continue']),
  'meter-for-3-continue-dead-tail': () => forBody(3, ['continue', BUMP_ACC]),
  'meter-for-3-leaf-continue': () => forBody(3, [BUMP_ACC, 'continue']),
  'meter-nested-3x2-leaf-continue': () => nestedForBody(3, 2, [BUMP_ACC, 'continue']),
  'meter-nested-3x5-leaf-break': () => nestedForBody(3, 5, [BUMP_ACC, 'break']),
  'meter-while-1-leaf-break': () => whileBody(1, [BUMP_ACC, BUMP_I, 'break']),
  'meter-while-3-leaf-continue': () => whileBody(3, [BUMP_ACC, BUMP_I, 'continue']),
});

export const JUMP_THRESHOLD_POSITIONS = Object.freeze([
  'meter-for-1-leaf-break',
  'meter-for-3-continue',
  'meter-for-3-leaf-continue',
  'meter-nested-3x5-leaf-break',
  'meter-while-1-leaf-break',
  'meter-while-3-leaf-continue',
]);

export const JUMP_SHAPE_POSITIONS = Object.freeze([
  'for-break',
  'for-break-trailing-comment',
  'neg-break-with-children-in-loop',
  'while-true-break-counter',
]);
