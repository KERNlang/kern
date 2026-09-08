import { ENTRY, moduleSource } from '../kern-5-rt4-user-fn-call/k0-support.mjs';

const ACC = 'let name=acc value="0"';
const RET_ACC = 'return value="acc"';
const SET1 = 'assign target="acc" value="1"';
const SET2 = 'assign target="acc" value="2"';
const SET3 = 'assign target="acc" value="3"';
const BUMP = 'assign target="acc" value="acc + 1"';
const BUMP_TEN = 'assign target="acc" value="acc + 10"';

// OQ-D1's finding: a bare `print` alone in a nested block is projection-rejected, identically for
// `while` and for `try`. Every clause body below is `assign`- or `if`-wrapped for that reason.
const THROW_BOOM = 'throw value="{message: \\"boom\\"}"';
const THROW_CODED = 'throw value="{message: \\"boom\\", code: \\"E1\\"}"';
const THROW_NULL_CODE = 'throw value="{message: \\"boom\\", code: null}"';
const RETHROW = 'throw value="e"';

export function tryProgram(body, { helpers = [], parameters = [], returns = 'integer' } = {}) {
  return moduleSource([...helpers, { body, exported: 'true', name: ENTRY.handlerName, parameters, returns }]);
}

function indent(lines, depth = 1) {
  const pad = '  '.repeat(depth);
  return lines.map((line) => `${pad}${line}`);
}

// One shape every structural fixture is built from, so a positive and its negative differ by exactly
// the clause named in the test that drives them.
export function tryCatch(bodyLines, catchLines, { binding = 'e', finallyLines } = {}) {
  return [
    'try',
    ...indent(bodyLines),
    binding === undefined ? 'catch' : `catch name=${binding}`,
    ...indent(catchLines),
    ...(finallyLines === undefined ? [] : ['finally', ...indent(finallyLines)]),
  ];
}

export const TEXT_PARAM = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);

export const TEXT_HELPER = Object.freeze({
  body: Object.freeze(['return value="t"']),
  name: 'lab',
  parameters: TEXT_PARAM,
  returns: 'string',
});

export const THROW_HELPER = Object.freeze({
  body: Object.freeze([THROW_BOOM, 'return value="1"']),
  name: 'thrower',
  parameters: Object.freeze([]),
  returns: 'integer',
});

export const TRY_HELPER = Object.freeze({
  body: Object.freeze([ACC, ...tryCatch([SET1], [SET2]), RET_ACC]),
  name: 'trier',
  parameters: Object.freeze([]),
  returns: 'integer',
});

export const ASYNC_HELPER = Object.freeze({
  body: Object.freeze(['return value="1"']),
  name: 'later',
  parameters: Object.freeze([]),
  returns: 'integer',
});

