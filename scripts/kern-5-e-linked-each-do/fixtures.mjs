import { ENTRY, moduleSource } from '../kern-5-rt4-user-fn-call/k0-support.mjs';

export const BOOL_FLAG = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);
export const INT_A = Object.freeze([Object.freeze({ name: 'a', type: 'integer' })]);
export const TEXT_T = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);
export const TEXT_LIST = Object.freeze([Object.freeze({ name: 'xs', type: 'string[]' })]);
export const INT_LIST = Object.freeze([Object.freeze({ name: 'ns', type: 'integer[]' })]);
export const BOOL_LIST = Object.freeze([Object.freeze({ name: 'bs', type: 'boolean[]' })]);
export const TEXT_LIST_AND_SCALAR = Object.freeze([...TEXT_LIST, ...TEXT_T]);

export const CAPABILITY = 'capability namespace=fixture operation=resolve name=reply';

export const INT_HELPER = Object.freeze({
  body: Object.freeze(['return value="a + 1"']),
  name: 'bump',
  parameters: INT_A,
  returns: 'integer',
});

export const TEXT_HELPER = Object.freeze({
  body: Object.freeze(['return value="t"']),
  name: 'label',
  parameters: TEXT_T,
  returns: 'string',
});

export const BOOL_HELPER = Object.freeze({
  body: Object.freeze(['return value="flag"']),
  name: 'same',
  parameters: BOOL_FLAG,
  returns: 'boolean',
});

export const VOID_HELPER = Object.freeze({
  body: Object.freeze(['print value="\\"sunk\\""']),
  name: 'sink',
  parameters: INT_A,
  returns: 'void',
});

export const ASYNC_INT_HELPER = Object.freeze({
  body: Object.freeze([CAPABILITY, 'return value="3"']),
  name: 'afi',
  parameters: Object.freeze([]),
  returns: 'integer',
});

const HELPERS = Object.freeze([INT_HELPER, TEXT_HELPER, BOOL_HELPER]);

export function eachProgram(body, { helpers = HELPERS, parameters = TEXT_LIST, returns = 'integer' } = {}) {
  return moduleSource([...helpers, { body, exported: 'true', name: ENTRY.handlerName, parameters, returns }]);
}

// Every admitted fixture keeps the same accumulator shape, so a positive and its negative differ by
// exactly the one clause the row under test names.
const ACC = 'let name=acc value="0"';
const RET_ACC = 'return value="acc"';
const BUMP_ACC = '  assign target="acc" value="acc + 1"';

export const DO_POSITIONS = Object.freeze({
  'do-async-call': () => eachProgram(['do value="afi()"', 'return value="1"'], { helpers: [ASYNC_INT_HELPER] }),
  'do-async-in-argument': () =>
    eachProgram(['do value="bump(afi())"', 'return value="1"'], { helpers: [ASYNC_INT_HELPER, INT_HELPER] }),
  'do-bare': () => eachProgram(['do', 'return value="1"']),
  'do-bare-twin': () => eachProgram(['return value="1"']),
  'do-binary': () => eachProgram(['do value="1 + 1"', 'return value="1"']),
  'do-identifier': () => eachProgram([ACC, 'do value="acc"', RET_ACC]),
  'do-in-each': () => eachProgram([ACC, 'each name=x in="xs"', '  do value="label(x)"', BUMP_ACC, RET_ACC]),
  'do-in-for': () => eachProgram([ACC, 'for name=i from="0" to="2"', '  do value="bump(i)"', BUMP_ACC, RET_ACC]),
  'do-in-try': () =>
    eachProgram([ACC, 'try', '  do value="bump(1)"', 'catch name=e', '  do', '  assign target="acc" value="1"', RET_ACC]),
  'do-in-while': () =>
    eachProgram([
      ACC,
      'let name=i value="0"',
      'while cond="i < 2"',
      '  do value="bump(i)"',
      '  assign target="i" value="i + 1"',
      BUMP_ACC,
      RET_ACC,
    ]),
  'do-json-parse': () => eachProgram(['do value="Json.parse(t)"', 'return value="1"'], { parameters: TEXT_T }),
  'do-json-stringify': () => eachProgram(['do value="Json.stringify(t)"', 'return value="1"'], { parameters: TEXT_T }),
  'do-list-literal': () => eachProgram(['do value="[1, 2]"', 'return value="1"']),
  'do-literal': () => eachProgram(['do value="1"', 'return value="1"']),
  'do-member': () => eachProgram(['do value="t.a"', 'return value="1"'], { parameters: TEXT_T }),
  'do-member-call': () => eachProgram(['do value="xs.push(1)"', 'return value="1"']),
  'do-record-literal': () => eachProgram(['do value="{a: 1}"', 'return value="1"']),
  'do-sync-call': () => eachProgram(['do value="bump(1)"', 'return value="1"']),
  'do-sync-call-twin': () => eachProgram(['return value="1"']),
  'do-text-call': () => eachProgram(['do value="label(t)"', 'return value="1"'], { parameters: TEXT_LIST_AND_SCALAR }),
  'do-unary': () => eachProgram(['do value="-a"', 'return value="1"'], { parameters: INT_A }),
  'do-void-call': () => eachProgram(['do value="sink(1)"', 'return value="1"'], { helpers: [VOID_HELPER] }),
});

