import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeKernKir,
  handlerSource,
  project,
  provider,
  runtimeRequest,
  threeLegs,
} from './k0-support.mjs';

const FLAG = Object.freeze([{ name: 'flag', type: 'boolean' }]);

const BRANCH_SOURCE = handlerSource('string', FLAG, [
  'if cond="flag"',
  '  print value="\"then-taken\""',
  'else',
  '  print value="\"else-taken\""',
  'return value="\"done\""',
]);

const EARLY_RETURN_SOURCE = handlerSource('string', FLAG, [
  'if cond="flag"',
  '  return value="\"early\""',
  'print value="\"after\""',
  'return value="\"late\""',
]);

const NESTED_SOURCE = handlerSource(
  'string',
  [
    { name: 'outer', type: 'boolean' },
    { name: 'inner', type: 'boolean' },
  ],
  [
    'if cond="outer"',
    '  if cond="inner"',
    '    return value="\"both\""',
    '  else',
    '    return value="\"outer-only\""',
    'return value="\"neither\""',
  ],
);

const LITERAL_CONDITION_SOURCE = handlerSource('string', FLAG, [
  'let name=held value="true"',
  'if cond="held"',
  '  print value="\"literal-true\""',
  'return value="\"done\""',
]);

const CAPABILITY_BRANCH_SOURCE = handlerSource('string', FLAG, [
  'if cond="flag"',
  '  capability namespace=fixture operation=resolve name=reply',
  '  return value="reply"',
  'return value="\"skipped\""',
]);

function booleans(values) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { tag: 'boolean', value }]));
}

async function agreeing(source, requestId, values) {
  const legs = await threeLegs(source, runtimeRequest(requestId, booleans(values)));
  const direct = envelopeBytes(legs.direct.envelope);
  assert.deepEqual(Buffer.from(envelopeBytes(legs.javascript.envelope)), Buffer.from(direct));
  assert.deepEqual(Buffer.from(envelopeBytes(legs.python.envelope)), Buffer.from(direct));
  const directCalls = legs.direct.calls.map(({ namespace, operation }) => ({ namespace, operation }));
  assert.deepEqual(legs.javascript.calls, directCalls);
  assert.deepEqual(legs.python.calls, directCalls);
  return { calls: directCalls, envelope: legs.direct.envelope };
}

test('RT-2 selects the then block and never the else block for true', async () => {
  const run = await agreeing(BRANCH_SOURCE, 'rt2-branch-true', { flag: true });
  assert.equal(run.envelope.outcome, 'success');
  assert.deepEqual([...run.envelope.events], [{ op: 'stdout', text: 'then-taken' }]);
  assert.equal(run.envelope.result.value.value, 'done');
});

test('RT-2 selects the else block and never the then block for false', async () => {
  const run = await agreeing(BRANCH_SOURCE, 'rt2-branch-false', { flag: false });
  assert.equal(run.envelope.outcome, 'success');
  assert.deepEqual([...run.envelope.events], [{ op: 'stdout', text: 'else-taken' }]);
  assert.equal(run.envelope.result.value.value, 'done');
});

test('RT-2 early return from a branch skips every following top-level statement', async () => {
  const taken = await agreeing(EARLY_RETURN_SOURCE, 'rt2-early-true', { flag: true });
  assert.equal(taken.envelope.result.value.value, 'early');
  assert.deepEqual([...taken.envelope.events], []);
  const skipped = await agreeing(EARLY_RETURN_SOURCE, 'rt2-early-false', { flag: false });
  assert.equal(skipped.envelope.result.value.value, 'late');
  assert.deepEqual([...skipped.envelope.events], [{ op: 'stdout', text: 'after' }]);
});

test('RT-2 resolves nested branches identically on all three legs', async () => {
  const both = await agreeing(NESTED_SOURCE, 'rt2-nested-both', { inner: true, outer: true });
  assert.equal(both.envelope.result.value.value, 'both');
  const outerOnly = await agreeing(NESTED_SOURCE, 'rt2-nested-outer', { inner: false, outer: true });
  assert.equal(outerOnly.envelope.result.value.value, 'outer-only');
  const neither = await agreeing(NESTED_SOURCE, 'rt2-nested-neither', { inner: true, outer: false });
  assert.equal(neither.envelope.result.value.value, 'neither');
});

