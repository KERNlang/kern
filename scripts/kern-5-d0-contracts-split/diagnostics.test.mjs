import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';

import {
  ALPHA_RECEIPT_BINDING_COUNT,
  EXPECTED_DIAGNOSTIC_CODES,
  RC_V1_AMENDMENT_COUNT,
  RC_V1_CONSUMED_CHAIN_LENGTH,
  THIRTEENTH_DIAGNOSTIC_CODE,
} from './pins.mjs';
import {
  KIR_RUNTIME_DIR,
  between,
  occurrences,
  readRepositoryText,
  repositoryPath,
  sourceFilesUnder,
} from './support.mjs';

const RUNTIME_CONTRACTS = `${KIR_RUNTIME_DIR}/contracts.ts`;
const AMENDMENTS_DIR = 'scripts/runtime-contract-v1/amendments';
const LINEAGE_DIGESTS = Object.freeze({
  constitutionSha256: 'f25716593bbb2d9417ab004438baf34085befb0cfc25f4bf22276b6277ec6d96',
  declarationSchemaSha256: '16fb0ac434f5124265167835879dc3c1a7ffad94dc0a01d52d85b44943d13828',
  goldensSha256: 'bb2e3b34ec936a9f88b45a94a80500f110f18ed3e7be7e7caf4062de2610f15c',
  proofInventorySha256: '4a8dbec281ac89709431e26f9e142ce15f14958310d233f88a393bba46212a57',
});
const CODE_PIN_TESTS = Object.freeze([
  'scripts/kern-5-rt10-for/compatibility.test.mjs',
  'scripts/kern-5-rt11-linked-while/compatibility.test.mjs',
  'scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs',
]);
const FAULT_CONSTRUCTORS = Object.freeze(['new KernKirFault(', 'new __Fault(', 'raise _Fault(']);

function diagnosticUnion() {
  return between(
    readRepositoryText(RUNTIME_CONTRACTS),
    'export type KernKirDiagnosticCode =',
    'export interface KernKirDiagnostic ',
    'd0/diagnostic-union',
  );
}

function unionMembers(region) {
  return [...new Set([...region.matchAll(/'([a-z-]+)'/gu)].map((match) => match[1]))].sort();
}

test('KernKirDiagnosticCode has exactly thirteen members', () => {
  const region = diagnosticUnion();
  assert.equal(
    occurrences(region, "  | '"),
    EXPECTED_DIAGNOSTIC_CODES.length,
    'D0_CODE_COUNT: the diagnostic code union is not thirteen members',
  );
  assert.deepEqual(
    unionMembers(region),
    [...EXPECTED_DIAGNOSTIC_CODES],
    'D0_CODE_SET: the diagnostic code union is not the pinned thirteen',
  );
});

test('the union stays sorted and ends on the pinned three members', () => {
  const region = diagnosticUnion();
  const ordered = [...region.matchAll(/\|\s+'([a-z-]+)'/gu)].map((match) => match[1]);
  assert.deepEqual(ordered, [...ordered].sort(), 'D0_CODE_ORDER: the union is not alphabetically sorted');
  assert.deepEqual(
    ordered.slice(-3),
    ['runtime-limit-exceeded', THIRTEENTH_DIAGNOSTIC_CODE, 'unsupported-runtime-input'],
    'D0_CODE_ORDER: the union must end runtime-limit-exceeded | uncaught-throw | unsupported-runtime-input',
  );
});

test('the three prior-slice code pins agree with the union rather than a literal twelve', () => {
  const expected = unionMembers(diagnosticUnion());
  for (const path of CODE_PIN_TESTS) {
    const source = readRepositoryText(path);
    const region = between(source, 'const DIAGNOSTIC_CODES = Object.freeze([', ']);', `d0/${path}`);
    assert.deepEqual(
      [...new Set([...region.matchAll(/'([a-z-]+)'/gu)].map((match) => match[1]))].sort(),
      expected,
      `D0_PIN_SKEW: ${path} pins a different diagnostic code set than kir-runtime/contracts.ts`,
    );
  }
});

test('no fault construction site anywhere in core carries uncaught-throw', () => {
  for (const path of sourceFilesUnder('packages/core/src')) {
    const source = readRepositoryText(path);
    for (const constructor of FAULT_CONSTRUCTORS) {
      let at = source.indexOf(constructor);
      while (at >= 0) {
        const head = source.slice(at, at + constructor.length + 32);
        assert.ok(
          !head.includes(THIRTEENTH_DIAGNOSTIC_CODE),
          `D0_CODE_SPENT: ${path} constructs a fault carrying ${THIRTEENTH_DIAGNOSTIC_CODE}`,
        );
        at = source.indexOf(constructor, at + 1);
      }
    }
  }
});

