import { ENTRY, moduleSource } from '../kern-5-rt4-user-fn-call/k0-support.mjs';

const BOOL_FLAG = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);
const INT_A = Object.freeze([Object.freeze({ name: 'a', type: 'integer' })]);
const TEXT_T = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);
const TEXT_LIST = Object.freeze([Object.freeze({ name: 'xs', type: 'string[]' })]);
const INT_LIST = Object.freeze([Object.freeze({ name: 'ns', type: 'integer[]' })]);
const BOOL_LIST = Object.freeze([Object.freeze({ name: 'bs', type: 'boolean[]' })]);

const CAPABILITY = 'capability namespace=fixture operation=resolve name=reply';

const BOOL_HELPER = Object.freeze({
  body: Object.freeze(['return value="flag"']),
  name: 'helper',
  parameters: BOOL_FLAG,
  returns: 'boolean',
});

const INT_HELPER = Object.freeze({
  body: Object.freeze(['return value="a + 1"']),
  name: 'bump',
  parameters: INT_A,
  returns: 'integer',
});

const TEXT_HELPER = Object.freeze({
  body: Object.freeze(['return value="t"']),
  name: 'label',
  parameters: TEXT_T,
  returns: 'string',
});

const ASYNC_INT_HELPER = Object.freeze({
  body: Object.freeze([CAPABILITY, 'return value="3"']),
  name: 'afi',
  parameters: Object.freeze([]),
  returns: 'integer',
});

const LOOP_HELPER = Object.freeze({
  body: Object.freeze([
    'let name=acc value="0"',
    'for name=i from="0" to="3"',
    '  assign target="acc" value="acc + i"',
    'return value="acc"',
  ]),
  name: 'sumf',
  parameters: Object.freeze([]),
  returns: 'integer',
});

const LIST_HELPER = Object.freeze({
  body: Object.freeze(['return value="xs"']),
  name: 'echo',
  parameters: TEXT_LIST,
  returns: 'string[]',
});

function entry(body, { helpers = [], parameters = [], returns = 'integer' } = {}) {
  return moduleSource([...helpers, { body, exported: 'true', name: ENTRY.handlerName, parameters, returns }]);
}

