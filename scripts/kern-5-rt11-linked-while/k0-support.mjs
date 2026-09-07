import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ENTRY,
  admission,
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeJavaScriptChild,
  executeKernKir,
  moduleSource,
  project,
  provider,
} from '../kern-5-rt4-user-fn-call/k0-support.mjs';
import {
  DEFERRAL_LABEL,
  LEDGER,
  ROW_KEYS,
  validateLedger,
} from '../kern-5-parity-ledger/ledger-support.mjs';

export * from '../kern-5-rt10-for/k0-support.mjs';

export { DEFERRAL_LABEL, LEDGER, ROW_KEYS, validateLedger };

const TABLE_URL = new URL('./behavior-table.json', import.meta.url);

export const BEHAVIOR_TABLE_RAW = readFileSync(TABLE_URL, 'utf8');
export const WHILE_TABLE_ROWS = Object.freeze(
  JSON.parse(BEHAVIOR_TABLE_RAW).rows.map((row) => Object.freeze({ ...row })),
);

export const LEDGER_ROW_VALUES = Object.freeze({
  blockedBy: Object.freeze([]),
  label: DEFERRAL_LABEL,
  nodeKind: 'while',
  since: 'kern-5-rt11-linked-while',
  spec: '.Codex/specs/kern-5-rt11-linked-while/spec.md',
  surface: 'statement',
});

export const WHILE_SPEC_URL = new URL('../../.Codex/specs/kern-5-rt11-linked-while/spec.md', import.meta.url);

const BOOL_FLAG = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);
const INT_A = Object.freeze([Object.freeze({ name: 'a', type: 'integer' })]);
const TEXT_T = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);

const CAPABILITY = 'capability namespace=fixture operation=resolve name=reply';

const BOOL_HELPER = Object.freeze({
  body: Object.freeze(['return value="false"']),
  name: 'isok',
  parameters: Object.freeze([]),
  returns: 'boolean',
});

const ASYNC_BOOL_HELPER = Object.freeze({
  body: Object.freeze([CAPABILITY, 'return value="false"']),
  name: 'afb',
  parameters: Object.freeze([]),
  returns: 'boolean',
});

const ASYNC_INT_HELPER = Object.freeze({
  body: Object.freeze([CAPABILITY, 'return value="3"']),
  name: 'afi',
  parameters: Object.freeze([]),
  returns: 'integer',
});

const INT_IDENTITY = Object.freeze({
  body: Object.freeze(['return value="a"']),
  name: 'idp',
  parameters: INT_A,
  returns: 'integer',
});

const WHILE_SUM_HELPER = Object.freeze({
  body: Object.freeze([
    'let name=acc value="0"',
    'let name=i value="0"',
    'while cond="i < 3"',
    '  assign target="acc" value="acc + i"',
    '  assign target="i" value="i + 1"',
    'return value="acc"',
  ]),
  name: 'sumw',
  parameters: Object.freeze([]),
  returns: 'integer',
});

export function whileProgram(body, { helpers = [], parameters = [], returns = 'integer' } = {}) {
  return moduleSource([...helpers, { body, exported: 'true', name: ENTRY.handlerName, parameters, returns }]);
}

export function quotedText(value) {
  return `"\\"${value}\\""`;
}

// The canonical counted `while`: an accumulator, an explicit counter, and the increment the loop
// form has to spell out because nothing binds it. Every metering identity is derived against this
// shape so the counter's cost is a measured term rather than a hidden one.
export function whileAccumulate(bound, { helpers = [], parameters = [], term = 'i' } = {}) {
  return whileProgram(
    [
      'let name=acc value="0"',
      'let name=i value="0"',
      `while cond="i < ${bound}"`,
      `  assign target="acc" value="acc + ${term}"`,
      '  assign target="i" value="i + 1"',
      'return value="acc"',
    ],
    { helpers, parameters },
  );
}