test('RT-2 accepts a boolean literal binding as the condition', async () => {
  const run = await agreeing(LITERAL_CONDITION_SOURCE, 'rt2-literal', { flag: false });
  assert.deepEqual([...run.envelope.events], [{ op: 'stdout', text: 'literal-true' }]);
});

test('RT-2 leaves an unselected capability branch completely unobserved', async () => {
  const taken = await agreeing(CAPABILITY_BRANCH_SOURCE, 'rt2-capability-true', { flag: true });
  assert.deepEqual(taken.calls, [{ namespace: 'fixture', operation: 'resolve' }]);
  assert.equal(taken.envelope.result.value.value, 'reply-value');
  const skipped = await agreeing(CAPABILITY_BRANCH_SOURCE, 'rt2-capability-false', { flag: false });
  assert.deepEqual(skipped.calls, []);
  assert.deepEqual([...skipped.envelope.events], []);
  assert.equal(skipped.envelope.result.value.value, 'skipped');
});

const NON_BOOLEAN_SOURCES = Object.freeze({
  'capability-bound condition': handlerSource('string', FLAG, [
    'capability namespace=fixture operation=resolve name=reply',
    'if cond="reply"',
    '  print value="\"truthy\""',
    'return value="\"done\""',
  ]),
  'boolean list parameter condition': handlerSource('string', [{ name: 'flags', type: 'boolean[]' }], [
    'if cond="flags"',
    '  print value="\"truthy\""',
    'return value="\"done\""',
  ]),
  'text literal condition': handlerSource('string', FLAG, [
    'if cond="\"yes\""',
    '  print value="\"truthy\""',
    'return value="\"done\""',
  ]),
  'text parameter condition': handlerSource('string', [{ name: 'label', type: 'string' }], [
    'if cond="label"',
    '  print value="\"truthy\""',
    'return value="\"done\""',
  ]),
});

for (const [name, source] of Object.entries(NON_BOOLEAN_SOURCES)) {
  test(`RT-2 fails closed on a non-boolean condition: ${name}`, async () => {
    const verified = await project(source);
    assert.ok(verified !== undefined, 'F5 must project the negative-control source');
    const javascript = compileJavaScript(verified);
    const python = compilePython(verified);
    const direct = await executeKernKir(
      verified,
      runtimeRequest('rt2-non-boolean', {}),
      provider([]),
    );
    assert.deepEqual(
      {
        javascript: javascript.outcome === 'failure' ? javascript.code : 'admitted',
        python: python.outcome === 'failure' ? python.code : 'admitted',
        rt1: direct.outcome === 'failure' ? direct.diagnostics[0]?.code : 'admitted',
      },
      {
        javascript: 'handler-entry-unsupported',
        python: 'handler-entry-unsupported',
        rt1: 'handler-entry-unsupported',
      },
      'KIR_IF_COND_NOT_BOOLEAN: a non-boolean condition must fail closed identically on all three legs',
    );
    assert.deepEqual([...direct.events], []);
  });
}

test('RT-2 rejects an else block that is not paired with an if', async () => {
  const source = handlerSource('string', FLAG, ['else', '  print value="\"orphan\""', 'return value="\"done\""']);
  const verified = await project(source);
  assert.ok(verified !== undefined);
  assert.equal(compileJavaScript(verified).code, 'handler-entry-unsupported');
  assert.equal(compilePython(verified).code, 'handler-entry-unsupported');
});

test('RT-2 keeps branch-local bindings out of the enclosing scope', async () => {
  const source = handlerSource('string', FLAG, [
    'if cond="flag"',
    '  let name=inner value="\"branch\""',
    '  print value="inner"',
    'return value="inner"',
  ]);
  const verified = await project(source);
  assert.ok(verified !== undefined);
  assert.equal(compileJavaScript(verified).code, 'handler-entry-unsupported');
  assert.equal(compilePython(verified).code, 'handler-entry-unsupported');
});
