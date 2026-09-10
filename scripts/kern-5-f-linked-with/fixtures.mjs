import { ENTRY, moduleSource } from '../kern-5-rt4-user-fn-call/k0-support.mjs';
import {
  ASYNC_INT_HELPER,
  CAPABILITY,
  INT_A,
  INT_HELPER,
  TEXT_LIST,
  TEXT_T,
  VOID_HELPER,
} from '../kern-5-e-linked-each-do/fixtures.mjs';

export { ASYNC_INT_HELPER, CAPABILITY, INT_A, INT_HELPER, TEXT_LIST, TEXT_T, VOID_HELPER };

export const TEXT_LIST_AND_SCALAR = Object.freeze([...TEXT_LIST, ...TEXT_T]);

// `print value="a"` on an integer is unsupported-runtime-input, so every observable marker goes
// through a text-valued helper: cleanup ORDER is read off the envelope's stdout events.
export const NOTE_HELPER = Object.freeze({
  body: Object.freeze(['print value="t"', 'return value="t"']),
  name: 'note',
  parameters: TEXT_T,
  returns: 'string',
});

export const ASYNC_NOTE_HELPER = Object.freeze({
  body: Object.freeze([CAPABILITY, 'print value="t"', 'return value="t"']),
  name: 'anote',
  parameters: TEXT_T,
  returns: 'string',
});

const HELPERS = Object.freeze([INT_HELPER, NOTE_HELPER]);
const ASYNC_HELPERS = Object.freeze([INT_HELPER, NOTE_HELPER, ASYNC_INT_HELPER]);
const ASYNC_NOTE_HELPERS = Object.freeze([INT_HELPER, NOTE_HELPER, ASYNC_NOTE_HELPER]);

export function withProgram(body, { helpers = HELPERS, parameters = TEXT_LIST, returns = 'integer' } = {}) {
  return moduleSource([...helpers, { body, exported: 'true', name: ENTRY.handlerName, parameters, returns }]);
}

function indent(lines, depth = 1) {
  const pad = '  '.repeat(depth);
  return lines.map((line) => `${pad}${line}`);
}

const ACC = 'let name=acc value="0"';
const RET_ACC = 'return value="acc"';
const SET_R = 'assign target="acc" value="r"';
const SET_S = 'assign target="acc" value="s"';
const BUMP_ACC = 'assign target="acc" value="acc + 1"';
const THROW_BOOM = 'throw value="{message: \\"boom\\"}"';

export const NOTE = (text) => `do value="note(\\"${text}\\")"`;

const CLEANUP = 'note(\\"cleanup\\")';

// The two spellings of the same meaning. `withLines` emits the surface form; `twinLines` emits the
// expansion the linker is specified to produce, spelled by hand so every equality in the suite is a
// comparison against an independent source and never a restatement of the implementation.
export function withLines(body, { cleanup = CLEANUP, name = 'r', properties = '', value = 'bump(1)' } = {}) {
  return [`with name=${name} value="${value}" cleanup="${cleanup}"${properties}`, ...indent(body)];
}

export function twinLines(body, { cleanup = CLEANUP, name = 'r', value = 'bump(1)' } = {}) {
  return [
    `let name=${name} value="${value}"`,
    'try',
    ...indent(body),
    'finally',
    ...indent([`do value="${cleanup}"`]),
  ];
}

const INNER = { cleanup: 'note(\\"inner\\")', name: 's', value: 'bump(2)' };
const OUTER = { cleanup: 'note(\\"outer\\")' };

