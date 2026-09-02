import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { decodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { ENTRY, moduleSource } from '../kern-5-rt4-user-fn-call/k0-support.mjs';
import { runProjection } from '../kern-frontend-f5-projection/worker.mjs';

export * from '../kern-5-rt6-void-fallthrough/k0-support.mjs';

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

export const BOOL_FLAG = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);
export const TEXT_PARAM = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);
export const INT_LIST_PARAM = Object.freeze([Object.freeze({ name: 'xs', type: 'integer[]' })]);
export const INT_AB = Object.freeze([
  Object.freeze({ name: 'a', type: 'integer' }),
  Object.freeze({ name: 'b', type: 'integer' }),
]);
export const INT_A = Object.freeze([Object.freeze({ name: 'a', type: 'integer' })]);
export const INT_ABC = Object.freeze([
  Object.freeze({ name: 'a', type: 'integer' }),
  Object.freeze({ name: 'b', type: 'integer' }),
  Object.freeze({ name: 'c', type: 'integer' }),
]);

export const CAPABILITY_REPLY = 'capability namespace=fixture operation=resolve name=reply';

export const SYNC_BOOL_HELPER = Object.freeze({
  body: Object.freeze(['return value="true"']),
  name: 'h',
  parameters: Object.freeze([]),
  returns: 'boolean',
});

export const SYNC_BOOL_PARAM_HELPER = Object.freeze({
  body: Object.freeze(['return value="flag"']),
  name: 'hb',
  parameters: BOOL_FLAG,
  returns: 'boolean',
});

// An integer-returning helper is not callable at all on this base: `linkedKirCrossCallType`
// has no integer row, so `expression.ts:148` refuses the call with KIR_CALL_SIGNATURE_TYPE.
// The two helpers below are the deferred-cross-call fences, not admitted fixtures.
export const SYNC_INT_HELPER = Object.freeze({
  body: Object.freeze(['return value="7"']),
  name: 'hi',
  parameters: Object.freeze([]),
  returns: 'integer',
});

export const INT_PARAM_HELPER = Object.freeze({
  body: Object.freeze(['return value="a"']),
  name: 'idp',
  parameters: INT_A,
  returns: 'integer',
});

// The helper-body position returns a boolean, because an integer-returning helper cannot be
// called: the arithmetic lives inside the helper and leaves it through a comparison.
export const ARITHMETIC_BODY_HELPER = Object.freeze({
  body: Object.freeze(['let name=x value="1 + 2"', 'return value="x > 2"']),
  name: 'g',
  parameters: Object.freeze([]),
  returns: 'boolean',
});

export function lit(value) {
  return `"\\"${value}\\""`;
}

export function route(body, { parameters = [], returns = 'string' } = {}) {
  return moduleSource([{ body, exported: 'true', name: ENTRY.handlerName, parameters, returns }]);
}

export function withHelper(helper, body, { parameters = [], returns = 'string' } = {}) {
  return moduleSource([helper, { body, exported: 'true', name: ENTRY.handlerName, parameters, returns }]);
}

export function intArgs(values) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { tag: 'integer', value }]));
}

export function flagArgs(value) {
  return { flag: { tag: 'boolean', value } };
}

export function textArgs(value) {
  return { t: { tag: 'text', value } };
}

export function listArgs(values) {
  return { xs: { tag: 'list', value: values.map((value) => ({ tag: 'integer', value })) } };
}

export function tableSource(row) {
  return route([`return value="${row.expression}"`], { returns: 'integer' });
}

export function integerResult(value) {
  return { presence: 'value', value: { tag: 'integer', value } };
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

// The lowered expression reduced to what F5 decided: the node kind, the operator text, and
// the operand subtrees. A literal keeps its canonical text so a negative literal can be shown
// to arrive as a non-negative payload under a unary node.
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

// Every statement in the tree, in source order, described only by its kind and the lowered
// shape of each expression-valued property.
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
  for (const root of projectedRoots(source)) walk(root.children);
  return shapes;
}

