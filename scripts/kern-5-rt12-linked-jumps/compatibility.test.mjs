import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { TARGET_KERNEL_SHA256 as JAVASCRIPT_KERNEL } from '../../packages/core/dist/compiler/kir-js-esm/emitter.js';
import { TARGET_KERNEL_SHA256 as PYTHON_KERNEL } from '../../packages/core/dist/compiler/kir-python/emitter.js';
import { JUMP_POSITIONS, LINKED_KIR_TYPE_ADMISSION, admission, f5Row } from './k0-support.mjs';

const F5_POLICY_URL = new URL('../kern-frontend-f5-projection/policy.json', import.meta.url);
const RT2_GOLDEN_URL = new URL('../kern-5-rt2-boolean-if/k0-golden.json', import.meta.url);
const RT3_GOLDEN_URL = new URL('../kern-5-rt3-binary-expression/k0-golden.json', import.meta.url);
const RT6_GOLDEN_URL = new URL('../kern-5-rt6-void-fallthrough/k0-golden.json', import.meta.url);
const RT10PRE_GOLDEN_URL = new URL('../kern-5-rt10-pre-linked-arithmetic/k0-golden.json', import.meta.url);
const RT10X_GOLDEN_URL = new URL('../kern-5-rt10-cross-call-integer/k0-golden.json', import.meta.url);
const CONTRACTS_URL = new URL('../../packages/core/src/kir-runtime/linked-kir-program/contracts.ts', import.meta.url);
const LIMITS_URL = new URL('../../packages/core/src/kir-runtime/contracts.ts', import.meta.url);
const PYTHON_EMITTER_URL = new URL('../../packages/core/src/compiler/kir-python/emitter.ts', import.meta.url);
const LINK_URL = new URL('../../packages/core/src/kir-runtime/linked-kir-program/link.ts', import.meta.url);
const CENSUS_URL = new URL('../kern-5-admission-census/admission.json', import.meta.url);

const JAVASCRIPT_KERNEL_SHA256 = 'b53251fd8a09f58226881b8f32547183e4b8300bab462d1373039426d3b057e6';
const PYTHON_KERNEL_SHA256 = 'f79a39633f58475124eafdec3c62a9fd042ffa50b1de637509d0f66e0f0cd18e';

const F5_POLICY_SHA256 = '0f62f6c964af7265357ac0ef3f3a8a6aa15ffa2a2800e09ae5877bad90dbd942';

// Three goldens whose scrapes a statement-union addition does not touch: RT-6 the void return
// contract, RT-10-pre the arithmetic surface, RT-10-X the cross-call type table. The RT-2 and RT-9
// goldens are absent on purpose — both scrape `linkedStatementKinds` and both move in this slice's
// licensed cascade.
const RT10PRE_GOLDEN_SHA256 = '87efee4df8ce4fbde5d954d74e859f3e4f889598e0f35fedca8d56705515f718';
const RT10X_GOLDEN_SHA256 = '6deab8ccfd16aacc79543fad945b62e62a71027bc1c2673b764125fa9158f4cf';
const RT6_GOLDEN_SHA256 = '429de5ebbb5e606acfd48764b506d38b6abc4c5c6270bca883b34aa027306e81';

// The RT-3 golden's content before this slice's licensed RT-2 cascade, and the RT-2 digest it
// carried then. Undoing that one field must reproduce the base bytes exactly, which is what says
// the cascade touched no other RT-3 field — its own expression-union scrape included.
const RT3_GOLDEN_BASE_SHA256 = '969dd11bdeaf11169559b1c790f6350ed3e29cf21983797acf3167c1bed8d512';
const RT3_GOLDEN_BASE_RT2_SHA256 = '5db55623bf5fca9e0bff84f81c159705002a044d9114a95e284c596896b05939';

// The Python emitter is byte-frozen: both jump kinds are deferred by ledger row, not lowered.
const PYTHON_EMITTER_SHA256 = 'c37b5c0092dd712e30f49b07ae7bc0ba1bb26343bcc219e29c750457756518d8';

const LIMIT_FIELDS = Object.freeze([
  'maxBytes',
  'maxCollectionLength',
  'maxDepth',
  'maxDiagnostics',
  'maxEvents',
  'maxSteps',
  'maxStringBytes',
]);

const DIAGNOSTIC_CODES = Object.freeze([
  'capability-error',
  'execution-cancelled',
  'execution-timeout',
  'handler-entry-ambiguous',
  'handler-entry-not-found',
  'handler-entry-unsupported',
  'handler-link-error',
  'invalid-handler-arguments',
  'invalid-handler-result',
  'projection-authentication-error',
  'runtime-limit-exceeded',
  'unsupported-runtime-input',
]);