export const TRY_POSITIONS = Object.freeze({
  'try-catch': () => tryProgram([ACC, ...tryCatch([SET1], [SET2]), RET_ACC]),
  'try-catch-no-binding': () => tryProgram([ACC, ...tryCatch([SET1], [SET2], { binding: undefined }), RET_ACC]),
  'try-catch-caught-throw': () => tryProgram([ACC, ...tryCatch([THROW_BOOM], [SET2]), RET_ACC]),
  'try-catch-coded-throw': () => tryProgram([ACC, ...tryCatch([THROW_CODED], [SET2]), RET_ACC]),
  'try-catch-null-code': () => tryProgram([ACC, ...tryCatch([THROW_NULL_CODE], [SET2]), RET_ACC]),
  'try-catch-return-in-body': () => tryProgram([ACC, ...tryCatch(['return value="5"'], [SET2]), RET_ACC]),
  'try-catch-return-in-catch': () => tryProgram([ACC, ...tryCatch([THROW_BOOM], ['return value="6"']), RET_ACC]),
  'try-catch-reads-message': () =>
    tryProgram(
      [
        'let name=out value="\\"ok\\""',
        ...tryCatch([THROW_BOOM], ['assign target="out" value="e.message"']),
        'return value="out"',
      ],
      { returns: 'string' },
    ),
  'try-catch-reads-code': () =>
    tryProgram(
      [
        'let name=out value="\\"ok\\""',
        ...tryCatch([THROW_CODED], ['assign target="out" value="e.code"']),
        'return value="out"',
      ],
      { returns: 'string' },
    ),
  // The default-insertion read: `code` is omitted at the throw site, so the linker completes it with
  // a null literal and `e.code` finds an entry rather than taking the missing-member path. The read
  // lands in a `let` and the handler returns an integer, so a null can never collide with the
  // return type and turn this into an invalid-handler-result row.
  'try-catch-reads-omitted-code': () =>
    tryProgram([ACC, ...tryCatch([THROW_BOOM], ['let name=c value="e.code"', SET2]), RET_ACC]),
  'try-catch-reads-missing': () =>
    tryProgram(
      [
        'let name=out value="\\"ok\\""',
        ...tryCatch([THROW_BOOM], ['assign target="out" value="e.missing"']),
        'return value="out"',
      ],
      { returns: 'string' },
    ),
  'try-nested': () => tryProgram([ACC, ...tryCatch(tryCatch([SET1], [SET2], { binding: 'i' }), [SET3]), RET_ACC]),
  'try-rethrow': () => tryProgram([ACC, ...tryCatch([THROW_BOOM], [RETHROW]), RET_ACC]),
  'try-throw-in-catch': () => tryProgram([ACC, ...tryCatch([THROW_BOOM], [THROW_CODED]), RET_ACC]),
  'try-payload-parameter': () =>
    tryProgram([ACC, ...tryCatch(['throw value="{message: t}"'], [SET2]), RET_ACC], { parameters: TEXT_PARAM }),
  'try-payload-helper-call': () =>
    tryProgram([ACC, ...tryCatch(['throw value="{message: lab(\\"x\\")}"'], [SET2]), RET_ACC], {
      helpers: [TEXT_HELPER],
    }),
  'throw-uncaught': () => tryProgram([ACC, THROW_BOOM, RET_ACC]),
  'throw-uncaught-coded': () => tryProgram([ACC, THROW_CODED, RET_ACC]),
  'throw-uncaught-after-print': () =>
    tryProgram([ACC, 'print value="\\"first\\""', THROW_BOOM, RET_ACC]),
  'throw-uncaught-after-capability': () =>
    tryProgram(
      [ACC, 'capability namespace=fixture operation=resolve name=reply', THROW_BOOM, RET_ACC],
    ),
  'throw-uncaught-in-try-body-no-catch-match': () => tryProgram([ACC, ...tryCatch([SET1], [SET2]), THROW_BOOM, RET_ACC]),
  'for-try-continue': () =>
    tryProgram(
      [
        ACC,
        'for name=i from="0" to="3"',
        ...indent(tryCatch([BUMP], ['continue'])),
        RET_ACC,
      ],
    ),
  'for-try-guarded-continue': () =>
    tryProgram([
      ACC,
      'for name=i from="0" to="4"',
      ...indent(tryCatch(['if cond="i == 2"', '  continue', BUMP], [BUMP_TEN])),
      RET_ACC,
    ]),
  'for-try-break': () =>
    tryProgram([ACC, 'for name=i from="0" to="3"', ...indent(tryCatch([BUMP, 'break'], [SET2])), RET_ACC]),
  'try-for-break': () => tryProgram([ACC, ...tryCatch(['for name=i from="0" to="3"', '  break'], [SET2]), RET_ACC]),
  'try-while-in-for-break': () =>
    tryProgram([
      ACC,
      'for name=o from="0" to="2"',
      ...indent(
        tryCatch(['let name=j value="0"', 'while cond="j < 3"', `  ${BUMP}`, '  break'], [SET2]),
      ),
      RET_ACC,
    ]),
  'try-await-helper-completes': () =>
    tryProgram([ACC, ...tryCatch(['assign target="acc" value="later()"'], [SET2]), RET_ACC], {
      helpers: [ASYNC_HELPER],
    }),
  'try-finally': () => tryProgram([ACC, ...tryCatch([SET1], [SET2], { finallyLines: [SET3] }), RET_ACC]),
  'try-finally-no-catch': () => tryProgram([ACC, 'try', ...indent([SET1]), 'finally', ...indent([SET3]), RET_ACC]),
  'try-finally-caught-throw': () =>
    tryProgram([ACC, ...tryCatch([THROW_BOOM], [SET2], { finallyLines: [SET3] }), RET_ACC]),
  'try-finally-rethrow': () =>
    tryProgram([ACC, ...tryCatch([THROW_BOOM], [RETHROW], { finallyLines: [SET3] }), RET_ACC]),
  // D-7b's rethrow exit, made observable: the envelope of a rethrown throw carries no result, so the
  // only way to see the finally ran is an event it committed. The print is if-wrapped because a bare
  // print alone in a nested block is projection-rejected.
  'try-finally-rethrow-prints': () =>
    tryProgram([
      ACC,
      ...tryCatch([THROW_BOOM], [RETHROW], { finallyLines: ['if cond="true"', '  print value="\\"cleanup\\""'] }),
      RET_ACC,
    ]),
  'try-finally-return-in-body': () =>
    tryProgram([ACC, ...tryCatch(['return value="5"'], [SET2], { finallyLines: [SET3] }), RET_ACC]),
  'try-finally-while': () =>
    tryProgram([
      ACC,
      ...tryCatch([SET1], [SET2], {
        finallyLines: ['let name=j value="0"', 'while cond="j < 2"', `  ${BUMP}`, '  assign target="j" value="j + 1"'],
      }),
      RET_ACC,
    ]),

  'neg-try-no-catch': () => tryProgram([ACC, 'try', ...indent([SET1]), RET_ACC]),
  'neg-try-duplicate-catch': () =>
    tryProgram([ACC, ...tryCatch([SET1], [SET2]), 'catch name=f', ...indent([SET3]), RET_ACC]),
  'neg-try-empty-body': () => tryProgram([ACC, 'try', 'catch name=e', ...indent([SET2]), RET_ACC]),
  'neg-try-empty-catch': () => tryProgram([ACC, 'try', ...indent([SET1]), 'catch name=e', RET_ACC]),
  'neg-try-named': () => tryProgram([ACC, 'try name=t', ...indent([SET1]), 'catch name=e', ...indent([SET2]), RET_ACC]),
  'neg-try-body-after-clause': () =>
    tryProgram([ACC, 'try', ...indent([SET1]), 'catch name=e', ...indent([SET2]), 'assign target="acc" value="9"']),
  'neg-catch-top-level': () => tryProgram([ACC, 'catch name=e', ...indent([SET1]), RET_ACC]),
  'neg-catch-in-for': () =>
    tryProgram([ACC, 'for name=i from="0" to="2"', ...indent(['catch name=e', `  ${SET1}`]), RET_ACC]),
  'neg-catch-in-while': () =>
    tryProgram([
      ACC,
      'let name=i value="0"',
      'while cond="i < 2"',
      ...indent(['catch name=e', `  ${SET1}`]),
      RET_ACC,
    ]),
  'neg-throw-shadowed-binding': () =>
    tryProgram([ACC, ...tryCatch([THROW_BOOM], ['let name=e value="1"', SET2]), RET_ACC]),
  'neg-assign-catch-binding': () =>
    tryProgram([ACC, ...tryCatch([THROW_BOOM], ['assign target="e" value="{message: \\"x\\"}"', SET2]), RET_ACC]),
  'neg-throw-in-helper': () => tryProgram([ACC, 'assign target="acc" value="thrower()"', RET_ACC], {
    helpers: [THROW_HELPER],
  }),
  'neg-try-in-helper': () => tryProgram([ACC, 'assign target="acc" value="trier()"', RET_ACC], {
    helpers: [TRY_HELPER],
  }),
  'neg-throw-bare': () => tryProgram([ACC, 'throw', RET_ACC]),
  'neg-throw-with-children': () => tryProgram([ACC, 'throw value="{message: \\"x\\"}"', `  ${SET1}`, RET_ACC]),
  'neg-throw-text-literal': () => tryProgram([ACC, 'throw value="\\"boom\\""', RET_ACC]),
  'neg-throw-integer-literal': () => tryProgram([ACC, 'throw value="1"', RET_ACC]),
  'neg-throw-boolean-literal': () => tryProgram([ACC, 'throw value="true"', RET_ACC]),
  'neg-throw-list': () => tryProgram([ACC, 'throw value="[1]"', RET_ACC]),
  'neg-throw-identifier': () => tryProgram([ACC, 'throw value="acc"', RET_ACC]),
  'neg-throw-empty-record': () => tryProgram([ACC, 'throw value="{}"', RET_ACC]),
  'neg-throw-integer-message': () => tryProgram([ACC, 'throw value="{message: 1}"', RET_ACC]),
  'neg-throw-extra-key': () =>
    tryProgram([ACC, 'throw value="{message: \\"x\\", extra: \\"y\\"}"', RET_ACC]),
  'neg-throw-no-message': () => tryProgram([ACC, 'throw value="{code: \\"E1\\"}"', RET_ACC]),
  'neg-throw-member': () =>
    tryProgram([ACC, 'let name=r value="{message: \\"x\\"}"', 'throw value="r.message"', RET_ACC]),
  'neg-throw-nested-record-message': () =>
    tryProgram([ACC, 'throw value="{message: {message: \\"x\\"}}"', RET_ACC]),
  'neg-throw-let-bound-payload': () =>
    tryProgram([ACC, 'let name=p value="{message: \\"x\\"}"', 'throw value="p"', RET_ACC]),
  'neg-return-only-in-try': () => tryProgram([ACC, ...tryCatch(['return value="1"'], ['return value="2"'])]),
  'neg-void-return-in-try': () => tryProgram([ACC, ...tryCatch(['return value="1"'], [SET2])], { returns: 'void' }),
  'neg-void-return-in-catch': () => tryProgram([ACC, ...tryCatch([SET1], ['return value="2"'])], { returns: 'void' }),
  'neg-break-in-try-top-level': () => tryProgram([ACC, ...tryCatch(['break'], [SET2]), RET_ACC]),
  'neg-continue-in-try-top-level': () => tryProgram([ACC, ...tryCatch(['continue'], [SET2]), RET_ACC]),
  // Measured 2026-09-08: F5 refuses a `finally` clause as a direct child of a `for` or `while` body
  // (its `allowedChildren` excludes `finally`), so the spec's own shape --
  // `for { try{break} catch finally }` -- is projection-rejected and the refusal it names would be
  // unreachable. An `if` branch does admit `finally`, so the if-wrapped shape is the only one that
  // reaches the linker, and it is the only one that can carry this row.
  'neg-break-crosses-finally': () =>
    tryProgram([
      ACC,
      'for name=i from="0" to="3"',
      '  if cond="true"',
      ...indent(tryCatch(['break'], [SET2], { finallyLines: [SET3] }), 2),
      RET_ACC,
    ]),
  'neg-continue-crosses-finally': () =>
    tryProgram([
      ACC,
      'for name=i from="0" to="3"',
      '  if cond="true"',
      ...indent(tryCatch(['continue'], [SET2], { finallyLines: [SET3] }), 2),
      RET_ACC,
    ]),
  'for-inside-finally-bearing-try-break': () =>
    tryProgram([
      ACC,
      ...tryCatch(['for name=i from="0" to="3"', `  ${BUMP}`, '  break'], [SET2], { finallyLines: [SET3] }),
      RET_ACC,
    ]),
  'neg-finally-return': () =>
    tryProgram([ACC, ...tryCatch([SET1], [SET2], { finallyLines: ['return value="9"'] })]),
  'neg-finally-throw': () =>
    tryProgram([ACC, ...tryCatch([SET1], [SET2], { finallyLines: [THROW_BOOM] }), RET_ACC]),
  'neg-finally-break': () =>
    tryProgram([
      ACC,
      'for name=i from="0" to="3"',
      '  if cond="true"',
      ...indent(tryCatch([BUMP], [SET2], { finallyLines: ['break'] }), 2),
      RET_ACC,
    ]),
  'neg-finally-continue': () =>
    tryProgram([
      ACC,
      'for name=i from="0" to="3"',
      '  if cond="true"',
      ...indent(tryCatch([BUMP], [SET2], { finallyLines: ['continue'] }), 2),
      RET_ACC,
    ]),
  'neg-finally-nested-throw': () =>
    tryProgram([
      ACC,
      ...tryCatch([SET1], [SET2], { finallyLines: ['if cond="true"', `  ${THROW_BOOM}`] }),
      RET_ACC,
    ]),
  'neg-duplicate-finally': () =>
    tryProgram([
      ACC,
      ...tryCatch([SET1], [SET2], { finallyLines: [SET3] }),
      'finally',
      ...indent([BUMP]),
      RET_ACC,
    ]),
  'neg-catch-after-finally': () =>
    tryProgram([
      ACC,
      'try',
      ...indent([SET1]),
      'finally',
      ...indent([SET3]),
      'catch name=e',
      ...indent([SET2]),
      RET_ACC,
    ]),
  'neg-finally-stray': () => tryProgram([ACC, 'finally', ...indent([SET3]), RET_ACC]),
});

