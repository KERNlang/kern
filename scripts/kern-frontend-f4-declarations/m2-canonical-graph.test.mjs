import assert from 'node:assert/strict';
import test from 'node:test';

import { runModuleSet } from './worker.mjs';

const rejectedModule = (moduleId) => ({
  moduleId,
  source: 'page route="/missing-name"\n',
});

const moduleWithUses = (moduleId, targets) => ({
  moduleId,
  source: `${targets.map((target) => `use path="./${target.replace(/\.kern$/u, '')}"`).join('\n')}\nfn name=main export=true\n`,
});

function graphFields(result) {
  return result.fields.slice(2, 7);
}

test('M2 format fence advances the canonical graph result to explicit .4', () => {
  const result = runModuleSet([
    { moduleId: 'main.kern', source: 'fn name=main export=true\n' },
  ]);
  assert.equal(result.receipt.header.format, 'kern.frontend.f4-module-set.4');
});

test('M2 canonical graph fields are independent of request order', () => {
  const provider = { moduleId: 'provider.kern', source: 'fn name=x export=true\n' };
  const middle = {
    moduleId: 'middle.kern',
    source: 'use path="./provider"\n  from name=x as=y export=true\nfn name=middle export=true\n',
  };
  const consumer = {
    moduleId: 'consumer.kern',
    source: 'use path="./middle"\n  from name=y\nfn name=consumer export=true\n',
  };
  const forward = runModuleSet([provider, middle, consumer]);
  const reversed = runModuleSet([consumer, middle, provider]);

  assert.deepEqual(graphFields(reversed), graphFields(forward));
  assert.notDeepEqual(
    reversed.receipt.header.inputIdentityTape,
    forward.receipt.header.inputIdentityTape,
    'request-order identity remains an independent commitment',
  );
});

test('M2 rejected rows sort by canonical module ID', () => {
  const receipt = runModuleSet([
    rejectedModule('z-rejected.kern'),
    rejectedModule('a-rejected.kern'),
  ]).receipt;
  assert.deepEqual(receipt.rejected.map(({ moduleId }) => moduleId), [
    'a-rejected.kern',
    'z-rejected.kern',
  ]);
});

test('M2 blocked rows carry the lexicographically smallest reachable rejected dependency', () => {
  const receipt = runModuleSet([
    rejectedModule('z-rejected.kern'),
    rejectedModule('a-rejected.kern'),
    moduleWithUses('path.kern', ['a-rejected.kern']),
    moduleWithUses('importer.kern', ['z-rejected.kern', 'path.kern']),
  ]).receipt;
  const reasons = new Map(receipt.blocked.map((row) => [row.moduleId, row.rejectedDependency]));

  assert.equal(reasons.get('path.kern'), 'a-rejected.kern');
  assert.equal(reasons.get('importer.kern'), 'a-rejected.kern');
});

test('M2 whole-graph SCC propagation canonicalizes a cyclic blocked component', () => {
  const receipt = runModuleSet([
    rejectedModule('z-rejected.kern'),
    rejectedModule('a-rejected.kern'),
    moduleWithUses('x.kern', ['z-rejected.kern', 'y.kern']),
    moduleWithUses('y.kern', ['a-rejected.kern', 'x.kern']),
  ]).receipt;
  const reasons = new Map(receipt.blocked.map((row) => [row.moduleId, row.rejectedDependency]));

  assert.equal(reasons.get('x.kern'), 'a-rejected.kern');
  assert.equal(reasons.get('y.kern'), 'a-rejected.kern');
  assert.equal(receipt.linkFacts.some(({ code }) => code === 'module-cycle'), false);
});

test('M2 emits real SCC members and one sourced cycle fact per cyclic V component', () => {
  const receipt = runModuleSet([
    moduleWithUses('b.kern', ['a.kern']),
    moduleWithUses('a.kern', ['b.kern']),
    { moduleId: 'c.kern', source: 'fn name=c export=true\n' },
  ]).receipt;

  for (const component of receipt.validatedComponents) {
    assert.equal(typeof component.componentMinimumId, 'string');
    assert.ok(Array.isArray(component.members));
  }
  assert.deepEqual(receipt.validatedComponents.map(({ componentMinimumId, members }) => ({
    componentMinimumId,
    members: members.map(({ moduleId }) => moduleId),
  })), [
    { componentMinimumId: 'a.kern', members: ['a.kern', 'b.kern'] },
    { componentMinimumId: 'c.kern', members: ['c.kern'] },
  ]);
  const cycles = receipt.linkFacts.filter(({ code }) => code === 'module-cycle');
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].moduleId, 'b.kern');
  assert.equal(cycles[0].detail, 'a.kern');
  assert.ok(Number.isSafeInteger(cycles[0].logicalOrdinal));
  assert.ok(Number.isSafeInteger(cycles[0].startScalar));
});

test('M2 resolved bindings retain authenticated source positions', () => {
  const receipt = runModuleSet([
    {
      moduleId: 'provider.kern',
      source: 'fn name=x export=true\nfn name=y export=true\n',
    },
    {
      moduleId: 'main.kern',
      source: 'use path="./provider"\n  from name=x\n  from name=y\nfn name=main export=true\n',
    },
  ]).receipt;

  assert.equal(receipt.status, 'linked');
  assert.equal(receipt.bindings.length, 2);
  assert.ok(receipt.bindings.every(({ logicalOrdinal, startScalar }) =>
    Number.isSafeInteger(logicalOrdinal) && Number.isSafeInteger(startScalar)));
  assert.notEqual(receipt.bindings[0].logicalOrdinal, receipt.bindings[1].logicalOrdinal);
  assert.ok(receipt.bindings[0].startScalar < receipt.bindings[1].startScalar);
});