// One program per emitter lowering path. Every statement kind, every expression kind, every helper
// shape and both loop forms appear at least once, so a digest that moves names the path that moved.
export const CORPUS = Object.freeze({
  'assign-arith': () =>
    entry(['let name=acc value="0"', 'assign target="acc" value="acc + 2"', 'return value="acc"']),
  'assign-async-value': () =>
    entry(['let name=acc value="0"', 'assign target="acc" value="afi()"', 'return value="acc"'], {
      helpers: [ASYNC_INT_HELPER],
    }),
  'binary-comparison': () => entry(['return value="1 < 2"'], { returns: 'boolean' }),
  'binary-logical': () => entry(['return value="flag && true"'], { parameters: BOOL_FLAG, returns: 'boolean' }),
  'binary-nested-arith': () => entry(['return value="(1 + 2) * 3 - 4"']),
  'capability-then-return': () => entry([CAPABILITY, 'return value="1"']),
  'for-break': () =>
    entry([
      'let name=acc value="0"',
      'for name=i from="0" to="5"',
      '  if cond="i > 2"',
      '    break',
      '  assign target="acc" value="acc + i"',
      'return value="acc"',
    ]),
  'for-continue': () =>
    entry([
      'let name=acc value="0"',
      'for name=i from="0" to="5"',
      '  if cond="i > 2"',
      '    continue',
      '  assign target="acc" value="acc + i"',
      'return value="acc"',
    ]),
  'for-nested': () =>
    entry([
      'let name=acc value="0"',
      'for name=i from="0" to="3"',
      '  for name=j from="0" to="2"',
      '    assign target="acc" value="acc + j"',
      'return value="acc"',
    ]),
  'for-step': () =>
    entry([
      'let name=acc value="0"',
      'for name=i from="0" to="6" step="2"',
      '  assign target="acc" value="acc + i"',
      'return value="acc"',
    ]),
  'for-with-print': () =>
    entry([
      'let name=acc value="0"',
      'for name=i from="0" to="2"',
      '  assign target="acc" value="acc + 1"',
      '  if cond="true"',
      '    print value="\\"trip\\""',
      'return value="acc"',
    ]),
  'helper-async-let': () => entry(['let name=v value="afi()"', 'return value="v"'], { helpers: [ASYNC_INT_HELPER] }),
  'helper-list-roundtrip': () =>
    entry(['return value="echo(xs)"'], { helpers: [LIST_HELPER], parameters: TEXT_LIST, returns: 'string[]' }),
  'helper-loop-body': () => entry(['return value="sumf()"'], { helpers: [LOOP_HELPER] }),
  'helper-sync-bool': () =>
    entry(['return value="helper(flag)"'], { helpers: [BOOL_HELPER], parameters: BOOL_FLAG, returns: 'boolean' }),
  'helper-sync-int-nested': () => entry(['return value="bump(bump(1))"'], { helpers: [INT_HELPER] }),
  'helper-sync-text': () =>
    entry(['return value="label(t)"'], { helpers: [TEXT_HELPER], parameters: TEXT_T, returns: 'string' }),
  'if-else': () =>
    entry(['if cond="flag"', '  return value="1"', 'else', '  return value="2"', 'return value="3"'], {
      parameters: BOOL_FLAG,
    }),
  'if-then-only': () => entry(['if cond="flag"', '  return value="1"', 'return value="2"'], { parameters: BOOL_FLAG }),
  'json-parse': () => entry(['let name=v value="Json.parse(t)"', 'return value="1"'], { parameters: TEXT_T }),
  'json-stringify': () =>
    entry(['let name=v value="Json.stringify(t)"', 'return value="v"'], { parameters: TEXT_T, returns: 'string' }),
  'let-list-literal': () => entry(['let name=v value="[1, 2, 3]"', 'return value="1"']),
  'let-record-member': () =>
    entry(['let name=r value="{a: 1}"', 'let name=v value="r.a"', 'return value="v"']),
  'params-bool-list': () => entry(['return value="bs"'], { parameters: BOOL_LIST, returns: 'boolean[]' }),
  'params-int-list': () => entry(['return value="ns"'], { parameters: INT_LIST, returns: 'integer[]' }),
  'print-text': () => entry(['print value="\\"hello\\""', 'return value="1"']),
  'throw-coded': () => entry(['throw value="{message: \\"boom\\", code: \\"E1\\"}"', 'return value="1"']),
  'throw-plain': () => entry(['throw value="{message: \\"boom\\"}"', 'return value="1"']),
  'try-catch-binding': () =>
    entry([
      'let name=acc value="0"',
      'try',
      '  throw value="{message: \\"boom\\"}"',
      'catch name=e',
      '  assign target="acc" value="1"',
      'return value="acc"',
    ]),
  'try-catch-finally': () =>
    entry([
      'let name=acc value="0"',
      'try',
      '  throw value="{message: \\"boom\\"}"',
      'catch name=e',
      '  assign target="acc" value="1"',
      'finally',
      '  assign target="acc" value="acc + 10"',
      'return value="acc"',
    ]),
  'try-catch-rethrow': () =>
    entry([
      'try',
      '  throw value="{message: \\"boom\\"}"',
      'catch name=e',
      '  throw value="e"',
      'return value="1"',
    ]),
  'try-finally-only': () =>
    entry([
      'let name=acc value="0"',
      'try',
      '  assign target="acc" value="1"',
      'finally',
      '  assign target="acc" value="acc + 10"',
      'return value="acc"',
    ]),
  'try-finally-return-crossing': () =>
    entry([
      'let name=acc value="0"',
      'try',
      '  return value="1"',
      'finally',
      '  assign target="acc" value="acc + 10"',
      'return value="acc"',
    ]),
  'try-in-for': () =>
    entry([
      'let name=acc value="0"',
      'for name=i from="0" to="3"',
      '  try',
      '    assign target="acc" value="acc + 1"',
      '  catch name=e',
      '    assign target="acc" value="0"',
      'return value="acc"',
    ]),
  'try-nested': () =>
    entry([
      'let name=acc value="0"',
      'try',
      '  try',
      '    throw value="{message: \\"boom\\"}"',
      '  catch name=inner',
      '    throw value="inner"',
      'catch name=outer',
      '  assign target="acc" value="1"',
      'return value="acc"',
    ]),
  'unary-negate': () => entry(['return value="-a"'], { parameters: INT_A }),
  'void-fallthrough': () => entry(['print value="\\"void\\""'], { returns: 'void' }),
  'while-break': () =>
    entry([
      'let name=acc value="0"',
      'let name=i value="0"',
      'while cond="true"',
      '  if cond="i > 2"',
      '    break',
      '  assign target="i" value="i + 1"',
      '  assign target="acc" value="acc + i"',
      'return value="acc"',
    ]),
  'while-counted': () =>
    entry([
      'let name=acc value="0"',
      'let name=i value="0"',
      'while cond="i < 3"',
      '  assign target="acc" value="acc + i"',
      '  assign target="i" value="i + 1"',
      'return value="acc"',
    ]),
  'while-in-try-finally': () =>
    entry([
      'let name=acc value="0"',
      'let name=i value="0"',
      'try',
      '  while cond="i < 3"',
      '    assign target="i" value="i + 1"',
      'finally',
      '  assign target="acc" value="acc + 10"',
      'return value="acc"',
    ]),
});

export const CORPUS_NAMES = Object.freeze(Object.keys(CORPUS).sort());

// Two emitter branches no projectable source reaches: a capability that carries an input slot, and a
// throw whose payload the linker's own gate refuses. Both are spliced into an already-linked program.
export const SPLICED = Object.freeze({
  'capability-input-slot': Object.freeze({
    base: 'capability-then-return',
    splice: (program) => spliceStatements(program, 'capability', (statement) =>
      Object.freeze({ ...statement, input: TEXT_LITERAL })),
  }),
  'throw-null-message': Object.freeze({
    base: 'throw-plain',
    splice: (program) => spliceStatements(program, 'throw', (statement) =>
      Object.freeze({
        ...statement,
        value: Object.freeze({
          entries: Object.freeze(
            statement.value.entries.map((entry) =>
              entry.key === 'message' ? Object.freeze({ key: 'message', value: NULL_LITERAL }) : entry,
            ),
          ),
          kind: 'record',
        }),
      })),
  }),
});

const TEXT_LITERAL = Object.freeze({ kind: 'literal', value: Object.freeze({ tag: 'text', value: 'in' }) });
const NULL_LITERAL = Object.freeze({ kind: 'literal', value: Object.freeze({ tag: 'null' }) });

function spliceStatements(program, kind, replace) {
  const statements = program.program.statements.map((statement) =>
    statement.kind === kind ? replace(statement) : statement,
  );
  if (!statements.some((statement) => statement.kind === kind)) {
    throw new TypeError(`E_SPLICE_BASE: the base program carries no ${kind} statement`);
  }
  return Object.freeze({
    ...program,
    program: Object.freeze({ ...program.program, statements: Object.freeze(statements) }),
  });
}

export const SPLICED_NAMES = Object.freeze(Object.keys(SPLICED).sort());
