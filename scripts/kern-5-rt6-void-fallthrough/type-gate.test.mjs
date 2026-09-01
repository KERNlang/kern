import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ENTRY,
  LIMITS,
  admission,
  assertLinkRejected,
  entryOf,
  linkVerifiedKernKirProgram,
  moduleSource,
  project,
  text,
} from './k0-support.mjs';

const BOOLEAN_FLAG = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);
const TEXT_INPUT = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);

test('a value-bearing return in a void handler is rejected at link, at top level and in a branch', async () => {
  await assertLinkRejected(entryOf([text('a'), 'return value="\\"x\\""']), 'KIR_VOID_HANDLER_VALUE_RETURN');
  await assertLinkRejected(
    entryOf(['if cond="flag"', '  return value="flag"', text('after')], { parameters: BOOLEAN_FLAG }),
    'a then-branch return must not escape the void gate',
  );
  await assertLinkRejected(
    entryOf(['if cond="flag"', `  ${text('t')}`, 'else', '  return value="flag"', text('after')], {
      parameters: BOOLEAN_FLAG,
    }),
    'an else-branch return must not escape the void gate',
  );
});

test('a bare return is projected by F5 and still fails closed at link in RT-6', async () => {
  await assertLinkRejected(entryOf([text('a'), 'return']), 'a bare return is deferred, not admitted');
});

test('void is never inferred: a non-void handler that falls through is still rejected', async () => {
  for (const returns of ['boolean', 'string', 'boolean[]']) {
    await assertLinkRejected(entryOf([text('a')], { returns }), `a ${returns} handler must still require its return`);
  }
});

test('a declared non-void handler with a final return is unaffected', async () => {
  const row = await admission(entryOf([text('a'), 'return value="\\"done\\""'], { returns: 'string' }));
  assert.deepEqual(
    { javascript: row.javascript, python: row.python, rt1: row.rt1 },
    { javascript: 'admitted', python: 'admitted', rt1: 'admitted' },
  );
});

test('void is invalid as a parameter type on every leg', async () => {
  const row = await admission(
    entryOf(['return value="true"'], { parameters: [{ name: 'x', type: 'void' }], returns: 'boolean' }),
  );
  assert.equal(row.projection, 'not-projected', 'F5 refuses a void parameter before the linker sees it');
});

test('a void helper has no call form and is rejected at link when a call resolves to it', async () => {
  const source = `${moduleSource([
    { body: ['print value="t"'], name: 'log', parameters: TEXT_INPUT, returns: 'void' },
  ])}${entryOf(['return value="log(t)"'], { parameters: TEXT_INPUT, returns: 'string' })}`;
  await assertLinkRejected(source, 'KIR_VOID_HANDLER_NO_CALL_FORM');
});

test('a void call can never be an argument, because void resolves no cross-call type', async () => {
  const source = `${moduleSource([
    { body: [text('inner')], name: 'log', returns: 'void' },
    { body: ['return value="flag"'], name: 'pick', parameters: BOOLEAN_FLAG, returns: 'boolean' },
  ])}${entryOf(['return value="pick(log())"'], { returns: 'boolean' })}`;
  await assertLinkRejected(source, 'a void call may not be an argument');
});

test('a void helper that is never called does not enter the linked program at all', async () => {
  const verified = await project(
    `${moduleSource([{ body: [text('inner')], name: 'log', returns: 'void' }])}${entryOf([text('a')])}`,
  );
  const linked = linkVerifiedKernKirProgram(verified, ENTRY, LIMITS);
  assert.equal(linked.outcome, 'success', 'an unreached void helper is simply not linked');
  assert.equal(linked.program.helpers, undefined);
});
