import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POSITIONS,
  SHAPE_NAMES,
  between,
  linkedContracts,
  linkedEntryStatements,
  occurrencesOf,
  repositoryText,
  statementKinds,
} from './k0-support.mjs';
import { CHECK_ABORT_SITES, STATEMENT_KINDS_AFTER_F } from './pins.mjs';

const CONTRACTS = 'packages/core/src/kir-runtime/linked-kir-program/contracts.ts';
const WALKER = 'packages/core/src/kir-runtime/statement-walker.ts';
const REQUEST = 'packages/core/src/compiler/kir-python/request.ts';

function union() {
  return between(repositoryText(CONTRACTS), 'export type LinkedKernKirStatement', 'export ', 'the linked union');
}

test('the linked statement union is still exactly the fourteen kinds slice E leaves behind', () => {
  const kinds = [...union().matchAll(/kind: '([a-z-]+)'/gu)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(kinds)].sort(),
    [...STATEMENT_KINDS_AFTER_F],
    'F_UNION_DRIFT: `with` is expanded at link and must never become a fifteenth linked kind',
  );
});

test('no consumer of the union learns a with arm', () => {
  for (const path of [CONTRACTS, WALKER, REQUEST]) {
    assert.equal(
      /kind === 'with'|\bwith: '(?:lowered|deferred)'/u.test(repositoryText(path)),
      false,
      `F_KIND_LEAKED: ${path} dispatches on a linked with kind, which the expansion must make impossible`,
    );
  }
});

test('statementSubBlocks and statementSubExpressions keep their exported surface and gain no with arm', () => {
  const contracts = linkedContracts();
  assert.ok('statementSubBlocks' in contracts, 'F_SURFACE_LOST: statementSubBlocks must stay exported');
  const source = repositoryText(CONTRACTS);
  for (const marker of ['export function statementSubBlocks(', 'export function statementSubExpressions(']) {
    const region = between(source, marker, '\n}\n', marker);
    assert.equal(region.includes("'with'"), false, `F_KIND_LEAKED: ${marker} must not name a with kind`);
  }
});

// The core structural claim. Every `with` fixture and its hand-written expansion twin must link to
// the SAME entry handler, statement for statement -- which is simultaneously the metering guarantee,
// the behaviour guarantee and the proof that no target ever sees a `with`.
for (const shape of SHAPE_NAMES) {
  test(`the ${shape} with expands to exactly its hand-written let/try/finally twin`, async () => {
    const expanded = await linkedEntryStatements(POSITIONS[`with-${shape}`]());
    const twin = await linkedEntryStatements(POSITIONS[`twin-${shape}`]());
    assert.deepEqual(
      expanded,
      twin,
      `F_EXPANSION_DRIFT: the ${shape} with does not link to the same statements as its expansion twin`,
    );
  });
}

test('a linked with carries no with kind anywhere in the entry handler', async () => {
  for (const shape of SHAPE_NAMES) {
    const kinds = statementKinds(await linkedEntryStatements(POSITIONS[`with-${shape}`]()));
    assert.equal(
      kinds.includes('with'),
      false,
      `F_KIND_LEAKED: the linked ${shape} fixture still carries a with statement`,
    );
    for (const kind of kinds) {
      assert.ok(
        STATEMENT_KINDS_AFTER_F.includes(kind),
        `F_KIND_LEAKED: the linked ${shape} fixture carries the unknown kind ${kind}`,
      );
    }
  }
});

// The shape at the position, not merely somewhere in the program: the `let` must be the statement
// the `with` replaced, the `try` must be its immediate successor, the body must sit under try.body
// and the cleanup must be a `do` in the finally with an empty catch.
test('the expansion is a let then a finally-bearing try with an empty catch, in place', async () => {
  const statements = await linkedEntryStatements(POSITIONS['with-fallthrough']());
  assert.equal(statements[0].kind, 'let', 'F_EXPANSION_SHAPE: the accumulator let must stay first');
  const bind = statements[1];
  assert.equal(bind.kind, 'let', 'F_EXPANSION_SHAPE: the with binding must lower to a let at the with position');
  assert.equal(bind.name, 'r', 'F_EXPANSION_SHAPE: the let must carry the with name');
  const guard = statements[2];
  assert.equal(guard.kind, 'try', 'F_EXPANSION_SHAPE: the with body must lower to a try immediately after the let');
  assert.deepEqual([...guard.catchBody], [], 'F_EXPANSION_SHAPE: the expansion catch must be empty');
  assert.equal(guard.binding, undefined, 'F_EXPANSION_SHAPE: the expansion try must bind no catch payload');
  assert.ok(Array.isArray(guard.finallyBody), 'F_EXPANSION_SHAPE: the expansion must be finally-bearing');
  assert.equal(guard.finallyBody.length, 1, 'F_EXPANSION_SHAPE: the finally must hold exactly the cleanup');
  assert.equal(guard.finallyBody[0].kind, 'do', 'F_EXPANSION_SHAPE: the cleanup must lower to a do');
  assert.equal(
    guard.finallyBody[0].value.kind,
    'user-call',
    'F_EXPANSION_SHAPE: the cleanup do must carry the user call the surface named',
  );
  assert.equal(
    statementKinds(guard.body).includes('do'),
    true,
    'F_EXPANSION_SHAPE: the with body must be the try body, not a sibling',
  );
});

test('a nested with expands innermost-first, so the inner try is inside the outer try body', async () => {
  const statements = await linkedEntryStatements(POSITIONS['with-nested']());
  const outer = statements.find((statement) => statement.kind === 'try');
  assert.ok(outer !== undefined, 'F_EXPANSION_SHAPE: the outer with must lower to a try');
  const innerLet = outer.body.find((statement) => statement.kind === 'let' && statement.name === 's');
  assert.ok(innerLet !== undefined, 'F_EXPANSION_SHAPE: the inner binding must live inside the outer try body');
  const inner = outer.body.find((statement) => statement.kind === 'try');
  assert.ok(inner !== undefined, 'F_EXPANSION_SHAPE: the inner with must lower to a try inside the outer one');
  assert.equal(inner.finallyBody?.length, 1, 'F_EXPANSION_SHAPE: the inner cleanup must be its own finally');
});

// QF-2, the creep guard: `with` reuses the statement boundary and the finally-bearing try frame, so
// neither runtime file may gain a checkpoint.
test('the checkAbort census does not move', () => {
  for (const [path, expected] of Object.entries(CHECK_ABORT_SITES)) {
    assert.equal(
      occurrencesOf(repositoryText(path), 'checkAbort()'),
      expected,
      `F_CHECKPOINT_CREEP: ${path} must keep exactly ${expected} checkAbort sites`,
    );
  }
});