export const TRY_POSITION_ARGUMENTS = Object.freeze({
  'try-payload-parameter': () => ({ t: { tag: 'text', value: 'boom' } }),
  'try-payload-helper-call': () => ({}),
});

export function tryPositionArguments(name) {
  return TRY_POSITION_ARGUMENTS[name] === undefined ? {} : TRY_POSITION_ARGUMENTS[name]();
}

// Twins are hand-counted, never derived. Each one carries its partner's body minus exactly the
// statements the metering test names, so the difference is attributable statement by statement.
export const TRY_TWINS = Object.freeze({
  'twin-leaf': () => tryProgram([ACC, SET1, RET_ACC]),
  // The `let` carries the payload record itself, so the record expression's own charge cancels
  // between the twin and its partner and the measured difference is statement boundaries only.
  'twin-let-and-leaf': () => tryProgram([ACC, 'let name=p value="{message: \\"boom\\"}"', SET1, RET_ACC]),
  'twin-for-3-leaf': () => tryProgram([ACC, 'for name=i from="0" to="3"', `  ${BUMP}`, RET_ACC]),
  'twin-try-catch-leaf': () => tryProgram([ACC, ...tryCatch([SET1], [SET2]), RET_ACC]),
});

export const TRY_METER_POSITIONS = Object.freeze({
  'meter-try-leaf': () => tryProgram([ACC, ...tryCatch([SET1], [SET2]), RET_ACC]),
  'meter-try-throw-catch-leaf': () => tryProgram([ACC, ...tryCatch([THROW_BOOM], [SET1]), RET_ACC]),
  'meter-for-3-try-leaf': () =>
    tryProgram([ACC, 'for name=i from="0" to="3"', ...indent(tryCatch([BUMP], [SET2])), RET_ACC]),
  'meter-try-leaf-finally-leaf': () =>
    tryProgram([ACC, ...tryCatch([SET1], [SET2], { finallyLines: [SET3] }), RET_ACC]),
});

