import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { walkStatements, ENTRY_WALK_POLICY, WALK_SEED } from '../../packages/core/dist/kir-runtime/expression.js';
import { RuntimeMeter } from '../../packages/core/dist/kir-runtime/inspect.js';
import {
  linkVerifiedKernKirProgramOrThrow,
  linkedProgramAsyncHelpers,
  linkedProgramHelpers,
} from '../../packages/core/dist/kir-runtime/linked-kir-program/index.js';
import { decodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
// A `export *` re-export does not bring a name into this module's own scope, so everything this
// file calls is imported by name as well as re-exported below.
import {
  ENTRY,
  LIMITS,
  executeKernKir,
  linkVerifiedKernKirProgram,
  moduleSource,
  project,
  provider,
  stepRequest,
} from '../kern-5-rt4-user-fn-call/k0-support.mjs';
import { runProjection } from '../kern-frontend-f5-projection/worker.mjs';

export * from '../kern-5-rt10-cross-call-integer/k0-support.mjs';

const F5_CANONICAL_LIMITS = JSON.parse(
  readFileSync(new URL('../kern-frontend-f5-projection/policy.json', import.meta.url), 'utf8'),
).canonicalLimits;

const TABLE_URL = new URL('./behavior-table.json', import.meta.url);

export const BEHAVIOR_TABLE_RAW = readFileSync(TABLE_URL, 'utf8');
export const TABLE_ROWS = Object.freeze(JSON.parse(BEHAVIOR_TABLE_RAW).rows.map((row) => Object.freeze({ ...row })));

export const INT_A = Object.freeze([Object.freeze({ name: 'a', type: 'integer' })]);
export const BOOL_FLAG = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);
export const TEXT_T = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);

export const CAPABILITY = 'capability namespace=fixture operation=resolve name=reply';

export const IDENTITY_HELPER = Object.freeze({
  body: Object.freeze(['return value="a"']),
  name: 'idp',
  parameters: INT_A,
  returns: 'integer',
});

export const ASYNC_INT_HELPER = Object.freeze({
  body: Object.freeze([CAPABILITY, 'return value="3"']),
  name: 'afi',
  parameters: Object.freeze([]),
  returns: 'integer',
});

export const LOOP_HELPER = Object.freeze({
  body: Object.freeze([
    'let name=acc value="0"',
    'for name=i from="0" to="a"',
    '  assign target="acc" value="acc + i"',
    'return value="acc"',
  ]),
  name: 'sumto',
  parameters: INT_A,
  returns: 'integer',
});

export function program(body, { helpers = [], parameters = [], returns = 'integer' } = {}) {
  return moduleSource([...helpers, { body, exported: 'true', name: ENTRY.handlerName, parameters, returns }]);
}

export function quoted(value) {
  return `"\\"${value}\\""`;
}

// `assign acc = acc + <term>` over an accumulator seeded at 0, which is the only body shape that
// can accumulate: `assign` cannot see a compound operator (RT9-C3).
export function accumulate(from, to, { helpers = [], parameters = [], step, term = 'i' } = {}) {
  const bounds = step === undefined ? '' : ` step="${step}"`;
  return program(
    [
      'let name=acc value="0"',
      `for name=i from="${from}" to="${to}"${bounds}`,
      `  assign target="acc" value="acc + ${term}"`,
      'return value="acc"',
    ],
    { helpers, parameters },
  );
}

export function intArgs(values) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { tag: 'integer', value }]));
}

// RT-4's `directStepBudget` scans a fixed 90-step window, which a nested loop overruns. This one
// binary-searches a wider range and then asserts the threshold is sharp, which is what makes the
// search sound: one step under the answer must fail.
const MAX_SCANNED_STEPS = 4_000;

export async function loopStepBudget(source, args, requestId) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F5 must project the metering fixture');
  const links = (maxSteps) =>
    linkVerifiedKernKirProgram(verified, ENTRY, { ...LIMITS, maxSteps }).outcome === 'success';
  const runs = async (maxSteps) => {
    const request = stepRequest(`${requestId}-${maxSteps}`, args, maxSteps);
    const envelope = await executeKernKir(verified, request, provider([]));
    return envelope.outcome === 'success';
  };
  const search = async (predicate, label) => {
    let low = 1;
    let high = MAX_SCANNED_STEPS;
    assert.ok(await predicate(high), `${requestId}: ${label} does not succeed inside the scanned step range`);
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (await predicate(mid)) high = mid;
      else low = mid + 1;
    }
    return low;
  };
  const link = await search(async (maxSteps) => links(maxSteps), 'linking');
  const total = await search(runs, 'execution');
  assert.equal(await runs(total - 1), false, `${requestId}: step consumption must be monotonic in the budget`);
  return { execution: total - link, link };
}

