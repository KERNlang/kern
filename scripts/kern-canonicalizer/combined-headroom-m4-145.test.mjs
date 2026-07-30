import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildCanonicalizerCombinedHeadroomM4145,
  loadCanonicalizerCombinedHeadroomM4145,
  validateCanonicalizerCombinedHeadroomM4145,
} from './combined-headroom-m4-145.mjs';
import {
  measureCanonicalizerCombinedHeadroomWitnessM4145,
} from './combined-headroom-m4-145-measure.mjs';
import {
  loadPublishedCanonicalizerProjectionAnalysisM4144,
} from './projection-analysis-m4-144.mjs';

const RECEIPT_URL = new URL('./combined-headroom-m4-145.json', import.meta.url);
const RECEIPT_DIGEST =
  'e61beda6a311742d0475fdcd52ab0147cffe74300c1ee339ea79acceb3f147ba';
const WITNESS_ID =
  'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources';

test('M4.145 authenticates structural and runtime headroom GO', () => {
  const source = readFileSync(RECEIPT_URL);
  const receipt = loadCanonicalizerCombinedHeadroomM4145();
  assert.equal(createHash('sha256').update(source).digest('hex'), RECEIPT_DIGEST);
  assert.deepEqual(validateCanonicalizerCombinedHeadroomM4145(receipt), receipt);
  assert.deepEqual(buildCanonicalizerCombinedHeadroomM4145(), receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.combined-headroom.2');
  assert.deepEqual(receipt.limits, {
    activeKir: { maxBytes: 273_051, maxDepth: 98, maxNodes: 5_313 },
    activeProfile: { maxNodeRows: 202, maxPropertyRows: 308, maxValueRows: 4_493 },
    candidateKir: { maxBytes: 367_368, maxDepth: 122, maxNodes: 7_136 },
    candidateProfile: { maxNodeRows: 205, maxPropertyRows: 332, maxValueRows: 6_304 },
    derivedRuntimeBytes: { maxBytes: 2_938_944, maxStringBytes: 1_469_472 },
    productionBudget: 65_536,
    promotionBudget: 49_152,
    reservedProductionHeadroom: 16_384,
    runtimeMaxDepth: 64,
  });
  assert.deepEqual(receipt.promotion, {
    combinedPromotionApproved: true,
    disposition: 'promotion-budget-headroom-authenticated',
    nextMilestone: 'M4.146',
    productionHeadroom: 22_482,
    promotionBudgetHeadroom: 6_098,
    promotionReady: true,
  });
  assert.deepEqual(receipt.summary, {
    maxExactFloor: 43_054,
    minimumProductionHeadroom: 22_482,
    minimumPromotionHeadroom: 6_098,
    totalArtifactBytes: 367_368,
    totalParameterRows: 6,
    witnessCount: 1,
  });
  assert.deepEqual(receipt.witnesses, [{
    artifactBytes: 367_368,
    belowFloor: 43_053,
    belowFloorOutcome: 'failure',
    exactFloor: 43_054,
    floorOutcome: 'success',
    id: WITNESS_ID,
    loopIterations: {
      attemptedByType: { for: 42_666, while: 388 },
      attemptedTotal: 43_054,
    },
    observerParityVerified: true,
    parameterRows: 6,
    productionDelta: 22_482,
    profileRows: { nodes: 205, properties: 332, values: 6_304 },
    promotionDelta: 6_098,
    publicParityVerified: true,
    roundTrip: true,
  }]);
});

test('M4.145 exact floor fails below and succeeds with observer and public parity', () => {
  const below = measureCanonicalizerCombinedHeadroomWitnessM4145(43_053);
  assert.equal(below.envelope.outcome, 'failure');
  assert.deepEqual(below.envelope.diagnostics.map(({ code }) => code), [
    'unsupported-runtime-input',
  ]);
  assert.equal(below.roundTrip, false);
  assert.deepEqual(below.loopIterations, {
    attemptedByType: { for: 42_665, while: 388 },
    attemptedTotal: 43_053,
  });

  const exact = measureCanonicalizerCombinedHeadroomWitnessM4145(
    43_054,
    { verifyObserverParity: true, verifyPublicParity: true },
  );
  assert.equal(exact.envelope.outcome, 'success');
  assert.equal(exact.roundTrip, true);
  assert.equal(exact.observerParityVerified, true);
  assert.equal(exact.publicParityVerified, true);
  assert.equal(exact.artifactBytes, 367_368);
  assert.deepEqual(exact.structuralRows, {
    nodes: 205,
    properties: 332,
    values: 6_304,
  });
  assert.deepEqual(exact.loopIterations, {
    attemptedByType: { for: 42_666, while: 388 },
    attemptedTotal: 43_054,
  });
});

test('M4.145 measurement rejects invalid budgets and imports quietly', () => {
  assert.throws(
    () => measureCanonicalizerCombinedHeadroomWitnessM4145(0),
    /M4\.145 combined headroom measurement rejection/u,
  );
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "await import('./scripts/kern-canonicalizer/combined-headroom-m4-145-measure.mjs'); process.stdout.write('quiet')",
      'scripts/check-kern-canonicalizer-coverage.mjs',
      '43054',
    ],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(output, 'quiet');
});

