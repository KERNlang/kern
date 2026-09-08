import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  CHECK_ABORT_SITES,
  NEW_STATEMENT_KINDS,
  TARGET_STATEMENT_KINDS,
  USER_THROW_CLASS,
} from './pins.mjs';
import {
  LIMITS,
  TRY_POSITIONS,
  TRY_TWINS,
  createLinkedKirClosureWalk,
  linkedStatementsCallDepth,
  linkedStatementsInvokeCapability,
  linkedThrowStatement,
  linkedTryStatement,
  occurrencesOf,
  repositoryText,
  runtimeEvaluator,
  tryArtifact,
} from './k0-support.mjs';

const CHILD_TIMEOUT_MS = 4000;

function walkChild(script) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    timeout: CHILD_TIMEOUT_MS,
  });
}

test('the linked statement union carries throw and try and no other new kind', () => {
  const contracts = repositoryText('packages/core/src/kir-runtime/linked-kir-program/contracts.ts');
  const union = contracts.slice(
    contracts.indexOf('export type LinkedKernKirStatement ='),
    contracts.indexOf('export function statementSubBlocks'),
  );
  assert.ok(union.length > 0, 'the statement union must be locatable');
  assert.deepEqual(
    [...union.matchAll(/readonly kind: '([a-z]+)'/gu)].map((match) => match[1]).sort(),
    [...TARGET_STATEMENT_KINDS],
    'D_UNION_DRIFT: the linked statement union must be exactly the ten base kinds plus throw and try',
  );
  for (const kind of ['each', 'set', 'with', 'do', 'catch', 'finally']) {
    assert.equal(
      union.includes(`kind: '${kind}'`),
      false,
      `D_SCOPE_CREEP: ${kind} must stay outside the linked statement union`,
    );
  }
});

// `catch` and `finally` are clauses of a `try`, never union members of their own: the union gains
// two kinds, not four. A `finallyBody` on the `try` member is what carries the third block.
test('catch and finally are try clauses, not union members, so the union gains exactly two kinds', () => {
  const contracts = repositoryText('packages/core/src/kir-runtime/linked-kir-program/contracts.ts');
  const union = contracts.slice(
    contracts.indexOf('export type LinkedKernKirStatement ='),
    contracts.indexOf('export function statementSubBlocks'),
  );
  const kinds = [...union.matchAll(/readonly kind: '([a-z]+)'/gu)].map((match) => match[1]);
  assert.equal(kinds.length - (TARGET_STATEMENT_KINDS.length - NEW_STATEMENT_KINDS.length), 2);
  for (const field of ['catchBody', 'finallyBody']) {
    assert.ok(union.includes(field), `D_CLAUSE_MODEL: the try member must carry ${field} as a clause block`);
  }
});

test('StatementWalkResult gains a threw variant, so an uncaught throw is a completion not an exception', () => {
  const source = repositoryText('packages/core/src/kir-runtime/expression.ts');
  const result = source.slice(
    source.indexOf('export type StatementWalkResult ='),
    source.indexOf('export interface StatementWalkPolicy'),
  );
  assert.ok(result.length > 0, 'StatementWalkResult must be locatable');
  assert.ok(
    result.includes("kind: 'threw'"),
    "D_CARRIER_MISSING: StatementWalkResult must gain { kind: 'threw'; value } -- a return value of the walk, never a host throw",
  );
  assert.ok(result.includes('value: KernKirValue'), 'D_CARRIER_MISSING: the threw variant must carry the payload');
});

test('WalkFrame gains a trap field and TryTrap carries the binding and both clause bodies', () => {
  const source = repositoryText('packages/core/src/kir-runtime/expression.ts');
  const frame = source.slice(source.indexOf('interface WalkFrame'), source.indexOf('function loopContinues'));
  assert.ok(frame.length > 0, 'WalkFrame must be locatable');
  assert.ok(
    frame.includes('trap:'),
    'D_FRAME_MODEL: WalkFrame must gain a trap field, so a try body is a frame carrying its handler',
  );
  assert.ok(
    source.includes('TryTrap'),
    'D_FRAME_MODEL: TryTrap must exist and hold the binding, the catch body and the finally body',
  );
  for (const field of ['binding', 'catchBody', 'finallyBody']) {
    assert.ok(source.includes(field), `D_FRAME_MODEL: TryTrap must carry ${field}`);
  }
});