// The envelope carries only `{category, code, phase}` for a runtime diagnostic — never a message —
// so the label a runtime fault raises is only observable by driving the walk directly and catching
// the raw `KernKirFault` before `executeKernKir` converts it into an envelope.
export async function rawRuntimeFaultMessage(source, args) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the fixture must project so the fault is a runtime decision');
  const linked = linkVerifiedKernKirProgramOrThrow(verified, ENTRY, new RuntimeMeter(LIMITS));
  const bindings = new Map(Object.entries(args));
  const runtime = {
    asyncHelpers: linkedProgramAsyncHelpers(linked.helpers),
    checkAbort: () => {},
    events: [],
    helpers: linkedProgramHelpers(linked.helpers),
    maxEvents: LIMITS.maxEvents,
  };
  const walk = walkStatements(linked.program, bindings, new RuntimeMeter(LIMITS), runtime, ENTRY_WALK_POLICY);
  let resume = WALK_SEED;
  for (;;) {
    let step;
    try {
      step = walk.next(resume);
    } catch (error) {
      return error.message;
    }
    assert.ok(!step.done, 'the fixture must fault before draining or returning');
    assert.fail(`unexpected suspension step ${step.value.kind}`);
  }
}

export function f5Row(source) {
  const result = runProjection([{ moduleId: ENTRY.moduleId, source }]);
  return {
    diagnostics: [...new Set(result.receipt.diagnostics.map(({ code }) => code))].sort(),
    status: result.receipt.status,
  };
}

function projectedRoots(source) {
  const result = runProjection([{ moduleId: ENTRY.moduleId, source }]);
  assert.equal(result.receipt.status, 'projected', 'the shape probe fixture must project');
  return decodeModuleKir(result.bytes, F5_CANONICAL_LIMITS).modules[0].roots;
}

function expressionTree(value, label, depth = 0) {
  assert.ok(depth <= 12, `${label}: lowered expression deeper than the probe walks`);
  assert.equal(value.tag, 'record', `${label} must be a lowered-expression record`);
  const outer = new Map(value.value.map((field) => [field.key, field.value]));
  const kind = outer.get('kind');
  assert.ok(kind !== undefined, `${label} must carry a kind field`);
  const fields = outer.get('fields');
  const tree = { kind: kind.value };
  if (fields === undefined) return tree;
  for (const [key, field] of new Map(fields.value.map((entry) => [entry.key, entry.value]))) {
    tree[key] = field.tag === 'record' ? expressionTree(field, `${label}.${key}`, depth + 1) : field.value;
  }
  return tree;
}

// The statement tree with nesting preserved, unlike the flattening probes RT-9 and RT-10-X use: a
// loop body is a child list, so a probe that flattened it could not tell a body from a sibling.
export function statementTree(source) {
  const walk = (nodes, depth) => {
    assert.ok(depth <= 8, 'the statement probe does not walk deeper than the fixtures nest');
    const shapes = [];
    for (const node of nodes) {
      if (node.kind === 'handler') {
        shapes.push(...walk(node.children, depth));
        continue;
      }
      const properties = {};
      for (const property of node.properties) {
        properties[property.key] =
          property.value.tag === 'record'
            ? expressionTree(property.value, `${node.kind}.${property.key}`)
            : property.value.value;
      }
      const shape = { kind: node.kind, properties };
      if (node.children.length > 0) shape.children = walk(node.children, depth + 1);
      shapes.push(shape);
    }
    return shapes;
  };
  const roots = projectedRoots(source);
  const entry = roots.find(
    (root) => root.properties.find((property) => property.key === 'name')?.value.value === ENTRY.handlerName,
  );
  assert.ok(entry !== undefined, 'the shape probe fixture must declare the entry function');
  return walk(entry.children, 0);
}

