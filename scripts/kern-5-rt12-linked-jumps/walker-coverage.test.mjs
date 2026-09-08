import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ENTRY_WALK_POLICY, WALK_SEED, walkStatements } from '../../packages/core/dist/kir-runtime/expression.js';
import { RuntimeMeter } from '../../packages/core/dist/kir-runtime/inspect.js';
import { emitJavaScriptEsm } from '../../packages/core/dist/compiler/kir-js-esm/emitter.js';
import {
  KIR_PYTHON_STATEMENT_LOWERING,
  pythonLoweringDeferral,
} from '../../packages/core/dist/compiler/kir-python/request.js';
import {
  JUMP_POSITIONS,
  LIMITS,
  assertJumpAdmitted,
  assertLinkLabel,
  createLinkedKirClosureWalk,
  handBuiltLinkedProgram,
  handBuiltManifestBase,
  linkedBreakStatement,
  linkedCallStatement,
  linkedCapabilityStatement,
  linkedContinueStatement,
  linkedForStatement,
  linkedIntegerReturn,
  linkedStatementsCallDepth,
  linkedStatementsInvokeCapability,
  linkedUserCall,
} from './k0-support.mjs';

const CONTRACTS_URL = new URL('../../packages/core/src/kir-runtime/linked-kir-program/contracts.ts', import.meta.url);
const LINK_URL = new URL('../../packages/core/src/kir-runtime/linked-kir-program/link.ts', import.meta.url);
const REQUEST_URL = new URL('../../packages/core/src/compiler/kir-python/request.ts', import.meta.url);
const EXPRESSION_DIST_URL = new URL('../../packages/core/dist/kir-runtime/expression.js', import.meta.url);
const INSPECT_DIST_URL = new URL('../../packages/core/dist/kir-runtime/inspect.js', import.meta.url);

// A frame-search bug with no `meter.step()` of its own spins the host CPU with no yield point at
// all, so no in-process guard (a step budget, an abort signal) can bound it: only an OS-level kill
// can. The walk runs in a throwaway child process for exactly this one property.
const WALK_CHILD_TIMEOUT_MS = 2_000;

function walkChildDriverSource() {
  return [
    `import { walkStatements, ENTRY_WALK_POLICY, WALK_SEED } from ${JSON.stringify(EXPRESSION_DIST_URL.href)};`,
    `import { RuntimeMeter } from ${JSON.stringify(INSPECT_DIST_URL.href)};`,
    `import { readFile, writeFile } from 'node:fs/promises';`,
    `const [, , inputPath, outputPath] = process.argv;`,
    `const statements = JSON.parse(await readFile(inputPath, 'utf8'));`,
    `const handler = Object.freeze({`,
    `  parameters: Object.freeze([]),`,
    `  returnType: Object.freeze({ kind: 'integer' }),`,
    `  statements: Object.freeze(statements),`,
    `});`,
    `const meter = new RuntimeMeter(${JSON.stringify(LIMITS)});`,
    `const runtime = {`,
    `  asyncHelpers: new Set(),`,
    `  checkAbort: () => {},`,
    `  events: [],`,
    `  helpers: undefined,`,
    `  maxEvents: ${LIMITS.maxEvents},`,
    `};`,
    `let outcome;`,
    `try {`,
    `  const walk = walkStatements(handler, new Map(), meter, runtime, ENTRY_WALK_POLICY);`,
    `  const step = walk.next(WALK_SEED);`,
    `  outcome = { caught: false, done: step.done, value: step.value };`,
    `} catch (error) {`,
    `  outcome = { caught: true, code: error && error.code, message: error && error.message, name: error && error.name };`,
    `}`,
    `await writeFile(outputPath, JSON.stringify(outcome));`,
  ].join('\n');
}

