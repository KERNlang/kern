import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { TARGET_KERNEL_SHA256 as JAVASCRIPT_KERNEL } from '../../packages/core/dist/compiler/kir-js-esm/emitter.js';
import { TARGET_KERNEL_SHA256 as PYTHON_KERNEL } from '../../packages/core/dist/compiler/kir-python/emitter.js';
import { LINKED_KIR_TYPE_ADMISSION, admission } from './k0-support.mjs';

const F5_POLICY_URL = new URL('../kern-frontend-f5-projection/policy.json', import.meta.url);
const RT3_GOLDEN_URL = new URL('../kern-5-rt3-binary-expression/k0-golden.json', import.meta.url);
const RT9_GOLDEN_URL = new URL('../kern-5-rt9-linked-assign/k0-golden.json', import.meta.url);
const RT10PRE_GOLDEN_URL = new URL('../kern-5-rt10-pre-linked-arithmetic/k0-golden.json', import.meta.url);
const RT10X_GOLDEN_URL = new URL('../kern-5-rt10-cross-call-integer/k0-golden.json', import.meta.url);
const CONTRACTS_URL = new URL(
  '../../packages/core/src/kir-runtime/linked-kir-program/contracts.ts',
  import.meta.url,
);
const LIMITS_URL = new URL('../../packages/core/src/kir-runtime/contracts.ts', import.meta.url);

const JAVASCRIPT_KERNEL_SHA256 = 'b53251fd8a09f58226881b8f32547183e4b8300bab462d1373039426d3b057e6';
const PYTHON_KERNEL_SHA256 = 'f79a39633f58475124eafdec3c62a9fd042ffa50b1de637509d0f66e0f0cd18e';

const F5_POLICY_SHA256 = '0f62f6c964af7265357ac0ef3f3a8a6aa15ffa2a2800e09ae5877bad90dbd942';

// Three goldens whose scrapes the for feature itself does not touch: RT-3 scrapes the expression
// union, RT-9 and RT-10-pre the assign and arithmetic admission surfaces, RT-10-X the cross-call
// type table. A statement-union addition is none of those. RT-9's own golden moved anyway, as a
// correction: its `control-for` admission row and linkedStatementKinds scrape were stale against
// the linker for admits, the same class of fix RT-2's golden received in this slice's own build.
const RT3_GOLDEN_SHA256 = '935da8148df5c02d5d405fea2db00fb7f5f6db08158d9cdca0d61c0084972b18';
const RT9_GOLDEN_SHA256 = 'c8a7253c86d6c04c73370129dfa99f0cf2e510eaad3e64410076c93785ddedb4';
const RT10PRE_GOLDEN_SHA256 = '87efee4df8ce4fbde5d954d74e859f3e4f889598e0f35fedca8d56705515f718';
const RT10X_GOLDEN_SHA256 = '6deab8ccfd16aacc79543fad945b62e62a71027bc1c2673b764125fa9158f4cf';

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

