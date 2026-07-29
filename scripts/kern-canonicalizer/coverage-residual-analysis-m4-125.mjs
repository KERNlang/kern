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
import { loadPreM4129CoverageInputs } from './historical-parameter-sources.mjs';
import { loadPreM4130CanonicalizerPolicy } from './historical-policy.mjs';

const FORMAT = 'kern.kir-canonicalizer.residual-analysis.3';
const PUBLISHED_DIGEST = 'eb2b075097025b9f91089a0587e84807279061801850b10402dd0978a2fe9652';
const INPUT_COMMIT = 'b2a722f43092ed16eeff45600dd8638fc53d4e05';
const SUMMARY_URL = new URL('./coverage-residual-analysis-m4-125.json', import.meta.url);
const EXPECTED_ASSIGNMENTS_DIGEST =
  'd56df2cc197c26f4c6f302c32e6447828e1e7359ba6f525f82bda5b6e2b5c481';
const PROFILE_AXES = [
  ['maxNodeRows', 'nodes'],
  ['maxPropertyRows', 'properties'],
  ['maxValueRows', 'values'],
];
const PUBLISHED_BASELINE = {
  baseCompleteFunctions: 103,
  baseId: 'kern.kir-canonicalizer.profile.m4.60',
  coverageImplementationDigest: '0c3186a44ce2ed3cf2a18e6790b23084bd0e5c9adafc229d4bac768fe16d35eb',
  coveragePolicyDigest: '04a61b18126cac0ddd723fef2686ae2f77c0bba6501c11dee6756fc3c0b0d400',
  currentProfileLimits: { maxNodeRows: 122, maxPropertyRows: 193, maxValueRows: 2411 },
  functionFactsDigest: '21869d80d31dbda6ddd60796bb479bb30e42985f52f2e1079efc28b81c467df5',
  legacyParameterBlockers: 4,
  residualFunctionCount: 4,
};

function fail(message) {
  throw new TypeError(`coverage M4.125 residual analysis rejection: ${message}`);
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
  if (digest !== PUBLISHED_DIGEST) fail('receipt must match the exact published M4.125 analysis');
  return { digest, inputCommit: INPUT_COMMIT, record: structuredClone(value) };
}

function assertPublishedInput(receipt, canonicalizerPolicy, coveragePolicyDigest) {
  const actual = {
    baseCompleteFunctions: receipt.baseCompleteFunctions,
    baseId: receipt.base.id,
    coveragePolicyDigest,
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
    fail('live semantic facts must match the exact published M4.124 input');
  }
}

export function measureCanonicalizerResidualAnalysisM4125() {
  const currentPolicy = loadCoveragePolicy();
  const historical = loadPreM4129CoverageInputs(currentPolicy);
  const policy = historical.policy;
  const canonicalizerPolicy = loadPreM4130CanonicalizerPolicy();
  const receipt = measureCanonicalizerCoverage(
    policy,
    canonicalizerPolicy,
    { sourceOverrides: historical.sourceOverrides },
  );
  assertPublishedInput(
    receipt,
    canonicalizerPolicy,
    historical.coveragePolicyDigest,
  );

  const roots = sourceFunctionRoots(policy, historical.sourceOverrides);
  const legacyFacts = receipt.functions.filter(({ excludedProperties }) =>
    excludedProperties.includes('fn.params'));
  if (legacyFacts.length !== PUBLISHED_BASELINE.legacyParameterBlockers) {
    fail('legacy parameter population must remain exactly 4 functions');
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
    fail('M4.124 must expose an empty queue and exactly 4 residual functions');
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
    fail('reason assignments must reproduce the M4.124 exhaustion frontier');
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
  if (
    analysis.frontier.profileRowsAvailableFunctions !== 0 ||
    analysis.frontier.evaluatedObservedSettings !== 0 ||
    analysis.frontier.actionableCandidates.length !== 0 ||
    analysis.selectedNextAction !== null
  ) {
    fail('M4.124 residual frontier must expose no actionable profile widening');
  }
  assertPlainReceiptData(analysis);
  return analysis;
}

export function validatePublishedCanonicalizerResidualAnalysisM4125(value) {
  return publishedHandoff(value);
}

export function loadPublishedCanonicalizerResidualAnalysisM4125() {
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
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerResidualAnalysisM4125());
}
