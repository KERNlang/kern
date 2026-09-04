import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const RT2_GOLDEN_URL = new URL('../kern-5-rt2-boolean-if/k0-golden.json', import.meta.url);
const RT3_GOLDEN_URL = new URL('../kern-5-rt3-binary-expression/k0-golden.json', import.meta.url);
const RT4_PROBE_MATRIX_URL = new URL('../kern-5-rt4-user-fn-call/probe-matrix.json', import.meta.url);
const RT4_COMPATIBILITY_URL = new URL('../kern-5-rt4-user-fn-call/compatibility.test.mjs', import.meta.url);
const RT5_VARIANT_COVERAGE_URL = new URL('../kern-5-rt5-async-user-fn-call/variant-coverage.test.mjs', import.meta.url);
const RT6_COMPATIBILITY_URL = new URL('../kern-5-rt6-void-fallthrough/compatibility.test.mjs', import.meta.url);
const RT9_COMPATIBILITY_URL = new URL('../kern-5-rt9-linked-assign/compatibility.test.mjs', import.meta.url);
const F5_POLICY_URL = new URL('../kern-frontend-f5-projection/policy.json', import.meta.url);

// The RT-2 golden scrapes the statement union only, so this slice may not move it at all.
const RT2_GOLDEN_SHA256 = 'cc7fb869d3f51ca6222521df52dd70e2364a83c8f97365f8db0a8c83cc2f9908';

// The frontend is frozen in this slice: no composition, policy or amendment moves.
const F5_POLICY_SHA256 = '0f62f6c964af7265357ac0ef3f3a8a6aa15ffa2a2800e09ae5877bad90dbd942';

// The one licensed prior-slice golden move: `linkedExpressionKinds` gains "unary".
const RT3_GOLDEN_PRE_SLICE_SHA256 = 'c8a94cc48ebc1e0a7c5364ab6b218a9471b30df02ef60e6fe8ab2d72d677d3f3';

// RT-9 carried the RT-2 golden's digest into the RT-3 golden and preserved the pre-RT-9
// pre-image, so the RT-3 move in this slice drags that derived constant too.
const RT2_GOLDEN_PRE_RT9_SHA256 = 'aa7f116d1b5ad758f7b58f358c026f34c08232bd5311dee4d5ad1211e90afaa0';

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

test('this slice does not touch the RT-2 golden at all', async () => {
  const { raw } = await canonicalGolden(RT2_GOLDEN_URL, 'the RT-2 golden');
  assert.equal(
    sha256(raw),
    RT2_GOLDEN_SHA256,
    'RT10PRE_PRE_IMAGE_DRIFT: the RT-2 golden pins the statement union, which this slice does not move',
  );
});

test('the frontend is frozen: the F5 projection policy digest is unchanged', async () => {
  assert.equal(
    sha256(await readFile(F5_POLICY_URL)),
    F5_POLICY_SHA256,
    'RT10PRE_FRONTEND_DRIFT: no F5 policy, composition or amendment moves in this slice',
  );
});

test('undoing the one RT-10-pre edit reproduces the pre-slice RT-3 golden byte for byte', async () => {
  const { golden } = await canonicalGolden(RT3_GOLDEN_URL, 'the RT-3 golden');
  assert.ok(
    golden.linkedExpressionKinds.includes('unary'),
    'RT10PRE_PRE_IMAGE_DRIFT: the RT-3 golden must carry the unary expression kind',
  );
  const preSlice = {
    ...golden,
    linkedExpressionKinds: golden.linkedExpressionKinds.filter((kind) => kind !== 'unary'),
  };
  assert.equal(
    sha256(`${JSON.stringify(preSlice, null, 2)}\n`),
    RT3_GOLDEN_PRE_SLICE_SHA256,
    'RT10PRE_PRE_IMAGE_DRIFT: this slice touched the RT-3 golden beyond the one expression-kind insertion',
  );
});

// The class RT-9's log calls "a digest whose own input includes the file the previous repin
// edited": three constants are derived from the RT-3 golden and each lives in a different
// prior-slice file, so a missed re-pin is silent unless it is recomputed here.
test('every digest derived from the RT-3 golden is re-pinned to the moved value', async () => {
  const { golden, raw } = await canonicalGolden(RT3_GOLDEN_URL, 'the RT-3 golden');
  const current = sha256(raw);
  assert.equal(
    await jsonLiteral(RT4_PROBE_MATRIX_URL, 'rt3GoldenSha256', 'the RT-4 probe matrix'),
    current,
    'RT10PRE_DERIVED_PIN_DRIFT: rt4 probe-matrix.json rt3GoldenSha256',
  );
  assert.equal(
    literal(await readFile(RT6_COMPATIBILITY_URL, 'utf8'), 'RT3_GOLDEN_SHA256', 'the RT-6 compatibility guard'),
    current,
    'RT10PRE_DERIVED_PIN_DRIFT: rt6 RT3_GOLDEN_SHA256',
  );
  assert.equal(
    literal(await readFile(RT9_COMPATIBILITY_URL, 'utf8'), 'RT3_GOLDEN_SHA256', 'the RT-9 compatibility guard'),
    current,
    'RT10PRE_DERIVED_PIN_DRIFT: rt9 RT3_GOLDEN_SHA256',
  );
  const rt4PreImage = {
    ...golden,
    linkedExpressionKinds: golden.linkedExpressionKinds.filter((kind) => kind !== 'user-call'),
  };
  assert.equal(
    literal(await readFile(RT4_COMPATIBILITY_URL, 'utf8'), 'RT3_PRE_SLICE_SHA256', 'the RT-4 compatibility guard'),
    sha256(`${JSON.stringify(rt4PreImage, null, 2)}\n`),
    'RT10PRE_DERIVED_PIN_DRIFT: rt4 RT3_PRE_SLICE_SHA256 is a digest of a derived pre-image and moves with the golden',
  );
  const rt9PreImage = { ...golden, rt2GoldenSha256: RT2_GOLDEN_PRE_RT9_SHA256 };
  assert.equal(
    literal(await readFile(RT9_COMPATIBILITY_URL, 'utf8'), 'RT3_K0_GOLDEN_PRE_RT9_SHA256', 'the RT-9 pre-image guard'),
    sha256(`${JSON.stringify(rt9PreImage, null, 2)}\n`),
    'RT10PRE_DERIVED_PIN_DRIFT: rt9 RT3_K0_GOLDEN_PRE_RT9_SHA256 is a digest of a derived pre-image',
  );
});

test('the RT-5 variant-coverage table gained its unary row, so the position gate stays complete', async () => {
  const source = await readFile(RT5_VARIANT_COVERAGE_URL, 'utf8');
  const start = source.indexOf('const VARIANTS = Object.freeze({');
  assert.ok(start >= 0, 'the RT-5 coverage table must still be declared');
  const table = source.slice(start, source.indexOf('});', start));
  assert.ok(
    /unary:\s*\{[^}]*carries:\s*true/u.test(table),
    'RT10PRE_VARIANT_COVERAGE_GAP: the unary variant needs a carries:true row in the RT-5 coverage table',
  );
  assert.ok(table.includes("kind: 'unary'"), 'the RT-5 unary row must build a real unary node');
});
