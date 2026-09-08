import assert from 'node:assert/strict';
import test from 'node:test';

import { TRY_POSITIONS, assertLinkLabel, assertTryAdmitted, linkedProgram, repositoryText } from './k0-support.mjs';

const PAYLOAD_LABEL = 'KIR_THROW_PAYLOAD_SHAPE';
const HELPER_LABEL = 'KIR_TRY_FAMILY_IN_HELPER';
const PROPERTY_SET = 'unsupported property set';
const EMPTY_BLOCK = 'branch block is empty';
const LEAF = 'statement must be a leaf';

// `KIR_TRY_REQUIRES_CATCH` is a prefix of `KIR_TRY_REQUIRES_CATCH_OR_FINALLY`, so one substring
// assertion covers both spellings: D2 emits the first, D5 replaces it with the second, and the row
// stays honest across the gate of D-7f without forking.
const REQUIRES_CATCH = 'KIR_TRY_REQUIRES_CATCH';

const STRUCTURE_REFUSALS = Object.freeze([
  ['neg-try-no-catch', REQUIRES_CATCH],
  ['neg-try-duplicate-catch', 'KIR_DUPLICATE_CATCH'],
  ['neg-try-empty-body', EMPTY_BLOCK],
  ['neg-try-empty-catch', EMPTY_BLOCK],
  ['neg-try-named', PROPERTY_SET],
  ['neg-try-body-after-clause', 'KIR_TRY_BODY_AFTER_CLAUSE'],
  ['neg-catch-top-level', 'KIR_CATCH_WITHOUT_TRY'],
  ['neg-catch-in-for', 'KIR_CATCH_WITHOUT_TRY'],
  ['neg-catch-in-while', 'KIR_CATCH_WITHOUT_TRY'],
  ['neg-throw-bare', PROPERTY_SET],
  ['neg-throw-with-children', LEAF],
  ['neg-throw-shadowed-binding', 'duplicate binding e'],
  ['neg-assign-catch-binding', 'KIR_ASSIGN_TARGET_NOT_LET'],
  // rt5's position gate, for the throw payload. The `statementValue` flag `compileThrow` passes is
  // what separates this row from `neg-throw-async-call` below: nested has no continuation position,
  // a bare statement value has one. A mutation that flips the flag collapses the pair.
  ['neg-throw-async-in-payload', 'KIR_ASYNC_CALL_EXPRESSION_POSITION'],
]);

const PAYLOAD_REFUSALS = Object.freeze([
  'neg-throw-text-literal',
  'neg-throw-integer-literal',
  'neg-throw-boolean-literal',
  'neg-throw-list',
  'neg-throw-identifier',
  'neg-throw-empty-record',
  'neg-throw-integer-message',
  'neg-throw-extra-key',
  'neg-throw-no-message',
  'neg-throw-null-message',
  // Refused by the PAYLOAD gate, not the position gate: a bare async user-call is a legal statement
  // value, so `assertAsyncCallPosition(value, scope, label, true)` lets it through and the shape
  // gate is what stops it. Flip that flag to false and this row reports the async label instead.
  'neg-throw-async-call',
  'neg-throw-member',
  'neg-throw-nested-record-message',
  'neg-throw-let-bound-payload',
]);

const ADMITTED = Object.freeze([
  'try-catch',
  'try-catch-no-binding',
  'try-catch-caught-throw',
  'try-catch-coded-throw',
  'try-catch-null-code',
  'try-catch-return-in-body',
  'try-catch-return-in-catch',
  'try-catch-reads-message',
  'try-catch-reads-code',
  'try-nested',
  'try-rethrow',
  'try-throw-in-catch',
  'try-payload-parameter',
  'try-payload-helper-call',
  'throw-uncaught',
  'throw-uncaught-coded',
  'try-await-helper-completes',
]);

for (const [position, label] of STRUCTURE_REFUSALS) {
  test(`${position} is refused at link with ${label}`, async () => {
    await assertLinkLabel(TRY_POSITIONS[position](), label);
  });
}

for (const position of PAYLOAD_REFUSALS) {
  test(`${position} is refused at link with ${PAYLOAD_LABEL}`, async () => {
    await assertLinkLabel(TRY_POSITIONS[position](), PAYLOAD_LABEL);
  });
}

for (const position of ADMITTED) {
  test(`${position} links on RT-1 and the JavaScript leg`, async () => {
    await assertTryAdmitted(position, TRY_POSITIONS[position]());
  });
}

// D-2h's discriminator is the scope flag, not the node kind: the same `throw` and the same `try`
// link in the entry handler and are refused in a helper body. Two rows, so a refusal that keyed on
// the kind rather than the scope cannot pass both halves.
test('the try family is refused in a helper body while the entry handler admits it', async () => {
  await assertLinkLabel(TRY_POSITIONS['neg-throw-in-helper'](), HELPER_LABEL);
  await assertLinkLabel(TRY_POSITIONS['neg-try-in-helper'](), HELPER_LABEL);
  await assertTryAdmitted('throw-uncaught', TRY_POSITIONS['throw-uncaught']());
  await assertTryAdmitted('try-catch', TRY_POSITIONS['try-catch']());
});

// D-1f1, the importer-visible half. Helper-mediated rethrow is doubly impossible: the helper body is
// refused, and a payload record is not an admissible parameter type. Both asserted, so the
// limitation is a measured fact rather than a design note.
test('rethrow is lexical only, and a payload record is not an admissible parameter type', async () => {
  await assertTryAdmitted('try-rethrow', TRY_POSITIONS['try-rethrow']());
  await assertLinkLabel(TRY_POSITIONS['neg-throw-in-helper'](), HELPER_LABEL);
  const contracts = repositoryText('packages/core/src/kir-runtime/linked-kir-program/contracts.ts');
  const admission = contracts.slice(
    contracts.indexOf('export const LINKED_KIR_TYPE_ADMISSION'),
    contracts.indexOf('export function linkedKirAdmitsType'),
  );
  assert.ok(admission.length > 0, 'LINKED_KIR_TYPE_ADMISSION must be locatable');
  assert.equal(
    admission.includes('record'),
    false,
    'D_TYPE_ADMISSION_WIDENED: a record must stay a non-parameter, non-return type so helper-mediated rethrow stays impossible',
  );
});