// The statement kinds this slice must leave outside the union. `for` is deliberately absent: it is
// what the slice adds, and `walker-coverage.test.mjs` asserts it arrives.
const STILL_OUTSIDE = Object.freeze(['break', 'continue', 'each', 'set', 'while']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function digest(url) {
  return sha256(await readFile(url));
}

async function source(url) {
  return readFile(url, 'utf8');
}

test('the target kernels carry the reconciled predecessor values', async () => {
  assert.equal(
    JAVASCRIPT_KERNEL,
    JAVASCRIPT_KERNEL_SHA256,
    'RT10F_KERNEL_TOUCH: the JavaScript kernel moved after reconciliation',
  );
  assert.equal(
    PYTHON_KERNEL,
    PYTHON_KERNEL_SHA256,
    'RT10F_KERNEL_TOUCH: the Python kernel moved after reconciliation',
  );
});

test('the frontend carries the reconciled F5 projection policy digest', async () => {
  assert.equal(await digest(F5_POLICY_URL), F5_POLICY_SHA256, 'RT10F_FRONTEND_TOUCH: the reconciled F5 policy moved');
});

test('the RT-3, RT-9, RT-10-pre and RT-10-X goldens do not move', async () => {
  for (const [url, expected, label] of [
    [RT3_GOLDEN_URL, RT3_GOLDEN_SHA256, 'RT-3'],
    [RT9_GOLDEN_URL, RT9_GOLDEN_SHA256, 'RT-9'],
    [RT10PRE_GOLDEN_URL, RT10PRE_GOLDEN_SHA256, 'RT-10-pre'],
    [RT10X_GOLDEN_URL, RT10X_GOLDEN_SHA256, 'RT-10-X'],
  ]) {
    assert.equal(await digest(url), expected, `RT10F_GOLDEN_DRIFT: the ${label} golden moved`);
  }
});

// The half of the union check that must be green before and after: no second loop form sneaks in
// as a way of rescuing a RED. The other half — that `for` itself joins the union — is this slice's
// work and is asserted in `walker-coverage.test.mjs` alongside the walkers it makes exhaustive.
test('every statement kind this slice defers stays outside the linked statement union', async () => {
  const contracts = await source(CONTRACTS_URL);
  const union = contracts.slice(
    contracts.indexOf('export type LinkedKernKirStatement ='),
    contracts.indexOf('function expressionVariantUnhandled'),
  );
  assert.ok(union.length > 0, 'the statement union must be locatable');
  for (const kind of STILL_OUTSIDE) {
    assert.equal(
      union.includes(`kind: '${kind}'`),
      false,
      `RT10F_SCOPE_CREEP: ${kind} must stay outside the linked statement union`,
    );
  }
});

// No new limit field and no new diagnostic code. `maxIterations` in particular does not exist and is
// not created: the loop's only budget is maxSteps.
test('the request limits and the diagnostic code union are byte-stable in shape', async () => {
  const contracts = await source(LIMITS_URL);
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
    'RT10F_LIMIT_CREEP: KernKirLimits must stay at exactly seven fields; maxIterations does not exist',
  );
  assert.equal(contracts.includes('maxIterations'), false, 'RT10F_LIMIT_CREEP: maxIterations must not be introduced');
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
    'RT10F_CODE_CREEP: the diagnostic code union must stay at twelve members',
  );
});

test('the type admission table this slice does not touch keeps its five rows', () => {
  assert.deepEqual(Object.keys(LINKED_KIR_TYPE_ADMISSION).sort(), ['boolean', 'integer', 'list', 'text', 'void']);
});

// RT-9's assign gate, RT-10-pre's arithmetic and RT-10-X's integer cross-call are the three
// neighbours the loop body is built out of. Each one is asserted admitted here, outside a loop, so a
// regression in any of them separates in this suite rather than as a mysterious loop failure.
test('the rt9 assign gate still admits an assign outside a loop', async () => {
  const row = await admission(
    [
      'fn name=route export=true returns=integer',
      '  handler lang=kern',
      '    let name=acc value="0"',
      '    assign target="acc" value="1"',
      '    return value="acc"',
      '',
    ].join('\n'),
  );
  assert.equal(row.rt1, 'admitted', 'RT9_REGRESSION: a plain assign must still link');
  assert.equal(row.javascript, 'admitted');
  assert.equal(row.python, 'admitted');
});

test('rt10-pre arithmetic and the rt10-X integer cross-call still link outside a loop', async () => {
  const arithmetic = await admission(
    [
      'fn name=route export=true returns=integer',
      '  handler lang=kern',
      '    let name=acc value="0"',
      '    assign target="acc" value="acc + 1"',
      '    return value="acc"',
      '',
    ].join('\n'),
  );
  assert.equal(arithmetic.rt1, 'admitted', 'RT10PRE_REGRESSION: a linked arithmetic assign must still link');
  const crossCall = await admission(
    [
      'fn name=idp export=false returns=integer',
      '  param name=a type=integer',
      '  handler lang=kern',
      '    return value="a"',
      '',
      'fn name=route export=true returns=integer',
      '  handler lang=kern',
      '    let name=acc value="0"',
      '    assign target="acc" value="acc + idp(7)"',
      '    return value="acc"',
      '',
    ].join('\n'),
  );
  assert.equal(crossCall.rt1, 'admitted', 'RT10X_REGRESSION: an integer cross-call must still link');
  assert.equal(crossCall.javascript, 'admitted');
  assert.equal(crossCall.python, 'admitted');
});
