import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
} from './coverage.mjs';
import {
  migrateFunctionFact,
  partitionMigratedFunctions,
  sourceFunctionRoots,
} from './coverage-prerequisite.mjs';
import {
  canonicalizerCompletionProfile,
  canonicalizerFunctionCompletes,
} from './coverage-selection.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const FORMAT = 'kern.kir-canonicalizer.residual-analysis.3';
const PUBLISHED_DIGEST = '9c8507a4fe5bacf1048bfc1f6946c3e493ee35cd7fb63ce3a2a7ced474ad1423';
const INPUT_COMMIT = '87431a527dfb8d0f3a707b74ce33907392670a51';
const SUMMARY_URL = new URL('./coverage-residual-analysis-m4-54.json', import.meta.url);
const EXPECTED_ASSIGNMENTS_DIGEST =
  '158ee2e9ee592986fa70f10e7345a243db0b082f7949497275e2dce2141ae6c8';
const PROFILE_AXES = [
  ['maxNodeRows', 'nodes'],
  ['maxPropertyRows', 'properties'],
  ['maxValueRows', 'values'],
];
const PUBLISHED_BASELINE = {
  baseCompleteFunctions: 65,
  baseId: 'kern.kir-canonicalizer.profile.m4.36',
  coverageImplementationDigest: '6bb9375f22dd1bee7dd371c43f725d68a79dc2e83e94b2cecc3c1c3c5c15dd93',
  coveragePolicyDigest: '213ce7266b0d8e449c4333483fe8862ae7d3fc69f2aaa7b869595dcbd5111d5c',
  currentProfileLimits: { maxNodeRows: 19, maxPropertyRows: 31, maxValueRows: 388 },
  functionFactsDigest: '7f42974aba8157c6f20fae3cf0c7632317e36e2e7c0d6e5869c32aa31970dc78',
  legacyParameterBlockers: 38,
  residualFunctionCount: 38,
};