test('M4.145 rejects receipt mutation and non-exact plain data', () => {
  const actual = loadCanonicalizerCombinedHeadroomM4145();
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.combined-headroom.1'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.source.publishedInputCommit = '0'.repeat(40); },
    (copy) => { copy.limits.candidateKir.maxBytes += 1; },
    (copy) => { copy.structuralBoundary.rejectedLimits[2].limit += 1; },
    (copy) => { copy.witnesses[0].exactFloor -= 1; },
    (copy) => { copy.witnesses[0].loopIterations.attemptedByType.for -= 1; },
    (copy) => { copy.promotion.combinedPromotionApproved = false; },
  ]) {
    const copy = structuredClone(actual);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerCombinedHeadroomM4145(copy),
      /coverage M4\.145 combined headroom rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), actual);
  assert.throws(
    () => validateCanonicalizerCombinedHeadroomM4145(decorated),
    /coverage M4\.145 combined headroom rejection/u,
  );

  const accessor = structuredClone(actual);
  Object.defineProperty(accessor.summary, 'maxExactFloor', {
    configurable: true,
    enumerable: true,
    get: () => 43_054,
  });
  assert.throws(
    () => validateCanonicalizerCombinedHeadroomM4145(accessor),
    /coverage M4\.145 combined headroom rejection/u,
  );

  const shared = structuredClone(actual);
  shared.future = shared.limits;
  assert.throws(
    () => validateCanonicalizerCombinedHeadroomM4145(shared),
    /coverage M4\.145 combined headroom rejection/u,
  );

  const cyclic = structuredClone(actual);
  cyclic.future = cyclic;
  assert.throws(
    () => validateCanonicalizerCombinedHeadroomM4145(cyclic),
    /coverage M4\.145 combined headroom rejection/u,
  );
});

test('M4.145 preserves M4.144 and loads canonically in a fresh process', () => {
  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4144();
  assert.equal(
    analysis.digest,
    '0aa57f2721cd76c9fed61ab5aaf22deccb868277e3627587712c92c907a6b086',
  );
  assert.equal(readFileSync(RECEIPT_URL, 'utf8'), `${
    JSON.stringify(loadCanonicalizerCombinedHeadroomM4145(), null, 2)
  }\n`);
  const fresh = JSON.parse(execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {loadCanonicalizerCombinedHeadroomM4145 as load} from './scripts/kern-canonicalizer/combined-headroom-m4-145.mjs'; process.stdout.write(JSON.stringify(load()))",
    ],
    {
      cwd: new URL('../../', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    },
  ));
  assert.deepEqual(fresh, loadCanonicalizerCombinedHeadroomM4145());
});

test('M4.145 loader rejects symlinks, invalid JSON, and noncanonical bytes', () => {
  const directory = mkdtempSync(
    join(realpathSync(tmpdir()), 'kern-m4-145-receipt-'),
  );
  try {
    const invalidJson = join(directory, 'invalid.json');
    writeFileSync(invalidJson, '{');
    assert.throws(
      () => loadCanonicalizerCombinedHeadroomM4145(invalidJson),
      /receipt must be valid JSON/u,
    );

    const noncanonical = join(directory, 'noncanonical.json');
    writeFileSync(
      noncanonical,
      JSON.stringify(loadCanonicalizerCombinedHeadroomM4145()),
    );
    assert.throws(
      () => loadCanonicalizerCombinedHeadroomM4145(noncanonical),
      /receipt must use canonical JSON bytes/u,
    );

    const symlink = join(directory, 'symlink.json');
    symlinkSync(fileURLToPath(RECEIPT_URL), symlink);
    assert.throws(
      () => loadCanonicalizerCombinedHeadroomM4145(symlink),
      /receipt must be a regular non-symlink file/u,
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('M4.145 direct invocation through a symlink still requires --write', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kern-m4-145-entry-'));
  try {
    const link = join(directory, 'combined-headroom-m4-145.mjs');
    symlinkSync(
      fileURLToPath(new URL('./combined-headroom-m4-145.mjs', import.meta.url)),
      link,
    );
    const fresh = spawnSync(process.execPath, [link], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      encoding: 'utf8',
    });
    assert.notEqual(fresh.status, 0);
    assert.match(fresh.stderr, /direct invocation requires exactly --write/u);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