export function forAccumulate(to, { term = 'i' } = {}) {
  return whileProgram([
    'let name=acc value="0"',
    `for name=i from="0" to="${to}"`,
    `  assign target="acc" value="acc + ${term}"`,
    'return value="acc"',
  ]);
}

export const WHILE_POSITIONS = Object.freeze({
  'while-assign-outer-persists': () =>
    whileProgram([
      'let name=acc value="0"',
      'let name=i value="0"',
      'while cond="i < 3"',
      '  assign target="acc" value="acc + 10"',
      '  assign target="i" value="i + 1"',
      'return value="acc"',
    ]),
  'while-async-let-in-body': () =>
    whileProgram(
      [
        'let name=acc value="0"',
        'let name=i value="0"',
        'while cond="i < 3"',
        '  let name=x value="afi()"',
        '  assign target="acc" value="acc + x"',
        '  assign target="i" value="i + 1"',
        'return value="acc"',
      ],
      { helpers: [ASYNC_INT_HELPER] },
    ),
  'while-cap-via-if': () =>
    whileProgram(
      [
        'let name=i value="0"',
        'while cond="i < 1"',
        '  if cond="true"',
        `    ${CAPABILITY}`,
        '  assign target="i" value="i + 1"',
        `return value=${quotedText('d')}`,
      ],
      { returns: 'string' },
    ),
  'while-counted-3': () => whileAccumulate(3),
  'while-early-return': () =>
    whileProgram([
      'let name=i value="0"',
      'while cond="i < 5"',
      '  if cond="i == 3"',
      '    return value="i"',
      '  assign target="i" value="i + 1"',
      'return value="-1"',
    ]),
  'while-false-never-runs': () =>
    whileProgram([
      'let name=acc value="0"',
      'while cond="false"',
      '  assign target="acc" value="acc + 1"',
      'return value="acc"',
    ]),
  'while-flag-param-false': () =>
    whileProgram(
      [
        'let name=acc value="0"',
        'while cond="flag"',
        '  assign target="acc" value="acc + 1"',
        'return value="acc"',
      ],
      { parameters: BOOL_FLAG },
    ),
  'while-for-in-body': () =>
    whileProgram([
      'let name=acc value="0"',
      'let name=i value="0"',
      'while cond="i < 2"',
      '  for name=k from="0" to="2"',
      '    assign target="acc" value="acc + 1"',
      '  assign target="i" value="i + 1"',
      'return value="acc"',
    ]),
  'while-helper-in-body': () => whileAccumulate(4, { helpers: [INT_IDENTITY], term: 'idp(i)' }),
  'while-if-in-body': () =>
    whileProgram([
      'let name=acc value="0"',
      'let name=i value="0"',
      'while cond="i < 5"',
      '  if cond="i > 2"',
      '    assign target="acc" value="acc + i"',
      '  assign target="i" value="i + 1"',
      'return value="acc"',
    ]),
  'while-in-for-body': () =>
    whileProgram([
      'let name=acc value="0"',
      'for name=k from="0" to="2"',
      '  let name=i value="0"',
      '  while cond="i < 2"',
      '    assign target="acc" value="acc + 1"',
      '    assign target="i" value="i + 1"',
      'return value="acc"',
    ]),
  'while-in-helper-body': () => whileProgram(['return value="sumw()"'], { helpers: [WHILE_SUM_HELPER] }),
  'while-in-if-else': () =>
    whileProgram([
      'let name=acc value="0"',
      'let name=i value="0"',
      'if cond="false"',
      '  assign target="acc" value="1"',
      'else',
      '  while cond="i < 3"',
      '    assign target="acc" value="acc + i"',
      '    assign target="i" value="i + 1"',
      'return value="acc"',
    ]),
  'while-in-if-then': () =>
    whileProgram([
      'let name=acc value="0"',
      'let name=i value="0"',
      'if cond="true"',
      '  while cond="i < 3"',
      '    assign target="acc" value="acc + i"',
      '    assign target="i" value="i + 1"',
      'return value="acc"',
    ]),
  'while-let-in-body': () =>
    whileProgram([
      'let name=acc value="0"',
      'let name=i value="0"',
      'while cond="i < 3"',
      '  let name=d value="i + 1"',
      '  assign target="acc" value="acc + d"',
      '  assign target="i" value="i + 1"',
      'return value="acc"',
    ]),
  'while-nested-while': () =>
    whileProgram([
      'let name=acc value="0"',
      'let name=i value="0"',
      'while cond="i < 2"',
      '  let name=j value="0"',
      '  while cond="j < 2"',
      '    assign target="acc" value="acc + 1"',
      '    assign target="j" value="j + 1"',
      '  assign target="i" value="i + 1"',
      'return value="acc"',
    ]),
  'while-print-via-if': () =>
    whileProgram(
      [
        'let name=i value="0"',
        'while cond="i < 2"',
        '  if cond="true"',
        `    print value=${quotedText('tick')}`,
        '  assign target="i" value="i + 1"',
        `return value=${quotedText('d')}`,
      ],
      { returns: 'string' },
    ),
  'while-repeated-counter-name': () =>
    whileProgram([
      'let name=acc value="0"',
      'let name=i value="0"',
      'while cond="i < 2"',
      '  assign target="acc" value="acc + 1"',
      '  assign target="i" value="i + 1"',
      'assign target="i" value="0"',
      'while cond="i < 3"',
      '  assign target="acc" value="acc + 1"',
      '  assign target="i" value="i + 1"',
      'return value="acc"',
    ]),
  'while-true-exhausts-steps': () =>
    whileProgram([
      'let name=acc value="0"',
      'while cond="true"',
      '  assign target="acc" value="acc + 1"',
      'return value="acc"',
    ]),

  'neg-while-assign-in-body-async': () =>
    whileProgram(
      [
        'let name=acc value="0"',
        'let name=i value="0"',
        'while cond="i < 3"',
        '  assign target="acc" value="acc + afi()"',
        '  assign target="i" value="i + 1"',
        'return value="acc"',
      ],
      { helpers: [ASYNC_INT_HELPER] },
    ),
  'neg-while-break-in-body': () =>
    whileProgram(['let name=acc value="0"', 'while cond="false"', '  break', 'return value="acc"']),
  'neg-while-cond-async': () =>
    whileProgram(
      [
        'let name=acc value="0"',
        'while cond="afb()"',
        '  assign target="acc" value="acc + 1"',
        'return value="acc"',
      ],
      { helpers: [ASYNC_BOOL_HELPER] },
    ),
  'neg-while-cond-binary-integer': () =>
    whileProgram([
      'let name=acc value="0"',
      'while cond="1 + 1"',
      '  assign target="acc" value="acc + 1"',
      'return value="acc"',
    ]),
  'neg-while-cond-integer-literal': () =>
    whileProgram([
      'let name=acc value="0"',
      'while cond="1"',
      '  assign target="acc" value="acc + 1"',
      'return value="acc"',
    ]),
  'neg-while-cond-integer-param': () =>
    whileProgram(
      ['let name=acc value="0"', 'while cond="a"', '  assign target="acc" value="acc + 1"', 'return value="acc"'],
      { parameters: INT_A },
    ),
  'neg-while-cond-text-param': () =>
    whileProgram(
      ['let name=acc value="0"', 'while cond="t"', '  assign target="acc" value="acc + 1"', 'return value="acc"'],
      { parameters: TEXT_T },
    ),
  'neg-while-continue-in-body': () =>
    whileProgram(['let name=acc value="0"', 'while cond="false"', '  continue', 'return value="acc"']),
  'neg-while-each-in-body': () =>
    whileProgram(
      [
        'let name=acc value="0"',
        'while cond="false"',
        '  each name=x in="xs"',
        '    assign target="acc" value="acc + 1"',
        'return value="acc"',
      ],
      { parameters: Object.freeze([Object.freeze({ name: 'xs', type: 'integer[]' })]) },
    ),
  'neg-while-empty-body': () =>
    whileProgram(['let name=acc value="0"', 'while cond="false"', 'return value="acc"']),
  'neg-while-let-escapes': () =>
    whileProgram([
      'let name=i value="0"',
      'while cond="i < 3"',
      '  let name=d value="i + 1"',
      '  assign target="i" value="i + 1"',
      'return value="d"',
    ]),
  'neg-while-void-return-in-body': () =>
    whileProgram(
      [
        'let name=i value="0"',
        'while cond="i < 2"',
        '  if cond="i > 0"',
        '    return value="1"',
        '  assign target="i" value="i + 1"',
      ],
      { returns: 'void' },
    ),
  'while-cond-user-call': () =>
    whileProgram(
      [
        'let name=acc value="0"',
        'while cond="isok()"',
        '  assign target="acc" value="acc + 1"',
        'return value="acc"',
      ],
      { helpers: [BOOL_HELPER] },
    ),
});

