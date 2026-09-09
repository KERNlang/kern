import assert from 'node:assert/strict';
import test from 'node:test';

import { POSITIONS, assertLinkLabel, repositoryText } from './k0-support.mjs';
import {
  DO_LABELS,
  EACH_LABELS,
  RESERVED_UNREACHABLE_LABELS,
  RESERVED_WITH_LABELS,
  REUSED_LABELS,
} from './pins.mjs';

const SOURCE_FILES = Object.freeze([
  'packages/core/src/kir-runtime/linked-kir-program/statements.ts',
  'packages/core/src/kir-runtime/linked-kir-program/loop-statements.ts',
  'packages/core/src/kir-runtime/linked-kir-program/link.ts',
  'packages/core/src/kir-runtime/linked-kir-program/link-support.ts',
  'packages/core/src/kir-runtime/linked-kir-program/expression.ts',
  'packages/core/src/kir-runtime/statement-walker.ts',
  'packages/core/src/kir-runtime/expression.ts',
  'packages/core/src/compiler/kir-js-esm/statement-source.ts',
  'packages/core/src/compiler/kir-js-esm/emitter.ts',
]);

function sources() {
  return SOURCE_FILES.map((path) => ({ path, text: repositoryText(path) }));
}

test('the label sets are disjoint and every label is a KIR token', () => {
  const all = [...DO_LABELS, ...EACH_LABELS, ...RESERVED_UNREACHABLE_LABELS, ...RESERVED_WITH_LABELS];
  assert.equal(new Set(all).size, all.length, 'E_LABEL_DUPLICATE: a label appears in two sets');
  for (const label of all) assert.match(label, /^KIR_[A-Z0-9_]+$/u);
  for (const label of REUSED_LABELS) {
    assert.equal(all.includes(label), false, `E_LABEL_REDECLARED: ${label} is a pre-E label and must be reused, not minted`);
  }
});

test('every spent label is declared in exactly one source file', () => {
  for (const label of [...DO_LABELS, ...EACH_LABELS]) {
    const owners = sources().filter((file) => file.text.includes(label));
    assert.equal(
      owners.length,
      1,
      `E_LABEL_SITE: ${label} must be spelled in exactly one source file, found ${owners.length}`,
    );
  }
});

// A label whose gate no projectable fixture can reach is dead code behind a single-cause name.
// `each … type=…` and `do value="f(1)?"` never project, so neither label may appear in source.
test('the two unreachable labels appear in no source file', () => {
  for (const label of RESERVED_UNREACHABLE_LABELS) {
    for (const file of sources()) {
      assert.equal(
        file.text.includes(label),
        false,
        `E_LABEL_DEAD: ${label} is unreachable from any projectable source, so ${file.path} must not spell it`,
      );
    }
  }
});

test('no KIR_WITH_ label is spent by slice E', () => {
  for (const label of RESERVED_WITH_LABELS) {
    for (const file of sources()) {
      assert.equal(
        file.text.includes(label),
        false,
        `E_WITH_LABEL_SPENT: ${label} belongs to the deferred with slice, and ${file.path} spells it`,
      );
    }
  }
  const spelled = sources().some((file) => /KIR_WITH_[A-Z_]+/u.test(file.text));
  assert.equal(spelled, false, 'E_WITH_LABEL_SPENT: slice E must mint no with label at all');
});

// `with` stays outside the union, which means it keeps the ordinary outside-RT-1 refusal and NOT a
// with-specific one. If a future edit gives it a private label without a contract, this row fires.
test('with is still refused by the generic outside-RT-1 gate', async () => {
  const source = [
    'fn name=route export=true returns=integer',
    '  handler lang=kern',
    '    let name=acc value="0"',
    '    with name=r value="1" cleanup="1"',
    '      assign target="acc" value="1"',
    '    return value="acc"',
    '',
  ].join('\n');
  const { admission } = await import('./k0-support.mjs');
  const row = await admission(source);
  if (row.projection !== 'projected') return;
  const message = await assertLinkLabel(source, 'statement must be a leaf');
  assert.equal(
    /KIR_WITH_[A-Z_]+/u.test(message),
    false,
    'E_WITH_LABEL_SPENT: with must keep the generic refusal until its own slice writes a contract',
  );
});

test('the reused labels are still spelled where their own slice put them', () => {
  const linkText = repositoryText('packages/core/src/kir-runtime/linked-kir-program/link.ts');
  assert.ok(linkText.includes('KIR_VOID_HANDLER_NO_CALL_FORM'), 'E_LABEL_LOST: RT-6 owns the void call form refusal');
  const statements = repositoryText('packages/core/src/kir-runtime/linked-kir-program/statements.ts');
  assert.ok(statements.includes('KIR_LOOP_JUMP_CROSSES_TRY'), 'E_LABEL_LOST: slice D owns the jump-crossing refusal');
  const support = repositoryText('packages/core/src/kir-runtime/linked-kir-program/link-support.ts');
  assert.ok(support.includes('KIR_ASYNC_CALL_EXPRESSION_POSITION'), 'E_LABEL_LOST: RT-5 owns the async position refusal');
});

test('a do fixture and an each fixture each name only their own label', async () => {
  const doMessage = await assertLinkLabel(POSITIONS['do-literal'](), 'KIR_DO_EXPRESSION_NOT_USER_CALL');
  for (const label of EACH_LABELS) assert.equal(doMessage.includes(label), false, label);
  const eachMessage = await assertLinkLabel(POSITIONS['each-await'](), 'KIR_EACH_AWAIT_UNSUPPORTED');
  for (const label of DO_LABELS) assert.equal(eachMessage.includes(label), false, label);
});