// The statement kinds this slice must leave outside the union. `break` and `continue` are
// deliberately absent: they are what the slice adds, and `walker-coverage.test.mjs` asserts they
// arrive with no field but `kind`.
const STILL_OUTSIDE = Object.freeze(['each', 'set']);

const RESERVED_LABEL = 'KIR_LOOP_JUMP_CROSSES_TRY';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function digest(url) {
  return sha256(await readFile(url));
}

test('the target kernels do not move, because a native jump needs no kernel helper of its own', () => {
  assert.equal(JAVASCRIPT_KERNEL, JAVASCRIPT_KERNEL_SHA256, 'RT12J_KERNEL_TOUCH: the JavaScript kernel moved');
  assert.equal(PYTHON_KERNEL, PYTHON_KERNEL_SHA256, 'RT12J_KERNEL_TOUCH: the Python kernel moved');
});

test('the Python emitter is byte-identical, because both jump kinds are deferred rather than lowered', async () => {
  assert.equal(
    await digest(PYTHON_EMITTER_URL),
    PYTHON_EMITTER_SHA256,
    'RT12J_PYTHON_TOUCH: the deferral must never reach the Python emitter',
  );
});

test('the frontend carries the same F5 projection policy digest, because both kinds already project', async () => {
  assert.equal(await digest(F5_POLICY_URL), F5_POLICY_SHA256, 'RT12J_FRONTEND_TOUCH: the F5 policy moved');
});

test('the RT-6, RT-10-pre and RT-10-X goldens do not move', async () => {
  for (const [url, expected, label] of [
    [RT6_GOLDEN_URL, RT6_GOLDEN_SHA256, 'RT-6'],
    [RT10PRE_GOLDEN_URL, RT10PRE_GOLDEN_SHA256, 'RT-10-pre'],
    [RT10X_GOLDEN_URL, RT10X_GOLDEN_SHA256, 'RT-10-X'],
  ]) {
    assert.equal(await digest(url), expected, `RT12J_GOLDEN_DRIFT: the ${label} golden moved`);
  }
  const rt6 = JSON.parse(await readFile(RT6_GOLDEN_URL, 'utf8'));
  assert.deepEqual(
    Object.keys(rt6).sort(),
    ['envelopeText', 'linkedReturnType', 'typeAdmission'],
    'RT12J_GOLDEN_DRIFT: the RT-6 golden scrapes no statement surface and must keep its three keys',
  );
});

// RT-3 moves, but only through the one field it carries for exactly this purpose. Two halves: the
// carried digest must always equal the live RT-2 golden, and undoing that one field on the current
// content must reproduce the base golden byte for byte.
test('the RT-3 golden differs from its base content in exactly the carried rt2GoldenSha256 field', async () => {
  const raw = await readFile(RT3_GOLDEN_URL, 'utf8');
  const golden = JSON.parse(raw);
  assert.equal(`${JSON.stringify(golden, null, 2)}\n`, raw, 'the RT-3 golden must stay canonically serialized');
  assert.equal(
    golden.rt2GoldenSha256,
    await digest(RT2_GOLDEN_URL),
    'RT12J_GOLDEN_DRIFT: the RT-3 golden must carry the live RT-2 digest',
  );
  const base = { ...golden, rt2GoldenSha256: RT3_GOLDEN_BASE_RT2_SHA256 };
  assert.equal(
    sha256(`${JSON.stringify(base, null, 2)}\n`),
    RT3_GOLDEN_BASE_SHA256,
    'RT12J_GOLDEN_DRIFT: the RT-3 golden moved beyond the rt2GoldenSha256 field',
  );
});

// The half of the union check that must be green before and after: no third loop form and no
// collection statement sneaks in as a way of rescuing a RED.
test('every statement kind still outside the linked union stays outside it', async () => {
  const contracts = await readFile(CONTRACTS_URL, 'utf8');
  const union = contracts.slice(
    contracts.indexOf('export type LinkedKernKirStatement ='),
    contracts.indexOf('function statementSubBlocks'),
  );
  assert.ok(union.length > 0, 'the statement union must be locatable');
  for (const kind of STILL_OUTSIDE) {
    assert.equal(
      union.includes(`kind: '${kind}'`),
      false,
      `RT12J_SCOPE_CREEP: ${kind} must stay outside the linked statement union`,
    );
  }
});

// The reserved label is written into the spec and into no source file. Pinning its absence is what
// stops it being quietly spent on some other refusal before the try/catch slice can claim it.
test('the reserved cross-try label is spent nowhere in the source tree', async () => {
  for (const url of [LINK_URL, CONTRACTS_URL, LIMITS_URL]) {
    const text = await readFile(url, 'utf8');
    assert.equal(
      text.includes(RESERVED_LABEL),
      false,
      `RT12J_LABEL_SPENT: ${RESERVED_LABEL} is reserved for the try slice and must not be emitted yet`,
    );
  }
});