export const WHILE_POSITION_ARGUMENTS = Object.freeze({
  'neg-while-cond-integer-param': () => ({ a: { tag: 'integer', value: '1' } }),
  'neg-while-cond-text-param': () => ({ t: { tag: 'text', value: 'a' } }),
  'while-flag-param-false': () => ({ flag: { tag: 'boolean', value: false } }),
});

export function whilePositionArguments(name) {
  return WHILE_POSITION_ARGUMENTS[name] === undefined ? {} : WHILE_POSITION_ARGUMENTS[name]();
}

// `print` and `capability` are absent from `while`'s 27-member allowedChildren, exactly as they are
// from `for`'s, so both die at F5 rather than at the linker. A widened catalog surfaces here.
export const WHILE_BODY_FENCES = Object.freeze({
  'fence-capability-in-body': () =>
    whileProgram(['while cond="false"', `  ${CAPABILITY}`, `return value=${quotedText('d')}`], { returns: 'string' }),
  'fence-extra-property': () =>
    whileProgram([
      'let name=acc value="0"',
      'while cond="false" name=x',
      '  assign target="acc" value="acc + 1"',
      'return value="acc"',
    ]),
  'fence-missing-cond': () =>
    whileProgram(['let name=acc value="0"', 'while', '  assign target="acc" value="acc + 1"', 'return value="acc"']),
  'fence-print-in-body': () =>
    whileProgram(['while cond="false"', `  print value=${quotedText('w')}`, `return value=${quotedText('d')}`], {
      returns: 'string',
    }),
});

