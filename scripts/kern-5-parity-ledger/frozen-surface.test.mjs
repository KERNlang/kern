import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { TARGET_KERNEL_SHA256 as JAVASCRIPT_KERNEL } from '../../packages/core/dist/compiler/kir-js-esm/emitter.js';
import { TARGET_KERNEL_SHA256 as PYTHON_KERNEL } from '../../packages/core/dist/compiler/kir-python/emitter.js';
import { C_PY_1_LOWERING_COMPILED_SUCCESSOR_TRANSITION } from '../kern-canonicalizer/c-py-1-lowering-historical-transition.mjs';

import {
  EXPRESSION_POSITIONS,
  STATEMENT_POSITIONS,
  compilePython,
  sha256,
  source,
  verified,
} from './ledger-support.mjs';

const CORE_SRC = new URL('../../packages/core/src/', import.meta.url);
const CORE_DIST = new URL('../../packages/core/dist/', import.meta.url);
const KIR_PYTHON_SRC = new URL('compiler/kir-python/', CORE_SRC);
const EMISSION_GOLDEN_URL = new URL('./emission-golden.json', import.meta.url);
const DECLARATION_SCHEMA_URL = new URL('../runtime-contract-v1/public-declaration-schema.json', import.meta.url);
const ALPHA_RECEIPT_POLICY_URL = new URL('../kir-v1/alpha-receipt-policy.json', import.meta.url);
const RT2_GOLDEN_TEST_URL = new URL('../kern-5-rt2-boolean-if/k0-golden.test.mjs', import.meta.url);
const RT4_SUPPORT_URL = new URL('../kern-5-rt4-user-fn-call/k0-support.mjs', import.meta.url);

const EMITTER_SHA256 = 'c37b5c0092dd712e30f49b07ae7bc0ba1bb26343bcc219e29c750457756518d8';
const FACADE_SHA256 = 'eade928a03649637cad48115a6e4023898765963739e27ca73aa5eca41ccdcf7';
const JAVASCRIPT_KERNEL_SHA256 = 'b53251fd8a09f58226881b8f32547183e4b8300bab462d1373039426d3b057e6';
const PYTHON_KERNEL_SHA256 = 'f79a39633f58475124eafdec3c62a9fd042ffa50b1de637509d0f66e0f0cd18e';
const COMPILED_CORE_COUNT = 354;

const KIR_PYTHON_FILES = Object.freeze([
  'contracts.ts',
  'emitter.ts',
  'index.ts',
  'request.ts',
  'target-base.ts',
  'target-execution.ts',
  'target-json.ts',
]);

const NEIGHBOUR_GOLDENS = Object.freeze({
  'kern-5-rt10-cross-call-integer': '6deab8ccfd16aacc79543fad945b62e62a71027bc1c2673b764125fa9158f4cf',
  'kern-5-rt10-pre-linked-arithmetic': '87efee4df8ce4fbde5d954d74e859f3e4f889598e0f35fedca8d56705515f718',
  'kern-5-rt2-boolean-if': '6d6754e75d5d9846a1201101831a528dfc7021374d4f1f6d5eacc0d6e0b8bff2',
  'kern-5-rt3-binary-expression': '935da8148df5c02d5d405fea2db00fb7f5f6db08158d9cdca0d61c0084972b18',
  'kern-5-rt6-void-fallthrough': '429de5ebbb5e606acfd48764b506d38b6abc4c5c6270bca883b34aa027306e81',
  'kern-5-rt9-linked-assign': 'c8a7253c86d6c04c73370129dfa99f0cf2e510eaad3e64410076c93785ddedb4',
});

function distJavaScriptCount(directory) {
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) total += distJavaScriptCount(new URL(`${entry.name}/`, directory));
    else if (entry.isFile() && entry.name.endsWith('.js')) total += 1;
  }
  return total;
}

test('the Python emitter stays byte-identical', () => {
  assert.equal(
    sha256(readFileSync(new URL('emitter.ts', KIR_PYTHON_SRC))),
    EMITTER_SHA256,
    'PARITY_LEDGER_EMITTER_TOUCH: the frozen Python emitter moved',
  );
});

