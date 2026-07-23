import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPublishedCanonicalizerResidualAnalysisM470 } from './coverage-residual-analysis-m4-70.mjs';
import {
  loadCanonicalizerDualRowHeadroomM471,
  measureCanonicalizerDualRowHeadroomM471,
  validateCanonicalizerDualRowHeadroomM471,
} from './dual-row-headroom-m4-71.mjs';

const summaryUrl = new URL('./dual-row-headroom-m4-71.json', import.meta.url);
const RECEIPT_DIGEST = '8be340082e3a5de479b015d4f0f4248486286290ed981cbf5715538069638c12';

test('M4.71 authenticates the exact dual-row structural headroom receipt', () => {
  const source = readFileSync(summaryUrl);
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  const receipt = loadCanonicalizerDualRowHeadroomM471();
  assert.deepEqual(receipt, measureCanonicalizerDualRowHeadroomM471());
  assert.equal(receipt.format, 'kern.kir-canonicalizer.dual-row-headroom.2');
  assert.equal(receipt.artifactScope, 'structural-kir-function');
  assert.deepEqual(receipt.limits, {
    candidateProfile: { maxNodeRows: 31, maxPropertyRows: 53, maxValueRows: 388 },
    productionMaxCollectionLength: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 36_193,
    minimumProductionHeadroom: 29_343,
    minimumPromotionHeadroom: 12_959,
    witnessCount: 1,
  });
  assert.deepEqual(
    receipt.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    [{
      exactFloor: 36_193,
      id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#1:validstatementlist',
      parameterRows: 14,
      profileRows: { nodes: 31, properties: 53, values: 370 },
    }],
  );
  assert.ok(receipt.witnesses[0].exactFloor <= receipt.limits.promotionBudget);
  assert.deepEqual(receipt.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.equal(
    receipt.source.residualAnalysisSha256,
    '2e1b2dea394f8a238b2f63b4a7045576b1843948740b3a6666b0c002971d8401',
  );
  assert.equal(
    receipt.source.residualAnalysisInputCommit,
    'e5069dc45a9d849ce02dbdc047cdfb78d0c55270',
  );
});

test('M4.71 rejects receipt drift, decorated data, and shared references', () => {
  const actual = loadCanonicalizerDualRowHeadroomM471();
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.dual-row-headroom.3'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.limits.candidateProfile.maxPropertyRows += 1; },
    (copy) => { copy.witnesses[0].exactFloor += 1; },
    (copy) => { copy.witnesses[0].roundTrip = false; },
    (copy) => { copy.moduleEnvelope.disposition = 'proven'; },
  ]) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerDualRowHeadroomM471(copy),
      /coverage M4\.71 dual-row headroom rejection/u,
    );
  }
  const decorated = Object.assign(Object.create({ inherited: true }), actual);
  assert.throws(
    () => validateCanonicalizerDualRowHeadroomM471(decorated),
    /coverage M4\.71 dual-row headroom rejection/u,
  );
  const shared = structuredClone(actual);
  shared.future = shared.limits;
  assert.throws(
    () => validateCanonicalizerDualRowHeadroomM471(shared),
    /cycles or shared references/u,
  );
});

test('M4.71 preserves M4.70 and reproduces in a fresh locale-independent process', () => {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM470();
  assert.equal(analysis.digest,
    '2e1b2dea394f8a238b2f63b4a7045576b1843948740b3a6666b0c002971d8401');
  assert.equal(analysis.inputCommit, 'e5069dc45a9d849ce02dbdc047cdfb78d0c55270');
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {loadCanonicalizerDualRowHeadroomM471 as load} from './scripts/kern-canonicalizer/dual-row-headroom-m4-71.mjs'; process.stdout.write(JSON.stringify(load()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadCanonicalizerDualRowHeadroomM471());
});
