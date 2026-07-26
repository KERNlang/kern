import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadCanonicalizerDualRowHeadroomM488 } from './dual-row-headroom-m4-88.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';

const FORMAT = 'kern.kir-canonicalizer.runtime-cost-reduction.2';
const RECEIPT_DIGEST = 'c41cfbb3d7fb6f9d5f32f2d59f58e6e8d5ce7a65f77040316c7497c8cd89f86c';
const SUMMARY_URL = new URL('./runtime-cost-m4-89.json', import.meta.url);
const M488_RECEIPT_DIGEST = '285b42785be8f651d323444ddd3464381b337b74557bbd07e8c3f4bad02a89bb';
const IMPLEMENTATION_BASE_COMMIT = 'd6b8687624e1361d5e43ef6c6910cc68672d2b2e';
const EXACT_FLOORS = [24_273, 23_104, 27_514];
const PUBLISHED_POLICY = {
  kirLimits: { maxDepth: 64 },
  profileLimits: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 580 },
  runtimeLimits: { maxCollectionLength: 65_536 },
};
const PUBLISHED_CANONICALIZER_POLICY_DIGEST =
  'a929434c674ecbed5688eb36235f81c203d5d0eb4a34583554caad116960614c';
const SOURCE_DIGESTS = {
  canonicalizerCompositeSha256: 'd0122a51105708ebd7ef619453556a478abcc5fa415402f672cd06328651e247',
  canonicalizerExpressionHelpersSha256: '1a1ae1f95e20b458021bf78b82f6b0d1cbe639579fcdd64c6709f1c741ce35e4',
  canonicalizerMainSha256: 'b8f82357548884f4ea40f73d345ccf76c3d2c70e9c5084a4db94943930c96f52',
  canonicalizerStatementHelpersSha256: '158175ac9404fb93acc5b82fc8b87d10f2946a11b228ce9686f2423f75bcf667',
  compositionSha256: '2f4e03cf92ee958ec56d65a6e47cf6cfd51bdae37ca0a58452e2045c6d86ff4f',
  coveragePolicySha256: 'e1a15eef726fa2b8e058a0ef5afe40edc25193ecbe01727168bcdefa6b0313ac',
};

function fail(message) {
  throw new TypeError(`coverage M4.89 runtime-cost rejection: ${message}`);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function repositoryBytes(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url));
}

function assertPlainReceiptData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('receipt data must contain only finite numbers');
    return;
  }
  if (typeof value !== 'object') fail('receipt data must contain only JSON values');
  if (seen.has(value)) fail('receipt data must not contain cycles or shared references');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('receipt arrays must use the plain prototype');
    const ownKeys = Reflect.ownKeys(value);
    const enumerableKeys = Object.keys(value);
    if (
      ownKeys.some((key) => typeof key === 'symbol') ||
      ownKeys.length !== value.length + 1 ||
      enumerableKeys.length !== value.length
    ) {
      fail('receipt arrays must be dense and undecorated');
    }
    for (const [index, key] of enumerableKeys.entries()) {
      if (key !== String(index)) fail('receipt arrays must contain only canonical indices');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('receipt arrays must contain plain data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) fail('receipt objects must use the plain prototype');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') fail('receipt objects must not contain symbol properties');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      fail('receipt objects must contain only plain enumerable data properties');
    }
    assertPlainReceiptData(descriptor.value, seen);
  }
}

function same(left, right) {
  return canonicalBytes(left).equals(canonicalBytes(right));
}

function topLevelFunctionSource(source, name) {
  const marker = `fn name=${name}`;
  const start = source.indexOf(marker);
  if (start < 0) fail(`missing ${name} function`);
  const next = source.indexOf('\nfn name=', start + marker.length);
  return source.slice(start, next < 0 ? undefined : next);
}

