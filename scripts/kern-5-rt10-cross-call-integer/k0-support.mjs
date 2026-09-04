import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { decodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { ENTRY, moduleSource } from '../kern-5-rt4-user-fn-call/k0-support.mjs';
import { runProjection } from '../kern-frontend-f5-projection/worker.mjs';

export * from '../kern-5-rt10-pre-linked-arithmetic/k0-support.mjs';

// The projected KIR is decoded with the same canonical limits the F5 policy hands
// `decodeModuleKir`, so a shape read here is the shape the linker receives.
const F5_CANONICAL_LIMITS = JSON.parse(
  readFileSync(new URL('../kern-frontend-f5-projection/policy.json', import.meta.url), 'utf8'),
).canonicalLimits;

const TABLE_URL = new URL('./behavior-table.json', import.meta.url);

export const BEHAVIOR_TABLE_RAW = readFileSync(TABLE_URL, 'utf8');
export const TABLE_ROWS = Object.freeze(
  JSON.parse(BEHAVIOR_TABLE_RAW).rows.map((row) => Object.freeze({ ...row })),
);

export const INTEGER_PARAM = Object.freeze([Object.freeze({ name: 'a', type: 'integer' })]);
export const INTEGER_PAIR = Object.freeze([
  Object.freeze({ name: 'a', type: 'integer' }),
  Object.freeze({ name: 'b', type: 'integer' }),
]);
export const NUMBER_PARAM = Object.freeze([Object.freeze({ name: 'a', type: 'number' })]);
export const BOOLEAN_PARAM = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);
export const TEXT_PARAMETER = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);
export const INTEGER_LIST_PARAM = Object.freeze([Object.freeze({ name: 'xs', type: 'integer[]' })]);
export const MIXED_PARAMS = Object.freeze([
  Object.freeze({ name: 'a', type: 'integer' }),
  Object.freeze({ name: 'flag', type: 'boolean' }),
]);

export const CAPABILITY = 'capability namespace=fixture operation=resolve name=reply';

// The helper cast. Every integer-typed one is uncallable at base with KIR_CALL_SIGNATURE_TYPE;
// the boolean and text ones are RT-4 shapes that link at base and are the admitted siblings
// that keep each refusal non-vacuous.
export const INT_IDENTITY = Object.freeze({
  body: Object.freeze(['return value="a"']),
  name: 'idp',
  parameters: INTEGER_PARAM,
  returns: 'integer',
});

export const NUMBER_IDENTITY = Object.freeze({
  body: Object.freeze(['return value="a"']),
  name: 'idp',
  parameters: NUMBER_PARAM,
  returns: 'number',
});

export const INT_CONSTANT = Object.freeze({
  body: Object.freeze(['return value="7"']),
  name: 'hi',
  parameters: Object.freeze([]),
  returns: 'integer',
});

export const INT_INCREMENT = Object.freeze({
  body: Object.freeze(['return value="a + 1"']),
  name: 'add1',
  parameters: INTEGER_PARAM,
  returns: 'integer',
});

export const INT_SUM = Object.freeze({
  body: Object.freeze(['return value="a + b"']),
  name: 'sum',
  parameters: INTEGER_PAIR,
  returns: 'integer',
});

export const INT_PREDICATE = Object.freeze({
  body: Object.freeze(['return value="a > 0"']),
  name: 'pos',
  parameters: INTEGER_PARAM,
  returns: 'boolean',
});

export const INT_PICK = Object.freeze({
  body: Object.freeze(['return value="a"']),
  name: 'pick',
  parameters: MIXED_PARAMS,
  returns: 'integer',
});

export const INT_INNER = Object.freeze({
  body: Object.freeze(['return value="a"']),
  name: 'inner',
  parameters: INTEGER_PARAM,
  returns: 'integer',
});

export const INT_OUTER = Object.freeze({
  body: Object.freeze(['return value="inner(a + 1)"']),
  name: 'outer',
  parameters: INTEGER_PARAM,
  returns: 'integer',
});