async function walkStatementsInChild(statements) {
  const directory = await mkdtemp(join(tmpdir(), 'kern-rt12j-walk-'));
  try {
    const driverPath = join(directory, 'driver.mjs');
    const inputPath = join(directory, 'input.json');
    const outputPath = join(directory, 'output.json');
    await Promise.all([
      writeFile(driverPath, walkChildDriverSource()),
      writeFile(inputPath, JSON.stringify(statements)),
    ]);
    const run = spawnSync(process.execPath, [driverPath, inputPath, outputPath], {
      encoding: 'utf8',
      timeout: WALK_CHILD_TIMEOUT_MS,
    });
    assert.equal(
      run.signal,
      null,
      `RT12J_JUMP_UNMETERED_HANG: the walk did not return within ${WALK_CHILD_TIMEOUT_MS}ms and was killed`,
    );
    assert.equal(run.status, 0, `walk child failed: ${run.stderr}`);
    return JSON.parse(await readFile(outputPath, 'utf8'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const JUMPS = Object.freeze([
  ['break', linkedBreakStatement],
  ['continue', linkedContinueStatement],
]);

const PLAIN_BODY = Object.freeze([
  Object.freeze({ kind: 'assign', target: 'acc', value: Object.freeze({ kind: 'identifier', name: 'i' }) }),
]);

const HELPER_NAME = 'reach';

function helperMap(statements) {
  return new Map([[HELPER_NAME, { parameters: [], returnType: { kind: 'integer' }, statements }]]);
}

function runtimeStub() {
  return { asyncHelpers: undefined, checkAbort: () => {}, events: [], helpers: undefined, maxEvents: LIMITS.maxEvents };
}

// Every hand-built row here bypasses the linker on purpose: `statementSubExpressions` falls through
// to `[statement.value]` for an unrecognised kind, so at base every walker raises a TypeError
// reading `kind` of `undefined` — a cause entirely independent of whether the linker routes a jump.
for (const [kind, build] of JUMPS) {
  test(`the capability closure walker treats a bare ${kind} as a leaf rather than throwing`, () => {
    assert.equal(
      linkedStatementsInvokeCapability([build()], undefined, createLinkedKirClosureWalk()),
      false,
      `RT12J_WALKER_BLIND: a ${kind} owns no expression, so the closure walk must answer false`,
    );
  });

  test(`the call-depth walker measures a bare ${kind} as zero rather than throwing`, () => {
    assert.equal(
      linkedStatementsCallDepth([build()], undefined),
      0,
      `RT12J_WALKER_BLIND: a ${kind} owns no expression, so the call-depth walk must answer zero`,
    );
  });
}

// A jump must not blind the walk to what sits beside it. Both rows put the jump *first*, so a
// walker that stopped at an unrecognised kind would answer the safe-looking wrong thing.
test('a capability after a jump in a loop body still reaches the closure walk', () => {
  for (const [kind, build] of JUMPS) {
    const statements = [linkedForStatement({ body: [build(), linkedCapabilityStatement()] })];
    assert.equal(
      linkedStatementsInvokeCapability(statements, undefined, createLinkedKirClosureWalk()),
      true,
      `RT12J_CLOSURE_BLIND: a ${kind} must not hide the capability after it`,
    );
  }
});

test('a call after a jump in a loop body still counts against the call-depth policy', () => {
  const helpers = helperMap([linkedIntegerReturn('1')]);
  for (const [kind, build] of JUMPS) {
    assert.equal(
      linkedStatementsCallDepth([linkedForStatement({ body: [build(), linkedCallStatement(HELPER_NAME)] })], helpers),
      1,
      `RT12J_DEPTH_BLIND: a ${kind} must not hide the call after it`,
    );
  }
});

test('a jump inside a while body is walked through both semantic walkers', () => {
  const helpers = helperMap([linkedCapabilityStatement()]);
  for (const [kind, build] of JUMPS) {
    const withCapability = [
      Object.freeze({
        body: Object.freeze([build(), linkedCallStatement(HELPER_NAME)]),
        condition: linkedUserCall(HELPER_NAME),
        kind: 'while',
      }),
    ];
    assert.equal(
      linkedStatementsInvokeCapability(withCapability, helpers, createLinkedKirClosureWalk()),
      true,
      `RT12J_CLOSURE_BLIND: a ${kind} in a while body must not stop the walk`,
    );
    const withCall = [
      Object.freeze({
        body: Object.freeze([build(), ...PLAIN_BODY]),
        condition: linkedUserCall(HELPER_NAME),
        kind: 'while',
      }),
    ];
    assert.equal(
      linkedStatementsCallDepth(withCall, helperMap([linkedIntegerReturn('1')])),
      1,
      `RT12J_DEPTH_BLIND: a ${kind} in a while body must not stop the depth walk`,
    );
  }
});

// RT-1's own dispatcher, driven directly. At base a jump falls into the `else` arm — the `return`
// arm — and is treated as a value return, so `statementValue(undefined, …)` throws. Driving
// `walkStatements` over a hand-built handler makes that the single visible cause.
for (const [kind, build] of JUMPS) {
  test(`the RT-1 statement walk executes a ${kind} in a loop body instead of mistaking it for a return`, () => {
    const handler = handBuiltLinkedProgram([
      linkedForStatement({ body: [build()], to: '3' }),
      linkedIntegerReturn('7'),
    ]).program;
    const walk = walkStatements(handler, new Map(), new RuntimeMeter(LIMITS), runtimeStub(), ENTRY_WALK_POLICY);
    const step = walk.next(WALK_SEED);
    assert.equal(step.done, true, `RT12J_RT1_WALK_GAP: a ${kind} must not suspend the walk`);
    assert.deepEqual(
      step.value,
      { kind: 'returned', value: { tag: 'integer', value: '7' } },
      `RT12J_RT1_WALK_GAP: the handler must reach its own return after the loop a ${kind} left`,
    );
  });
}

// RT12J-TD17: link.ts's loopDepth gate keeps a bare jump from ever reaching walkStatements through
// a compiled program, but walkStatements is exported and this suite drives it directly with
// hand-built statements, so the frame-search fix needs its own oracle independent of the linker.
test('a continue with no enclosing loop frame faults closed instead of spinning unmetered', async () => {
  const outcome = await walkStatementsInChild([linkedContinueStatement()]);
  assert.equal(
    outcome.caught,
    true,
    'RT12J_JUMP_FAIL_OPEN: a continue with no loop frame must raise a fault, not silently drain the stack',
  );
  assert.equal(outcome.name, 'KernKirFault');
  assert.equal(outcome.code, 'unsupported-runtime-input');
  assert.equal(outcome.message, 'KIR_JUMP_WITHOUT_LOOP_FRAME');
});

// The fail-open twin of the row above: at base, a break with no loop frame pops every frame and
// the walk returns `drained` as if the handler had run to completion, skipping the return below it.
test('a break with no enclosing loop frame faults closed instead of draining the whole stack', async () => {
  const outcome = await walkStatementsInChild([linkedBreakStatement(), linkedIntegerReturn('7')]);
  assert.equal(
    outcome.caught,
    true,
    'RT12J_JUMP_FAIL_OPEN: a break with no loop frame must raise a fault, not complete the handler normally',
  );
  assert.equal(outcome.name, 'KernKirFault');
  assert.equal(outcome.code, 'unsupported-runtime-input');
  assert.equal(outcome.message, 'KIR_JUMP_WITHOUT_LOOP_FRAME');
});

// Regression guard for the fix itself: the frame search must look past a loopless `if` frame to
// the loop frame beneath it, not treat the `if` frame as the nearest loop and fault on it.
test('a continue or break inside an if frame inside a loop still finds the loop frame', () => {
  const trueCondition = Object.freeze({ kind: 'literal', value: Object.freeze({ tag: 'boolean', value: true }) });
  for (const [kind, build] of JUMPS) {
    const ifWrapped = Object.freeze({
      condition: trueCondition,
      elseBranch: undefined,
      kind: 'if',
      thenBranch: Object.freeze([build()]),
    });
    const handler = handBuiltLinkedProgram([
      linkedForStatement({ body: [ifWrapped], to: '3' }),
      linkedIntegerReturn('7'),
    ]).program;
    const walk = walkStatements(handler, new Map(), new RuntimeMeter(LIMITS), runtimeStub(), ENTRY_WALK_POLICY);
    const step = walk.next(WALK_SEED);
    assert.equal(step.done, true, `RT12J_IF_FRAME_JUMP_GAP: a ${kind} inside an if inside a loop must not hang`);
    assert.deepEqual(
      step.value,
      { kind: 'returned', value: { tag: 'integer', value: '7' } },
      `RT12J_IF_FRAME_JUMP_GAP: a ${kind} inside an if must still find the loop frame beneath it`,
    );
  }
});

// The JavaScript emitter's block dispatcher, reached without the linker. At base `leafSource` is
// where a jump lands and it throws a plain `Error` about return statements — an emit-time
// TypeScript error rather than a `__Fault`, and the public compile entry would mask it as
// `artifact-emission-failure`, so it is driven through `emitJavaScriptEsm` directly.
for (const [kind, build] of JUMPS) {
  test(`the JavaScript block dispatcher emits a native ${kind} rather than throwing`, () => {
    const program = handBuiltLinkedProgram([
      linkedForStatement({ body: [build()], to: '3' }),
      linkedIntegerReturn('7'),
    ]);
    const bytes = emitJavaScriptEsm(program, handBuiltManifestBase());
    const text = Buffer.from(bytes).toString('utf8');
    assert.match(
      text,
      new RegExp(`\\b${kind}\\s*;`, 'u'),
      `RT12J_JS_SHAPE: the emitter must lower a ${kind} to the host keyword`,
    );
  });
}

// The Python deferral pass, reached without the linker. Its switch is closed by a `never` guard, so
// a union member without an arm is a `tsc` error rather than a runtime one; the runtime half is
// that the mapping reports the jump kind for a jump in a `for` body.
test('the Python lowering table defers both jump kinds and the walk reports them', () => {
  for (const [kind, build] of JUMPS) {
    assert.equal(
      KIR_PYTHON_STATEMENT_LOWERING[kind],
      'deferred',
      `RT12J_PY_MAPPING_GAP: ${kind} must be mapped deferred, not missing`,
    );
    const program = handBuiltLinkedProgram([
      linkedForStatement({ body: [build()], to: '3' }),
      linkedIntegerReturn('7'),
    ]);
    assert.equal(
      pythonLoweringDeferral(program),
      kind,
      `RT12J_PY_MAPPING_GAP: a ${kind} in a for body must be the reported deferral`,
    );
  }
});

// The union members are what turn every walker above into a `tsc` error, so they belong with them.
// Zero fields each: a jump binds no name, reads no expression and owns no block, so any field at
// all would mean the shape was copied from `while` rather than derived.
test('the linked statement union carries both jump members with no field but kind', async () => {
  const contracts = await readFile(CONTRACTS_URL, 'utf8');
  const union = contracts.slice(
    contracts.indexOf('export type LinkedKernKirStatement ='),
    contracts.indexOf('function statementSubBlocks'),
  );
  assert.ok(union.length > 0, 'the statement union must be locatable');
  for (const [kind] of JUMPS) {
    assert.ok(union.includes(`kind: '${kind}'`), `RT12J_UNION_GAP: the union must carry the ${kind} member`);
    const at = union.indexOf(`kind: '${kind}'`);
    const member = union.slice(union.lastIndexOf('| {', at), union.indexOf('}', at));
    const declared = [...member.matchAll(/readonly (\w+)[?]?:/gu)].map((match) => match[1]);
    assert.deepEqual(
      [...new Set(declared)].sort(),
      ['kind'],
      `the ${kind} member must declare exactly kind and nothing else`,
    );
  }
});

// `compileBlock` routes a jump to `compileStatement`, which is observable only through the label
// path: a refusal attributed to a loop body proves the body was compiled by the ordinary statement
// route, and an admitted jump proves the route reaches the new branches.
test('compileBlock sends a jump to the ordinary statement route in every block it compiles', async () => {
  const message = await assertLinkLabel(
    JUMP_POSITIONS['neg-break-with-children-in-loop'](),
    'statement must be a leaf',
  );
  assert.match(
    message,
    /\.body\.children\[/u,
    'RT12J_ROUTE_GAP: the refusal must be attributed to the loop body, not to the loop statement',
  );
  await assertJumpAdmitted('for-break', JUMP_POSITIONS['for-break']());
});

// `containsReturn` needs no arm: it is a `.some` predicate whose unrecognised kinds are simply
// `false`, and a jump owns no block that could hide a `return`. This row pins that no arm was
// added — an arm for a childless kind would be dead code with a real cost, because it would have to
// be kept correct as the union grows.
test('containsReturn keeps exactly its four block-owning arms and gains none for a jump', async () => {
  const link = await readFile(LINK_URL, 'utf8');
  const walker = link.slice(
    link.indexOf('function containsReturn'),
    link.indexOf('function assertLeaf'),
  );
  assert.ok(walker.length > 0, 'containsReturn must be locatable');
  const kinds = [...walker.matchAll(/statement\.kind === '([a-z]+)'/gu)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(kinds)].sort(),
    ['for', 'if', 'return', 'while'],
    'RT12J_WALKER_CREEP: containsReturn must not learn a kind that owns no block',
  );
});

// The `never` guard is the tripwire that makes the Python arm non-optional, so it must still be
// there and the two jump cases must be inside the switch rather than short-circuited above it.
test('the Python statement deferral switch keeps its never guard and names both jump kinds', async () => {
  const request = await readFile(REQUEST_URL, 'utf8');
  const walker = request.slice(
    request.indexOf('function statementDeferral'),
    request.indexOf('function statementsDeferral'),
  );
  assert.ok(walker.length > 0, 'statementDeferral must be locatable');
  assert.ok(walker.includes('const exhaustive: never = statement'), 'RT12J_TRIPWIRE_LOST: the never guard is gone');
  for (const [kind] of JUMPS) {
    assert.ok(walker.includes(`case '${kind}':`), `RT12J_PY_ARM_MISSING: statementDeferral must name ${kind}`);
  }
});
