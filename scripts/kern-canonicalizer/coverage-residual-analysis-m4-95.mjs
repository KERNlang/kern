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
const PUBLISHED_DIGEST = 'f69bbae69a3f25d059dcdc23e023f4432dcd23c19dc9e6228087811f178a4928';
const INPUT_COMMIT = 'c623388fe7f8a8c288743f85bfaf79d55f889b94';
const SUMMARY_URL = new URL('./coverage-residual-analysis-m4-95.json', import.meta.url);
const EXPECTED_ASSIGNMENTS_DIGEST =
  'ac1ce11255b827161910b883fb8061606849524c52f9531036dea2570e82264f';
const PROFILE_AXES = [
  ['maxNodeRows', 'nodes'],
  ['maxPropertyRows', 'properties'],
  ['maxValueRows', 'values'],
];
const PUBLISHED_BASELINE = {
  baseCompleteFunctions: 89,
  baseId: 'kern.kir-canonicalizer.profile.m4.60',
  coverageImplementationDigest: 'f3e648ceb482e0b6131c97ee884d623169437408bcea83c427bcf61f99543a0c',
  coveragePolicyDigest: '3f68fc1e198be2c8072a619170e4494e05c54f8442dffa6271189bbd33a352c7',
  currentProfileLimits: { maxNodeRows: 74, maxPropertyRows: 77, maxValueRows: 580 },
  functionFactsDigest: 'c99b3c527d0e262a3c8876ea3508f52aac8ab8eaf7914fa6b3ff9792c0ab83f0',
  legacyParameterBlockers: 17,
  residualFunctionCount: 17,
};

function fail(message) {
  throw new TypeError(`coverage M4.95 residual analysis rejection: ${message}`);
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
  if (seen.has(value)) fail('analysis data must not contain cycles or shared references');
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
  if (digest !== PUBLISHED_DIGEST) fail('receipt must match the exact published M4.95 analysis');
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
    fail('live semantic facts must match the exact published M4.94 input');
  }
}

export function measureCanonicalizerResidualAnalysisM495() {
  const policy = loadCoveragePolicy();
  const receipt = measureCanonicalizerCoverage(policy);
  const canonicalizerPolicy = loadCanonicalizerPolicy();
  assertPublishedInput(receipt, canonicalizerPolicy);

  const roots = sourceFunctionRoots(policy);
  const legacyFacts = receipt.functions.filter(({ excludedProperties }) =>
    excludedProperties.includes('fn.params'));
  if (legacyFacts.length !== PUBLISHED_BASELINE.legacyParameterBlockers) {
    fail('legacy parameter population must remain exactly 17 functions');
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
    fail('M4.94 must expose an empty queue and exactly 17 residual functions');
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
    fail('reason assignments must reproduce the M4.94 exhaustion digest');
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
    selectedNextAction: structuredClone(actionableCandidates[0] ?? null),
  };
  assertPlainReceiptData(analysis);
  return analysis;
}

export function validatePublishedCanonicalizerResidualAnalysisM495(value) {
  return publishedHandoff(value);
}

export function loadPublishedCanonicalizerResidualAnalysisM495() {
  const path = fileURLToPath(SUMMARY_URL);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) fail('published receipt must exist');
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
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerResidualAnalysisM495());
}