// Every exit path QF-1 meters, written once and instantiated twice: once through `with`, once
// through the hand-written expansion.
export const SHAPES = Object.freeze({
  'async-acquire': (block) =>
    withProgram([ACC, ...block([SET_R], { properties: ' async=true', value: 'afi()' }), RET_ACC], {
      helpers: ASYNC_HELPERS,
    }),
  'async-cleanup': (block) =>
    withProgram(
      [ACC, ...block([SET_R], { cleanup: 'anote(\\"async-cleanup\\")', properties: ' async=true' }), RET_ACC],
      { helpers: ASYNC_NOTE_HELPERS },
    ),
  'break-inner-loop': (block) =>
    withProgram(
      [
        ACC,
        ...block(['for name=j from="0" to="3"', '  if cond="j > 1"', '    break', `  ${BUMP_ACC}`]),
        RET_ACC,
      ],
    ),
  'caught-throw': (block) =>
    withProgram([
      ACC,
      'try',
      ...indent(block([THROW_BOOM])),
      'catch name=e',
      `  ${NOTE('caught')}`,
      '  assign target="acc" value="5"',
      RET_ACC,
    ]),
  'continue-inner-loop': (block) =>
    withProgram(
      [
        ACC,
        ...block(['for name=j from="0" to="3"', '  if cond="j > 1"', '    continue', `  ${BUMP_ACC}`]),
        RET_ACC,
      ],
    ),
  fallthrough: (block) => withProgram([ACC, ...block([NOTE('body'), SET_R]), RET_ACC]),
  nested: (block) => withProgram([ACC, ...block(block([SET_S], INNER), OUTER), RET_ACC]),
  return: (block) => withProgram([ACC, ...block([NOTE('body'), 'return value="r"']), RET_ACC]),
  'return-through-outer-finally': (block) =>
    withProgram([
      ACC,
      'try',
      ...indent(block([NOTE('body'), 'return value="r"'])),
      'finally',
      `  ${NOTE('outer-finally')}`,
      RET_ACC,
    ]),
  'uncaught-throw': (block) => withProgram([ACC, ...block([THROW_BOOM]), RET_ACC]),
});

export const SHAPE_NAMES = Object.freeze(Object.keys(SHAPES).sort());

const SHAPE_POSITIONS = {};
for (const [shape, build] of Object.entries(SHAPES)) {
  SHAPE_POSITIONS[`with-${shape}`] = () => build(withLines);
  SHAPE_POSITIONS[`twin-${shape}`] = () => build(twinLines);
}

export const WITH_POSITIONS = Object.freeze({
  ...SHAPE_POSITIONS,
  'do-in-with': () => withProgram([ACC, ...withLines([NOTE('body'), SET_R]), RET_ACC]),
  'each-in-with': () => withProgram([ACC, ...withLines(['each name=x in="xs"', `  ${BUMP_ACC}`]), RET_ACC]),
  'for-in-with': () => withProgram([ACC, ...withLines(['for name=j from="0" to="2"', `  ${BUMP_ACC}`]), RET_ACC]),
  'if-in-with': () => withProgram([ACC, ...withLines(['if cond="true"', `  ${BUMP_ACC}`]), RET_ACC]),
  'print-in-with': () =>
    withProgram([ACC, ...withLines(['if cond="true"', '  print value="\\"printed\\""', `  ${BUMP_ACC}`]), RET_ACC]),
  'throw-in-with': () =>
    withProgram([ACC, 'try', ...indent(withLines([THROW_BOOM])), 'catch name=e', `  ${BUMP_ACC}`, RET_ACC]),
  'while-in-with': () =>
    withProgram([
      ACC,
      'let name=i value="0"',
      ...withLines(['while cond="i < 2"', '  assign target="i" value="i + 1"', `  ${BUMP_ACC}`]),
      RET_ACC,
    ]),
  'with-async-false': () => withProgram([ACC, ...withLines([SET_R], { properties: ' async=false' }), RET_ACC]),
  // The only suspension point a `with` body can carry: the capability lives inside the async helper,
  // because `capability` itself is not among `with`'s allowedChildren. It is what lets an abort land
  // strictly between the body's own effect and the cleanup, on both legs.
  'with-capability-in-body': () =>
    withProgram([ACC, ...withLines([NOTE('body'), 'do value="afi()"', SET_R]), RET_ACC], {
      helpers: ASYNC_HELPERS,
    }),
  'with-in-catch': () =>
    withProgram([ACC, 'try', `  ${THROW_BOOM}`, 'catch name=e', ...indent(withLines([SET_R])), RET_ACC]),
  'with-in-each': () => withProgram([ACC, 'each name=x in="xs"', ...indent(withLines([BUMP_ACC])), RET_ACC]),
  'with-in-finally': () =>
    withProgram([ACC, 'try', `  ${BUMP_ACC}`, 'finally', ...indent(withLines([BUMP_ACC])), RET_ACC]),
  'with-in-for': () => withProgram([ACC, 'for name=i from="0" to="2"', ...indent(withLines([BUMP_ACC])), RET_ACC]),
  'with-in-if': () => withProgram([ACC, 'if cond="true"', ...indent(withLines([SET_R])), RET_ACC]),
  'with-in-try': () =>
    withProgram([
      ACC,
      'try',
      ...indent(withLines([SET_R])),
      'catch name=e',
      '  assign target="acc" value="9"',
      RET_ACC,
    ]),
  'with-in-while': () =>
    withProgram([
      ACC,
      'let name=i value="0"',
      'while cond="i < 2"',
      '  assign target="i" value="i + 1"',
      ...indent(withLines([BUMP_ACC])),
      RET_ACC,
    ]),
  'with-protocol-empty': () => withProgram([ACC, ...withLines([SET_R], { properties: ' protocol=""' }), RET_ACC]),
  'with-protocol-omitted': () => withProgram([ACC, ...withLines([SET_R]), RET_ACC]),
  'with-sibling-reuse': () => withProgram([ACC, ...withLines([SET_R]), ...withLines([BUMP_ACC]), RET_ACC]),
  'with-value-visible': () =>
    withProgram([
      ACC,
      ...withLines([NOTE('body')], { cleanup: 'note(r)', value: 'note(\\"acquired\\")' }),
      RET_ACC,
    ]),
});