export const ASYNC_INT_HELPER = Object.freeze({
  body: Object.freeze([CAPABILITY, 'return value="7"']),
  name: 'afi',
  parameters: Object.freeze([]),
  returns: 'integer',
});

// The `list<integer>` fences. The parameter fence returns a boolean on purpose: the return-type
// check at `expression.ts:156` runs before the parameter loop, so an integer-list return would
// mask the parameter refusal this row exists to attribute.
export const INT_LIST_PARAM_HELPER = Object.freeze({
  body: Object.freeze(['return value="true"']),
  name: 'suml',
  parameters: INTEGER_LIST_PARAM,
  returns: 'boolean',
});

export const INT_LIST_RETURN_HELPER = Object.freeze({
  body: Object.freeze(['return value="[1, 2]"']),
  name: 'mkl',
  parameters: Object.freeze([]),
  returns: 'integer[]',
});

export const BOOL_CONSTANT = Object.freeze({
  body: Object.freeze(['return value="true"']),
  name: 'h',
  parameters: Object.freeze([]),
  returns: 'boolean',
});

export const BOOL_IDENTITY = Object.freeze({
  body: Object.freeze(['return value="flag"']),
  name: 'hb',
  parameters: BOOLEAN_PARAM,
  returns: 'boolean',
});

export const TEXT_IDENTITY = Object.freeze({
  body: Object.freeze(['return value="t"']),
  name: 'label',
  parameters: TEXT_PARAMETER,
  returns: 'string',
});

export function quoted(value) {
  return `"\\"${value}\\""`;
}

// A text literal *inside* an expression attribute, where `quoted` is the whole attribute value.
export function innerText(value) {
  return `\\"${value}\\"`;
}

export function entrySource(body, { parameters = [], returns = 'integer' } = {}) {
  return moduleSource([{ body, exported: 'true', name: ENTRY.handlerName, parameters, returns }]);
}

export function withHelpers(helpers, body, { parameters = [], returns = 'integer' } = {}) {
  return moduleSource([...helpers, { body, exported: 'true', name: ENTRY.handlerName, parameters, returns }]);
}

export function integerArguments(values) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { tag: 'integer', value }]));
}

export function integerSlot(value) {
  return { presence: 'value', value: { tag: 'integer', value } };
}

export function booleanSlot(value) {
  return { presence: 'value', value: { tag: 'boolean', value } };
}

export const CAPABILITY_EVENT = Object.freeze({
  input: Object.freeze({ presence: 'absent' }),
  namespace: 'fixture',
  op: 'capability',
  operation: 'resolve',
  result: Object.freeze({ presence: 'value', value: Object.freeze({ tag: 'text', value: 'reply-value' }) }),
});