test('the public Python compiler facade gains no export', () => {
  assert.equal(
    sha256(readFileSync(new URL('compiler-kir-python.ts', CORE_SRC))),
    FACADE_SHA256,
    'PARITY_LEDGER_PUBLIC_SURFACE: the deferral must not widen the package subpath',
  );
});

test('both target kernels are unchanged', () => {
  assert.equal(JAVASCRIPT_KERNEL, JAVASCRIPT_KERNEL_SHA256, 'PARITY_LEDGER_KERNEL_TOUCH: the JavaScript kernel moved');
  assert.equal(PYTHON_KERNEL, PYTHON_KERNEL_SHA256, 'PARITY_LEDGER_KERNEL_TOUCH: the Python kernel moved');
});

test('the compiled-core inventory stays at the attested 354 files', () => {
  assert.equal(C_PY_1_LOWERING_COMPILED_SUCCESSOR_TRANSITION.currentInventory.count, COMPILED_CORE_COUNT);
  assert.equal(
    distJavaScriptCount(CORE_DIST),
    COMPILED_CORE_COUNT,
    'PARITY_LEDGER_INVENTORY: the ledger and the admission pass must add no file under packages/core/src',
  );
});

test('the kir-python directory holds exactly the seven files it already had', () => {
  assert.deepEqual(readdirSync(KIR_PYTHON_SRC).sort(), [...KIR_PYTHON_FILES]);
});

test('the neighbour K0 goldens do not move', () => {
  for (const [slice, expected] of Object.entries(NEIGHBOUR_GOLDENS)) {
    const url = new URL(`../${slice}/k0-golden.json`, import.meta.url);
    assert.equal(sha256(readFileSync(url)), expected, `PARITY_LEDGER_GOLDEN_DRIFT: the ${slice} golden moved`);
  }
});

// The two cross-leg equality assertions the first deferred row will have to amend. They are green
// today because the ledger is empty, and naming them here is what stops that amendment being a
// surprise in the slice that adds the row.
test('the cross-leg agreement tripwires are still in place and still green', () => {
  assert.match(source(RT2_GOLDEN_TEST_URL), /both targets share one linker/u);
  assert.match(source(RT4_SUPPORT_URL), /assert\.equal\(row\.python, 'handler-entry-unsupported', label\)/u);
});

test('no emitted Python byte moves in this slice', async () => {
  const golden = JSON.parse(source(EMISSION_GOLDEN_URL));
  const positions = { ...STATEMENT_POSITIONS, ...EXPRESSION_POSITIONS };
  const artifacts = {};
  for (const name of Object.keys(positions).sort()) {
    const result = compilePython(await verified(positions[name]()));
    assert.equal(result.outcome, 'success', `${name}: ${result.code}`);
    artifacts[name] = sha256(Buffer.from(result.artifact.bytes));
  }
  assert.equal(golden.format, 'kern.compiler.kir-python.parity-ledger.emission-golden.v1');
  assert.deepEqual(artifacts, golden.artifacts, 'PARITY_LEDGER_EMISSION_DRIFT: emitted Python changed');
});

// Public-contract honesty: the Python compiler's result schema is not part of runtime-contract-v1's
// declared surface, and no kir-python path is bound by the alpha-receipt policy, so widening the
// failure-code union needs no amendment record. If either becomes false, one is required.
test('runtime-contract-v1 does not declare the Python compiler result', () => {
  const schema = source(DECLARATION_SCHEMA_URL);
  assert.equal(schema.includes('KernKirPythonCompile'), false, 'PARITY_LEDGER_AMENDMENT: RC-v1 now declares it');
  assert.equal(schema.includes('kern.compiler.kir-python'), false, 'PARITY_LEDGER_AMENDMENT: RC-v1 now declares it');
});

test('the alpha-receipt policy binds no kir-python compiler path', () => {
  const policy = JSON.parse(source(ALPHA_RECEIPT_POLICY_URL));
  const bound = policy.bindings.filter((path) => path.includes('compiler/kir-python'));
  assert.deepEqual(bound, [], 'PARITY_LEDGER_RECEIPT_BINDING: a kir-python path is now receipt-bound');
});