export const POSITIONS = Object.freeze({
  'add-in-let': () => route(['let name=n value="1 + 2"', 'return value="n"'], { returns: 'integer' }),
  'add-in-print-tag': () => route(['let name=n value="1 + 2"', 'print value="n"'], { returns: 'void' }),
  'add-in-return': () => route(['return value="7 + 3"'], { returns: 'integer' }),
  'add-under-comparison-in-if': () =>
    route(['if cond="1 + 2 > 2"', `  print value=${lit('y')}`, `return value=${lit('z')}`]),
  'add-under-comparison-in-let': () => route(['let name=b value="1 + 2 > 2"', 'return value="b"'], { returns: 'boolean' }),
  'arith-return-type-mismatch': () => route(['return value="1 + 2"'], { returns: 'boolean' }),
  'helper-body-arith': () => withHelper(ARITHMETIC_BODY_HELPER, ['return value="g()"'], { returns: 'boolean' }),
  'local-add': () =>
    route(['let name=a value="4"', 'let name=b value="5"', 'return value="a + b"'], { returns: 'integer' }),
  'mul-in-return': () => route(['return value="7 * 3"'], { returns: 'integer' }),
  'neg-in-let': () => route(['let name=n value="-7"', 'return value="n"'], { returns: 'integer' }),
  'neg-in-return': () => route(['return value="-7"'], { returns: 'integer' }),
  'neg-of-local': () => route(['let name=n value="5"', 'let name=m value="-n"', 'return value="m"'], { returns: 'integer' }),
  'neg-through-binding-zero': () =>
    route(['let name=z value="0"', 'let name=n value="-z"', 'return value="n"'], { returns: 'integer' }),
  'param-add': () => route(['return value="a + b"'], { parameters: INT_AB, returns: 'integer' }),
  'param-add-under-comparison-in-if': () =>
    route(['if cond="a + b > c"', `  print value=${lit('y')}`, `return value=${lit('z')}`], { parameters: INT_ABC }),
  'param-neg': () => route(['return value="-a"'], { parameters: INT_A, returns: 'integer' }),
  'param-ordering': () => route(['return value="a < b"'], { parameters: INT_AB, returns: 'boolean' }),
  'sub-in-return': () => route(['return value="7 - 3"'], { returns: 'integer' }),
  'refuse-arith-call-argument': () =>
    withHelper(SYNC_BOOL_PARAM_HELPER, ['return value="hb(1 + 2)"'], { returns: 'boolean' }),
  'refuse-arith-if-cond': () => route(['if cond="1 + 2"', `  print value=${lit('y')}`, `return value=${lit('z')}`]),
  'refuse-bool-operands': () => route(['return value="true + true"'], { returns: 'integer' }),
  'refuse-bool-param-left': () => route(['return value="flag + 1"'], { parameters: BOOL_FLAG, returns: 'integer' }),
  'refuse-bool-param-right': () => route(['return value="1 + flag"'], { parameters: BOOL_FLAG, returns: 'integer' }),
  'refuse-call-operand': () => withHelper(SYNC_BOOL_HELPER, ['return value="h() + 1"'], { returns: 'integer' }),
  'refuse-capability-operand': () => route([CAPABILITY_REPLY, 'return value="reply + 1"'], { returns: 'integer' }),
  'refuse-chained-comparison': () => route(['return value="1 + 2 > 2 > 1"'], { returns: 'boolean' }),
  'refuse-decimal-operand': () => route(['return value="1.5 + 1"'], { returns: 'integer' }),
  'refuse-div': () => route(['return value="6 / 2"'], { returns: 'integer' }),
  'refuse-int-text': () => route([`return value="1 + \\"a\\""`], { returns: 'integer' }),
  'refuse-integer-helper-call': () => withHelper(SYNC_INT_HELPER, ['return value="hi()"'], { returns: 'integer' }),
  'refuse-integer-helper-operand': () =>
    withHelper(SYNC_INT_HELPER, ['return value="hi() + 1"'], { returns: 'integer' }),
  'refuse-integer-param-helper-call': () =>
    withHelper(INT_PARAM_HELPER, ['return value="idp(1)"'], { returns: 'integer' }),
  'refuse-leading-zero': () => route(['return value="007"'], { returns: 'integer' }),
  'refuse-list-operand': () => route(['return value="[1, 2] + 1"'], { returns: 'integer' }),
  'refuse-mod': () => route(['return value="7 % 2"'], { returns: 'integer' }),
  'refuse-neg-zero-literal': () => route(['return value="-0"'], { returns: 'integer' }),
  'refuse-pow': () => route(['return value="2 ** 3"'], { returns: 'integer' }),
  'refuse-shift': () => route(['return value="1 << 2"'], { returns: 'integer' }),
  'refuse-text-int': () => route([`return value="\\"a\\" + 1"`], { returns: 'integer' }),
  'refuse-text-operands': () => route([`return value="\\"a\\" + \\"b\\""`]),
  'refuse-text-param-operands': () => route(['return value="t + t"'], { parameters: TEXT_PARAM, returns: 'integer' }),
  'refuse-unary-bool-param': () => route(['return value="-flag"'], { parameters: BOOL_FLAG, returns: 'integer' }),
  'refuse-unary-call': () => withHelper(SYNC_BOOL_HELPER, ['return value="-h()"'], { returns: 'integer' }),
  'refuse-unary-capability': () => route([CAPABILITY_REPLY, 'return value="-reply"'], { returns: 'integer' }),
  'refuse-unary-decimal': () => route(['return value="-1.5"'], { returns: 'integer' }),
  'refuse-unary-list-param': () => route(['return value="-xs"'], { parameters: INT_LIST_PARAM, returns: 'integer' }),
  'refuse-unary-not': () => route(['return value="!flag"'], { parameters: BOOL_FLAG, returns: 'boolean' }),
  'refuse-unary-plus': () => route(['return value="+5"'], { returns: 'integer' }),
  'refuse-unary-text-param': () => route(['return value="-t"'], { parameters: TEXT_PARAM, returns: 'integer' }),
});

export const POSITION_ARGUMENTS = Object.freeze({
  'param-add': () => intArgs({ a: '9007199254740993', b: '1' }),
  'param-add-under-comparison-in-if': () => intArgs({ a: '1', b: '2', c: '2' }),
  'param-neg': () => intArgs({ a: '9007199254740993' }),
  'param-ordering': () => intArgs({ a: '3', b: '7' }),
});

// The rows whose projected shape the probe matrix pins. Two of them are the F2 precedence
// pair, and `neg-in-return` is the row that proves a negative literal arrives as a unary
// node over a non-negative canonical payload.
export const SHAPE_POSITIONS = Object.freeze([
  'add-in-let',
  'add-under-comparison-in-if',
  'helper-body-arith',
  'neg-in-return',
  'neg-of-local',
  'refuse-div',
  'refuse-unary-not',
]);

export const SHAPE_TABLE_ROWS = Object.freeze([
  'prec-mul-then-add',
  'prec-paren-add-first',
  'sub-left-assoc',
  'neg-double',
  'sub-neg-right',
]);

export const FRONTEND_WALLS = Object.freeze(['refuse-leading-zero', 'refuse-neg-zero-literal']);
