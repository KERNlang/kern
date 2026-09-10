import assert from 'node:assert/strict';
import test from 'node:test';

import { RESERVED_WITH_LABELS as E_RESERVED_WITH_LABELS } from '../kern-5-e-linked-each-do/pins.mjs';
import { POSITIONS, assertLinkLabel, repositoryText } from './k0-support.mjs';
import {
  DECLARED_WITH_LABELS,
  LABEL_DECLARATION_SITE,
  NEW_WITH_LABELS,
  REUSED_LABELS,
  SPENT_WITH_LABELS,
  UNSPENT_WITH_LABELS,
} from './pins.mjs';

const SOURCE_FILES = Object.freeze([
  'packages/core/src/kir-runtime/linked-kir-program/statements.ts',
  'packages/core/src/kir-runtime/linked-kir-program/loop-statements.ts',
  'packages/core/src/kir-runtime/linked-kir-program/link.ts',
  'packages/core/src/kir-runtime/linked-kir-program/link-support.ts',
  'packages/core/src/kir-runtime/linked-kir-program/expression.ts',
  'packages/core/src/kir-runtime/linked-kir-program/contracts.ts',
  'packages/core/src/kir-runtime/statement-walker.ts',
  'packages/core/src/kir-runtime/expression.ts',
  'packages/core/src/compiler/kir-js-esm/statement-source.ts',
  'packages/core/src/compiler/kir-js-esm/emitter.ts',
  'packages/core/src/compiler/kir-python/request.ts',
]);

function sources() {
  return SOURCE_FILES.map((path) => ({ path, text: repositoryText(path) }));
}

test('the label sets are disjoint and every label is a KIR token', () => {
  const all = [...DECLARED_WITH_LABELS, ...UNSPENT_WITH_LABELS];
  assert.equal(new Set(all).size, all.length, 'F_LABEL_DUPLICATE: a label appears in two sets');
  for (const label of all) assert.match(label, /^KIR_[A-Z0-9_]+$/u);
  for (const label of REUSED_LABELS) {
    assert.equal(
      all.includes(label),
      false,
      `F_LABEL_REDECLARED: ${label} is a pre-F label and must be reused, not minted`,
    );
  }
  assert.deepEqual(
    [...SPENT_WITH_LABELS, ...NEW_WITH_LABELS].sort(),
    [...DECLARED_WITH_LABELS],
    'F_LABEL_SET: the spent and new sets must together be the declared set',
  );
});

test('every label slice F declares is spelled in exactly one source file, and that file is the linker', () => {
  for (const label of DECLARED_WITH_LABELS) {
    const owners = sources().filter((file) => file.text.includes(label));
    assert.equal(
      owners.length,
      1,
      `F_LABEL_SITE: ${label} must be spelled in exactly one source file, found ${owners.length}`,
    );
    assert.equal(
      owners[0]?.path,
      LABEL_DECLARATION_SITE,
      `F_LABEL_SITE: ${label} belongs in the linker, not in ${owners[0]?.path}`,
    );
  }
});

// A label whose gate no projectable fixture can reach is dead code behind a single-cause name.
// `with … value="f(1)?"` never projects, and the `let` rule admits every acquire `with` admits.
test('the two unspent with labels appear in no source file', () => {
  for (const label of UNSPENT_WITH_LABELS) {
    for (const file of sources()) {
      assert.equal(
        file.text.includes(label),
        false,
        `F_LABEL_DEAD: ${label} is unreachable from any projectable source, so ${file.path} must not spell it`,
      );
    }
  }
});

// The predecessor's own reservation has to be spent down, not merely stepped over: slice E pins the
// five KIR_WITH_ labels as unspent, and F must leave exactly the two it does not use.
test('slice E reserves only the labels slice F leaves unspent', () => {
  assert.deepEqual(
    [...E_RESERVED_WITH_LABELS].sort(),
    [...UNSPENT_WITH_LABELS].sort(),
    'F_PRIOR_PIN_STALE: E still reserves labels F now spends, so E RESERVED_WITH_LABELS must be narrowed',
  );
});

test('the reused labels are still spelled where their own slice put them', () => {
  const link = repositoryText('packages/core/src/kir-runtime/linked-kir-program/link.ts');
  assert.ok(link.includes('KIR_VOID_HANDLER_NO_CALL_FORM'), 'F_LABEL_LOST: RT-6 owns the void call form refusal');
  assert.ok(link.includes('KIR_VOID_HANDLER_VALUE_RETURN'), 'F_LABEL_LOST: RT-6 owns the void value return refusal');
  const statements = repositoryText('packages/core/src/kir-runtime/linked-kir-program/statements.ts');
  assert.ok(statements.includes('KIR_LOOP_JUMP_CROSSES_TRY'), 'F_LABEL_LOST: slice D owns the jump-crossing refusal');
  assert.ok(statements.includes('KIR_TRY_FAMILY_IN_HELPER'), 'F_LABEL_LOST: slice D owns the try-family helper refusal');
  const support = repositoryText('packages/core/src/kir-runtime/linked-kir-program/link-support.ts');
  assert.ok(support.includes('KIR_ASYNC_CALL_EXPRESSION_POSITION'), 'F_LABEL_LOST: RT-5 owns the async position refusal');
});

// The generic gate slice E pinned must be gone: a `with` that still refuses as a non-leaf statement
// is a `with` no contract has been written for.
test('with is no longer refused by the generic outside-RT-1 gate', async () => {
  const message = await assertLinkLabel(POSITIONS['neg-with-protocol-with'](), 'KIR_WITH_PROTOCOL_UNSUPPORTED');
  assert.equal(
    message.includes('statement must be a leaf'),
    false,
    'F_GENERIC_REFUSAL: a with must reach its own gates, not the structural leaf check',
  );
  assert.equal(
    message.includes('statement kind with is outside RT-1'),
    false,
    'F_GENERIC_REFUSAL: a with must no longer be reported as outside RT-1',
  );
});

test('each with fixture names only its own label', async () => {
  const protocol = await assertLinkLabel(POSITIONS['neg-with-protocol-with'](), 'KIR_WITH_PROTOCOL_UNSUPPORTED');
  for (const other of DECLARED_WITH_LABELS.filter((label) => label !== 'KIR_WITH_PROTOCOL_UNSUPPORTED')) {
    assert.equal(protocol.includes(other), false, `F_LABEL_COMPOUND: the protocol refusal also names ${other}`);
  }
  const cleanup = await assertLinkLabel(POSITIONS['neg-with-cleanup-literal'](), 'KIR_WITH_CLEANUP_UNSUPPORTED');
  for (const other of DECLARED_WITH_LABELS.filter((label) => label !== 'KIR_WITH_CLEANUP_UNSUPPORTED')) {
    assert.equal(cleanup.includes(other), false, `F_LABEL_COMPOUND: the cleanup refusal also names ${other}`);
  }
});
