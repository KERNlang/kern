import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadCanonicalizerPropertyRowHeadroomM479 } from './property-row-headroom-m4-79.mjs';
import {
  loadCanonicalizerRuntimeCostM480,
  measureCanonicalizerRuntimeCostM480,
  validateCanonicalizerRuntimeCostM480,
} from './runtime-cost-m4-80.mjs';

const summaryUrl = new URL('./runtime-cost-m4-80.json', import.meta.url);
const RECEIPT_DIGEST = '48465b28f951d5f74a1ea148d2c21a1f28d3dcb13c475ed5885d7c0512046b14';

test('M4.80 freezes the exact canonicalizer runtime-cost reduction', () => {
  const source = readFileSync(summaryUrl);
  const receipt = loadCanonicalizerRuntimeCostM480();
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  assert.deepEqual(measureCanonicalizerRuntimeCostM480(), receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.runtime-cost-reduction.1');
  assert.deepEqual(receipt.baseline, {
    exactFloor: 56_238,
    implementationBaseCommit: '990898fba53f88e71dce24e5e783d47b9c91b62c',
    m479ReceiptSha256: 'd8683f1440e8bb0f8496ab1845c83c7dabe73dbfd26114b78685d8c8e1cf830b',
    promotionBudgetDeficit: 7_086,
  });
  assert.deepEqual(receipt.limits, {
    activeProfile: { maxNodeRows: 38, maxPropertyRows: 53, maxValueRows: 461 },
    candidateProfile: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 461 },
    maxDepth: 64,
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
  });
  assert.deepEqual(receipt.result, {
    belowFloorOutcome: 'failure',
    exactFloor: 35_998,
    floorOutcome: 'success',
    floorReduction: 20_240,
    productionHeadroom: 29_538,
    promotionHeadroom: 13_154,
    roundTrip: true,
  });
  assert.deepEqual(receipt.promotion, {
    disposition: 'headroom-authenticated',
    nextMilestone: 'M4.81',
  });
  assert.deepEqual(receipt.optimization, {
    exactValueTablePasses: 1,
    forbiddenWholeTableHelpers: ['recordfield', 'valuechildcount'],
    helper: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#16:typefields',
    owner: 'examples/kern-canonicalizer/canonicalizer.kern#0:typesource',
    strategy: 'merged-direct-child-field-scan',
  });
  assert.deepEqual(receipt.source, {
    canonicalizerCompositeSha256: 'fe5087dfcb79898a4b5d46cd233a2bbbeea156417f18ac314e87330172e31b28',
    canonicalizerExpressionHelpersSha256: '1a1ae1f95e20b458021bf78b82f6b0d1cbe639579fcdd64c6709f1c741ce35e4',
    canonicalizerPolicySha256: 'ac4983323d0e9da875e75ae12aff079d8d52deee069d77f703280a06f2f42244',
    canonicalizerSourceSha256: 'de5eb248401e933a05c7f55789a872f07c084c28e140f6561dd4205b71c57e00',
    compositionSha256: '894cf14bc391d3109a20fb6abef8d1c98cab426e2ed6d238d414c8aee46cff3b',
    inputSourceSha256: '84ca20346a655595cbaab095e3b46b964e46acabd90ead29d1d1a3c6813e8b60',
    runtimeHandlerAbi: 'kern.runtime.handler.v1',
    structuralKirCodecSha256: '04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab',
  });
  assert.deepEqual(receipt.witness, {
    id: 'examples/capstone-checker-subset/checker-while.kern#16:checkWhileCore',
    parameterRows: 22,
    profileRows: { nodes: 38, properties: 61, values: 460 },
  });
});

test('M4.80 rejects receipt drift, decorated data, cycles, and shared references', () => {
  const actual = loadCanonicalizerRuntimeCostM480();
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.runtime-cost-reduction.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.result.exactFloor -= 1; },
    (copy) => { copy.result.floorReduction -= 1; },
    (copy) => { copy.result.roundTrip = false; },
    (copy) => { copy.optimization.exactValueTablePasses += 1; },
    (copy) => { copy.promotion.disposition = 'rejected-over-budget'; },
    (copy) => { copy.limits.activeProfile.maxPropertyRows += 1; },
  ]) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeCostM480(copy),
      /coverage M4\.80 runtime-cost rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), actual);
  assert.throws(
    () => validateCanonicalizerRuntimeCostM480(decorated),
    /coverage M4\.80 runtime-cost rejection/u,
  );
  const shared = structuredClone(actual);
  shared.future = shared.limits;
  assert.throws(
    () => validateCanonicalizerRuntimeCostM480(shared),
    /cycles or shared references/u,
  );
  const cyclic = structuredClone(actual);
  cyclic.future = cyclic;
  assert.throws(
    () => validateCanonicalizerRuntimeCostM480(cyclic),
    /cycles or shared references/u,
  );
});

test('M4.80 preserves M4.79 and reproduces in a fresh locale-independent process', () => {
  const m479 = loadCanonicalizerPropertyRowHeadroomM479();
  assert.equal(
    createHash('sha256').update(`${JSON.stringify(m479, null, 2)}\n`).digest('hex'),
    'd8683f1440e8bb0f8496ab1845c83c7dabe73dbfd26114b78685d8c8e1cf830b',
  );
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadCanonicalizerRuntimeCostM480 as load} from './scripts/kern-canonicalizer/runtime-cost-m4-80.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadCanonicalizerRuntimeCostM480());
});