// The straight-line twins every `while` metering identity is derived against, plus the two `for`
// twins the cross-form rows need. Each is admitted at base, so the constants are measurements.
export const WHILE_TWINS = Object.freeze({
  'twin-assign-one': () =>
    whileProgram(['let name=acc value="0"', 'assign target="acc" value="acc + 1"', 'return value="acc"']),
  'twin-let-literal': () => whileProgram(['let name=x value="3"', 'return value="x"']),
  'twin-two-lets': () => whileProgram(['let name=acc value="0"', 'let name=i value="0"', 'return value="acc"']),
  'twin-two-lets-assign': () =>
    whileProgram([
      'let name=acc value="0"',
      'let name=i value="0"',
      'assign target="i" value="i + 1"',
      'return value="acc"',
    ]),
});

export const WHILE_METER_POSITIONS = Object.freeze({
  'meter-for-trips-0': () => forAccumulate(0, { term: '1' }),
  'meter-for-trips-3': () => forAccumulate(3, { term: '1' }),
  'meter-nested-2x2': () =>
    whileProgram([
      'let name=acc value="0"',
      'let name=i value="0"',
      'while cond="i < 2"',
      '  let name=j value="0"',
      '  while cond="j < 2"',
      '    assign target="acc" value="acc + 1"',
      '    assign target="j" value="j + 1"',
      '  assign target="i" value="i + 1"',
      'return value="acc"',
    ]),
  'meter-nested-2x4': () =>
    whileProgram([
      'let name=acc value="0"',
      'let name=i value="0"',
      'while cond="i < 2"',
      '  let name=j value="0"',
      '  while cond="j < 4"',
      '    assign target="acc" value="acc + 1"',
      '    assign target="j" value="j + 1"',
      '  assign target="i" value="i + 1"',
      'return value="acc"',
    ]),
  'meter-trips-0': () => whileAccumulate(0, { term: '1' }),
  'meter-trips-0-fat': () =>
    whileProgram([
      'let name=acc value="0"',
      'let name=i value="0"',
      'while cond="i < 0"',
      '  let name=d value="i + 1"',
      '  assign target="acc" value="acc + d"',
      '  assign target="acc" value="acc + 1"',
      '  assign target="i" value="i + 1"',
      'return value="acc"',
    ]),
  'meter-trips-1': () => whileAccumulate(1, { term: '1' }),
  'meter-trips-3': () => whileAccumulate(3, { term: '1' }),
});

