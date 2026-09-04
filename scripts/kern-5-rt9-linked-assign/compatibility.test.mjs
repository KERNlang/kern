import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const RT2_GOLDEN_URL = new URL('../kern-5-rt2-boolean-if/k0-golden.json', import.meta.url);
const RT3_GOLDEN_URL = new URL('../kern-5-rt3-binary-expression/k0-golden.json', import.meta.url);

// The seals RT-9 re-pinned in the rt4/rt5/rt6 compatibility guards.
const RT2_GOLDEN_SHA256 = 'cc7fb869d3f51ca6222521df52dd70e2364a83c8f97365f8db0a8c83cc2f9908';
const RT3_GOLDEN_SHA256 = 'c8a94cc48ebc1e0a7c5364ab6b218a9471b30df02ef60e6fe8ab2d72d677d3f3';

// The pre-images those seals replaced, preserved here rather than in the frozen guards they left:
// spec Corrections Log, resolution (A) plus its rider.
const RT2_K0_GOLDEN_PRE_RT9_SHA256 = 'aa7f116d1b5ad758f7b58f358c026f34c08232bd5311dee4d5ad1211e90afaa0';
const RT3_K0_GOLDEN_PRE_RT9_SHA256 = 'ac690563c41feb50dc889c580de6cb763390484183c3795a513ec63a674a12cf';

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function canonicalGolden(url, label) {
  const raw = await readFile(url, 'utf8');
  const golden = JSON.parse(raw);
  assert.equal(`${JSON.stringify(golden, null, 2)}\n`, raw, `${label} must stay canonically serialized`);
  return { golden, raw };
}

test('undoing the two RT-9 edits reproduces the pre-RT-9 RT-2 K0 golden byte for byte', async () => {
  const { golden, raw } = await canonicalGolden(RT2_GOLDEN_URL, 'the RT-2 golden');
  assert.equal(sha256(raw), RT2_GOLDEN_SHA256, 'RT9_PRE_IMAGE_DRIFT: the RT-2 golden is not at its re-pinned seal');
  assert.equal(golden.admission.assign, 'admitted');
  assert.ok(golden.linkedStatementKinds.includes('assign'));
  const preRt9 = {
    ...golden,
    admission: { ...golden.admission, assign: 'projection-rejected' },
    linkedStatementKinds: golden.linkedStatementKinds.filter((kind) => kind !== 'assign'),
  };
  assert.equal(
    sha256(`${JSON.stringify(preRt9, null, 2)}\n`),
    RT2_K0_GOLDEN_PRE_RT9_SHA256,
    'RT9_PRE_IMAGE_DRIFT: RT-9 touched the RT-2 golden beyond the assign admission row and the statement union',
  );
});

test('resetting the one carried digest reproduces the pre-RT-9 RT-3 K0 golden byte for byte', async () => {
  const { golden, raw } = await canonicalGolden(RT3_GOLDEN_URL, 'the RT-3 golden');
  assert.equal(sha256(raw), RT3_GOLDEN_SHA256, 'RT9_PRE_IMAGE_DRIFT: the RT-3 golden is not at its re-pinned seal');
  assert.equal(golden.rt2GoldenSha256, RT2_GOLDEN_SHA256);
  const preRt9 = { ...golden, rt2GoldenSha256: RT2_K0_GOLDEN_PRE_RT9_SHA256 };
  assert.equal(
    sha256(`${JSON.stringify(preRt9, null, 2)}\n`),
    RT3_K0_GOLDEN_PRE_RT9_SHA256,
    'RT9_PRE_IMAGE_DRIFT: RT-9 touched the RT-3 golden beyond the rt2GoldenSha256 literal',
  );
});