// The trip count is chosen so the loop's charge is two orders of magnitude over the suite's default
// `maxSteps` on every leg, and still cheap enough for the child-process wall clock under a
// sufficient budget.
export const BUDGET_TRIPS = 20_000;

export const POSITIONS = Object.freeze({
  'for-big-step': () => accumulate(0, 10, { step: 100 }),
  'for-budget-loop': () => accumulate(0, BUDGET_TRIPS, { term: '1' }),
  'for-bounds-once': () =>
    program(
      [
        'let name=acc value="0"',
        'let name=n value="3"',
        'for name=i from="0" to="n"',
        '  assign target="n" value="0"',
        '  assign target="acc" value="acc + 1"',
        'return value="acc"',
      ],
      {},
    ),
  'for-counter-product': () => accumulate(1, 5, { term: 'i * i' }),
  'for-async-let-in-body': () =>
    program(
      [
        'let name=acc value="0"',
        'for name=i from="0" to="3"',
        '  let name=x value="afi()"',
        '  assign target="acc" value="acc + x"',
        'return value="acc"',
      ],
      { helpers: [ASYNC_INT_HELPER] },
    ),
  'for-early-return': () =>
    program(['for name=i from="0" to="5"', '  if cond="i == 3"', '    return value="i"', 'return value="-1"']),
  'for-empty-negative': () => accumulate(0, 3, { step: -1, term: '1' }),
  'for-empty-range': () => accumulate(3, 3, { term: '1' }),
  'for-helper-in-body': () => accumulate(0, 4, { helpers: [IDENTITY_HELPER], term: 'idp(i)' }),
  'for-i64-near-limit': () => accumulate('9223372036854775805', '9223372036854775807', { term: '1' }),
  'for-if-in-body': () =>
    program([
      'let name=acc value="0"',
      'for name=i from="0" to="5"',
      '  if cond="i > 2"',
      '    assign target="acc" value="acc + i"',
      'return value="acc"',
    ]),
  'for-in-helper-body': () => program(['return value="sumto(4)"'], { helpers: [LOOP_HELPER] }),
  'for-let-in-body': () =>
    program([
      'let name=acc value="0"',
      'for name=i from="0" to="3"',
      '  let name=d value="i + 1"',
      '  assign target="acc" value="acc + d"',
      'return value="acc"',
    ]),
  'for-negative-counter': () => accumulate(-3, 0),
  'for-negative-step': () => accumulate(3, 0, { step: -1 }),
  'for-negative-step-2': () => accumulate(6, 0, { step: -2 }),
  'for-nested-acc': () =>
    program([
      'let name=acc value="0"',
      'for name=o from="0" to="3"',
      '  for name=n from="0" to="4"',
      '    assign target="acc" value="acc + o * n"',
      'return value="acc"',
    ]),
  'for-repeated-counter-name': () =>
    program([
      'let name=acc value="0"',
      'for name=i from="0" to="3"',
      '  assign target="acc" value="acc + i"',
      'for name=i from="0" to="3"',
      '  assign target="acc" value="acc + i"',
      'return value="acc"',
    ]),
  'for-reversed-positive-step': () => accumulate(3, 0, { term: '1' }),
  'for-single-iteration': () => accumulate(0, 1, { term: '1' }),
  'for-step-2': () => accumulate(0, 6, { step: 2 }),
  'for-step-larger-negative': () => accumulate(0, -6, { step: -3 }),
  'for-step-nonzero-computed': () => accumulate(0, 3, { step: '0 + 1', term: '1' }),
  'for-step-zero-computed': () => accumulate(0, 3, { step: '0 + 0', term: '1' }),
  'for-step-zero-dynamic-param': () => accumulate(0, 3, { parameters: INT_A, step: 'a', term: '1' }),
  'for-sum-0-3': () => accumulate(0, 3),
  'for-sum-1-5': () => accumulate(1, 5),
  'for-triple-nested': () =>
    program([
      'let name=acc value="0"',
      'for name=a from="0" to="2"',
      '  for name=b from="0" to="2"',
      '    for name=c from="0" to="2"',
      '      assign target="acc" value="acc + 1"',
      'return value="acc"',
    ]),
  'neg-assign-counter': () =>
    program(['for name=i from="0" to="3"', '  assign target="i" value="i + 1"', 'return value="1"']),
  'neg-async-assign-in-body': () =>
    program(
      [
        'let name=acc value="0"',
        'for name=i from="0" to="3"',
        '  assign target="acc" value="acc + afi()"',
        'return value="acc"',
      ],
      { helpers: [ASYNC_INT_HELPER] },
    ),
  'neg-async-bound-from': () => accumulate('afi()', 3, { helpers: [ASYNC_INT_HELPER], term: '1' }),
  'neg-async-bound-to': () => accumulate(0, 'afi()', { helpers: [ASYNC_INT_HELPER], term: '1' }),
  'neg-bound-bool-from': () => accumulate('flag', 3, { parameters: BOOL_FLAG, term: '1' }),
  'neg-bound-decimal-to': () => accumulate(0, '2.5', { term: '1' }),
  'neg-bound-text-to': () => accumulate(0, 't', { parameters: TEXT_T, term: '1' }),
  'neg-break-in-body': () =>
    program(['let name=acc value="0"', 'for name=i from="0" to="3"', '  break', 'return value="acc"']),
  'neg-continue-in-body': () =>
    program(['let name=acc value="0"', 'for name=i from="0" to="3"', '  continue', 'return value="acc"']),
  'neg-counter-after-loop': () =>
    program([
      'let name=acc value="0"',
      'for name=i from="0" to="3"',
      '  assign target="acc" value="acc + 1"',
      'return value="i"',
    ]),
  'neg-each': () =>
    program(
      ['let name=acc value="0"', 'each name=x in="xs"', '  assign target="acc" value="acc + 1"', 'return value="acc"'],
      { parameters: Object.freeze([Object.freeze({ name: 'xs', type: 'integer[]' })]) },
    ),
  'neg-empty-body': () => program(['let name=acc value="0"', 'for name=i from="0" to="3"', 'return value="acc"']),
  'neg-shadow-let': () =>
    program([
      'let name=i value="9"',
      'let name=acc value="0"',
      'for name=i from="0" to="3"',
      '  assign target="acc" value="acc + i"',
      'return value="acc"',
    ]),
  'neg-shadow-nested-counter': () =>
    program([
      'let name=acc value="0"',
      'for name=i from="0" to="3"',
      '  for name=i from="0" to="2"',
      '    assign target="acc" value="acc + i"',
      'return value="acc"',
    ]),
  'neg-shadow-parameter': () =>
    program(
      [
        'let name=acc value="0"',
        'for name=a from="0" to="3"',
        '  assign target="acc" value="acc + a"',
        'return value="acc"',
      ],
      { parameters: INT_A },
    ),
  'neg-step-bool': () => accumulate(0, 3, { parameters: BOOL_FLAG, step: 'flag', term: '1' }),
  'neg-step-zero-literal': () => accumulate(0, 3, { step: 0, term: '1' }),
  'neg-void-return-in-body': () =>
    program(['for name=i from="0" to="2"', '  if cond="i > 0"', '    return value="1"'], { returns: 'void' }),
  'neg-while': () =>
    program([
      'let name=acc value="0"',
      'while cond="false"',
      '  assign target="acc" value="acc + 1"',
      'return value="acc"',
    ]),
});