export const WITH_REFUSALS = Object.freeze({
  'neg-with-assign-binding': () =>
    withProgram([ACC, ...withLines(['assign target="r" value="1"', SET_R]), RET_ACC]),
  'neg-with-async-cleanup-no-flag': () =>
    withProgram([ACC, ...withLines([SET_R], { cleanup: 'afi()' }), RET_ACC], { helpers: ASYNC_HELPERS }),
  'neg-with-async-in-argument': () =>
    withProgram([ACC, ...withLines([SET_R], { properties: ' async=true', value: 'bump(afi())' }), RET_ACC], {
      helpers: ASYNC_HELPERS,
    }),
  'neg-with-async-value-no-flag': () =>
    withProgram([ACC, ...withLines([SET_R], { value: 'afi()' }), RET_ACC], { helpers: ASYNC_HELPERS }),
  'neg-with-body-let-read-after': () =>
    withProgram([
      ACC,
      ...withLines(['let name=inner value="1"', 'assign target="acc" value="inner"']),
      'return value="inner"',
    ]),
  'neg-with-break-crosses': () =>
    withProgram([
      ACC,
      'for name=i from="0" to="2"',
      ...indent(withLines(['if cond="true"', '  break'])),
      RET_ACC,
    ]),
  'neg-with-cleanup-binary': () => withProgram([ACC, ...withLines([SET_R], { cleanup: '1 + 1' }), RET_ACC]),
  'neg-with-cleanup-identifier': () => withProgram([ACC, ...withLines([SET_R], { cleanup: 'r' }), RET_ACC]),
  'neg-with-cleanup-json': () =>
    withProgram([ACC, ...withLines([SET_R], { cleanup: 'Json.stringify(t)' }), RET_ACC], {
      parameters: TEXT_LIST_AND_SCALAR,
    }),
  'neg-with-cleanup-literal': () => withProgram([ACC, ...withLines([SET_R], { cleanup: '1' }), RET_ACC]),
  'neg-with-cleanup-binding-member-call': () =>
    withProgram([ACC, ...withLines([SET_R], { cleanup: 'r.close()' }), RET_ACC]),
  'neg-with-cleanup-member-call': () =>
    withProgram([ACC, ...withLines([SET_R], { cleanup: 'xs.push(1)' }), RET_ACC]),
  // The cleanup IS a user call; the unsupported member sits in one of its ARGUMENTS, so the refusal
  // belongs to the expression compiler and the with gate must not overwrite it.
  'neg-with-cleanup-nested-member': () =>
    withProgram([ACC, ...withLines([SET_R], { cleanup: 'bump(xs.length)' }), RET_ACC]),
  'neg-with-cleanup-reads-body-let': () =>
    withProgram([ACC, ...withLines(['let name=inner value="1"', SET_R], { cleanup: 'bump(inner)' }), RET_ACC]),
  'neg-with-cleanup-void-call': () =>
    withProgram([ACC, ...withLines([SET_R], { cleanup: 'sink(1)' }), RET_ACC], {
      helpers: [INT_HELPER, NOTE_HELPER, VOID_HELPER],
    }),
  'neg-with-continue-crosses': () =>
    withProgram([
      ACC,
      'for name=i from="0" to="2"',
      ...indent(withLines(['if cond="true"', '  continue'])),
      RET_ACC,
    ]),
  'neg-with-empty-body': () => withProgram([ACC, ...withLines([]), RET_ACC]),
  'neg-with-flag-without-async-call': () =>
    withProgram([ACC, ...withLines([SET_R], { properties: ' async=true' }), RET_ACC]),
  'neg-with-in-helper': () =>
    moduleSource([
      INT_HELPER,
      NOTE_HELPER,
      {
        body: [ACC, ...withLines([SET_R]), RET_ACC],
        name: 'wrapped',
        parameters: INT_A,
        returns: 'integer',
      },
      {
        body: [ACC, 'assign target="acc" value="wrapped(1)"', RET_ACC],
        exported: 'true',
        name: ENTRY.handlerName,
        parameters: TEXT_LIST,
        returns: 'integer',
      },
    ]),
  'neg-with-no-cleanup': () => withProgram([ACC, 'with name=r value="bump(1)"', `  ${SET_R}`, RET_ACC]),
  'neg-with-protocol-no-cleanup': () =>
    withProgram([ACC, 'with name=r value="bump(1)" protocol=with', `  ${SET_R}`, RET_ACC]),
  'neg-with-protocol-with': () =>
    withProgram([ACC, ...withLines([SET_R], { properties: ' protocol=with' }), RET_ACC]),
  'neg-with-read-after': () => withProgram([ACC, ...withLines([SET_R]), 'return value="r"']),
  'neg-with-rebind-in-body': () =>
    withProgram([ACC, ...withLines(['let name=r value="1"', BUMP_ACC]), RET_ACC]),
  'neg-with-return-in-void-handler': () =>
    withProgram([ACC, ...withLines(['return value="r"'])], { returns: 'void' }),
  'neg-with-shadow-counter': () =>
    withProgram([
      ACC,
      'for name=i from="0" to="2"',
      ...indent(withLines([BUMP_ACC], { name: 'i' })),
      RET_ACC,
    ]),
  'neg-with-shadow-let': () => withProgram([ACC, 'let name=r value="0"', ...withLines([SET_R]), RET_ACC]),
  'neg-with-shadow-outer-with': () => withProgram([ACC, ...withLines(withLines([SET_R])), RET_ACC]),
  'neg-with-shadow-parameter': () => withProgram([ACC, ...withLines([BUMP_ACC], { name: 'xs' }), RET_ACC]),
  'neg-with-value-reads-own-binding': () =>
    withProgram([ACC, ...withLines([SET_R], { value: 'bump(r)' }), RET_ACC]),
});