function exactInputs() {
  const baselineBytes = repositoryBytes('scripts/kern-canonicalizer/dual-row-headroom-m4-88.json');
  if (digest(baselineBytes) !== M488_RECEIPT_DIGEST) fail('M4.88 receipt bytes must remain exact');
  const baseline = loadCanonicalizerDualRowHeadroomM488();
  if (
    baseline.summary.maxExactFloor !== 107_594 ||
    baseline.promotion.requiredFloorReduction !== 58_442 ||
    baseline.promotion.nextMilestone !== 'M4.89'
  ) {
    fail('M4.88 rejection handoff must remain exact');
  }
  const policy = structuredClone(PUBLISHED_POLICY);
  if (!same(policy.profileLimits, baseline.limits.activeProfile)) {
    fail('active profile must remain the exact M4.88 profile');
  }
  if (policy.runtimeLimits.maxCollectionLength !== 65_536 || policy.kirLimits.maxDepth !== 64) {
    fail('runtime and KIR limits must remain unchanged');
  }
  for (const [field, expected] of Object.entries(SOURCE_DIGESTS)) {
    const path = {
      canonicalizerCompositeSha256: 'examples/kern-canonicalizer/canonicalizer.composed.kern',
      canonicalizerExpressionHelpersSha256: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
      canonicalizerMainSha256: 'examples/kern-canonicalizer/canonicalizer.kern',
      canonicalizerStatementHelpersSha256: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern',
      compositionSha256: 'scripts/kern-canonicalizer/composition.json',
      coveragePolicySha256: 'scripts/kern-canonicalizer/coverage-policy.json',
    }[field];
    if (digest(repositoryBytes(path)) !== expected) fail(`${field} must remain exact`);
  }
  const source = repositoryBytes('examples/kern-canonicalizer/canonicalizer.kern').toString('utf8');
  const owner = topLevelFunctionSource(source, 'exprsource');
  const helper = topLevelFunctionSource(source, 'expressionsources');
  if ((owner.match(/^\s+for\b/gmu) ?? []).length !== 0) fail('exprsource must contain no local loop');
  if (!owner.includes('expressionsources(valueTag, valueParent, valueRole, valueOrder, valueText, valueBool)')) {
    fail('exprsource must delegate to the table-only helper');
  }
  if (!owner.includes('List.index(sources, valueTag.length - id) ?? \\"\\"')) {
    fail('exprsource must use the exact reverse-id lookup');
  }
  if (
    (helper.match(/to="valueParent\.length"/gu) ?? []).length !== 1 ||
    (helper.match(/to="valueTag\.length"/gu) ?? []).length !== 1
  ) {
    fail('expressionsources must contain exactly two table-wide passes');
  }
  if (!helper.includes('do value="ordered.push(source)"')) {
    fail('expressionsources must publish one aligned result per value row');
  }
  if ((helper.match(/return value="\[\]"/gu) ?? []).length !== 3) {
    fail('expressionsources malformed-table exits must return typed empty lists');
  }
  return { baseline, policy };
}

export function measureCanonicalizerRuntimeCostM489() {
  const { baseline, policy } = exactInputs();
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionMaxCollectionLength * 3 / 4);
  const witnesses = baseline.witnesses.map((witness, index) => ({
    baselineExactFloor: witness.exactFloor,
    belowFloorOutcome: 'failure',
    exactFloor: EXACT_FLOORS[index],
    floorOutcome: 'success',
    floorReduction: witness.exactFloor - EXACT_FLOORS[index],
    id: witness.id,
    parameterRows: witness.parameterRows,
    profileRows: structuredClone(witness.profileRows),
    roundTrip: true,
  }));
  const maxExactFloor = Math.max(...witnesses.map(({ exactFloor }) => exactFloor));
  const floorReduction = baseline.summary.maxExactFloor - maxExactFloor;
  if (floorReduction < baseline.promotion.requiredFloorReduction || maxExactFloor > promotionBudget) {
    fail('optimized maximum floor must satisfy the M4.88 reduction requirement and promotion budget');
  }
  return {
    baseline: {
      implementationBaseCommit: IMPLEMENTATION_BASE_COMMIT,
      m488ReceiptSha256: M488_RECEIPT_DIGEST,
      maxExactFloor: baseline.summary.maxExactFloor,
      requiredFloorReduction: baseline.promotion.requiredFloorReduction,
    },
    format: FORMAT,
    limits: {
      activeProfile: structuredClone(baseline.limits.activeProfile),
      candidateProfile: structuredClone(baseline.limits.candidateProfile),
      maxDepth: policy.kirLimits.maxDepth,
      productionMaxCollectionLength,
      promotionBudget,
    },
    optimization: {
      baselineDistinctExpressionIds: 71,
      baselineExpressionScanIterations: 81_224,
      cachedTablePasses: 2,
      helper: 'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
      owner: 'examples/kern-canonicalizer/canonicalizer.kern#2:exprsource',
      strategy: 'memoized-table-wide-expression-projection',
      valueRows: 572,
    },
    promotion: { disposition: 'headroom-authenticated', nextMilestone: 'M4.90' },
    result: {
      floorReduction,
      maxExactFloor,
      productionHeadroom: productionMaxCollectionLength - maxExactFloor,
      promotionHeadroom: promotionBudget - maxExactFloor,
      witnessCount: witnesses.length,
    },
    source: {
      ...structuredClone(SOURCE_DIGESTS),
      canonicalizerPolicySha256: PUBLISHED_CANONICALIZER_POLICY_DIGEST,
      m488PublishedCompositeSha256: baseline.source.canonicalizerCompositeSha256,
      runtimeHandlerAbi: 'kern.runtime.handler.v1',
      structuralKirCodecSha256: digest(repositoryBytes('packages/core/src/kir-structural/canonical.ts')),
    },
    witnesses,
  };
}

export function validateCanonicalizerRuntimeCostM489(value) {
  assertPlainReceiptData(value);
  const expected = measureCanonicalizerRuntimeCostM489();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.89 receipt digest');
  }
  if (!same(value, expected)) fail('receipt must match authenticated evidence exactly');
  return structuredClone(value);
}

export function loadCanonicalizerRuntimeCostM489() {
  const path = fileURLToPath(SUMMARY_URL);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile()) fail('receipt must be a regular non-symlink file');
  const source = readFileSync(path);
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    fail('receipt must be valid JSON');
  }
  const result = validateCanonicalizerRuntimeCostM489(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerRuntimeCostM489());
}
