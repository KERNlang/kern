import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  POSITIONS,
  assertLinkLabel,
  createLinkedKirClosureWalk,
  linkedCallStatement,
  linkedCapabilityStatement,
  linkedForStatement,
  linkedStatementsCallDepth,
  linkedStatementsInvokeCapability,
} from './k0-support.mjs';

const CONTRACTS_URL = new URL('../../packages/core/src/kir-runtime/linked-kir-program/contracts.ts', import.meta.url);

const HELPER_NAME = 'reach';

function helperMap(statements) {
  return new Map([[HELPER_NAME, { parameters: [], returnType: { kind: 'integer' }, statements }]]);
}

const RETURN_PARAMETER = Object.freeze({ kind: 'return', value: Object.freeze({ kind: 'identifier', name: 'a' }) });

const RETURN_LITERAL = Object.freeze({
  kind: 'return',
  value: Object.freeze({ kind: 'literal', value: Object.freeze({ tag: 'integer', value: '1' }) }),
});

const PLAIN_BODY = Object.freeze([
  Object.freeze({ kind: 'assign', target: 'acc', value: Object.freeze({ kind: 'identifier', name: 'i' }) }),
]);

test('the capability closure walker looks inside a loop body', () => {
  const statements = [linkedForStatement({ body: [linkedCapabilityStatement()] })];
  assert.equal(
    linkedStatementsInvokeCapability(statements, undefined, createLinkedKirClosureWalk()),
    true,
    'RT10F_CLOSURE_BLIND: a capability inside a loop body must reach the closure walk',
  );
});

test('the capability closure walker follows a helper called from a loop body', () => {
  const helpers = helperMap([linkedCapabilityStatement()]);
  const statements = [linkedForStatement({ body: [linkedCallStatement(HELPER_NAME)] })];
  assert.equal(
    linkedStatementsInvokeCapability(statements, helpers, createLinkedKirClosureWalk()),
    true,
    'RT10F_CLOSURE_BLIND: the walk must recurse through a call made inside a loop body',
  );
});

test('the capability closure walker looks inside a loop bound', () => {
  const helpers = helperMap([linkedCapabilityStatement()]);
  const loop = {
    ...linkedForStatement({ body: PLAIN_BODY }),
    to: Object.freeze({ arguments: Object.freeze([]), handlerName: HELPER_NAME, kind: 'user-call' }),
  };
  assert.equal(
    linkedStatementsInvokeCapability([Object.freeze(loop)], helpers, createLinkedKirClosureWalk()),
    true,
    'RT10F_BOUND_BLIND: a bound is an expression the closure walk must visit',
  );
});

test('a capability-free loop answers false rather than throwing, so the arm is not a blanket true', () => {
  const statements = [linkedForStatement({ body: PLAIN_BODY })];
  assert.equal(linkedStatementsInvokeCapability(statements, undefined, createLinkedKirClosureWalk()), false);
});

test('the call-depth walker counts a call made inside a loop body', () => {
  const helpers = helperMap([RETURN_PARAMETER]);
  const statements = [linkedForStatement({ body: [linkedCallStatement(HELPER_NAME)] })];
  assert.equal(
    linkedStatementsCallDepth(statements, helpers),
    1,
    'RT10F_DEPTH_BLIND: a call inside a loop body must count against the call-depth policy',
  );
});

test('the call-depth walker counts a call in a loop bound', () => {
  const helpers = helperMap([RETURN_PARAMETER]);
  const loop = {
    ...linkedForStatement({ body: PLAIN_BODY }),
    from: Object.freeze({ arguments: Object.freeze([]), handlerName: HELPER_NAME, kind: 'user-call' }),
  };
  assert.equal(linkedStatementsCallDepth([Object.freeze(loop)], helpers), 1);
});

test('the call-depth walker sees a nested loop body, so nesting cannot hide a chain', () => {
  const inner = helperMap([linkedCallStatement('deeper')]);
  inner.set('deeper', {
    parameters: [],
    returnType: { kind: 'integer' },
    statements: [RETURN_LITERAL],
  });
  const statements = [
    linkedForStatement({ body: [linkedForStatement({ body: [linkedCallStatement(HELPER_NAME)], counter: 'n' })] }),
  ];
  assert.equal(
    linkedStatementsCallDepth(statements, inner),
    2,
    'RT10F_DEPTH_BLIND: two nested loops must not shorten a two-frame chain',
  );
});

test('a call-free loop measures zero depth rather than throwing', () => {
  assert.equal(linkedStatementsCallDepth([linkedForStatement({ body: PLAIN_BODY })], undefined), 0);
});

// `containsReturn` is the walker that fails silently rather than loudly: it recurses into `if`
// branches only, so before this slice a `void` handler whose only `return` sat inside a loop body
// would link and then fault at execution instead of being refused at link.
test('a void handler whose only return is inside a loop body is refused at link', async () => {
  const message = await assertLinkLabel(POSITIONS['neg-void-return-in-body'](), 'KIR_VOID_HANDLER_VALUE_RETURN');
  assert.ok(
    !message.includes('did not return'),
    'RT10F_RETURN_BLIND: the refusal must come from the link-time return walk, not from execution',
  );
});

// The union member is what turns the two statement walkers into `tsc` errors, so it belongs with
// them rather than in the compatibility pins: adding it without teaching them is the one state this
// suite exists to make impossible.
test('the linked statement union carries the for member the walkers are exhaustive over', async () => {
  const contracts = await readFile(CONTRACTS_URL, 'utf8');
  const union = contracts.slice(
    contracts.indexOf('export type LinkedKernKirStatement ='),
    contracts.indexOf('function expressionVariantUnhandled'),
  );
  assert.ok(union.length > 0, 'the statement union must be locatable');
  assert.ok(union.includes(`kind: 'for'`), 'the union must carry the for member this slice adds');
  for (const field of ['body', 'counter', 'from', 'step', 'to']) {
    assert.ok(union.includes(`readonly ${field}`), `the for member must declare ${field}`);
  }
});