export const WITH_WALLS = Object.freeze({
  'wall-capability-in-with': () =>
    withProgram([ACC, ...withLines([CAPABILITY, `  ${BUMP_ACC}`.trim()]), RET_ACC]),
  'wall-try-in-with': () =>
    withProgram([
      ACC,
      ...withLines(['try', `  ${BUMP_ACC}`, 'catch name=e', '  assign target="acc" value="9"']),
      RET_ACC,
    ]),
  'wall-with-catch-child': () =>
    withProgram([ACC, ...withLines([SET_R, 'catch name=e', `  ${BUMP_ACC}`]), RET_ACC]),
  'wall-with-cleanup-propagate': () => withProgram([ACC, ...withLines([SET_R], { cleanup: 'bump(r)?' }), RET_ACC]),
  'wall-with-extra-prop': () => withProgram([ACC, ...withLines([SET_R], { properties: ' type=integer' }), RET_ACC]),
  'wall-with-no-name': () =>
    withProgram([ACC, `with value="bump(1)" cleanup="${CLEANUP}"`, `  ${BUMP_ACC}`, RET_ACC]),
  'wall-with-no-value': () => withProgram([ACC, `with name=r cleanup="${CLEANUP}"`, `  ${BUMP_ACC}`, RET_ACC]),
  'wall-with-value-propagate': () => withProgram([ACC, ...withLines([SET_R], { value: 'bump(1)?' }), RET_ACC]),
});

export const POSITIONS = Object.freeze({ ...WITH_POSITIONS, ...WITH_REFUSALS, ...WITH_WALLS });

export const POSITION_NAMES = Object.freeze(Object.keys(POSITIONS).sort());
