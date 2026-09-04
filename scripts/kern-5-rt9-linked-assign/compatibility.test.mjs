import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const RT2_GOLDEN_URL = new URL('../kern-5-rt2-boolean-if/k0-golden.json', import.meta.url);
const RT3_GOLDEN_URL = new URL('../kern-5-rt3-binary-expression/k0-golden.json', import.meta.url);

// The seals RT-9 re-pinned in the rt4/rt5/rt6 compatibility guards.
const RT2_GOLDEN_SHA256 = '6d6754e75d5d9846a1201101831a528dfc7021374d4f1f6d5eacc0d6e0b8bff2';
const RT3_GOLDEN_SHA256 = '935da8148df5c02d5d405fea2db00fb7f5f6db08158d9cdca0d61c0084972b18';

// The pre-images those seals replaced, preserved here rather than in the frozen guards they left:
// spec Corrections Log, resolution (A) plus its rider.
const RT2_K0_GOLDEN_PRE_RT9_SHA256 = 'aa7f116d1b5ad758f7b58f358c026f34c08232bd5311dee4d5ad1211e90afaa0';
const RT3_K0_GOLDEN_PRE_RT9_SHA256 = '0eca34b6680ca2861fe6cb03fb5c1a0e31326aceb1ee3307afa6650d064f2e86';

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
  const { for: _forAdmission, ...admissionBeforeFor } = golden.admission;
  const preRt9 = {
    ...golden,
    admission: { ...admissionBeforeFor, assign: 'projection-rejected' },
    linkedStatementKinds: golden.linkedStatementKinds.filter((kind) => kind !== 'assign' && kind !== 'for'),
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