// D-1a1's discriminating row, and the one that separates a typing default from canonicalization: the
// linker completes an omitted `code` with an explicit null literal, so every linked payload carries
// both keys sorted `code` then `message` -- while a non-conforming payload stays a refusal.
test('the absent code default is inserted, so every linked payload carries both keys sorted', async () => {
  const { program } = await linkedProgram(TRY_POSITIONS['throw-uncaught']());
  const thrown = program.statements.find((statement) => statement.kind === 'throw');
  assert.ok(thrown !== undefined, 'D_THROW_ABSENT: the linked entry handler must carry a throw statement');
  assert.equal(thrown.value.kind, 'record', 'D_PAYLOAD_SHAPE: the linked payload must be a record expression');
  assert.deepEqual(
    thrown.value.entries.map((entry) => entry.key),
    ['code', 'message'],
    'D_PAYLOAD_DEFAULT: an omitted code must be completed with a literal null, sorted before message',
  );
  assert.deepEqual(
    thrown.value.entries[0].value,
    { kind: 'literal', value: { tag: 'null' } },
    'D_PAYLOAD_DEFAULT: the inserted code default must be an explicit null literal, not an absent key',
  );
  assert.equal(thrown.value.entries[1].value.value.tag, 'text');
});

test('an explicitly written code: null is admitted, because writing the default is not a refusal', async () => {
  await assertTryAdmitted('try-catch-null-code', TRY_POSITIONS['try-catch-null-code']());
  const { program } = await linkedProgram(TRY_POSITIONS['try-catch-null-code']());
  const outer = program.statements.find((statement) => statement.kind === 'try');
  assert.ok(outer !== undefined, 'D_TRY_ABSENT: the linked entry handler must carry a try statement');
  const thrown = outer.body.find((statement) => statement.kind === 'throw');
  assert.deepEqual(thrown.value.entries.map((entry) => entry.key), ['code', 'message']);
});

// D-1a2. `member` is statically untyped on both channels today, so reading the payload needs no
// typing change at all. This row pins the absence: a slice that "fixed" the typing would break it.
test('member expressions stay statically untyped on both channels, so reading a payload needs no typing change', () => {
  const source = repositoryText('packages/core/src/kir-runtime/linked-kir-program/expression.ts');
  for (const marker of ['staticExpressionType', 'crossCallExpressionType']) {
    const region = source.slice(source.indexOf(`export function ${marker}`));
    assert.ok(region.length > 0, `${marker} must be locatable`);
    assert.equal(
      region.slice(0, region.indexOf('\n}')).includes("kind === 'member'"),
      false,
      `D_TYPING_WIDENED: ${marker} must keep falling through to undefined for a member expression`,
    );
  }
});

test('e.message and e.code link and evaluate, and e.missing keeps the existing missing-member fault', async () => {
  await assertTryAdmitted('try-catch-reads-message', TRY_POSITIONS['try-catch-reads-message']());
  await assertTryAdmitted('try-catch-reads-code', TRY_POSITIONS['try-catch-reads-code']());
  await assertTryAdmitted('try-catch-reads-missing', TRY_POSITIONS['try-catch-reads-missing']());
});

// D-6d, the "one arm, not two" lesson in a new place: `try` joins the zero-expression arm because it
// has no `value`, and `throw` needs no arm because the fallback already returns `[statement.value]`.
// Without the `try` arm the fallback returns `[undefined]` and the capability closure walks a hole.
test('statementSubExpressions gains exactly one arm, for try and not for throw', () => {
  const contracts = repositoryText('packages/core/src/kir-runtime/linked-kir-program/contracts.ts');
  const walker = contracts.slice(
    contracts.indexOf('export function statementSubExpressions'),
    contracts.indexOf('export function expressionVariantUnhandled'),
  );
  assert.ok(walker.length > 0, 'statementSubExpressions must be locatable');
  assert.ok(
    walker.includes("statement.kind === 'try'"),
    'D_WALKER_HOLE: statementSubExpressions must name try in its zero-expression arm, or the fallback returns [undefined]',
  );
  assert.equal(
    walker.includes("statement.kind === 'throw'"),
    false,
    'D_WALKER_CREEP: throw needs no arm; the fallback already returns [statement.value]',
  );
});

// D-6e. Every sub-block must be reachable or the closure walk and the call-depth policy miss a
// capability or a call inside a try.
test('statementSubBlocks gains a try arm that reaches every clause body', () => {
  const contracts = repositoryText('packages/core/src/kir-runtime/linked-kir-program/contracts.ts');
  const walker = contracts.slice(
    contracts.indexOf('export function statementSubBlocks'),
    contracts.indexOf('export function statementSubExpressions'),
  );
  assert.ok(walker.length > 0, 'statementSubBlocks must be locatable');
  assert.ok(
    walker.includes("statement.kind === 'try'"),
    'D_WALKER_HOLE: statementSubBlocks must name try, or a capability inside a try body is invisible',
  );
  for (const field of ['catchBody', 'finallyBody']) {
    assert.ok(
      walker.includes(field),
      `D_WALKER_HOLE: statementSubBlocks must reach ${field}, or a call inside that clause escapes the policy`,
    );
  }
});