test('the request limits and the diagnostic code union are byte-stable in shape', async () => {
  const contracts = await readFile(LIMITS_URL, 'utf8');
  const limits = contracts.slice(
    contracts.indexOf('export interface KernKirLimits'),
    contracts.indexOf('export interface KernKirRequest'),
  );
  for (const field of LIMIT_FIELDS) {
    assert.ok(limits.includes(`readonly ${field}:`), `KernKirLimits must keep ${field}`);
  }
  assert.equal(
    limits.split('readonly ').length - 1,
    LIMIT_FIELDS.length,
    'RT12J_LIMIT_CREEP: KernKirLimits must stay at exactly seven fields; maxIterations does not exist',
  );
  assert.equal(contracts.includes('maxIterations'), false, 'RT12J_LIMIT_CREEP: maxIterations must not be introduced');
  const codes = contracts.slice(
    contracts.indexOf('export type KernKirDiagnosticCode ='),
    contracts.indexOf('export interface KernKirDiagnostic '),
  );
  for (const code of DIAGNOSTIC_CODES) {
    assert.ok(codes.includes(`'${code}'`), `the diagnostic code union must keep ${code}`);
  }
  assert.equal(
    codes.split("  | '").length - 1,
    DIAGNOSTIC_CODES.length,
    'RT12J_CODE_CREEP: the diagnostic code union must stay at twelve members',
  );
  assert.deepEqual(Object.keys(LINKED_KIR_TYPE_ADMISSION).sort(), ['boolean', 'integer', 'list', 'text', 'void']);
});

// The load-bearing difference from the `while` slice: F5 is NOT a fence here. A bare top-level
// `break` projects with zero diagnostics, so the outside-loop refusal is reachable through the
// public projection entry and `KIR_BREAK_OUTSIDE_LOOP` is a real gate rather than defence in depth.
// This row is GREEN at base and is the fence that keeps it that way — if F5 ever started rejecting
// these, the linker's refusal rows would become unreachable and the type-gate would prove nothing.
test('F5 projects a bare top-level jump with zero diagnostics, so the linker owns the refusal', () => {
  for (const position of [
    'neg-break-top-level',
    'neg-continue-top-level',
    'neg-break-in-if-outside-loop',
    'neg-continue-in-if-outside-loop',
    'neg-return-then-break-top-level',
    'neg-break-with-children-top-level',
  ]) {
    const row = f5Row(JUMP_POSITIONS[position]());
    assert.equal(row.status, 'projected', `RT12J_FRONTEND_FENCE: ${position} must reach the linker`);
    assert.deepEqual(row.diagnostics, [], `RT12J_FRONTEND_FENCE: ${position} must project without a diagnostic`);
  }
});

test('no tracked kern file is rejected at the link stage, so the census cannot move', async () => {
  const census = JSON.parse(await readFile(CENSUS_URL, 'utf8'));
  assert.equal(census.total, 240, 'RT12J_CENSUS_SHAPE: the tracked corpus size moved');
  assert.equal(census.results.length, census.total);
  const linkStage = census.results.filter((row) => row.stage === 'link');
  assert.deepEqual(
    linkStage.map((row) => row.file),
    [],
    'RT12J_CENSUS_REACHABLE: a file now reaches the linker, so widening the linker can change admission',
  );
});

// The neighbour gates a jump-carrying body is built out of, each asserted admitted here outside any
// loop, so a regression in one separates in this suite rather than as a mysterious jump failure.
test('the neighbour gates a jump-carrying body is built from still link outside a loop', async () => {
  const rows = [
    ['RT9', ['let name=acc value="0"', 'assign target="acc" value="1"', 'return value="acc"']],
    ['RT10PRE', ['let name=acc value="0"', 'assign target="acc" value="acc + 1"', 'return value="acc"']],
    ['RT2', ['let name=acc value="0"', 'if cond="1 < 2"', '  assign target="acc" value="1"', 'return value="acc"']],
  ];
  for (const [label, body] of rows) {
    const row = await admission(
      [
        'fn name=route export=true returns=integer',
        '  handler lang=kern',
        ...body.map((line) => `    ${line}`),
        '',
      ].join('\n'),
    );
    assert.equal(row.rt1, 'admitted', `${label}_REGRESSION: the neighbour gate must still link`);
    assert.equal(row.javascript, 'admitted', `${label}_REGRESSION: the JavaScript leg must still compile`);
    assert.equal(row.python, 'admitted', `${label}_REGRESSION: a jump-free program must still compile to Python`);
  }
});
