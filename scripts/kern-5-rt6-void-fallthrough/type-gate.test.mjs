import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ENTRY,
  LIMITS,
  LINKED_KIR_TYPE_ADMISSION,
  admission,
  assertLinkLabel,
  entryOf,
  linkVerifiedKernKirProgram,
  moduleSource,
  project,
  text,
} from './k0-support.mjs';

const BOOLEAN_FLAG = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);
const TEXT_INPUT = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);

test('a value-bearing return in a void handler fires the void gate, at top level and in a branch', async () => {
  for (const body of [
    [text('a'), 'return value="\\"x\\""'],
    ['if cond="flag"', '  return value="flag"', text('after')],
    ['if cond="flag"', `  ${text('t')}`, 'else', '  return value="flag"', text('after')],
  ]) {
    await assertLinkLabel(entryOf(body, { parameters: BOOLEAN_FLAG }), 'KIR_VOID_HANDLER_VALUE_RETURN');
  }
});

test('a bare return is projected by F5 and still fails closed on the property gate, not the void gate', async () => {
  const message = await assertLinkLabel(entryOf([text('a'), 'return']), 'unsupported property set');
  assert.ok(
    !message.includes('KIR_VOID_HANDLER'),
    'the bare return is deferred by the statement property gate, so no void gate may claim it',
  );
});

test('void is never inferred: a non-void handler that falls through fires the final-return gate', async () => {
  for (const returns of ['boolean', 'string', 'boolean[]']) {
    await assertLinkLabel(entryOf([text('a')], { returns }), 'expected exactly one final return');
  }
});

test('a declared non-void handler with a final return is unaffected', async () => {
  const row = await admission(entryOf([text('a'), 'return value="\\"done\\""'], { returns: 'string' }));
  assert.deepEqual(
    { javascript: row.javascript, python: row.python, rt1: row.rt1 },
    { javascript: 'admitted', python: 'admitted', rt1: 'admitted' },
  );
});

test('void is invalid as a parameter type: F5 refuses it and the table refuses it', async () => {
  const row = await admission(
    entryOf(['return value="true"'], { parameters: [{ name: 'x', type: 'void' }], returns: 'boolean' }),
  );
  assert.equal(row.projection, 'not-projected', 'F5 refuses a void parameter before the linker sees it');
  assert.equal(
    LINKED_KIR_TYPE_ADMISSION.void.parameter,
    false,
    'and the closed table the linker gate is built from refuses it independently of F5',
  );
});

test('a void helper has no call form and fires the void callee gate when a call resolves to it', async () => {
  const source = `${moduleSource([
    { body: ['print value="t"'], name: 'log', parameters: TEXT_INPUT, returns: 'void' },
  ])}${entryOf(['return value="log(t)"'], { parameters: TEXT_INPUT, returns: 'string' })}`;
  await assertLinkLabel(source, 'KIR_VOID_HANDLER_NO_CALL_FORM');
});

test('a void call can never be an argument, because void resolves no cross-call type', async () => {
  const source = `${moduleSource([
    { body: [text('inner')], name: 'log', returns: 'void' },
    { body: ['return value="flag"'], name: 'pick', parameters: BOOLEAN_FLAG, returns: 'boolean' },
  ])}${entryOf(['return value="pick(log())"'], { returns: 'boolean' })}`;
  await assertLinkLabel(source, 'KIR_VOID_HANDLER_NO_CALL_FORM');
});

test('a void helper that is never called does not enter the linked program at all', async () => {
  const verified = await project(
    `${moduleSource([{ body: [text('inner')], name: 'log', returns: 'void' }])}${entryOf([text('a')])}`,
  );
  const linked = linkVerifiedKernKirProgram(verified, ENTRY, LIMITS);
  assert.equal(linked.outcome, 'success', 'an unreached void helper is simply not linked');
  assert.equal(linked.program.helpers, undefined);
});