export const TRY_THRESHOLD_POSITIONS = Object.freeze([
  'try-catch',
  'try-catch-caught-throw',
  'for-try-continue',
  'try-for-break',
]);

// Shapes F5 refuses, so the linker never sees them. Each one is a refusal the spec attributes to the
// linker and the measurement of 2026-09-08 attributes to the frontend instead; the oracle asserts
// the frontend owns them, so the linker's own gates keep a reachable surface.
export const TRY_FENCES = Object.freeze({
  'fence-catch-in-catch': () => tryProgram([ACC, ...tryCatch([SET1], ['catch name=f', `  ${SET2}`]), RET_ACC]),
  'fence-catch-property': () =>
    tryProgram([ACC, 'try', ...indent([SET1]), 'catch name=e other=x', ...indent([SET2]), RET_ACC]),
  'fence-catch-typed': () =>
    tryProgram([ACC, 'try', ...indent([SET1]), 'catch name=e type=Error', ...indent([SET2]), RET_ACC]),
  'fence-finally-in-for-body': () =>
    tryProgram([ACC, 'for name=i from="0" to="3"', ...indent(tryCatch([BUMP], [SET2], { finallyLines: [SET3] })), RET_ACC]),
  'fence-finally-in-while-body': () =>
    tryProgram([
      ACC,
      'let name=j value="0"',
      'while cond="j < 2"',
      ...indent(tryCatch([BUMP, 'assign target="j" value="j + 1"'], [SET2], { finallyLines: [SET3] })),
      RET_ACC,
    ]),
  'fence-finally-property': () =>
    tryProgram([ACC, 'try', ...indent([SET1]), 'catch name=e', ...indent([SET2]), 'finally name=f', ...indent([SET3]), RET_ACC]),
  'fence-for-inside-finally': () =>
    tryProgram([
      ACC,
      ...tryCatch([SET1], [SET2], { finallyLines: ['for name=i from="0" to="2"', `  ${BUMP}`] }),
      RET_ACC,
    ]),
  'fence-try-step-child': () =>
    tryProgram([ACC, 'try', ...indent(['step name=s', SET1]), 'catch name=e', ...indent([SET2]), RET_ACC]),
});

export const FENCE_DIAGNOSTICS = Object.freeze({
  'fence-catch-in-catch': Object.freeze([]),
  'fence-catch-property': Object.freeze([]),
  'fence-catch-typed': Object.freeze(['FRONTEND_EXCLUDED_HOST_TYPE']),
  'fence-finally-in-for-body': Object.freeze([]),
  'fence-finally-in-while-body': Object.freeze([]),
  'fence-finally-property': Object.freeze([]),
  'fence-for-inside-finally': Object.freeze([]),
  'fence-try-step-child': Object.freeze(['UNEXPECTED_TOKEN']),
});