export const POSITION_ARGUMENTS = Object.freeze({
  'for-step-zero-dynamic-param': () => intArgs({ a: '0' }),
  'neg-bound-bool-from': () => ({ flag: { tag: 'boolean', value: true } }),
  'neg-bound-text-to': () => ({ t: { tag: 'text', value: 'a' } }),
  'neg-shadow-parameter': () => intArgs({ a: '1' }),
  'neg-step-bool': () => ({ flag: { tag: 'boolean', value: true } }),
});

export function positionArguments(name) {
  return POSITION_ARGUMENTS[name] === undefined ? {} : POSITION_ARGUMENTS[name]();
}

// The straight-line twins every metering identity is derived against. Each one is admitted at base,
// so the constants a `for` charge is compared to are measurements rather than predictions.
export const TWINS = Object.freeze({
  'twin-assign-counter': () =>
    program([
      'let name=acc value="0"',
      'let name=i value="0"',
      'assign target="acc" value="acc + i"',
      'return value="acc"',
    ]),
  'twin-assign-helper': () =>
    program(
      [
        'let name=acc value="0"',
        'let name=i value="0"',
        'assign target="acc" value="acc + idp(i)"',
        'return value="acc"',
      ],
      { helpers: [IDENTITY_HELPER] },
    ),
  'twin-assign-one': () =>
    program(['let name=acc value="0"', 'assign target="acc" value="acc + 1"', 'return value="acc"']),
  'twin-async-call': () =>
    program(['let name=acc value="afi()"', 'return value="acc"'], { helpers: [ASYNC_INT_HELPER] }),
  'twin-let-binary': () => program(['let name=x value="1 + 2"', 'return value="x"']),
  'twin-let-literal': () => program(['let name=x value="3"', 'return value="x"']),
  'twin-two-lets': () => program(['let name=acc value="0"', 'let name=i value="0"', 'return value="acc"']),
});

