import assert from 'node:assert/strict';
import test from 'node:test';

import { POSITIONS, admission, assertLinkLabel } from './k0-support.mjs';

// Every row is (position, label). The closed link code is the same for all of them, so
// the label text is the only thing that says which gate fired.
const REFUSALS = Object.freeze([
  ['neg-undeclared', 'KIR_ASSIGN_UNDECLARED'],
  ['neg-sibling-branch', 'KIR_ASSIGN_UNDECLARED'],
  ['neg-assign-before-let', 'KIR_ASSIGN_UNDECLARED'],
  ['neg-bool-into-integer', 'KIR_ASSIGN_TYPE_MISMATCH'],
  ['neg-text-into-integer', 'KIR_ASSIGN_TYPE_MISMATCH'],
  ['neg-integer-into-text', 'KIR_ASSIGN_TYPE_MISMATCH'],
  ['neg-integer-list-into-integer', 'KIR_ASSIGN_TYPE_MISMATCH'],
  ['neg-list-into-text', 'KIR_ASSIGN_TYPE_MISMATCH'],
  ['neg-integer-into-call-typed', 'KIR_ASSIGN_TYPE_MISMATCH'],
  ['neg-call-typed-into-integer', 'KIR_ASSIGN_TYPE_MISMATCH'],
  ['neg-text-into-call-typed-list', 'KIR_ASSIGN_TYPE_MISMATCH'],
  ['neg-call-typed-list-into-text', 'KIR_ASSIGN_TYPE_MISMATCH'],
  ['neg-text-into-capability', 'KIR_ASSIGN_TYPE_MISMATCH'],
  ['neg-param-target', 'KIR_ASSIGN_TARGET_NOT_LET'],
  ['neg-op-compound', 'KIR_ASSIGN_OP_UNSUPPORTED'],
  ['neg-op-equals', 'KIR_ASSIGN_OP_UNSUPPORTED'],
  ['neg-target-member', 'KIR_ASSIGN_TARGET_NOT_IDENTIFIER'],
  ['neg-target-index', 'KIR_ASSIGN_TARGET_NOT_IDENTIFIER'],
]);

for (const [position, label] of REFUSALS) {
  test(`${position} is refused at link with ${label}`, async () => {
    await assertLinkLabel(POSITIONS[position](), label);
  });
}

test('an undeclared target never reports the not-a-let label', async () => {
  const message = await assertLinkLabel(POSITIONS['neg-undeclared'](), 'KIR_ASSIGN_UNDECLARED');
  assert.ok(
    !message.includes('KIR_ASSIGN_TARGET_NOT_LET'),
    'declared is checked before assignable, so an unknown name is UNDECLARED and nothing else',
  );
});

test('a parameter target is refused as not-a-let, never as undeclared', async () => {
  const message = await assertLinkLabel(POSITIONS['neg-param-target'](), 'KIR_ASSIGN_TARGET_NOT_LET');
  assert.ok(
    !message.includes('KIR_ASSIGN_UNDECLARED'),
    'a parameter is declared; only its assignability is missing',
  );
});

test('an op property is refused with its own label, not as an unsupported property set', async () => {
  for (const position of ['neg-op-compound', 'neg-op-equals']) {
    const message = await assertLinkLabel(POSITIONS[position](), 'KIR_ASSIGN_OP_UNSUPPORTED');
    assert.ok(
      !message.includes('unsupported property set'),
      `${position}: op must be an optional property so the refusal can name itself`,
    );
  }
});

test('shadowing is refused before assignment resolution can ever be asked about it', async () => {
  await assertLinkLabel(POSITIONS['neg-shadow-branch-let'](), 'duplicate binding s');
});

test('assigning a capability result into another capability binding is admitted', async () => {
  const row = await admission(POSITIONS['capability-to-capability']());
  assert.equal(row.projection, 'projected');
  assert.equal(row.rt1, 'admitted');
  assert.equal(row.javascript, 'admitted');
  assert.equal(row.python, 'admitted');
});

test('an assign that preserves both recorded types is admitted on every leg', async () => {
  for (const position of ['simple-reassign', 'binary-value', 'integer-from-identifier', 'list-assign']) {
    const row = await admission(POSITIONS[position]());
    assert.equal(row.rt1, 'admitted', position);
    assert.equal(row.javascript, 'admitted', position);
    assert.equal(row.python, 'admitted', position);
  }
});

// A binding declared from a user call carries the type record the callee's signature
// produced, so the gate has to resolve the call arm of both tables — not just the
// literal arms — or every one of these is refused for a type the binding really has.
test('a binding typed through a call signature is assignable through both tables', async () => {
  for (const position of ['call-typed-positive', 'call-typed-literal', 'call-typed-list']) {
    const row = await admission(POSITIONS[position]());
    assert.equal(row.rt1, 'admitted', position);
    assert.equal(row.javascript, 'admitted', position);
    assert.equal(row.python, 'admitted', position);
  }
});

// Both rows read `undefined` from the static table, so the cross-call table is the only
// one that can separate them: dropping that half admits the text row.
test('the cross-call half of the gate separates the two assigns into one call-typed list binding', async () => {
  const admitted = await admission(POSITIONS['call-typed-list']());
  assert.equal(admitted.rt1, 'admitted');
  await assertLinkLabel(POSITIONS['neg-text-into-call-typed-list'](), 'KIR_ASSIGN_TYPE_MISMATCH');
});

// `neg-bool-into-integer` cannot separate the halves: `crossCallExpressionType` answers
// `boolean` for a boolean literal, so both halves fire on it independently. An integer list
// is the mirror of `neg-list-into-text` — `undefined` in both cross-call directions — so the
// static table is the only one that can refuse it.
test('the static half of the gate separates the two assigns into one integer binding', async () => {
  const admitted = await admission(POSITIONS['integer-from-identifier']());
  assert.equal(admitted.rt1, 'admitted');
  await assertLinkLabel(POSITIONS['neg-integer-list-into-integer'](), 'KIR_ASSIGN_TYPE_MISMATCH');
});

// The transpose of the call-typed-list row above: here the *value* is the call, so this is the
// only fixture a mutation confined to the tables' user-call arm can reach. Both sides read
// `undefined` from the static table, so again only the cross-call half can refuse.
test('the cross-call half of the gate refuses a call-typed value assigned into a text binding', async () => {
  const admitted = await admission(POSITIONS['simple-reassign']());
  assert.equal(admitted.rt1, 'admitted');
  await assertLinkLabel(POSITIONS['neg-call-typed-list-into-text'](), 'KIR_ASSIGN_TYPE_MISMATCH');
});
