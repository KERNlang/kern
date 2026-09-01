import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASYNC_TEXT_HELPER,
  CAPABILITY_LINE,
  RELAY_HELPER,
  SYNC_TEXT_HELPER,
  TEXT_INPUT,
  entryFn,
  linkedProgram,
  linkedProgramAsyncHelpers,
  moduleSource,
} from './k0-support.mjs';

// The production digest drops keys whose value is undefined, which is the whole omit-when-false
// mechanism, so the oracle has to serialize the same way to measure it.
function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  assert.ok(value !== undefined && typeof value === 'object');
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

const DEEP_HELPER = Object.freeze({
  body: Object.freeze(['return value="relay(t)"']),
  name: 'deep',
  parameters: TEXT_INPUT,
  returns: 'string',
});

const SECOND_SYNC = Object.freeze({
  body: Object.freeze(['return value="echo(t)"']),
  name: 'twice',
  parameters: TEXT_INPUT,
  returns: 'string',
});

const CAPABILITY_IN_BRANCH = Object.freeze({
  body: Object.freeze(['if cond="true"', `  ${CAPABILITY_LINE}`, '  return value="reply"', 'return value="t"']),
  name: 'branchy',
  parameters: TEXT_INPUT,
  returns: 'string',
});

const FIXTURES = Object.freeze({
  'branch-only-capability': {
    async: ['branchy'],
    source: () => moduleSource([CAPABILITY_IN_BRANCH, entryFn(['return value="branchy(t)"'], TEXT_INPUT, 'string')]),
  },
  'diamond-reaches-one-async-leaf': {
    async: ['deep', 'fetchIt', 'relay'],
    source: () =>
      moduleSource([
        ASYNC_TEXT_HELPER,
        RELAY_HELPER,
        DEEP_HELPER,
        SYNC_TEXT_HELPER,
        entryFn(['let name=a value="deep(t)"', 'let name=b value="echo(a)"', 'return value="relay(b)"'], TEXT_INPUT, 'string'),
      ]),
  },
  'direct-capability': {
    async: ['fetchIt'],
    source: () => moduleSource([ASYNC_TEXT_HELPER, entryFn(['return value="fetchIt(t)"'], TEXT_INPUT, 'string')]),
  },
  'sync-only': {
    async: [],
    source: () =>
      moduleSource([SYNC_TEXT_HELPER, SECOND_SYNC, entryFn(['return value="twice(t)"'], TEXT_INPUT, 'string')]),
  },
  'transitive-one-hop': {
    async: ['fetchIt', 'relay'],
    source: () =>
      moduleSource([ASYNC_TEXT_HELPER, RELAY_HELPER, entryFn(['return value="relay(t)"'], TEXT_INPUT, 'string')]),
  },
  'transitive-two-hops': {
    async: ['deep', 'fetchIt', 'relay'],
    source: () =>
      moduleSource([
        ASYNC_TEXT_HELPER,
        RELAY_HELPER,
        DEEP_HELPER,
        entryFn(['return value="deep(t)"'], TEXT_INPUT, 'string'),
      ]),
  },
});

test('the classification fixed point matches its golden table on every fixture', async () => {
  const observed = {};
  for (const name of Object.keys(FIXTURES).sort()) {
    const program = await linkedProgram(FIXTURES[name].source());
    observed[name] = [...linkedProgramAsyncHelpers(program.helpers)].sort();
  }
  assert.deepEqual(
    observed,
    Object.fromEntries(Object.keys(FIXTURES).sort().map((name) => [name, [...FIXTURES[name].async].sort()])),
    'RT5_CLASSIFICATION_DRIFT: the fixed point disagreed with its golden',
  );
});

test('classification is transitive: an async leaf makes every caller on the path async', async () => {
  const program = await linkedProgram(FIXTURES['transitive-two-hops'].source());
  const names = program.helpers.map((helper) => helper.name);
  assert.deepEqual(names, ['deep', 'fetchIt', 'relay']);
  for (const helper of program.helpers) {
    assert.equal(helper.async, true, `${helper.name} is on the path to a capability and must be async`);
  }
});

test('classification never leaks: a sibling that reaches no capability stays synchronous', async () => {
  const program = await linkedProgram(FIXTURES['diamond-reaches-one-async-leaf'].source());
  const byName = new Map(program.helpers.map((helper) => [helper.name, helper]));
  assert.equal(byName.get('echo').async, undefined, 'a helper with no reachable capability must stay synchronous');
  assert.equal(byName.get('deep').async, true);
});

function linkedShape(program) {
  return canonicalJson({
    entry: program.entry,
    format: program.format,
    helpers: program.helpers,
    program: program.program,
  });
}

test('classification is order-independent: declaration order changes neither the flags nor the shape', async () => {
  const entry = entryFn(['return value="deep(t)"'], TEXT_INPUT, 'string');
  const forward = await linkedProgram(moduleSource([ASYNC_TEXT_HELPER, RELAY_HELPER, DEEP_HELPER, entry]));
  const reversed = await linkedProgram(moduleSource([DEEP_HELPER, RELAY_HELPER, ASYNC_TEXT_HELPER, entry]));
  assert.deepEqual(
    [...linkedProgramAsyncHelpers(forward.helpers)].sort(),
    [...linkedProgramAsyncHelpers(reversed.helpers)].sort(),
  );
  assert.equal(linkedShape(forward), linkedShape(reversed), 'helper declaration order must not change the linked shape');
  assert.notEqual(
    forward.projectionArtifactSha256,
    reversed.projectionArtifactSha256,
    'the two fixtures really are different source texts, so the invariance above is not vacuous',
  );
});

test('the flag is omitted when false, so a synchronous helper costs the bytes it always cost', async () => {
  const program = await linkedProgram(FIXTURES['sync-only'].source());
  for (const helper of program.helpers) {
    assert.equal(
      Object.hasOwn(helper, 'async'),
      false,
      'RT5_CANONICALIZATION_DRIFT: a synchronous helper must not carry an async key at all',
    );
  }
  assert.equal(
    canonicalJson(program.helpers).includes('"async"'),
    false,
    'RT5_CANONICALIZATION_DRIFT: false must never be serialized',
  );
});

test('the flag is present and true exactly for the async helpers of a mixed program', async () => {
  const program = await linkedProgram(FIXTURES['diamond-reaches-one-async-leaf'].source());
  const serialized = canonicalJson(program.helpers);
  assert.equal((serialized.match(/"async":true/gu) ?? []).length, 3, 'exactly the three async helpers carry the flag');
  assert.equal(serialized.includes('"async":false'), false);
});