// The trip-count family the metering identities scan: one body shape, one bound shape, three trip
// counts, so every difference isolates exactly one term of `1_init + Sum(1_head + body) + 1_exit`.
export const METER_POSITIONS = Object.freeze({
  'meter-binary-bound-3': () => accumulate(0, '1 + 2', { term: '1' }),
  'meter-explicit-step-1': () => accumulate(0, 3, { step: 1, term: '1' }),
  'meter-helper-1': () => accumulate(0, 1, { helpers: [IDENTITY_HELPER], term: 'idp(i)' }),
  'meter-helper-3': () => accumulate(0, 3, { helpers: [IDENTITY_HELPER], term: 'idp(i)' }),
  'meter-literal-bound-3': () => accumulate(0, 3, { term: '1' }),
  'meter-nested-3x2': () =>
    program([
      'let name=acc value="0"',
      'for name=o from="0" to="3"',
      '  for name=n from="0" to="2"',
      '    assign target="acc" value="acc + 1"',
      'return value="acc"',
    ]),
  'meter-nested-3x4': () =>
    program([
      'let name=acc value="0"',
      'for name=o from="0" to="3"',
      '  for name=n from="0" to="4"',
      '    assign target="acc" value="acc + 1"',
      'return value="acc"',
    ]),
  'meter-trips-0': () => accumulate(3, 3, { term: '1' }),
  'meter-trips-1': () => accumulate(0, 1, { term: '1' }),
  'meter-trips-3': () => accumulate(0, 3, { term: '1' }),
});

// The `for` body vocabulary the structural catalog admits, and the two it does not: `print` and
// `capability` are absent from `allowedChildren`, so both fixtures are refused by F5 rather than by
// the linker, and the fence is what notices a schema widening.
export const BODY_FENCES = Object.freeze({
  'fence-capability-in-body': () =>
    program([`for name=i from="0" to="2"`, `  ${CAPABILITY}`, `return value=${quoted('d')}`], { returns: 'string' }),
  'fence-print-in-body': () =>
    program([`for name=i from="0" to="2"`, `  print value=${quoted('tick')}`, `return value=${quoted('d')}`], {
      returns: 'string',
    }),
});

export const SHAPE_POSITIONS = Object.freeze([
  'for-nested-acc',
  'for-step-2',
  'for-sum-0-3',
  'neg-assign-counter',
  'neg-empty-body',
  'neg-step-zero-literal',
]);

// A hand-built linked `for` statement, so the two closure walkers can be asked about a loop without
// depending on the linker admitting one first. Both throw the never-tripwire until they learn `for`.
export function linkedForStatement({ body, counter = 'i', from = '0', step = '1', to = '3' } = {}) {
  const integer = (value) => Object.freeze({ kind: 'literal', value: Object.freeze({ tag: 'integer', value }) });
  return Object.freeze({
    body: Object.freeze(body),
    counter,
    from: integer(from),
    kind: 'for',
    step: integer(step),
    to: integer(to),
  });
}

export function linkedCapabilityStatement(name = 'reply') {
  return Object.freeze({ input: undefined, kind: 'capability', name, namespace: 'fixture', operation: 'resolve' });
}

export function linkedCallStatement(handlerName) {
  return Object.freeze({
    kind: 'return',
    value: Object.freeze({ arguments: Object.freeze([]), handlerName, kind: 'user-call' }),
  });
}

export function countOccurrences(source, token) {
  return source.split(token).length - 1;
}