test('clampThrowLabel is exported from the RT-1 evaluator, so both legs can share one label rule', () => {
  const evaluator = runtimeEvaluator();
  assert.equal(
    typeof evaluator.clampThrowLabel,
    'function',
    'D_LABEL_HELPER_MISSING: kir-runtime/expression.ts must export clampThrowLabel so the JS leg can mirror it',
  );
});

// D-2e's bounded scan, and the RT12J-TD17 row for the try family: a throw with no trap frame must
// return `'threw'` and TERMINATE. Driven in a throwaway child because no in-process guard can bound
// a frame-search bug that calls neither `meter.step()` nor `checkAbort()`.
test('a throw with no trap frame returns threw and terminates instead of spinning unmetered', () => {
  const child = walkChild(`
    const { walkStatements, ENTRY_WALK_POLICY } = await import('./packages/core/dist/kir-runtime/expression.js');
    const { RuntimeMeter } = await import('./packages/core/dist/kir-runtime/inspect.js');
    const support = await import('./scripts/kern-5-d-linked-try/k0-support.mjs');
    const handler = { parameters: [], returnType: { kind: 'integer' }, statements: [support.linkedThrowStatement()] };
    const runtime = { asyncHelpers: new Set(), checkAbort: () => {}, events: [], helpers: undefined, maxEvents: 32 };
    const walk = walkStatements(handler, new Map(), new RuntimeMeter(${JSON.stringify(LIMITS)}), runtime, ENTRY_WALK_POLICY);
    const step = walk.next({ tag: 'boolean', value: false });
    process.stdout.write(JSON.stringify({ done: step.done, kind: step.value && step.value.kind }));
  `);
  assert.notEqual(
    child.signal,
    'SIGTERM',
    'D_UNBOUNDED_SCAN: the trap-frame search did not terminate; a pop() loop on an empty stack is the RT12J-TD17 defect',
  );
  assert.equal(
    child.status,
    0,
    `D_CARRIER_MISSING: driving a hand-built throw through walkStatements failed: ${child.stderr.split('\n')[0]}`,
  );
  assert.deepEqual(
    JSON.parse(child.stdout),
    { done: true, kind: 'threw' },
    "D_CARRIER_MISSING: an uncaught throw must complete the walk with { kind: 'threw' }, not hang and not fault",
  );
});

// D-2f(i). Unreachable through a compiled program, so it can only be driven directly -- and it still
// needs a fail-closed row, because `walkStatements` is exported and this suite drives it.
test('callHelper given a walk that completes threw faults closed with KIR_TRY_FAMILY_IN_HELPER', () => {
  const source = repositoryText('packages/core/src/kir-runtime/expression.ts');
  const helper = source.slice(source.indexOf('function callHelper'), source.indexOf('export function evaluateExpression'));
  assert.ok(helper.length > 0, 'callHelper must be locatable');
  assert.ok(
    helper.includes("'threw'"),
    "D_FAIL_OPEN: callHelper must name the 'threw' completion, or a user throw escaping a helper is silently dropped",
  );
  assert.ok(
    helper.includes('KIR_TRY_FAMILY_IN_HELPER'),
    'D_FAIL_OPEN: callHelper must fail closed with KIR_TRY_FAMILY_IN_HELPER on a threw completion',
  );
});

// D-2f(ii). The async driver's own arm, distinct from callHelper's: a popped helper frame that
// completed `'threw'` must fault, and the entry walk's own threw must convert to uncaught-throw.
test('the async driver converts an entry threw and fails closed on a helper threw', () => {
  const source = repositoryText('packages/core/src/kir-runtime/execute.ts');
  const frames = source.slice(source.indexOf('const runFrames'), source.indexOf('return await runFrames()'));
  assert.ok(frames.length > 0, 'runFrames must be locatable');
  assert.ok(
    frames.includes("'threw'"),
    "D_FAIL_OPEN: runFrames must name the 'threw' completion on both the entry and the helper arm",
  );
  assert.ok(
    frames.includes('uncaught-throw'),
    'D_UNCAUGHT_UNWIRED: the entry walk threw must convert to a KernKirFault carrying uncaught-throw',
  );
  assert.ok(
    frames.includes('KIR_TRY_FAMILY_IN_HELPER'),
    'D_FAIL_OPEN: a popped helper frame that completed threw must fault closed',
  );
});