export const EACH_POSITIONS = Object.freeze({
  'each-assign-index': () =>
    eachProgram([ACC, 'each name=x in="xs" index=i', '  assign target="i" value="i + 1"', RET_ACC]),
  'each-assign-item': () => eachProgram([ACC, 'each name=x in="xs"', '  assign target="x" value="x"', RET_ACC]),
  'each-await': () => eachProgram([ACC, 'each name=x in="xs" await=true', BUMP_ACC, RET_ACC]),
  'each-bool-item-condition': () =>
    eachProgram([ACC, 'each name=b in="bs"', '  if cond="b"', '    assign target="acc" value="acc + 1"', RET_ACC], {
      parameters: BOOL_LIST,
    }),
  'each-bool-item-cross-call': () =>
    eachProgram([ACC, 'each name=b in="bs"', '  if cond="same(b)"', '    assign target="acc" value="acc + 1"', RET_ACC], {
      parameters: BOOL_LIST,
    }),
  'each-break': () =>
    eachProgram([ACC, 'each name=x in="xs"', '  if cond="acc > 0"', '    break', BUMP_ACC, RET_ACC]),
  'each-break-crosses-finally': () =>
    eachProgram([
      ACC,
      'each name=x in="xs"',
      '  try',
      '    if cond="true"',
      '      break',
      '  finally',
      '    assign target="acc" value="acc + 10"',
      RET_ACC,
    ]),
  'each-capability-body': () => eachProgram([ACC, 'each name=x in="xs"', `  ${CAPABILITY}`, BUMP_ACC, RET_ACC]),
  'each-continue': () =>
    eachProgram([ACC, 'each name=x in="xs"', '  if cond="acc > 0"', '    continue', BUMP_ACC, RET_ACC]),
  'each-do-async-body': () =>
    eachProgram([ACC, 'each name=x in="xs"', '  do value="afi()"', BUMP_ACC, RET_ACC], {
      helpers: [ASYNC_INT_HELPER],
    }),
  'each-empty-body': () => eachProgram([ACC, 'each name=x in="xs"', RET_ACC]),
  'each-entries': () => eachProgram([ACC, 'each name=x in="xs" entries=true', BUMP_ACC, RET_ACC]),
  'each-entry-key-only': () => eachProgram([ACC, 'each name=x in="xs" entryKey=k', BUMP_ACC, RET_ACC]),
  'each-entry-mode': () => eachProgram([ACC, 'each name=x in="xs" entryKey=k entryValue=v', BUMP_ACC, RET_ACC]),
  'each-entry-value-only': () => eachProgram([ACC, 'each name=x in="xs" entryValue=v', BUMP_ACC, RET_ACC]),
  'each-in-try': () =>
    eachProgram([
      ACC,
      'try',
      '  each name=x in="xs"',
      '    assign target="acc" value="acc + 1"',
      'catch name=e',
      '  assign target="acc" value="0"',
      RET_ACC,
    ]),
  'each-index': () => eachProgram([ACC, 'each name=x in="xs" index=i', '  assign target="acc" value="acc + i"', RET_ACC]),
  'each-index-as-for-bound': () =>
    eachProgram([
      ACC,
      'each name=x in="xs" index=i',
      '  for name=j from="0" to="i"',
      '    assign target="acc" value="acc + 1"',
      RET_ACC,
    ]),
  'each-index-shadows-item': () => eachProgram([ACC, 'each name=x in="xs" index=x', BUMP_ACC, RET_ACC]),
  'each-int-item-as-for-bound': () =>
    eachProgram([
      ACC,
      'each name=n in="ns"',
      '  for name=j from="0" to="n"',
      '    assign target="acc" value="acc + 1"',
      RET_ACC,
    ], { parameters: INT_LIST }),
  'each-int-item-sum': () =>
    eachProgram([ACC, 'each name=n in="ns"', '  assign target="acc" value="acc + n"', RET_ACC], {
      parameters: INT_LIST,
    }),
  'each-nested-each': () =>
    eachProgram([ACC, 'each name=x in="xs"', '  each name=y in="xs"', '    assign target="acc" value="acc + 1"', RET_ACC]),
  'each-nested-for-break': () =>
    eachProgram([
      ACC,
      'each name=x in="xs"',
      '  for name=j from="0" to="3"',
      '    if cond="j > 1"',
      '      break',
      '    assign target="acc" value="acc + 1"',
      RET_ACC,
    ]),
  'each-nested-while-continue': () =>
    eachProgram([
      ACC,
      'let name=i value="0"',
      'each name=x in="xs"',
      '  while cond="i < 2"',
      '    assign target="i" value="i + 1"',
      '    if cond="i > 1"',
      '      continue',
      '    assign target="acc" value="acc + 1"',
      RET_ACC,
    ]),
  'each-pair-key-only': () => eachProgram([ACC, 'each name=x in="xs" pairKey=k', BUMP_ACC, RET_ACC]),
  'each-pair-mode': () => eachProgram([ACC, 'each name=x in="xs" pairKey=k pairValue=v', BUMP_ACC, RET_ACC]),
  'each-pair-value-only': () => eachProgram([ACC, 'each name=x in="xs" pairValue=v', BUMP_ACC, RET_ACC]),
  'each-plain': () => eachProgram([ACC, 'each name=x in="xs"', BUMP_ACC, RET_ACC]),
  'each-plain-twin': () => eachProgram([ACC, RET_ACC]),
  'each-print-body': () =>
    eachProgram([ACC, 'each name=x in="xs"', '  if cond="true"', '    print value="x"', BUMP_ACC, RET_ACC]),
  'each-record-field': () => eachProgram([ACC, 'each name=x in="t.items"', BUMP_ACC, RET_ACC], { parameters: TEXT_T }),
  'each-shadow-let': () =>
    eachProgram(['let name=x value="0"', ACC, 'each name=x in="xs"', BUMP_ACC, RET_ACC]),
  'each-shadow-parameter': () => eachProgram([ACC, 'each name=xs in="xs"', BUMP_ACC, RET_ACC]),
  'each-source-call': () => eachProgram([ACC, 'each name=x in="mk()"', BUMP_ACC, RET_ACC]),
  'each-source-let-list': () =>
    eachProgram(['let name=ys value="[1, 2]"', ACC, 'each name=x in="ys"', BUMP_ACC, RET_ACC]),
  'each-source-list-literal': () => eachProgram([ACC, 'each name=x in="[1, 2]"', BUMP_ACC, RET_ACC]),
  'each-source-scalar-parameter': () => eachProgram([ACC, 'each name=x in="t"', BUMP_ACC, RET_ACC], {
    parameters: TEXT_T,
  }),
  'each-text-item-cross-call': () =>
    eachProgram([ACC, 'each name=x in="xs"', '  let name=s value="label(x)"', BUMP_ACC, RET_ACC]),
  'each-try-finally-in-body': () =>
    eachProgram([
      ACC,
      'each name=x in="xs"',
      '  try',
      '    assign target="acc" value="acc + 1"',
      '  finally',
      '    assign target="acc" value="acc + 10"',
      RET_ACC,
    ]),
  'each-type-annotation': () => eachProgram([ACC, 'each name=x in="xs" type=string', BUMP_ACC, RET_ACC]),
});

export const POSITIONS = Object.freeze({ ...DO_POSITIONS, ...EACH_POSITIONS });

export const POSITION_NAMES = Object.freeze(Object.keys(POSITIONS).sort());
