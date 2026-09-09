import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createLinkedKirClosureWalk,
  linkedCapabilityStatement,
  linkedCallStatement,
  linkedStatementsCallDepth,
  linkedStatementsInvokeCapability,
  linkedUserCall,
  linkedWhileStatement,
} from './k0-support.mjs';

const CONTRACTS_URL = new URL(
  '../../packages/core/src/kir-runtime/linked-kir-program/contracts.ts',
  import.meta.url,
);

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

// Every row here is driven by a hand-built linked `while`, so the walkers can be asked about a
// condition loop with no linker involvement. That is deliberate: the two walkers fall through to
// `statement.value` for an unrecognised kind rather than erroring, so at base they raise a
// TypeError — a cause independent of whether the linker routes `while` at all.
test('the capability closure walker looks inside a while body', () => {
  const statements = [linkedWhileStatement({ body: [linkedCapabilityStatement()] })];
  assert.equal(
    linkedStatementsInvokeCapability(statements, undefined, createLinkedKirClosureWalk()),
    true,
    'RT11W_CLOSURE_BLIND: a capability inside a while body must reach the closure walk',
  );
});

// The condition is an expression the walk must visit, exactly as an `if` condition and a `for`
// bound are. A walker that visited only the body would pass the row above and fail this one.
test('the capability closure walker looks inside a while condition', () => {
  const helpers = helperMap([linkedCapabilityStatement()]);
  const statements = [linkedWhileStatement({ body: PLAIN_BODY, condition: linkedUserCall(HELPER_NAME) })];
  assert.equal(
    linkedStatementsInvokeCapability(statements, helpers, createLinkedKirClosureWalk()),
    true,
    'RT11W_CONDITION_BLIND: a condition is an expression the closure walk must visit',
  );
});

test('the capability closure walker follows a helper called from a while body', () => {
  const helpers = helperMap([linkedCapabilityStatement()]);
  const statements = [linkedWhileStatement({ body: [linkedCallStatement(HELPER_NAME)] })];
  assert.equal(
    linkedStatementsInvokeCapability(statements, helpers, createLinkedKirClosureWalk()),
    true,
    'RT11W_CLOSURE_BLIND: the walk must recurse through a call made inside a while body',
  );
});

test('a capability-free while answers false rather than throwing, so the arm is not a blanket true', () => {
  const statements = [linkedWhileStatement({ body: PLAIN_BODY })];
  assert.equal(linkedStatementsInvokeCapability(statements, undefined, createLinkedKirClosureWalk()), false);
});

test('the call-depth walker counts a call made inside a while body and one in its condition', () => {
  const helpers = helperMap([RETURN_PARAMETER]);
  assert.equal(
    linkedStatementsCallDepth([linkedWhileStatement({ body: [linkedCallStatement(HELPER_NAME)] })], helpers),
    1,
    'RT11W_DEPTH_BLIND: a call inside a while body must count against the call-depth policy',
  );
  assert.equal(
    linkedStatementsCallDepth(
      [linkedWhileStatement({ body: PLAIN_BODY, condition: linkedUserCall(HELPER_NAME) })],
      helpers,
    ),
    1,
    'RT11W_DEPTH_BLIND: a call in a condition must count too',
  );
});

test('the call-depth walker sees a nested while body, so nesting cannot hide a chain', () => {
  const helpers = helperMap([linkedCallStatement('deeper')]);
  helpers.set('deeper', { parameters: [], returnType: { kind: 'integer' }, statements: [RETURN_LITERAL] });
  const statements = [
    linkedWhileStatement({ body: [linkedWhileStatement({ body: [linkedCallStatement(HELPER_NAME)] })] }),
  ];
  assert.equal(
    linkedStatementsCallDepth(statements, helpers),
    2,
    'RT11W_DEPTH_BLIND: two nested whiles must not shorten a two-frame chain',
  );
  assert.equal(
    linkedStatementsCallDepth([linkedWhileStatement({ body: PLAIN_BODY })], undefined),
    0,
    'a call-free while measures zero depth rather than throwing',
  );
});

// The union member is what turns the two statement walkers into `tsc` errors, so it belongs with
// them rather than in the compatibility pins: adding it without teaching them is the one state this
// suite exists to make impossible. Two fields and no more — a `while` binds no counter and reads no
// bounds, so a `counter`, `from`, `to` or `step` field would mean the shape was copied, not derived.
test('the linked statement union carries the while member with exactly body and condition', async () => {
  const contracts = await readFile(CONTRACTS_URL, 'utf8');
  const union = contracts.slice(
    contracts.indexOf('export type LinkedKernKirStatement ='),
    contracts.indexOf('function expressionVariantUnhandled'),
  );
  assert.ok(union.length > 0, 'the statement union must be locatable');
  assert.ok(
    union.includes(`kind: 'while'`),
    'RT11W_UNION_GAP: the linked statement union must carry the while member',
  );
  const at = union.indexOf(`kind: 'while'`);
  const member = union.slice(union.lastIndexOf('| {', at), union.indexOf('}', at));
  const declared = [...member.matchAll(/readonly (\w+)[?]?:/gu)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(declared)].sort(),
    ['body', 'condition', 'kind'],
    'the while member must declare exactly kind, body and condition',
  );
});