// The code is not dormant repo-wide: runtime-envelope/normalize.ts already emits it for a throwing
// trace. What D.0 reserves is the KIR-runtime member, which must have no producer at all.
test('the kir-runtime tree names uncaught-throw exactly once, in the union declaration', () => {
  const hits = sourceFilesUnder(KIR_RUNTIME_DIR).filter((path) =>
    readRepositoryText(path).includes(THIRTEENTH_DIAGNOSTIC_CODE),
  );
  assert.deepEqual(
    hits,
    [RUNTIME_CONTRACTS],
    `D0_CODE_LEAK: ${THIRTEENTH_DIAGNOSTIC_CODE} must appear only in the kir-runtime union declaration`,
  );
  assert.equal(
    occurrences(readRepositoryText(RUNTIME_CONTRACTS), THIRTEENTH_DIAGNOSTIC_CODE),
    1,
    `D0_CODE_LEAK: ${THIRTEENTH_DIAGNOSTIC_CODE} must occur once in kir-runtime/contracts.ts`,
  );
});

test('the runtime-envelope normalizer remains the single producer of uncaught-throw', () => {
  assert.ok(
    readRepositoryText('packages/core/src/runtime-envelope/normalize.ts').includes(
      `internalRuntimeFailure('${THIRTEENTH_DIAGNOSTIC_CODE}')`,
    ),
    'D0_PRODUCER_MOVED: normalize.ts must keep emitting uncaught-throw for a throwing trace',
  );
});

test('uncaught-throw is already the frozen RC-v1 public code, so the KIR union converges', () => {
  const constitution = JSON.parse(readRepositoryText('scripts/runtime-contract-v1/constitution.json'));
  assert.ok(
    constitution.diagnostics.codes.includes(THIRTEENTH_DIAGNOSTIC_CODE),
    'D0_CONVERGENCE: constitution.json must already carry uncaught-throw',
  );
  assert.equal(
    constitution.diagnostics.codes.length,
    15,
    'D0_CONSTITUTION_WIDENED: the public diagnostic vocabulary must stay at fifteen codes',
  );
  assert.ok(
    readRepositoryText('scripts/runtime-contract-v1/public-declaration-schema.json').includes(
      `'${THIRTEENTH_DIAGNOSTIC_CODE}'`,
    ),
    'D0_CONVERGENCE: the public handler ABI declaration must already carry uncaught-throw',
  );
  assert.ok(
    readRepositoryText('scripts/runtime-contract-v1/goldens.json').includes('failure-uncaught-throw'),
    'D0_CONVERGENCE: the failure-uncaught-throw golden must already exist',
  );
});

test('no RC-v1 amendment record is added and the chain stays settled', async () => {
  assert.deepEqual(
    readdirSync(repositoryPath(AMENDMENTS_DIR)).sort(),
    ['chain-anchor.json', 'kern-5-runtime-envelope-max-iterations-optional-v1.json',
      'kern-5-runtime-envelope-max-iterations.json'],
    'D0_AMENDMENT_ADDED: the amendments directory must hold exactly the three base records',
  );
  assert.equal(readdirSync(repositoryPath(AMENDMENTS_DIR)).length, RC_V1_AMENDMENT_COUNT);
  const { verifyRuntimeContractAmendmentChain } = await import(
    new URL('../../scripts/runtime-contract-v1/amend.mjs', import.meta.url).href
  );
  const verified = verifyRuntimeContractAmendmentChain();
  assert.equal(verified.pendingRepins.length, 0, 'D0_AMENDMENT_PENDING: no re-pin may be pending');
  assert.equal(
    verified.consumed.length,
    RC_V1_CONSUMED_CHAIN_LENGTH,
    'D0_AMENDMENT_ADDED: the consumed chain length must stay at two',
  );
  assert.deepEqual(verified.rowsChanged, ['limits.maxIterations']);
});

test('the four governed RC-v1 artifact digests are unchanged from base', () => {
  const lineage = JSON.parse(readRepositoryText('scripts/runtime-contract-v1/lineage.json'));
  assert.equal(lineage.versions.length, 1);
  const [version] = lineage.versions;
  for (const [key, digest] of Object.entries(LINEAGE_DIGESTS)) {
    assert.equal(version[key], digest, `D0_RC_V1_DRIFT: ${key} moved from its base pin`);
  }
});

test('no new alpha-receipt binding is claimed', () => {
  const policy = JSON.parse(readRepositoryText('scripts/kir-v1/alpha-receipt-policy.json'));
  assert.equal(
    policy.bindings.length,
    ALPHA_RECEIPT_BINDING_COUNT,
    'D0_RECEIPT_WIDENED: the alpha-receipt binding list must stay at 125 entries',
  );
});
