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

export const BOOL_FLAG = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);
export const TEXT_PARAM = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);
export const LIST_PARAM = Object.freeze([Object.freeze({ name: 'xs', type: 'boolean[]' })]);
export const NAMED_TEXT_PARAM = Object.freeze([Object.freeze({ name: 'p', type: 'string' })]);
export const TEXT_AND_FLAG = Object.freeze([
  Object.freeze({ name: 't', type: 'string' }),
  Object.freeze({ name: 'flag', type: 'boolean' }),
]);

export const CAPABILITY_FIRST = 'capability namespace=fixture operation=resolve name=first';
export const CAPABILITY_SECOND = 'capability namespace=fixture operation=resolve name=second';
export const CAPABILITY_REPLY = 'capability namespace=fixture operation=resolve name=reply';

export const ASYNC_TEXT_HELPER = Object.freeze({
  body: Object.freeze([CAPABILITY_REPLY, 'return value="reply"']),
  name: 'fetchIt',
  parameters: TEXT_PARAM,
  returns: 'string',
});

// An integer-returning helper is not callable at all on this base: `linkedKirCrossCallType`
// has no integer row, so `expression.ts:148` refuses the call with KIR_CALL_SIGNATURE_TYPE
// before any assign gate can be reached. The call-typed fixtures therefore carry the two
// cross-call shapes that do resolve: boolean and list<boolean>.
export const SYNC_BOOL_HELPER = Object.freeze({
  body: Object.freeze(['return value="true"']),
  name: 'h',
  parameters: Object.freeze([]),
  returns: 'boolean',
});

export const SYNC_LIST_HELPER = Object.freeze({
  body: Object.freeze(['return value="[true]"']),
  name: 'hs',
  parameters: Object.freeze([]),
  returns: 'boolean[]',
});

export const SYNC_ASSIGN_HELPER = Object.freeze({
  body: Object.freeze([`let name=x value=${lit('p')}`, `assign target="x" value=${lit('q')}`, 'return value="x"']),
  name: 'g',
  parameters: Object.freeze([]),
  returns: 'string',
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

export function textArgs(value) {
  return { t: { tag: 'text', value } };
}

export function flagArgs(value) {
  return { flag: { tag: 'boolean', value } };
}

export function listArgs(values) {
  return { xs: { tag: 'list', value: values.map((value) => ({ tag: 'boolean', value })) } };
}

export function f5Row(source) {
  const result = runProjection([{ moduleId: ENTRY.moduleId, source }]);
  return {
    diagnostics: [...new Set(result.receipt.diagnostics.map(({ code }) => code))].sort(),
    status: result.receipt.status,
  };
}

function projectedHandler(source) {
  const result = runProjection([{ moduleId: ENTRY.moduleId, source }]);
  assert.equal(result.receipt.status, 'projected', 'the shape probe fixture must project');
  const decoded = decodeModuleKir(result.bytes, F5_CANONICAL_LIMITS);
  const root = decoded.modules[0].roots.find((node) => node.kind === 'fn');
  assert.ok(root !== undefined, 'a projected module must carry an fn root');
  const handler = root.children.find((node) => node.kind === 'handler');
  assert.ok(handler !== undefined, 'a projected fn must carry a handler child');
  return handler;
}

function expressionKind(property, label) {
  assert.equal(property.value.tag, 'record', `${label} must be a lowered-expression record`);
  const kind = property.value.value.find((field) => field.key === 'kind');
  assert.ok(kind !== undefined, `${label} must carry a kind field`);
  return kind.value.value;
}

// Every assign in the tree, in source order, described only by what F5 decided: the
// property key set and the lowered kind of each expression-valued property.
export function assignShapes(source) {
  const shapes = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.kind === 'assign') {
        const properties = node.properties.map(({ key }) => key).sort();
        const target = node.properties.find(({ key }) => key === 'target');
        const value = node.properties.find(({ key }) => key === 'value');
        shapes.push({
          children: node.children.length,
          properties,
          targetKind: target === undefined ? null : expressionKind(target, 'assign.target'),
          valueKind: value === undefined ? null : expressionKind(value, 'assign.value'),
        });
      }
      walk(node.children);
    }
  };
  walk(projectedHandler(source).children);
  return shapes;
}

const T = lit;

