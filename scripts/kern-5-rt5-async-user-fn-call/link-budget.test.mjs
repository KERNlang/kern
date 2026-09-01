import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BOOLEAN_FLAG,
  CAPABILITY_LINE,
  ENTRY,
  LIMITS,
  TEXT_INPUT,
  createLinkedKirClosureWalk,
  entryFn,
  linkVerifiedKernKirProgram,
  moduleSource,
  project,
} from './k0-support.mjs';

// Every nested call position asks the classifier about its callee, so a classifier that does not
// cache the helper it is asked *about* rescans that helper's whole statement tree once per call
// site. The probe helper is deliberately wide and referenced from two nested operands in each of
// `width` callers, which is the shape that turns the rescan quadratic.
function nestedProbeSource(width) {
  const helpers = [];
  for (let index = 0; index < width; index += 1) {
    helpers.push({ body: ['return value="flag"'], name: `l${index}`, parameters: BOOLEAN_FLAG, returns: 'boolean' });
  }
  const wideBody = [];
  for (let index = 0; index < width; index += 1) wideBody.push(`let name=a${index} value="l${index}(flag)"`);
  wideBody.push('return value="a0"');
  helpers.push({ body: wideBody, name: 'wide', parameters: BOOLEAN_FLAG, returns: 'boolean' });
  for (let index = 0; index < width; index += 1) {
    helpers.push({
      body: ['return value="wide(flag) && wide(flag)"'],
      name: `p${index}`,
      parameters: BOOLEAN_FLAG,
      returns: 'boolean',
    });
  }
  const entryBody = [];
  for (let index = 0; index < width; index += 1) entryBody.push(`let name=x${index} value="p${index}(flag)"`);
  entryBody.push('return value="x0"');
  return moduleSource([...helpers, entryFn(entryBody, BOOLEAN_FLAG, 'boolean')]);
}

function asyncFanSource(width) {
  const helpers = [];
  for (let index = 0; index < width; index += 1) {
    helpers.push({
      body: [CAPABILITY_LINE, 'return value="reply"'],
      name: `l${index}`,
      parameters: TEXT_INPUT,
      returns: 'string',
    });
  }
  const wideBody = [];
  for (let index = 0; index < width; index += 1) wideBody.push(`let name=a${index} value="l${index}(t)"`);
  wideBody.push('return value="a0"');
  helpers.push({ body: wideBody, name: 'wide', parameters: TEXT_INPUT, returns: 'string' });
  for (let index = 0; index < width; index += 1) {
    helpers.push({ body: ['return value="wide(t)"'], name: `c${index}`, parameters: TEXT_INPUT, returns: 'string' });
  }
  const entryBody = [];
  for (let index = 0; index < width; index += 1) entryBody.push(`let name=x${index} value="c${index}(t)"`);
  entryBody.push('return value="x0"');
  return moduleSource([...helpers, entryFn(entryBody, TEXT_INPUT, 'string')]);
}

async function linkedWalk(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the budget fixture must project');
  const walk = createLinkedKirClosureWalk();
  const linked = linkVerifiedKernKirProgram(verified, ENTRY, LIMITS, undefined, walk);
  assert.equal(linked.outcome, 'success', `link failed: ${linked.code}`);
  return { helpers: linked.program.helpers.length, walk };
}

test('the classification walk visits every helper of a nested-probe graph exactly once', async () => {
  for (const width of [4, 8]) {
    const { helpers, walk } = await linkedWalk(nestedProbeSource(width));
    assert.equal(helpers, 2 * width + 1, `width ${width}: the fixture must link every helper`);
    assert.equal(
      walk.visits,
      helpers,
      `RT5_CLOSURE_BUDGET: ${width} probes referencing one wide helper from two nested operands each must cost one scan per helper, observed ${walk.visits}`,
    );
    assert.equal(walk.cycles, 0, 'the fixture is acyclic, so no result is cycle-tainted');
  }
});

test('the classification walk stays linear as the nested-probe graph grows', async () => {
  const small = await linkedWalk(nestedProbeSource(4));
  const large = await linkedWalk(nestedProbeSource(8));
  assert.equal(
    large.walk.visits - small.walk.visits,
    large.helpers - small.helpers,
    'RT5_CLOSURE_BUDGET: doubling the graph must add exactly one scan per added helper',
  );
});

test('an async fan graph also costs exactly one scan per helper', async () => {
  for (const width of [4, 8]) {
    const { helpers, walk } = await linkedWalk(asyncFanSource(width));
    assert.equal(helpers, 2 * width + 1);
    assert.equal(walk.visits, helpers, `RT5_CLOSURE_BUDGET: observed ${walk.visits} scans for ${helpers} helpers`);
  }
});

test('the memo answers every helper, so the walk records one result per linked helper', async () => {
  const { helpers, walk } = await linkedWalk(nestedProbeSource(8));
  assert.equal(walk.done.size, helpers, 'every linked helper carries a cached classification');
  for (const cached of walk.done.values()) {
    assert.equal(cached, false, 'the nested-probe graph is entirely synchronous');
  }
});

test('a caller-supplied walk is optional and never changes the linked program', async () => {
  const verified = await project(nestedProbeSource(4));
  const withWalk = linkVerifiedKernKirProgram(verified, ENTRY, LIMITS, undefined, createLinkedKirClosureWalk());
  const withoutWalk = linkVerifiedKernKirProgram(verified, ENTRY, LIMITS);
  assert.equal(withWalk.outcome, 'success');
  assert.equal(withoutWalk.outcome, 'success');
  assert.equal(
    withWalk.program.sha256,
    withoutWalk.program.sha256,
    'observing the budget must not change what the linker produces',
  );
});
