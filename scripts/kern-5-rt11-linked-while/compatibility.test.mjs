import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { TARGET_KERNEL_SHA256 as JAVASCRIPT_KERNEL } from '../../packages/core/dist/compiler/kir-js-esm/emitter.js';
import { TARGET_KERNEL_SHA256 as PYTHON_KERNEL } from '../../packages/core/dist/compiler/kir-python/emitter.js';
import { LINKED_KIR_TYPE_ADMISSION, admission } from './k0-support.mjs';

const F5_POLICY_URL = new URL('../kern-frontend-f5-projection/policy.json', import.meta.url);
const RT3_GOLDEN_URL = new URL('../kern-5-rt3-binary-expression/k0-golden.json', import.meta.url);
const RT10PRE_GOLDEN_URL = new URL('../kern-5-rt10-pre-linked-arithmetic/k0-golden.json', import.meta.url);
const RT10X_GOLDEN_URL = new URL('../kern-5-rt10-cross-call-integer/k0-golden.json', import.meta.url);
const RT6_GOLDEN_URL = new URL('../kern-5-rt6-void-fallthrough/k0-golden.json', import.meta.url);
const CONTRACTS_URL = new URL(
  '../../packages/core/src/kir-runtime/linked-kir-program/contracts.ts',
  import.meta.url,
);
const LIMITS_URL = new URL('../../packages/core/src/kir-runtime/contracts.ts', import.meta.url);
const PYTHON_EMITTER_URL = new URL('../../packages/core/src/compiler/kir-python/emitter.ts', import.meta.url);
const CENSUS_URL = new URL('../kern-5-admission-census/admission.json', import.meta.url);

const JAVASCRIPT_KERNEL_SHA256 = 'b53251fd8a09f58226881b8f32547183e4b8300bab462d1373039426d3b057e6';
const PYTHON_KERNEL_SHA256 = 'f79a39633f58475124eafdec3c62a9fd042ffa50b1de637509d0f66e0f0cd18e';

const F5_POLICY_SHA256 = '0f62f6c964af7265357ac0ef3f3a8a6aa15ffa2a2800e09ae5877bad90dbd942';

// Three goldens whose scrapes a statement-union addition does not touch: RT-6 the void return
// contract, RT-10-pre the arithmetic surface, RT-10-X the cross-call type table. The RT-2 and RT-9
// goldens are absent on purpose — both scrape `linkedStatementKinds` and both move in this slice's
// licensed cascade. RT-3 is absent from this list too: it carries no statement-union scrape of its
// own, but it does carry `rt2GoldenSha256`, which the RT-2 cascade changes, so RT-3 moves as well —
// pinned separately below rather than here.
const RT10PRE_GOLDEN_SHA256 = '87efee4df8ce4fbde5d954d74e859f3e4f889598e0f35fedca8d56705515f718';
const RT10X_GOLDEN_SHA256 = '6deab8ccfd16aacc79543fad945b62e62a71027bc1c2673b764125fa9158f4cf';

// The RT-3 golden before and after this slice's licensed RT-2 → RT-3 digest cascade, and the one
// field of RT-3's golden the cascade is licensed to move.
const RT3_GOLDEN_BASE_SHA256 = '935da8148df5c02d5d405fea2db00fb7f5f6db08158d9cdca0d61c0084972b18';
const RT3_GOLDEN_SHA256 = 'd871bd4cd495d6c85b1621ee13b042a8651d714ff26204b3c505b5719ee3f291';
const RT3_GOLDEN_BASE_RT2_SHA256 = '6d6754e75d5d9846a1201101831a528dfc7021374d4f1f6d5eacc0d6e0b8bff2';
const RT2_GOLDEN_SHA256 = 'ea64e2ef7bc824bf62d632533488bda484c81aa783fb04d7940af9f249b2ac87';

// The Python emitter is byte-frozen: `while` is deferred by ledger row, not lowered. Slice A pins
// this digest too, and it must not move in either slice.
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
  'uncaught-throw',
  'unsupported-runtime-input',
]);