export const POSITIONS = Object.freeze({
  'bool-argument-control': () => withHelpers([BOOL_IDENTITY], ['return value="hb(true)"'], { returns: 'boolean' }),
  'int-accumulator': () =>
    withHelpers([INT_IDENTITY], ['let name=n value="0"', 'assign target="n" value="n + idp(7)"', 'return value="n"']),
  'int-accumulator-twice': () =>
    withHelpers([INT_IDENTITY], [
      'let name=n value="0"',
      'assign target="n" value="n + idp(7)"',
      'assign target="n" value="n + idp(7)"',
      'return value="n"',
    ]),
  'int-arith-argument': () => withHelpers([INT_IDENTITY], ['return value="idp(1 + 2)"']),
  'int-arith-on-result': () => withHelpers([INT_IDENTITY], ['return value="idp(7) + 1"']),
  'int-assign-value': () =>
    withHelpers([INT_CONSTANT], ['let name=n value="1"', 'assign target="n" value="hi()"', 'return value="n"']),
  'int-async-let': () => withHelpers([ASYNC_INT_HELPER], ['let name=n value="afi()"', 'return value="n"']),
  'int-async-return': () => withHelpers([ASYNC_INT_HELPER], ['return value="afi()"']),
  'int-big-argument': () => withHelpers([INT_IDENTITY], ['return value="idp(9223372036854775807)"']),
  'int-big-through-helper': () => withHelpers([INT_INCREMENT], ['return value="add1(9007199254740993)"']),
  'int-both': () => withHelpers([INT_IDENTITY], ['return value="idp(7)"']),
  'int-helper-chain': () => withHelpers([INT_INNER, INT_OUTER], ['return value="outer(7)"']),
  'int-let-passthrough': () => withHelpers([INT_IDENTITY], ['let name=x value="5"', 'return value="idp(x)"']),
  'int-mixed-signature': () => withHelpers([INT_PICK], ['return value="pick(7, true)"']),
  'int-negative-argument': () => withHelpers([INT_IDENTITY], ['return value="idp(-9007199254740993)"']),
  'int-nested-call': () => withHelpers([INT_IDENTITY], ['return value="idp(idp(7))"']),
  'int-param-only': () => withHelpers([INT_PREDICATE], ['return value="pos(1)"'], { returns: 'boolean' }),
  'int-param-passthrough': () =>
    withHelpers([INT_IDENTITY], ['return value="idp(a)"'], { parameters: INTEGER_PARAM }),
  'int-print-tag': () =>
    withHelpers([INT_CONSTANT], ['let name=n value="hi()"', 'print value="n"'], { returns: 'void' }),
  'int-result-as-operand': () => withHelpers([INT_IDENTITY], ['return value="1 + idp(7)"']),
  'int-return': () => withHelpers([INT_CONSTANT], ['return value="hi()"']),
  'int-return-tag-mismatch': () => withHelpers([INT_CONSTANT], ['return value="hi()"'], { returns: 'boolean' }),
  'int-two-args': () => withHelpers([INT_SUM], ['return value="sum(4, 5)"']),
  'int-uncalled-helper': () => withHelpers([INT_IDENTITY], ['return value="true"'], { returns: 'boolean' }),
  'int-under-comparison': () => withHelpers([INT_CONSTANT], ['return value="hi() > 2"'], { returns: 'boolean' }),
  'int-unary-on-result': () => withHelpers([INT_IDENTITY], ['return value="-idp(7)"']),
  'number-spelling': () => withHelpers([NUMBER_IDENTITY], ['return value="idp(7)"'], { returns: 'number' }),
  'refuse-async-int-argument': () =>
    withHelpers([ASYNC_INT_HELPER, INT_IDENTITY], ['return value="idp(afi())"']),
  'refuse-async-int-operand': () => withHelpers([ASYNC_INT_HELPER], ['return value="afi() + 1"']),
  'refuse-bool-call-into-int-param': () => withHelpers([BOOL_CONSTANT, INT_IDENTITY], ['return value="idp(h())"']),
  'refuse-bool-into-int-param': () =>
    withHelpers([INT_IDENTITY], ['return value="idp(flag)"'], { parameters: BOOLEAN_PARAM }),
  'refuse-decimal-into-int-param': () => withHelpers([INT_IDENTITY], ['return value="idp(1.5)"']),
  'refuse-int-arity': () => withHelpers([INT_IDENTITY], ['return value="idp(1, 2)"']),
  'refuse-int-call-if-cond': () =>
    withHelpers([INT_CONSTANT], ['if cond="hi()"', `  print value=${quoted('y')}`, `return value=${quoted('z')}`], {
      returns: 'string',
    }),
  'refuse-int-into-bool-assign': () =>
    withHelpers([INT_CONSTANT], ['let name=b value="true"', 'assign target="b" value="hi()"', 'return value="b"'], {
      returns: 'boolean',
    }),
  'refuse-int-into-bool-param': () => withHelpers([BOOL_IDENTITY], ['return value="hb(1)"'], { returns: 'boolean' }),
  'refuse-int-into-text-param': () => withHelpers([TEXT_IDENTITY], ['return value="label(1)"'], { returns: 'string' }),
  'refuse-int-list-literal-argument': () => withHelpers([INT_IDENTITY], ['return value="idp([1, 2])"']),
  'refuse-int-list-param': () =>
    withHelpers([INT_LIST_PARAM_HELPER], ['return value="suml([1, 2])"'], { returns: 'boolean' }),
  'refuse-int-list-return': () =>
    withHelpers([INT_LIST_RETURN_HELPER], ['return value="mkl()"'], { returns: 'integer[]' }),
  'refuse-text-call-operand': () =>
    withHelpers([TEXT_IDENTITY], [`return value="label(${innerText('a')}) + 1"`]),
  'refuse-text-into-int-param': () =>
    withHelpers([INT_IDENTITY], ['return value="idp(t)"'], { parameters: TEXT_PARAMETER }),
  'text-argument-control': () =>
    withHelpers([TEXT_IDENTITY], [`return value="label(${innerText('a')})"`], { returns: 'string' }),
});