// D-5b. GREEN at base and must stay GREEN: the whole-file count is pinned in two prior suites and D
// adds no third observation point.
test('the RT-1 evaluator still carries exactly two checkAbort sites, and the try family adds none', () => {
  const source = repositoryText('packages/core/src/kir-runtime/expression.ts');
  assert.equal(
    occurrencesOf(source, 'checkAbort()'),
    CHECK_ABORT_SITES,
    'D_CHECKPOINT_CREEP: the statement-boundary and loop-head checkpoints are the only two RT-1 may carry',
  );
});

// D-6a. The two visitors are dispatched from `compileBlock` alongside `for`/`while`/`if`, never as
// `assertLeaf` exemptions -- which is observable only through the label path: a refusal attributed
// to a clause body proves the clause was compiled by the ordinary block route.
test('compileBlock dispatches try to a dedicated visitor rather than exempting it from assertLeaf', () => {
  const statements = repositoryText('packages/core/src/kir-runtime/linked-kir-program/statements.ts');
  const block = statements.slice(statements.indexOf('export function compileBlock'));
  assert.ok(block.length > 0, 'compileBlock must be locatable');
  assert.ok(
    block.includes("kind === 'try'"),
    'D_ROUTE_GAP: compileBlock must dispatch try to compileTry alongside for, while and if',
  );
  for (const visitor of ['compileTry', 'compileCatch']) {
    assert.ok(statements.includes(visitor), `D_ROUTE_GAP: ${visitor} must be a dedicated visitor in statements.ts`);
  }
  const compileStatement = statements.slice(
    statements.indexOf('function compileStatement'),
    statements.indexOf('function compileBranch'),
  );
  assert.ok(
    compileStatement.includes("kind === 'throw'"),
    'D_ROUTE_GAP: compileThrow belongs on the ordinary statement route, because throw is a leaf',
  );
});

// D-4c is OBSOLETE, and this row is what keeps it that way. D.0's `9f366f0b` single-sourced
// `containsReturn`'s traversal onto `statementSubBlocks`, so the walker names no block-owning kind
// of its own: the `try` arm D adds to `statementSubBlocks` for D-6e gives `containsReturn` its
// recursion for free. One edit closes the void-handler hazard, not two -- and if a later slice
// re-inlines a kind here, the hazard silently reopens on the next statement kind.
test('containsReturn stays delegated to statementSubBlocks and re-learns no kind inline', () => {
  const source = repositoryText('packages/core/src/kir-runtime/linked-kir-program/link-support.ts');
  const walker = source.slice(source.indexOf('export function containsReturn'), source.indexOf('export function assertLeaf'));
  assert.ok(walker.length > 0, 'containsReturn must be locatable');
  const kinds = [...new Set([...walker.matchAll(/statement\.kind === '([a-z]+)'/gu)].map((match) => match[1]))].sort();
  assert.deepEqual(
    kinds,
    ['return'],
    'D_WALKER_RE_INLINED: containsReturn must delegate every block-owning kind to statementSubBlocks, or D owes it a try arm of its own',
  );
  assert.ok(
    walker.includes('statementSubBlocks'),
    'D_WALKER_RE_INLINED: the traversal must stay single-sourced, which is what makes the try arm free',
  );
});

// The loudly-breaking prior-slice scrape, relocated by the same refactor: rt12 now pins
// `statementSubBlocks` to exactly ['for','if','while'] and asserts it "must not learn a kind that
// owns no block". `try` owns three, so that list -- not the containsReturn one the spec predicted --
// is the assertion D moves.
test('rt12 own statementSubBlocks pin gains try, which is the scrape the refactor relocated', () => {
  const rt12 = repositoryText('scripts/kern-5-rt12-linked-jumps/walker-coverage.test.mjs');
  assert.ok(
    rt12.includes("['for', 'if', 'try', 'while']"),
    'D_PRIOR_PIN_STALE: rt12 statementSubBlocks kind list must gain try, a genuinely block-owning kind',
  );
  assert.ok(
    rt12.includes("['return']"),
    'D_PRIOR_PIN_STALE: rt12 must keep pinning containsReturn as delegated, which D does not change',
  );
});

