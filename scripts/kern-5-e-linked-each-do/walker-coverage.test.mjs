import assert from 'node:assert/strict';
import test from 'node:test';

import { between, linkedContracts, occurrencesOf, repositoryText, runtimeWalker } from './k0-support.mjs';
import { STATEMENT_KINDS_AFTER_E } from './pins.mjs';

const WALKER = 'packages/core/src/kir-runtime/statement-walker.ts';
const CONTRACTS = 'packages/core/src/kir-runtime/linked-kir-program/contracts.ts';

function walkerSource() {
  return repositoryText(WALKER);
}

test('the linked statement union is exactly the fourteen kinds slice E leaves behind', () => {
  const source = repositoryText(CONTRACTS);
  const union = between(source, 'export type LinkedKernKirStatement', 'export ', 'the linked statement union');
  const kinds = [...union.matchAll(/kind: '([a-z-]+)'/gu)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(kinds)].sort(),
    [...STATEMENT_KINDS_AFTER_E],
    'E_UNION_DRIFT: the linked statement union is not the fourteen kinds slice E leaves behind',
  );
});

test('the walk dispatches every one of the fourteen kinds', () => {
  const source = walkerSource();
  for (const kind of STATEMENT_KINDS_AFTER_E) {
    if (kind === 'return') continue;
    assert.ok(
      source.includes(`statement.kind === '${kind}'`),
      `E_WALKER_GAP: the walk has no arm for statement kind ${kind}`,
    );
  }
  assert.ok(source.includes("statement.kind !== 'return'"), 'E_WALKER_GAP: return is the trailing else arm');
});

// The creep guard. Both checkpoint sites are pre-E and slice E must add neither a third one nor a
// second loop head: `each` reuses enterTrip, and `do` reuses the statement boundary.
test('the walk still carries exactly two checkAbort sites', () => {
  assert.equal(
    occurrencesOf(walkerSource(), 'checkAbort()'),
    2,
    'E_CHECKPOINT_CREEP: the statement-boundary and loop-head checkpoints are the only two',
  );
});

test('each reuses enterTrip rather than adding a second trip charge', () => {
  const source = walkerSource();
  const enterTrip = between(source, 'const enterTrip = ', 'const settle = ', 'the loop-head site');
  assert.equal(occurrencesOf(enterTrip, 'meter.step()'), 1, 'E_TRIP_CHARGE: the loop head charges exactly once');
  assert.equal(occurrencesOf(source, 'const enterTrip = '), 1, 'E_TRIP_CHARGE: there is one loop head, not two');
  assert.ok(
    enterTrip.includes("loop.kind === 'each'"),
    'E_EACH_TRIP: the shared loop head must bind the each item, not a private each-only head',
  );
});

test('the loop state union carries exactly the three loop forms', () => {
  const source = walkerSource();
  const union = between(source, 'type LoopState =', ';', 'the loop state union');
  assert.deepEqual(
    union
      .replace('type LoopState =', '')
      .split('|')
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .sort(),
    ['EachLoopState', 'ForLoopState', 'WhileLoopState'],
    'E_LOOP_STATE_DRIFT: the loop state union is not the three loop forms',
  );
});

// No derived type on the node. The element type is a link-time check, and a stored copy can only
// skew against the value the walk actually binds.
test('the each node stores no element type', () => {
  const source = repositoryText(CONTRACTS);
  const union = between(source, 'export type LinkedKernKirStatement', 'export ', 'the linked statement union');
  const eachAt = union.indexOf("kind: 'each'");
  assert.ok(eachAt >= 0, 'E_UNION_DRIFT: the union has no each member');
  const member = union.slice(union.lastIndexOf('|', eachAt), union.indexOf('}', eachAt));
  assert.equal(
    /elementType|itemType/u.test(member),
    false,
    'E_DERIVED_ON_NODE: the each node must not carry a derived element type',
  );
});

test('the built walker exports the walk and both policies', () => {
  const walker = runtimeWalker();
  for (const name of ['walkStatements', 'ENTRY_WALK_POLICY', 'HELPER_WALK_POLICY', 'WALK_SEED']) {
    assert.ok(name in walker, `E_SURFACE_LOST: statement-walker.js must export ${name}`);
  }
  assert.ok('statementSubBlocks' in linkedContracts(), 'E_SURFACE_LOST: statementSubBlocks must stay exported');
});

// statementSubBlocks is what every closure walker recurses through. An `each` body that is not
// listed there is invisible to the capability, call-depth and try-family walks at once.
test('statementSubBlocks reaches the each body', () => {
  const source = repositoryText(CONTRACTS);
  const region = between(source, 'export function statementSubBlocks(', '\n}\n', 'statementSubBlocks');
  assert.ok(
    region.includes("'each'"),
    'E_SUBBLOCK_GAP: statementSubBlocks must name the each kind so every closure walk reaches its body',
  );
});