export const WHILE_SHAPE_POSITIONS = Object.freeze([
  'neg-while-empty-body',
  'while-counted-3',
  'while-nested-while',
]);

// Two legs, not three: the Python leg refuses every `while` program by ledger row, so
// `threeLegs`/`emittedArtifacts` (which assert a successful Python compile) are unusable here.
export async function twoLegs(source, request) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F5 must project the fixture source');
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `RT11W_LINK_REFUSED: javascript compile failed: ${javascript.code}`);
  const directCalls = [];
  const direct = await executeKernKir(verified, request, provider(directCalls));
  const javascriptRun = await executeJavaScriptChild(javascript.artifact.bytes, request);
  return { direct: { calls: directCalls, envelope: direct }, javascript: javascriptRun };
}

export async function twoLegBytes(source, request) {
  const legs = await twoLegs(source, request);
  const direct = envelopeBytes(legs.direct.envelope);
  assert.deepEqual(
    Buffer.from(envelopeBytes(legs.javascript.envelope)),
    Buffer.from(direct),
    'RT11W_LEG_DIVERGENCE: emitted JavaScript diverged from RT-1',
  );
  return { bytes: direct, legs };
}

export async function javascriptArtifact(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the fixture must project');
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `RT11W_LINK_REFUSED: javascript compile failed: ${javascript.code}`);
  return Buffer.from(javascript.artifact.bytes).toString('utf8');
}

export async function pythonCompile(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the fixture must project so the deferral is a compile decision');
  return compilePython(verified);
}

// The linker is target-neutral, so a `while` fixture the linker refuses is refused identically on
// all three legs, including Python: the refusal happens before the deferral pass ever runs. That is
// what lets the landed `assertLinkLabel` be reused unchanged for every negative row here.
export async function assertWhileAdmitted(name, source) {
  const row = await admission(source);
  assert.equal(row.projection, 'projected', name);
  assert.equal(row.rt1, 'admitted', `RT11W_LINK_REFUSED: ${name} must link on RT-1`);
  assert.equal(row.javascript, 'admitted', `RT11W_LINK_REFUSED: ${name} must link on the JavaScript leg`);
  return row;
}

// A hand-built linked `while` statement, so the two semantic walkers can be asked about a condition
// loop without depending on the linker admitting one first. Both throw a TypeError until they learn
// `while`, which is a cause independent of the linker's own route.
export function linkedWhileStatement({ body, condition } = {}) {
  return Object.freeze({
    body: Object.freeze(body ?? []),
    condition: condition ?? Object.freeze({ kind: 'literal', value: Object.freeze({ tag: 'boolean', value: true }) }),
    kind: 'while',
  });
}

export function linkedUserCall(handlerName) {
  return Object.freeze({ arguments: Object.freeze([]), handlerName, kind: 'user-call' });
}