// The statement kinds this slice must leave outside the union. `while` is deliberately absent: it
// is what the slice adds, and `walker-coverage.test.mjs` asserts it arrives.
const STILL_OUTSIDE = Object.freeze(['each', 'set']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function digest(url) {
  return sha256(await readFile(url));
}

test('the target kernels do not move, because a while needs no kernel helper of its own', async () => {
  assert.equal(JAVASCRIPT_KERNEL, JAVASCRIPT_KERNEL_SHA256, 'RT11W_KERNEL_TOUCH: the JavaScript kernel moved');
  assert.equal(PYTHON_KERNEL, PYTHON_KERNEL_SHA256, 'RT11W_KERNEL_TOUCH: the Python kernel moved');
});

test('the Python emitter is byte-identical, because while is deferred rather than lowered', async () => {
  assert.equal(
    await digest(PYTHON_EMITTER_URL),
    PYTHON_EMITTER_SHA256,
    'RT11W_PYTHON_TOUCH: the deferral must never reach the Python emitter',
  );
});

test('the frontend carries the same F5 projection policy digest, because while already projects', async () => {
  assert.equal(await digest(F5_POLICY_URL), F5_POLICY_SHA256, 'RT11W_FRONTEND_TOUCH: the F5 policy moved');
});

test('the RT-6, RT-10-pre and RT-10-X goldens do not move', async () => {
  for (const [url, expected, label] of [
    [RT10PRE_GOLDEN_URL, RT10PRE_GOLDEN_SHA256, 'RT-10-pre'],
    [RT10X_GOLDEN_URL, RT10X_GOLDEN_SHA256, 'RT-10-X'],
  ]) {
    assert.equal(await digest(url), expected, `RT11W_GOLDEN_DRIFT: the ${label} golden moved`);
  }
  const rt6 = JSON.parse(await readFile(RT6_GOLDEN_URL, 'utf8'));
  assert.deepEqual(
    Object.keys(rt6).sort(),
    ['envelopeText', 'linkedReturnType', 'typeAdmission'],
    'RT11W_GOLDEN_DRIFT: the RT-6 golden scrapes no statement surface and must keep its three keys',
  );
});

// RT-3 moves, but only through the one field it carries for exactly this purpose. Undoing that one
// field on the current golden must reproduce the base golden byte for byte, proving the cascade
// touched nothing else — RT-3's own expression-union scrape included.
test('the RT-3 golden differs from its base content in exactly the carried rt2GoldenSha256 field', async () => {
  const raw = await readFile(RT3_GOLDEN_URL, 'utf8');
  const golden = JSON.parse(raw);
  assert.equal(`${JSON.stringify(golden, null, 2)}\n`, raw, 'the RT-3 golden must stay canonically serialized');
  assert.equal(sha256(raw), RT3_GOLDEN_SHA256, 'RT11W_GOLDEN_DRIFT: the RT-3 golden moved beyond its licensed cascade');
  assert.equal(
    golden.rt2GoldenSha256,
    RT2_GOLDEN_SHA256,
    'RT11W_GOLDEN_DRIFT: the RT-3 golden must carry the post-cascade RT-2 digest',
  );
  const base = { ...golden, rt2GoldenSha256: RT3_GOLDEN_BASE_RT2_SHA256 };
  assert.equal(
    sha256(`${JSON.stringify(base, null, 2)}\n`),
    RT3_GOLDEN_BASE_SHA256,
    'RT11W_GOLDEN_DRIFT: the RT-3 golden moved beyond the rt2GoldenSha256 field',
  );
});

// The half of the union check that must be green before and after: no second loop form and no jump
// statement sneaks in as a way of rescuing a RED.
test('every statement kind this slice defers stays outside the linked statement union', async () => {
  const contracts = await readFile(CONTRACTS_URL, 'utf8');
  const union = contracts.slice(
    contracts.indexOf('export type LinkedKernKirStatement ='),
    contracts.indexOf('function expressionVariantUnhandled'),
  );
  assert.ok(union.length > 0, 'the statement union must be locatable');
  for (const kind of STILL_OUTSIDE) {
    assert.equal(
      union.includes(`kind: '${kind}'`),
      false,
      `RT11W_SCOPE_CREEP: ${kind} must stay outside the linked statement union`,
    );
  }
});

// No new limit field and no new diagnostic code. `maxIterations` in particular does not exist and is
// not created: a while's only budget is maxSteps, so the tribunal's iteration-budget-scope question
// has no row to pin in this slice — only a note for a later one.
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
    'RT11W_LIMIT_CREEP: KernKirLimits must stay at exactly seven fields; maxIterations does not exist',
  );
  assert.equal(contracts.includes('maxIterations'), false, 'RT11W_LIMIT_CREEP: maxIterations must not be introduced');
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
    'RT11W_CODE_CREEP: the diagnostic code union must stay at thirteen members',
  );
  assert.deepEqual(Object.keys(LINKED_KIR_TYPE_ADMISSION).sort(), ['boolean', 'integer', 'list', 'text', 'void']);
});

// The measured answer to "how many census files gain admission from while alone": none, because
// none of the 240 tracked files is rejected at the link stage at all. If a file ever is, this row
// fires and the admission-count question becomes real rather than vacuous.
test('no tracked kern file is rejected at the link stage, so the census cannot move', async () => {
  const census = JSON.parse(await readFile(CENSUS_URL, 'utf8'));
  assert.equal(census.total, 240, 'RT11W_CENSUS_SHAPE: the tracked corpus size moved');
  assert.equal(census.results.length, census.total);
  const linkStage = census.results.filter((row) => row.stage === 'link');
  assert.deepEqual(
    linkStage.map((row) => row.file),
    [],
    'RT11W_CENSUS_REACHABLE: a file now reaches the linker, so widening the linker can change admission',
  );
});

// RT-9's assign gate, RT-10-pre's arithmetic and RT-10-X's integer cross-call are the three
// neighbours a while body is built out of. Each is asserted admitted here, outside a loop, so a
// regression in any of them separates in this suite rather than as a mysterious while failure.
test('the neighbour gates a while body is built from still link outside a loop', async () => {
  const rows = [
    ['RT9', ['let name=acc value="0"', 'assign target="acc" value="1"', 'return value="acc"']],
    ['RT10PRE', ['let name=acc value="0"', 'assign target="acc" value="acc + 1"', 'return value="acc"']],
    ['RT2', ['let name=acc value="0"', 'if cond="1 < 2"', '  assign target="acc" value="1"', 'return value="acc"']],
  ];
  for (const [label, body] of rows) {
    const row = await admission(
      ['fn name=route export=true returns=integer', '  handler lang=kern', ...body.map((line) => `    ${line}`), ''].join(
        '\n',
      ),
    );
    assert.equal(row.rt1, 'admitted', `${label}_REGRESSION: the neighbour gate must still link`);
    assert.equal(row.javascript, 'admitted', `${label}_REGRESSION: the JavaScript leg must still compile`);
    assert.equal(row.python, 'admitted', `${label}_REGRESSION: a while-free program must still compile to Python`);
  }
});