function fail(message) {
  throw new TypeError(`coverage M4.54 residual analysis rejection: ${message}`);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPlainReceiptData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('analysis data must contain only finite numbers');
    return;
  }
  if (typeof value !== 'object') fail('analysis data must contain only JSON values');
  if (seen.has(value)) fail('analysis data must not contain cycles');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail('analysis arrays must use the plain prototype');
    }
    const ownKeys = Reflect.ownKeys(value);
    const enumerableKeys = Object.keys(value);
    if (
      ownKeys.some((key) => typeof key === 'symbol') ||
      ownKeys.length !== value.length + 1 ||
      enumerableKeys.length !== value.length
    ) {
      fail('analysis arrays must be dense and undecorated');
    }
    for (const [index, key] of enumerableKeys.entries()) {
      if (key !== String(index)) fail('analysis arrays must contain only canonical indices');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('analysis arrays must contain plain data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      fail('analysis objects must use the plain prototype');
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') fail('analysis objects must not contain symbol properties');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('analysis objects must contain only plain enumerable data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
  }
  seen.delete(value);
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function exactLimits(limits) {
  return Object.fromEntries(PROFILE_AXES.map(([limit]) => [limit, limits[limit]]));
}

function limitsEqual(left, right) {
  return PROFILE_AXES.every(([limit]) => left[limit] === right[limit]);
}

function candidateOrder(left, right) {
  return left.changedLimits.length - right.changedLimits.length ||
    right.completeTools - left.completeTools ||
    left.totalDelta - right.totalDelta ||
    right.completeFunctions - left.completeFunctions ||
    compareText(JSON.stringify(left.limits), JSON.stringify(right.limits));
}

function publishedHandoff(value) {
  assertPlainReceiptData(value);
  if (value === null || Array.isArray(value) || value.format !== FORMAT) {
    fail(`published format must be ${FORMAT}`);
  }
  const digest = createHash('sha256').update(canonicalBytes(value)).digest('hex');
  if (digest !== PUBLISHED_DIGEST) fail('receipt must match the exact published M4.54 analysis');
  return { digest, inputCommit: INPUT_COMMIT, record: structuredClone(value) };
}

function assertPublishedInput(receipt, canonicalizerPolicy) {
  const actual = {
    baseCompleteFunctions: receipt.baseCompleteFunctions,
    baseId: receipt.base.id,
    coveragePolicyDigest: receipt.coveragePolicyDigest,
    currentProfileLimits: exactLimits(canonicalizerPolicy.profileLimits),
    functionFactsDigest: receipt.functionFactsDigest,
  };
  const expected = {
    baseCompleteFunctions: PUBLISHED_BASELINE.baseCompleteFunctions,
    baseId: PUBLISHED_BASELINE.baseId,
    coveragePolicyDigest: PUBLISHED_BASELINE.coveragePolicyDigest,
    currentProfileLimits: PUBLISHED_BASELINE.currentProfileLimits,
    functionFactsDigest: PUBLISHED_BASELINE.functionFactsDigest,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('live semantic facts must match the exact published M4.53 input');
  }
}

export function measureCanonicalizerResidualAnalysisM454() {
  const policy = loadCoveragePolicy();
  const receipt = measureCanonicalizerCoverage(policy);
  const canonicalizerPolicy = loadCanonicalizerPolicy();
  assertPublishedInput(receipt, canonicalizerPolicy);

  const roots = sourceFunctionRoots(policy);
  const legacyFacts = receipt.functions.filter(({ excludedProperties }) =>
    excludedProperties.includes('fn.params'));
  if (legacyFacts.length !== PUBLISHED_BASELINE.legacyParameterBlockers) {
    fail('legacy parameter population must remain exactly 38 functions');
  }
  const migrateAt = (profileLimits) => legacyFacts.map((fact) =>
    migrateFunctionFact(
      fact,
      roots.get(fact.id),
      policy.base,
      { ...canonicalizerPolicy, profileLimits },
    ));

  const currentLimits = exactLimits(canonicalizerPolicy.profileLimits);
  const currentMigrated = migrateAt(currentLimits);
  const { parameterReady, residual } = partitionMigratedFunctions(
    policy.base,
    currentMigrated,
    currentLimits,
  );
  if (parameterReady.length !== 0 || residual.length !== PUBLISHED_BASELINE.residualFunctionCount) {
    fail('M4.53 must expose an empty queue and exactly 38 residual functions');
  }

  const assignments = residual
    .map((fact) => ({
      id: fact.id,
      parameterRows: fact.parameterRows,
      profileRows: fact.profileRows,
      reasons: [...new Set([...fact.excludedProperties, ...fact.profileBlockers])].sort(compareText),
      tool: fact.tool,
    }))
    .sort((left, right) => compareText(left.id, right.id));
  if (assignments.some(({ reasons }) => reasons.length === 0)) {
    fail('every residual function must retain an authenticated reason');
  }
  const reasonAssignments = assignments.map(({ id, reasons }) => ({ id, reasons }));
  const assignmentsDigest = createHash('sha256')
    .update(JSON.stringify(reasonAssignments))
    .digest('hex');
  if (assignmentsDigest !== EXPECTED_ASSIGNMENTS_DIGEST) {
    fail('reason assignments must reproduce the M4.53 exhaustion digest');
  }

  const observedSettings = new Map();
  for (const { profileRows } of residual) {
    if (profileRows === null) continue;
    const limits = Object.fromEntries(PROFILE_AXES.map(([limit, row]) => [
      limit,
      Math.max(currentLimits[limit], profileRows[row]),
    ]));
    if (!limitsEqual(limits, currentLimits)) {
      observedSettings.set(JSON.stringify(limits), limits);
    }
  }

  const residualIds = new Set(residual.map(({ id }) => id));
  const baseProfile = canonicalizerCompletionProfile(policy.base, []);
  const actionableCandidates = [...observedSettings.values()]
    .map((limits) => {
      const witnesses = migrateAt(limits)
        .filter(({ id }) => residualIds.has(id))
        .filter((fact) => canonicalizerFunctionCompletes(baseProfile, fact, limits));
      const changedLimits = PROFILE_AXES
        .map(([limit]) => limit)
        .filter((limit) => limits[limit] !== currentLimits[limit]);
      return {
        changedLimits,
        completeFunctions: witnesses.length,
        completeTools: new Set(witnesses.map(({ tool }) => tool)).size,
        limits,
        totalDelta: changedLimits.reduce(
          (total, limit) => total + limits[limit] - currentLimits[limit],
          0,
        ),
        witnesses: witnesses.map(({ id }) => id).sort(compareText),
      };
    })
    .filter(({ completeFunctions }) => completeFunctions > 0)
    .sort(candidateOrder);

  const analysis = {
    assignments,
    assignmentsDigest,
    baseline: structuredClone(PUBLISHED_BASELINE),
    format: FORMAT,
    frontier: {
      actionableCandidates,
      evaluatedObservedSettings: observedSettings.size,
      profileRowsAvailableFunctions: residual.filter(({ profileRows }) => profileRows !== null).length,
    },
    selectedNextAction: actionableCandidates[0] ?? null,
  };
  assertPlainReceiptData(analysis);
  return analysis;
}

export function validatePublishedCanonicalizerResidualAnalysisM454(value) {
  return publishedHandoff(value);
}

export function loadPublishedCanonicalizerResidualAnalysisM454() {
  const path = fileURLToPath(SUMMARY_URL);
  const stat = lstatSync(path);
  if (!stat.isFile() || realpathSync(path) !== path) {
    fail('published receipt must be a regular non-symlink file');
  }
  const source = readFileSync(path);
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    fail('published receipt must be valid JSON');
  }
  const result = publishedHandoff(parsed);
  if (!source.equals(canonicalBytes(result.record))) {
    fail('published receipt must use canonical JSON bytes');
  }
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerResidualAnalysisM454());
}
