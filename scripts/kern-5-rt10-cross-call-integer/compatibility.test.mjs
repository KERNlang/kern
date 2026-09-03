import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { TARGET_KERNEL_SHA256 as JAVASCRIPT_KERNEL } from '../../packages/core/dist/compiler/kir-js-esm/emitter.js';
import { TARGET_KERNEL_SHA256 as PYTHON_KERNEL } from '../../packages/core/dist/compiler/kir-python/emitter.js';

const RT2_GOLDEN_URL = new URL('../kern-5-rt2-boolean-if/k0-golden.json', import.meta.url);
const RT3_GOLDEN_URL = new URL('../kern-5-rt3-binary-expression/k0-golden.json', import.meta.url);
const RT4_PROBE_MATRIX_URL = new URL('../kern-5-rt4-user-fn-call/probe-matrix.json', import.meta.url);
const RT4_COMPATIBILITY_URL = new URL('../kern-5-rt4-user-fn-call/compatibility.test.mjs', import.meta.url);
const RT4_TYPE_GATE_URL = new URL('../kern-5-rt4-user-fn-call/type-gate.test.mjs', import.meta.url);
const RT5_VARIANT_COVERAGE_URL = new URL('../kern-5-rt5-async-user-fn-call/variant-coverage.test.mjs', import.meta.url);
const RT6_COMPATIBILITY_URL = new URL('../kern-5-rt6-void-fallthrough/compatibility.test.mjs', import.meta.url);
const RT9_GOLDEN_URL = new URL('../kern-5-rt9-linked-assign/k0-golden.json', import.meta.url);
const RT9_COMPATIBILITY_URL = new URL('../kern-5-rt9-linked-assign/compatibility.test.mjs', import.meta.url);
const RT10PRE_GOLDEN_URL = new URL('../kern-5-rt10-pre-linked-arithmetic/k0-golden.json', import.meta.url);
const F5_POLICY_URL = new URL('../kern-frontend-f5-projection/policy.json', import.meta.url);

// Three goldens scrape a union this slice does not move: RT-2 and RT-9 the statement union,
// RT-3 the expression union. A cross-call type is neither.
const RT2_GOLDEN_SHA256 = 'cc7fb869d3f51ca6222521df52dd70e2364a83c8f97365f8db0a8c83cc2f9908';
const RT3_GOLDEN_SHA256 = 'cb5799446b64c83f82a4a5a044e2b680d41932b5305fffacf8bb5643e99cc7de';
const RT9_GOLDEN_SHA256 = '2378f458943eb450984d8286e43bf45f322aa1f9e862eb0202188436bf2ab94a';

// The frontend is frozen in this slice: no composition, policy or amendment moves.
const F5_POLICY_SHA256 = 'e025392a83b6c6fecad31d7f92a2c34b67403bd0042b1cde9dc4b4223df80519';

// The whole-program target kernel is embedded in every emitted artifact, so these two digests
// are the assertion that no emitted-artifact digest in the repository may be re-sealed.
const JAVASCRIPT_KERNEL_SHA256 = 'b53251fd8a09f58226881b8f32547183e4b8300bab462d1373039426d3b057e6';
const PYTHON_KERNEL_SHA256 = '3df98a2e7b08660a827c2b5ed9f5f64ff0bf1c31e470464ce3a9570d3816d04a';

// The one licensed prior-slice golden move: three admission rows flip from the closed link code
// to admitted, because admitting an integer cross-call is this slice.
const RT10PRE_GOLDEN_PRE_SLICE_SHA256 = '93e47dc288799b3cc7152eddd80f6fd0fcd135b9a5589de76aa8a9ae715e384a';
const RT10PRE_FLIPPED_ROWS = Object.freeze([
  'refuse-integer-helper-call',
  'refuse-integer-helper-operand',
  'refuse-integer-param-helper-call',
]);

