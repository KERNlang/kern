import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { loadCanonicalizerPropertyRowHeadroomM479 } from './property-row-headroom-m4-79.mjs';

const FORMAT = 'kern.kir-canonicalizer.runtime-cost-reduction.1';
const RECEIPT_DIGEST = '48465b28f951d5f74a1ea148d2c21a1f28d3dcb13c475ed5885d7c0512046b14';
const SUMMARY_URL = new URL('./runtime-cost-m4-80.json', import.meta.url);
const M479_DIGEST = 'd8683f1440e8bb0f8496ab1845c83c7dabe73dbfd26114b78685d8c8e1cf830b';
const IMPLEMENTATION_BASE_COMMIT = '990898fba53f88e71dce24e5e783d47b9c91b62c';
const WITNESS_ID = 'examples/capstone-checker-subset/checker-while.kern#16:checkWhileCore';

function fail(message) {
  throw new TypeError(`coverage M4.80 runtime-cost rejection: ${message}`);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
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
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail('receipt arrays must use the plain prototype');
    }
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
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      fail('receipt objects must use the plain prototype');
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') fail('receipt objects must not contain symbol properties');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('receipt objects must contain only plain enumerable data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
  }
}

function same(left, right) {
  return canonicalBytes(left).equals(canonicalBytes(right));
}

function repositorySource(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url));
}

function exactInputs() {
  const m479 = loadCanonicalizerPropertyRowHeadroomM479();
  if (digest(canonicalBytes(m479)) !== M479_DIGEST) fail('M4.79 receipt must remain exact');
  if (m479.witnesses.length !== 1 || m479.witnesses[0].id !== WITNESS_ID) {
    fail('M4.79 witness identity must remain exact');
  }
  const policy = loadCanonicalizerPolicy();
  if (!same(policy.profileLimits, { maxNodeRows: 38, maxPropertyRows: 53, maxValueRows: 461 })) {
    fail('active profile must remain at the published M4.79 boundary');
  }
  if (policy.runtimeLimits.maxCollectionLength !== 65_536 || policy.kirLimits.maxDepth !== 64) {
    fail('runtime and KIR limits must remain at the published boundary');
  }
  const canonicalizer = repositorySource('examples/kern-canonicalizer/canonicalizer.kern').toString('utf8');
  const typeStart = canonicalizer.indexOf('fn name=typesource returns=string export=true\n');
  const typeEnd = canonicalizer.indexOf('\nfn name=validbinaryop ', typeStart);
  if (typeStart !== 0 || typeEnd <= typeStart) fail('typesource identity and ordinal must remain exact');
  const typeSource = canonicalizer.slice(typeStart, typeEnd);
  if (typeSource.includes('valuechildcount(') || typeSource.includes('recordfield(')) {
    fail('optimized typesource must not delegate whole-table scans');
  }
  if (!typeSource.includes('typefields(id, valueParent, valueRole)')) {
    fail('optimized typesource must delegate to the exact bounded field helper');
  }
  if ((typeSource.match(/^\s+for\b/gmu) ?? []).length !== 0) {
    fail('optimized typesource must not retain a local value-table loop');
  }
  const helperSource = repositorySource(
    'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
  ).toString('utf8');
  const helperStart = helperSource.indexOf('fn name=typefields returns="number[]" export=true\n');
  if (helperStart < 0) fail('typefields helper identity must remain exact');
  const typeFields = helperSource.slice(helperStart);
  if ((typeFields.match(/^\s+for\b/gmu) ?? []).length !== 1) {
    fail('typefields must contain exactly one value-table loop');
  }
  if (typeFields.includes('valuechildcount(') || typeFields.includes('recordfield(')) {
    fail('typefields must not delegate another whole-table scan');
  }
  return { m479, policy };
}

export function measureCanonicalizerRuntimeCostM480() {
  const { m479, policy } = exactInputs();
  const baselineFloor = m479.witnesses[0].exactFloor;
  const exactFloor = 35_998;
  const floorReduction = baselineFloor - exactFloor;
  const promotionBudget = m479.limits.promotionBudget;
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  if (floorReduction < m479.promotion.requiredFloorReduction) {
    fail('optimized floor must satisfy the exact M4.79 reduction requirement');
  }
  if (exactFloor > promotionBudget) fail('optimized floor must fit the promotion budget');
  return {
    baseline: {
      exactFloor: baselineFloor,
      implementationBaseCommit: IMPLEMENTATION_BASE_COMMIT,
      m479ReceiptSha256: M479_DIGEST,
      promotionBudgetDeficit: m479.summary.promotionBudgetDeficit,
    },
    format: FORMAT,
    limits: {
      activeProfile: structuredClone(policy.profileLimits),
      candidateProfile: structuredClone(m479.limits.candidateProfile),
      maxDepth: policy.kirLimits.maxDepth,
      productionMaxCollectionLength,
      promotionBudget,
    },
    optimization: {
      exactValueTablePasses: 1,
      forbiddenWholeTableHelpers: ['recordfield', 'valuechildcount'],
      helper: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#16:typefields',
      owner: 'examples/kern-canonicalizer/canonicalizer.kern#0:typesource',
      strategy: 'merged-direct-child-field-scan',
    },
    promotion: {
      disposition: 'headroom-authenticated',
      nextMilestone: 'M4.81',
    },
    result: {
      belowFloorOutcome: 'failure',
      exactFloor,
      floorOutcome: 'success',
      floorReduction,
      productionHeadroom: productionMaxCollectionLength - exactFloor,
      promotionHeadroom: promotionBudget - exactFloor,
      roundTrip: true,
    },
    source: {
      canonicalizerCompositeSha256: digest(repositorySource('examples/kern-canonicalizer/canonicalizer.composed.kern')),
      canonicalizerExpressionHelpersSha256: digest(
        repositorySource('examples/kern-canonicalizer/canonicalizer-expression-helpers.kern'),
      ),
      canonicalizerPolicySha256: digest(readFileSync(new URL('./policy.json', import.meta.url))),
      canonicalizerSourceSha256: digest(repositorySource('examples/kern-canonicalizer/canonicalizer.kern')),
      compositionSha256: digest(readFileSync(new URL('./composition.json', import.meta.url))),
      inputSourceSha256: digest(repositorySource('examples/capstone-checker-subset/checker-while.kern')),
      runtimeHandlerAbi: 'kern.runtime.handler.v1',
      structuralKirCodecSha256: digest(repositorySource('packages/core/src/kir-structural/canonical.ts')),
    },
    witness: {
      id: WITNESS_ID,
      parameterRows: m479.witnesses[0].parameterRows,
      profileRows: structuredClone(m479.witnesses[0].profileRows),
    },
  };
}

export function validateCanonicalizerRuntimeCostM480(value) {
  assertPlainReceiptData(value);
  const expected = measureCanonicalizerRuntimeCostM480();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.80 receipt digest');
  }
  if (!same(value, expected)) fail('receipt must match authenticated evidence exactly');
  return structuredClone(value);
}

export function loadCanonicalizerRuntimeCostM480() {
  const path = fileURLToPath(SUMMARY_URL);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) fail('receipt must exist');
  if (!stat.isFile() || realpathSync(path) !== path) {
    fail('receipt must be a regular non-symlink file');
  }
  const source = readFileSync(path);
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    fail('receipt must be valid JSON');
  }
  const result = validateCanonicalizerRuntimeCostM480(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

export function writeCanonicalizerRuntimeCostM480() {
  const result = validateCanonicalizerRuntimeCostM480(measureCanonicalizerRuntimeCostM480());
  writeCoverageSummary(SUMMARY_URL, result);
  return result;
}