export const POSITIONS = Object.freeze({
  'after-async-suspension': () =>
    withHelper(
      ASYNC_TEXT_HELPER,
      [
        `let name=s value=${T('a')}`,
        'let name=r value="fetchIt(t)"',
        'assign target="s" value="r"',
        'if cond="flag"',
        `  assign target="s" value=${T('c')}`,
        'return value="s"',
      ],
      { parameters: TEXT_AND_FLAG },
    ),
  'async-value': () =>
    withHelper(ASYNC_TEXT_HELPER, [`let name=a value=${T('x')}`, 'assign target="a" value="fetchIt(t)"', 'return value="a"'], {
      parameters: TEXT_PARAM,
    }),
  'binary-value': () =>
    route(['let name=b value="false"', 'assign target="b" value="1 < 2"', 'return value="b"'], { returns: 'boolean' }),
  'branch-else': () =>
    route(
      [
        `let name=s value=${T('a')}`,
        'if cond="flag"',
        `  assign target="s" value=${T('b')}`,
        'else',
        `  assign target="s" value=${T('c')}`,
        'return value="s"',
      ],
      { parameters: BOOL_FLAG },
    ),
  'branch-return': () =>
    route(
      [
        `let name=s value=${T('a')}`,
        'if cond="flag"',
        `  assign target="s" value=${T('b')}`,
        '  return value="s"',
        'return value="s"',
      ],
      { parameters: BOOL_FLAG },
    ),
  'branch-then': () =>
    route([`let name=s value=${T('a')}`, 'if cond="flag"', `  assign target="s" value=${T('b')}`, 'return value="s"'], {
      parameters: BOOL_FLAG,
    }),
  'call-typed-list': () =>
    withHelper(SYNC_LIST_HELPER, ['let name=ys value="hs()"', 'assign target="ys" value="[flag]"', 'return value="ys"'], {
      parameters: BOOL_FLAG,
      returns: 'boolean[]',
    }),
  'call-typed-literal': () =>
    withHelper(SYNC_BOOL_HELPER, ['let name=n value="h()"', 'assign target="n" value="false"', 'return value="n"'], {
      returns: 'boolean',
    }),
  'call-typed-positive': () =>
    withHelper(SYNC_BOOL_HELPER, ['let name=n value="h()"', 'assign target="n" value="h()"', 'return value="n"'], {
      returns: 'boolean',
    }),
  'capability-to-capability': () =>
    route([CAPABILITY_FIRST, CAPABILITY_SECOND, 'assign target="first" value="second"', 'return value="first"']),
  'helper-body-assign': () => withHelper(SYNC_ASSIGN_HELPER, ['return value="g()"']),
  'integer-from-identifier': () =>
    route(['let name=n value="1"', 'let name=m value="2"', 'assign target="n" value="m"', 'return value="n"'], {
      returns: 'number',
    }),
  'list-assign': () =>
    route(['let name=ys value="[flag, flag]"', 'assign target="ys" value="[flag]"', 'return value="ys"'], {
      parameters: BOOL_FLAG,
      returns: 'boolean[]',
    }),
  'neg-assign-before-let': () =>
    route([`assign target="s" value=${T('b')}`, `let name=s value=${T('a')}`, 'return value="s"']),
  'neg-bool-into-integer': () =>
    route(['let name=n value="1"', 'assign target="n" value="true"', 'return value="n"'], { returns: 'number' }),
  'neg-call-typed-into-integer': () =>
    withHelper(SYNC_BOOL_HELPER, ['let name=n value="1"', 'assign target="n" value="h()"', 'return value="n"'], {
      returns: 'number',
    }),
  // The transpose of `neg-text-into-call-typed-list`: the *value* is the call, so this is the only
  // row a mutation of the tables' user-call arm can reach.
  'neg-call-typed-list-into-text': () =>
    withHelper(SYNC_LIST_HELPER, [`let name=s value=${T('a')}`, 'assign target="s" value="hs()"', 'return value="s"']),
  'neg-integer-into-call-typed': () =>
    withHelper(SYNC_BOOL_HELPER, ['let name=n value="h()"', 'assign target="n" value="2"', 'return value="n"'], {
      returns: 'boolean',
    }),
  'neg-integer-into-text': () =>
    route([`let name=s value=${T('a')}`, 'assign target="s" value="1"', 'return value="s"']),
  // An integer list reads `undefined` in both cross-call directions and `undefined` statically,
  // against the binding's `integer`, so only the static half of the gate can refuse it.
  'neg-integer-list-into-integer': () =>
    route(['let name=n value="1"', 'assign target="n" value="[1, 2]"', 'return value="n"'], { returns: 'number' }),
  'neg-list-into-text': () =>
    route([`let name=ys value="[flag, flag]"`, `assign target="ys" value=${T('x')}`, 'return value="ys"'], {
      parameters: BOOL_FLAG,
      returns: 'boolean[]',
    }),
  'neg-op-compound': () =>
    route(['let name=n value="1"', 'assign target="n" op="+=" value="2"', 'return value="n"'], { returns: 'number' }),
  'neg-op-equals': () =>
    route([`let name=s value=${T('a')}`, `assign target="s" op="=" value=${T('b')}`, 'return value="s"']),
  'neg-param-target': () =>
    route([`assign target="p" value=${T('b')}`, 'return value="p"'], { parameters: NAMED_TEXT_PARAM }),
  'neg-postfix-op': () => route(['let name=n value="1"', 'assign target="n" op="++"', 'return value="n"'], { returns: 'number' }),
  'neg-shadow-branch-let': () =>
    route(
      [`let name=s value=${T('a')}`, 'if cond="flag"', `  let name=s value=${T('c')}`, '  print value="s"', 'return value="s"'],
      { parameters: BOOL_FLAG },
    ),
  'neg-sibling-branch': () =>
    route(
      [
        'if cond="flag"',
        `  let name=held value=${T('b')}`,
        '  print value="held"',
        'else',
        `  assign target="held" value=${T('c')}`,
        `return value=${T('x')}`,
      ],
      { parameters: BOOL_FLAG },
    ),
  'neg-target-index': () =>
    route([`let name=s value=${T('a')}`, `assign target="s[0]" value=${T('b')}`, 'return value="s"']),
  'neg-target-member': () =>
    route([`let name=s value=${T('a')}`, `assign target="s.x" value=${T('b')}`, 'return value="s"']),
  'neg-text-into-call-typed-list': () =>
    withHelper(SYNC_LIST_HELPER, ['let name=ys value="hs()"', `assign target="ys" value=${T('x')}`, 'return value="ys"'], {
      returns: 'boolean[]',
    }),
  'neg-text-into-capability': () =>
    route([CAPABILITY_REPLY, `assign target="reply" value=${T('x')}`, 'return value="reply"']),
  'neg-text-into-integer': () =>
    route(['let name=n value="1"', `assign target="n" value=${T('x')}`, 'return value="n"'], { returns: 'number' }),
  'neg-undeclared': () => route([`assign target="zz" value=${T('b')}`, `return value=${T('x')}`]),
  'neg-unquoted-target': () => route([`let name=s value=${T('a')}`, `assign target=s value=${T('b')}`, 'return value="s"']),
  'ordering-print': () =>
    route([
      `let name=s value=${T('a')}`,
      `assign target="s" value=${T('b')}`,
      'print value="s"',
      `assign target="s" value=${T('c')}`,
      'return value="s"',
    ]),
  'self-referential-and': () =>
    route(
      ['let name=b value="true"', 'let name=c value="false"', 'assign target="b" value="b && c"', 'return value="b"'],
      { returns: 'boolean' },
    ),
  'self-referential-or': () =>
    route(['let name=b value="false"', 'assign target="b" value="b || flag"', 'return value="b"'], {
      parameters: BOOL_FLAG,
      returns: 'boolean',
    }),
  // The one row whose answer differs from a target cleared to `false` rather than to unset:
  // true || false is true, a cleared target gives false.
  'self-referential-or-held': () =>
    route(['let name=b value="true"', 'assign target="b" value="b || flag"', 'return value="b"'], {
      parameters: BOOL_FLAG,
      returns: 'boolean',
    }),
  'simple-reassign': () => route([`let name=s value=${T('a')}`, `assign target="s" value=${T('b')}`, 'return value="s"']),
  'trailing-comment': () =>
    route([`let name=s value=${T('a')}`, `assign target="s" value=${T('b')} # note`, 'return value="s"']),
  'two-assigns': () =>
    route([
      `let name=s value=${T('a')}`,
      `assign target="s" value=${T('b')}`,
      `assign target="s" value=${T('c')}`,
      'return value="s"',
    ]),
  'void-with-assign': () =>
    route([`let name=s value=${T('a')}`, `assign target="s" value=${T('b')}`, 'print value="s"'], { returns: 'void' }),
});

// Statement kinds RT-9 must leave exactly where it found them.
export const CONTROL_POSITIONS = Object.freeze({
  'control-each': () =>
    route([`let name=s value=${T('a')}`, 'each name=i in="xs"', `  let name=q value=${T('b')}`, 'return value="s"'], {
      parameters: LIST_PARAM,
    }),
  'control-for': () =>
    route([`let name=s value=${T('a')}`, 'for name=i from="0" to="3"', `  let name=q value=${T('b')}`, 'return value="s"']),
  'control-set': () => route([`let name=s value=${T('a')}`, `set name=s to=${T('b')}`, 'return value="s"']),
  'control-while': () =>
    route([`let name=s value=${T('a')}`, 'while cond="flag"', `  let name=q value=${T('b')}`, 'return value="s"'], {
      parameters: BOOL_FLAG,
    }),
});

// `assignShapes` reads the first `fn` root, which for a two-function module is the helper, so
// `helper-body-assign` is the row that proves F5 projects an assign inside a helper body.
export const SHAPE_POSITIONS = Object.freeze([
  'simple-reassign',
  'binary-value',
  'helper-body-assign',
  'neg-op-compound',
  'neg-target-member',
  'neg-target-index',
  'trailing-comment',
]);