// The two semantic walkers, driven on hand-built statements so a hole is attributable to the walker
// rather than to the linker's route.
test('both semantic walkers traverse a hand-built try without throwing and reach its clause bodies', () => {
  const statement = linkedTryStatement({ catchBody: [linkedThrowStatement()] });
  let depth;
  try {
    depth = linkedStatementsCallDepth([statement]);
  } catch (error) {
    assert.fail(
      `D_WALKER_HOLE: the call-depth walker walked a hole on a try -- statementSubExpressions returned [undefined]: ${error.message}`,
    );
  }
  assert.equal(depth, 0, 'D_WALKER_HOLE: a try carrying no call must measure zero');
  const walk = createLinkedKirClosureWalk();
  try {
    linkedStatementsInvokeCapability([statement], undefined, walk);
  } catch (error) {
    assert.fail(
      `D_WALKER_HOLE: the capability closure walk walked a hole on a try instead of traversing it: ${error.message}`,
    );
  }
});

test('the Python statement deferral switch keeps its never guard and names throw and try explicitly', () => {
  const request = repositoryText('packages/core/src/compiler/kir-python/request.ts');
  const walker = request.slice(request.indexOf('function statementDeferral'), request.indexOf('function statementsDeferral'));
  assert.ok(walker.length > 0, 'statementDeferral must be locatable');
  assert.ok(walker.includes('const exhaustive: never = statement'), 'D_TRIPWIRE_LOST: the never guard is gone');
  for (const kind of NEW_STATEMENT_KINDS) {
    assert.ok(walker.includes(`case '${kind}':`), `D_PY_ARM_MISSING: statementDeferral must name ${kind}`);
  }
});

// D-2b0. One emit entrypoint, one `__module()`, every helper inlined, one literal-typed 'entry.mjs',
// so the nominal `instanceof` cannot meet a cross-realm class. Measured on a program that has a
// throw, a try AND helpers, which is the only shape that could have falsified it.
test('the emitted module for a throw, a try and helpers declares exactly one __UserThrow class', async () => {
  const artifact = await tryArtifact(TRY_POSITIONS['try-payload-helper-call']());
  assert.equal(
    occurrencesOf(artifact.text, `class ${USER_THROW_CLASS}`),
    1,
    `D_CLASS_IDENTITY: exactly one ${USER_THROW_CLASS} class must exist per artifact, or instanceof is unsound`,
  );
  assert.equal(
    artifact.path,
    'entry.mjs',
    'D_ARTIFACT_SPLIT: the manifest must name exactly one artifact, so there is no cross-artifact realm',
  );
});

test('the JavaScript block dispatcher emits a native try and a nominal guard rather than a signal object', async () => {
  const artifact = await tryArtifact(TRY_POSITIONS['try-catch-caught-throw']());
  assert.ok(artifact.text.includes('try {') || artifact.text.includes('try{'), 'D_LOWERING_SHAPE: a native try must be emitted');
  assert.ok(artifact.text.includes('catch('), 'D_LOWERING_SHAPE: a native catch clause must be emitted');
  assert.equal(
    occurrencesOf(artifact.text, `instanceof ${USER_THROW_CLASS}`),
    1,
    `D_LOWERING_SHAPE: each catch clause must guard with instanceof ${USER_THROW_CLASS}, never a field check`,
  );
  // Zero, per the acceptance criterion: the kernel spells `class __Fault extends Error`, so the token
  // `extends __Fault` occurs nowhere at all -- which is the property the row exists to hold.
  assert.equal(
    occurrencesOf(artifact.text, `extends __Fault`),
    0,
    'D_CARRIER_CONFUSED: __Fault is the only class extending Error, and nothing may extend __Fault',
  );
  assert.equal(
    artifact.text.includes(`${USER_THROW_CLASS} extends`),
    false,
    `D_CARRIER_CONFUSED: ${USER_THROW_CLASS} must be a bare nominal class`,
  );
});

// The other half of D-2b's conditional emission, and the half that keeps D.0's fifteen
// behaviour-preservation fixtures byte-identical. GREEN at base, and the row that would go RED if
// the prelude were emitted unconditionally.
test('a program with no throw and no try carries no __UserThrow token at all', async () => {
  const artifact = await tryArtifact(TRY_TWINS['twin-leaf']());
  assert.equal(
    artifact.text.includes(USER_THROW_CLASS),
    false,
    `D_UNCONDITIONAL_EMISSION: ${USER_THROW_CLASS} must be emitted only for programs that carry a throw or a try`,
  );
});