export const POSITION_ARGUMENTS = Object.freeze({
  'int-param-passthrough': () => integerArguments({ a: '9007199254740993' }),
  'refuse-bool-into-int-param': () => ({ flag: { tag: 'boolean', value: true } }),
  'refuse-text-into-int-param': () => ({ t: { tag: 'text', value: 'a' } }),
});

export function positionArguments(name) {
  return POSITION_ARGUMENTS[name] === undefined ? {} : POSITION_ARGUMENTS[name]();
}

function projectedRoots(source) {
  const result = runProjection([{ moduleId: ENTRY.moduleId, source }]);
  assert.equal(result.receipt.status, 'projected', 'the shape probe fixture must project');
  return decodeModuleKir(result.bytes, F5_CANONICAL_LIMITS).modules[0].roots;
}

function plainValue(value) {
  if (value.tag === 'record') return Object.fromEntries(value.value.map((field) => [field.key, plainValue(field.value)]));
  if (value.tag === 'list') return value.value.map(plainValue);
  return value.value;
}

// Every function root reduced to what F5 decided about its signature: the declared return type
// record and each parameter's type record. This is the RT-8 alias fact the linker consumes.
export function signatureShapes(source) {
  return projectedRoots(source).map((root) => ({
    name: plainValue(root.properties.find((property) => property.key === 'name').value),
    parameters: root.children
      .filter((node) => node.kind === 'param')
      .map((node) => Object.fromEntries(node.properties.map((property) => [property.key, plainValue(property.value)]))),
    returns: plainValue(root.properties.find((property) => property.key === 'returns').value),
  }));
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
    tree[key] =
      field.tag === 'record'
        ? expressionTree(field, `${label}.${key}`, depth + 1)
        : field.tag === 'list'
          ? field.value.map((item, index) => expressionTree(item, `${label}.${key}[${index}]`, depth + 1))
          : field.value;
  }
  return tree;
}

// Every statement in the entry handler, in source order, described only by its kind and the
// lowered shape of each expression-valued property.
export function statementShapes(source) {
  const shapes = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.kind !== 'handler') {
        const properties = {};
        for (const property of node.properties) {
          properties[property.key] =
            property.value.tag === 'record'
              ? expressionTree(property.value, `${node.kind}.${property.key}`)
              : property.value.value;
        }
        shapes.push({ kind: node.kind, properties });
      }
      walk(node.children);
    }
  };
  const roots = projectedRoots(source);
  const entry = roots.find(
    (root) => root.properties.find((property) => property.key === 'name')?.value.value === ENTRY.handlerName,
  );
  assert.ok(entry !== undefined, 'the shape probe fixture must declare the entry function');
  walk(entry.children);
  return shapes;
}

// The rows whose projected signature the probe matrix pins: both RT-8 spellings in parameter and
// return position, and the two `integer[]` fences.
export const SIGNATURE_POSITIONS = Object.freeze([
  'int-both',
  'int-mixed-signature',
  'number-spelling',
  'refuse-int-list-param',
  'refuse-int-list-return',
]);

// The rows whose projected statement shape the probe matrix pins: the accumulator the queued
// `for` slice inherits, arithmetic over a call result in both operand positions, a call as an
// assign value, and a call nested inside a call argument.
export const SHAPE_POSITIONS = Object.freeze([
  'int-accumulator',
  'int-arith-argument',
  'int-arith-on-result',
  'int-assign-value',
  'int-nested-call',
  'int-result-as-operand',
  'int-unary-on-result',
]);
