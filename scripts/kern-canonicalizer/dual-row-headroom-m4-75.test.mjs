import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM474 } from './coverage-residual-analysis-m4-74.mjs';
import { assertCanonicalizerDualRowHeadroomM475 } from './dual-row-headroom-m4-75-check.mjs';
import {
  loadPublishedCanonicalizerDualRowHeadroomM475,
  validatePublishedCanonicalizerDualRowHeadroomM475,
} from './dual-row-headroom-m4-75.mjs';

const summaryUrl = new URL('./dual-row-headroom-m4-75.json', import.meta.url);
const RECEIPT_DIGEST = 'c70022af6c90620c9ade8c03cff85eba41c53966f515b5523bd774985cb877f6';

test('M4.75 freezes the exact node+value structural headroom receipt', () => {
  const source = readFileSync(summaryUrl);
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  const handoff = loadPublishedCanonicalizerDualRowHeadroomM475();
  assert.equal(handoff.digest, RECEIPT_DIGEST);
  assert.equal(handoff.sourceCommit, '177212fc4cc1ba0c15f04e1092657b4d335067e9');
  const receipt = handoff.record;
  assert.deepEqual(assertCanonicalizerDualRowHeadroomM475(), receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.dual-row-headroom.3');
  assert.deepEqual(receipt.limits, {
    candidateProfile: { maxNodeRows: 38, maxPropertyRows: 53, maxValueRows: 461 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 46_255,
    minimumProductionHeadroom: 19_281,
    minimumPromotionHeadroom: 2_897,
    witnessCount: 1,
  });
  assert.deepEqual(
    receipt.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    [{
      exactFloor: 46_255,
      id: 'examples/kern-canonicalizer/canonicalizer.kern#0:typesource',
      parameterRows: 6,
      profileRows: { nodes: 38, properties: 51, values: 461 },
    }],
  );
  assert.ok(receipt.witnesses[0].exactFloor <= receipt.limits.promotionBudget);
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.equal(
    receipt.source.residualAnalysisSha256,
    'dae5ecfb09bd07575a8436771ff770c6ea544ea5efecba16ae45010b8f0df6e0',
  );
  assert.equal(
    receipt.source.publishedInputCommit,
    'b867c5d5b67917f7abc7cdc3da5c76b867c69cf5',
  );
  assert.equal(
    receipt.source.publishedCoverageImplementationDigest,
    '025fbf7ea33aecf8e1ee36fc6ef2334fbb2a71641777660473953e9da38a36ee',
  );
});

test('M4.75 rejects receipt drift, decorated data, and shared references', () => {
  const actual = loadPublishedCanonicalizerDualRowHeadroomM475().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.dual-row-headroom.4'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.limits.candidateProfile.maxNodeRows += 1; },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.witnesses[0].roundTrip = false; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerDualRowHeadroomM475(copy),
      /coverage M4\.75 dual-row headroom rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), actual);
  assert.throws(
    () => validatePublishedCanonicalizerDualRowHeadroomM475(decorated),
    /coverage M4\.75 dual-row headroom rejection/u,
  );
  const shared = structuredClone(actual);
  shared.future = shared.limits;
  assert.throws(
    () => validatePublishedCanonicalizerDualRowHeadroomM475(shared),
    /cycles or shared references/u,
  );
});

test('M4.75 preserves M4.74 and reproduces in a fresh locale-independent process', () => {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM474();
  assert.equal(
    analysis.digest,
    'dae5ecfb09bd07575a8436771ff770c6ea544ea5efecba16ae45010b8f0df6e0',
  );
  assert.equal(analysis.inputCommit, '1fe7851101cf2a25e1aebfd561655bb458aec66b');
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadPublishedCanonicalizerDualRowHeadroomM475 as load} from './scripts/kern-canonicalizer/dual-row-headroom-m4-75.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerDualRowHeadroomM475());
});