const CROSS_CALL_TYPE_NAMES = Object.freeze(['boolean', 'integer', 'list<boolean>', 'list<text>', 'text']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function canonicalGolden(url, label) {
  const raw = await readFile(url, 'utf8');
  const golden = JSON.parse(raw);
  assert.equal(`${JSON.stringify(golden, null, 2)}\n`, raw, `${label} must stay canonically serialized`);
  return { golden, raw };
}

function literal(source, name, label) {
  const match = source.match(new RegExp(`${name}\\s*[:=]\\s*'([0-9a-f]{64})'`, 'u'));
  assert.ok(match !== null, `${label}: ${name} must be a 64-hex literal`);
  return match[1];
}

async function jsonLiteral(url, key, label) {
  const value = JSON.parse(await readFile(url, 'utf8'))[key];
  assert.match(String(value), /^[0-9a-f]{64}$/u, `${label}: ${key} must be a 64-hex digest`);
  return value;
}

test('the RT-2 and RT-9 statement-union goldens are untouched', async () => {
  assert.equal(
    sha256((await canonicalGolden(RT2_GOLDEN_URL, 'the RT-2 golden')).raw),
    RT2_GOLDEN_SHA256,
    'RT10X_PRE_IMAGE_DRIFT: the RT-2 golden pins the statement union, which this slice does not move',
  );
  assert.equal(
    sha256((await canonicalGolden(RT9_GOLDEN_URL, 'the RT-9 golden')).raw),
    RT9_GOLDEN_SHA256,
    'RT10X_PRE_IMAGE_DRIFT: the RT-9 golden pins the statement union too',
  );
});

test('the RT-3 expression-union golden is untouched, because no expression variant is added', async () => {
  const { golden, raw } = await canonicalGolden(RT3_GOLDEN_URL, 'the RT-3 golden');
  assert.equal(
    sha256(raw),
    RT3_GOLDEN_SHA256,
    'RT10X_PRE_IMAGE_DRIFT: a cross-call type is not an expression variant; the RT-3 golden may not move',
  );
  assert.deepEqual(golden.linkedExpressionKinds, [
    'binary',
    'identifier',
    'json-call',
    'list',
    'literal',
    'member',
    'record',
    'unary',
    'user-call',
  ]);
});

test('the frontend is frozen: the F5 projection policy digest is unchanged', async () => {
  assert.equal(
    sha256(await readFile(F5_POLICY_URL)),
    F5_POLICY_SHA256,
    'RT10X_FRONTEND_DRIFT: no F5 policy, composition or amendment moves in this slice',
  );
});

// The claim this slice makes that no prior slice in the ladder could: the target kernel does not
// change, so not one of the 70 emitted-artifact digest lines rt4/rt5/rt6 carry may be re-sealed.
test('both target-kernel digests are unchanged, so no emitted artifact may be re-sealed', () => {
  assert.equal(
    JAVASCRIPT_KERNEL,
    JAVASCRIPT_KERNEL_SHA256,
    'RT10X_KERNEL_DRIFT: the JavaScript target kernel moved, so an artifact re-seal was smuggled in',
  );
  assert.equal(
    PYTHON_KERNEL,
    PYTHON_KERNEL_SHA256,
    'RT10X_KERNEL_DRIFT: the Python target kernel moved, so an artifact re-seal was smuggled in',
  );
});

test('every digest derived from the RT-3 golden is still at the value RT-10-pre left it', async () => {
  const current = sha256((await canonicalGolden(RT3_GOLDEN_URL, 'the RT-3 golden')).raw);
  assert.equal(
    await jsonLiteral(RT4_PROBE_MATRIX_URL, 'rt3GoldenSha256', 'the RT-4 probe matrix'),
    current,
    'RT10X_DERIVED_PIN_DRIFT: rt4 probe-matrix.json rt3GoldenSha256',
  );
  assert.equal(
    literal(await readFile(RT6_COMPATIBILITY_URL, 'utf8'), 'RT3_GOLDEN_SHA256', 'the RT-6 compatibility guard'),
    current,
    'RT10X_DERIVED_PIN_DRIFT: rt6 RT3_GOLDEN_SHA256',
  );
  assert.equal(
    literal(await readFile(RT9_COMPATIBILITY_URL, 'utf8'), 'RT3_GOLDEN_SHA256', 'the RT-9 compatibility guard'),
    current,
    'RT10X_DERIVED_PIN_DRIFT: rt9 RT3_GOLDEN_SHA256',
  );
  const { golden } = await canonicalGolden(RT3_GOLDEN_URL, 'the RT-3 golden');
  const rt4PreImage = {
    ...golden,
    linkedExpressionKinds: golden.linkedExpressionKinds.filter((kind) => kind !== 'user-call'),
  };
  assert.equal(
    literal(await readFile(RT4_COMPATIBILITY_URL, 'utf8'), 'RT3_PRE_SLICE_SHA256', 'the RT-4 compatibility guard'),
    sha256(`${JSON.stringify(rt4PreImage, null, 2)}\n`),
    'RT10X_DERIVED_PIN_DRIFT: rt4 RT3_PRE_SLICE_SHA256 is a digest of a derived pre-image',
  );
});

test('the RT-5 variant-coverage table is untouched, so the async position gate stays complete', async () => {
  const source = await readFile(RT5_VARIANT_COVERAGE_URL, 'utf8');
  const start = source.indexOf('const VARIANTS = Object.freeze({');
  assert.ok(start >= 0, 'the RT-5 coverage table must still be declared');
  const table = source.slice(start, source.indexOf('});', start));
  for (const kind of ['binary', 'unary', 'list', 'record', 'member', 'json-call']) {
    assert.ok(table.includes(kind), `RT10X_VARIANT_COVERAGE_GAP: the RT-5 coverage table must retain ${kind}`);
  }
});

test('undoing the three RT-10-pre admission flips reproduces its pre-slice golden byte for byte', async () => {
  const { golden } = await canonicalGolden(RT10PRE_GOLDEN_URL, 'the RT-10-pre golden');
  for (const row of RT10PRE_FLIPPED_ROWS) {
    assert.equal(
      golden.admission[row],
      'admitted',
      `RT10X_RT10PRE_REPIN_MISSING: ${row} is admitted by this slice and its golden row must say so`,
    );
  }
  const preSlice = {
    ...golden,
    admission: Object.fromEntries(
      Object.entries(golden.admission).map(([name, value]) => [
        name,
        RT10PRE_FLIPPED_ROWS.includes(name) ? 'handler-entry-unsupported' : value,
      ]),
    ),
  };
  assert.equal(
    sha256(`${JSON.stringify(preSlice, null, 2)}\n`),
    RT10PRE_GOLDEN_PRE_SLICE_SHA256,
    'RT10X_PRE_IMAGE_DRIFT: this slice touched the RT-10-pre golden beyond the three admission flips',
  );
});

test('the RT-4 cross-call contract pin names the five admitted cross-call types', async () => {
  const source = await readFile(RT4_TYPE_GATE_URL, 'utf8');
  assert.ok(
    source.includes(`[${CROSS_CALL_TYPE_NAMES.map((name) => `'${name}'`).join(', ')}]`),
    'RT10X_RT4_REPIN_MISSING: the RT-4 exhaustive cross-call key-set pin must gain integer',
  );
  assert.ok(
    /LINKED_KIR_CROSS_CALL_TYPES\.integer/u.test(source),
    'RT10X_RT4_REPIN_MISSING: the RT-4 pin must assert the integer row is a scalar contract',
  );
});
