import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  measureCanonicalizerCoverage,
  summarizeCanonicalizerCoverage,
} from './coverage.mjs';
import { loadCanonicalizerCoverageEvidence } from './coverage-composition.mjs';
import { authenticateCoverageDependencies } from './coverage-dependencies.mjs';
import {
  buildCanonicalizerPrerequisiteSummary,
  migrateFunctionFact,
  partitionMigratedFunctions,
  sourceFunctionRoots,
} from './coverage-prerequisite.mjs';
import {
  canonicalizerCompletionProfile,
  canonicalizerFunctionCompletes,
} from './coverage-selection.mjs';
import { loadPublishedM4147CoverageInput } from './coverage-input-m4-147.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import {
  QUOTESOURCE_M4150_PATH,
  reconstructPreM4150ExpressionHelpers,
} from './quotesource-rewrite-m4-150-target.mjs';
import { M4151_COVERAGE_POLICY_DIGEST } from './quotesource-parameter-m4-151-target.mjs';

const FORMAT = 'kern.kir-canonicalizer.residual-analysis.3';
const PUBLISHED_DIGEST = 'bf5b7c6886f7f114995f59d916f4a87ecc2ea3f7fffc5289448d7ebb32abde2f';
const INPUT_COMMIT = '4115914127dc627edf8348af8a487ac1beae941a';
const SUMMARY_URL = new URL('./coverage-residual-analysis-m4-148.json', import.meta.url);
const COVERAGE_SUMMARY_DIGEST =
  'fc030f9b1140e15cca55fdcea93bcf7da15fd75825ae1cb6577b5620e0b95bf0';
const PREREQUISITE_SUMMARY_DIGEST =
  '0ef253dba0b3ab80593d9fd3985e210736c3c9bc69763b21480330f1c0ba21f7';
const EXPECTED_ASSIGNMENTS_DIGEST =
  'e953208c40e51714c3e0338455f67437fb6a6fda6c3f9fb42df0870dda003720';
const PROFILE_AXES = [
  ['maxNodeRows', 'nodes'],
  ['maxPropertyRows', 'properties'],
  ['maxValueRows', 'values'],
];
const PUBLISHED_BASELINE = {
  baseCompleteFunctions: 111,
  baseId: 'kern.kir-canonicalizer.profile.m4.141',
  canonicalizerDigest: '836e71de0c456247fdd8e5725d388aeb0f60853083616f82666d2fd2c191d266',
  canonicalizerPolicyDigest: '13d9315aeaf7ffa89ec17ad86b01e39e4a7084657000beb11f8bd0d478b21db7',
  compiledCoreDigest: '29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2',
  corpusDigest: '8308f89b292ed823e8b551e0533c550008ee98ba5f817081ae4c9919421a3b6c',
  coverageImplementationDigest: '10b3ae6b227aa3c42094a175b63989d9b3089277d3a4730972581f1ec7a9b22c',
  coveragePolicyDigest: '28b76e1260febf3e518a2a6d97b11f96bf202fcce149fb201b92b5b0a5d98019',
  coverageSummaryDigest: COVERAGE_SUMMARY_DIGEST,
  currentProfileLimits: {
    maxNodeRows: 205,
    maxPropertyRows: 332,
    maxValueRows: 6_304,
  },
  familyRegistryDigest: '2be9640b87d863298e5fa93704d526d8b09f58a5c4eed78a46cb8213cca56df8',
  functionFactsDigest: '8a75842adba91baaeb54c959bbd2647dab0165817dfa7a2e1d341efc914adc54',
  legacyParameterBlockers: 1,
  prerequisiteSummaryDigest: PREREQUISITE_SUMMARY_DIGEST,
  profileDigest: 'fe14493f42136a4c6d5593b0ec6eb8c5c96c89076264cbdb961e8c2e03acb44b',
  residualFunctionCount: 1,
};

function fail(message) {
  throw new TypeError(`coverage M4.148 residual analysis rejection: ${message}`);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPlainReceiptData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      fail('analysis data must contain only finite canonical numbers');
    }
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
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      ownKeys.some((key) => typeof key === 'symbol') ||
      ownKeys.length !== value.length + 1 ||
      enumerableKeys.length !== value.length ||
      lengthDescriptor === undefined ||
      lengthDescriptor.value !== value.length ||
      lengthDescriptor.enumerable ||
      lengthDescriptor.configurable ||
      !lengthDescriptor.writable
    ) {
      fail('analysis arrays must be dense and undecorated');
    }
    for (const [index, key] of enumerableKeys.entries()) {
      if (key !== String(index)) fail('analysis arrays must contain only canonical indices');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !descriptor.configurable ||
        !descriptor.writable ||
        !('value' in descriptor)
      ) {
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
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !descriptor.configurable ||
        !descriptor.writable ||
        !('value' in descriptor)
      ) {
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
  if (digest !== PUBLISHED_DIGEST) fail('receipt must match the exact published M4.148 analysis');
  return { digest, inputCommit: INPUT_COMMIT, record: structuredClone(value) };
}

export function assertM4148PublishedInput(
  receipt,
  prerequisite,
  canonicalizerPolicy,
  published = loadPublishedM4147CoverageInput(),
) {
  assertPlainReceiptData(canonicalizerPolicy);
  const canonicalizerPolicyDigest = createHash('sha256')
    .update(canonicalBytes(canonicalizerPolicy))
    .digest('hex');
  if (receipt.canonicalizerPolicyDigest !== canonicalizerPolicyDigest) {
    fail('canonicalizer policy must match the measured receipt');
  }
  const liveEvidence = loadCanonicalizerCoverageEvidence();
  const liveDependencies = authenticateCoverageDependencies();
  const liveCanonicalizerDigest = createHash('sha256')
    .update(liveEvidence.source)
    .digest('hex');
  if (
    receipt.canonicalizerDigest !== liveCanonicalizerDigest ||
    !isDeepStrictEqual(receipt.composition, liveEvidence.composition) ||
    receipt.coverageImplementationDigest !== liveDependencies.coverageImplementationDigest ||
    receipt.coveragePolicyDigest !== M4151_COVERAGE_POLICY_DIGEST ||
    prerequisite.baseline.canonicalizerDigest !== receipt.canonicalizerDigest ||
    prerequisite.baseline.coverageImplementationDigest !==
      receipt.coverageImplementationDigest ||
    prerequisite.baseline.coveragePolicyDigest !== receipt.coveragePolicyDigest
  ) {
    fail('successor identities must match authenticated live dependencies before normalization');
  }
  const normalizedCoverage = summarizeCanonicalizerCoverage(receipt);
  normalizedCoverage.canonicalizerDigest = published.coverage.canonicalizerDigest;
  normalizedCoverage.composition = structuredClone(published.coverage.composition);
  normalizedCoverage.coverageImplementationDigest =
    published.coverage.coverageImplementationDigest;
  normalizedCoverage.coveragePolicyDigest = published.coverage.coveragePolicyDigest;
  const normalizedPrerequisite = structuredClone(prerequisite);
  normalizedPrerequisite.baseline.canonicalizerDigest =
    published.prerequisite.baseline.canonicalizerDigest;
  normalizedPrerequisite.baseline.coverageImplementationDigest =
    published.prerequisite.baseline.coverageImplementationDigest;
  normalizedPrerequisite.baseline.coveragePolicyDigest =
    published.prerequisite.baseline.coveragePolicyDigest;
  if (
    !isDeepStrictEqual(normalizedCoverage, published.coverage) ||
    !isDeepStrictEqual(normalizedPrerequisite, published.prerequisite)
  ) {
    fail('live summaries must reproduce M4.147 except for the local implementation digest');
  }
  const archived = {
    baseCompleteFunctions: published.coverage.baseCompleteFunctions,
    baseId: published.coverage.base.id,
    canonicalizerDigest: published.coverage.canonicalizerDigest,
    canonicalizerPolicyDigest: published.coverage.canonicalizerPolicyDigest,
    compiledCoreDigest: published.coverage.compiledCoreDigest,
    corpusDigest: published.coverage.corpusDigest,
    coverageImplementationDigest: published.coverage.coverageImplementationDigest,
    coveragePolicyDigest: published.coverage.coveragePolicyDigest,
    coverageSummaryDigest: published.coverageDigest,
    currentProfileLimits: exactLimits(canonicalizerPolicy.profileLimits),
    familyRegistryDigest: published.coverage.familyRegistryDigest,
    functionFactsDigest: published.coverage.functionFactsDigest,
    legacyParameterBlockers: published.prerequisite.baseline.legacyParameterBlockers,
    prerequisiteSummaryDigest: published.prerequisiteDigest,
    profileDigest: published.coverage.profileDigest,
    residualFunctionCount: published.prerequisite.exhaustion.residualFunctionCount,
  };
  if (!isDeepStrictEqual(archived, PUBLISHED_BASELINE)) {
    fail('archived M4.147 input must match the exact independently pinned baseline');
  }
  const liveSemanticInput = {
    baseCompleteFunctions: receipt.baseCompleteFunctions,
    baseId: receipt.base.id,
    canonicalizerDigest: normalizedCoverage.canonicalizerDigest,
    canonicalizerPolicyDigest: receipt.canonicalizerPolicyDigest,
    compiledCoreDigest: receipt.compiledCoreDigest,
    corpusDigest: receipt.corpusDigest,
    coveragePolicyDigest: normalizedCoverage.coveragePolicyDigest,
    currentProfileLimits: exactLimits(canonicalizerPolicy.profileLimits),
    familyRegistryDigest: receipt.familyRegistryDigest,
    functionFactsDigest: receipt.functionFactsDigest,
    legacyParameterBlockers: prerequisite.baseline.legacyParameterBlockers,
    profileDigest: receipt.profileDigest,
    residualFunctionCount: prerequisite.exhaustion.residualFunctionCount,
  };
  const expected = {
    baseCompleteFunctions: PUBLISHED_BASELINE.baseCompleteFunctions,
    baseId: PUBLISHED_BASELINE.baseId,
    canonicalizerDigest: PUBLISHED_BASELINE.canonicalizerDigest,
    canonicalizerPolicyDigest: PUBLISHED_BASELINE.canonicalizerPolicyDigest,
    compiledCoreDigest: PUBLISHED_BASELINE.compiledCoreDigest,
    corpusDigest: PUBLISHED_BASELINE.corpusDigest,
    coveragePolicyDigest: PUBLISHED_BASELINE.coveragePolicyDigest,
    currentProfileLimits: PUBLISHED_BASELINE.currentProfileLimits,
    familyRegistryDigest: PUBLISHED_BASELINE.familyRegistryDigest,
    functionFactsDigest: PUBLISHED_BASELINE.functionFactsDigest,
    legacyParameterBlockers: PUBLISHED_BASELINE.legacyParameterBlockers,
    profileDigest: PUBLISHED_BASELINE.profileDigest,
    residualFunctionCount: PUBLISHED_BASELINE.residualFunctionCount,
  };
  if (!isDeepStrictEqual(liveSemanticInput, expected)) {
    fail('live semantic facts must match the exact published M4.147 input');
  }
}

export function measureM4148HistoricalCoverageInputs() {
  const published = loadPublishedM4147CoverageInput();
  const policy = published.policy;
  const canonicalizerPolicy = loadCanonicalizerPolicy();
  const sourceOverrides = new Map([[
    QUOTESOURCE_M4150_PATH,
    reconstructPreM4150ExpressionHelpers(),
  ]]);
  const receipt = measureCanonicalizerCoverage(
    policy,
    canonicalizerPolicy,
    { sourceOverrides },
  );
  const prerequisite = buildCanonicalizerPrerequisiteSummary(
    policy,
    sourceOverrides,
    canonicalizerPolicy,
    'kern.kir-canonicalizer.prerequisite-summary.3',
  );
  return {
    canonicalizerPolicy,
    policy,
    prerequisite,
    published,
    receipt,
    sourceOverrides,
  };
}

export function measureCanonicalizerResidualAnalysisM4148() {
  const {
    canonicalizerPolicy,
    policy,
    prerequisite,
    published,
    receipt,
    sourceOverrides,
  } = measureM4148HistoricalCoverageInputs();
  assertM4148PublishedInput(receipt, prerequisite, canonicalizerPolicy, published);

  const roots = sourceFunctionRoots(policy, sourceOverrides);
  const legacyFacts = receipt.functions.filter(({ excludedProperties }) =>
    excludedProperties.includes('fn.params'));
  if (legacyFacts.length !== PUBLISHED_BASELINE.legacyParameterBlockers) {
    fail('legacy parameter population must remain exactly 1 function');
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
    fail('M4.147 must expose an empty queue and exactly 1 residual function');
  }

  const assignments = residual
    .map((fact) => ({
      id: fact.id,
      parameterRows: fact.parameterRows,
      profileRows: fact.profileRows,
      reasons: [...new Set([...fact.excludedProperties, ...fact.profileBlockers])]
        .sort(compareText),
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
    fail('reason assignments must reproduce the M4.147 exhaustion frontier');
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
      profileRowsAvailableFunctions: residual.filter(({ profileRows }) => profileRows !== null)
        .length,
    },
    selectedNextAction: structuredClone(actionableCandidates[0] ?? null),
  };
  if (
    analysis.assignments.length !== 1 ||
    analysis.frontier.profileRowsAvailableFunctions !== 1 ||
    analysis.frontier.evaluatedObservedSettings !== 0 ||
    analysis.frontier.actionableCandidates.length !== 0 ||
    analysis.selectedNextAction !== null
  ) {
    fail('M4.147 residual frontier must expose no actionable profile widening');
  }
  assertPlainReceiptData(analysis);
  return analysis;
}

export function validatePublishedCanonicalizerResidualAnalysisM4148(value) {
  return publishedHandoff(value);
}

export function loadPublishedCanonicalizerResidualAnalysisM4148(summaryUrl = SUMMARY_URL) {
  const path = fileURLToPath(summaryUrl);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile() || realpathSync(path) !== path) {
    fail('published receipt must be a regular non-symlink file');
  }
  const source = readFileSync(path);
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    fail('published receipt must contain JSON');
  }
  const result = publishedHandoff(parsed);
  if (!source.equals(canonicalBytes(result.record))) {
    fail('published receipt must use canonical JSON bytes');
  }
  return result;
}

function isDirectInvocation(invokedPath) {
  if (invokedPath === undefined || invokedPath === '-') return false;
  const resolvedPath = resolve(invokedPath);
  if (lstatSync(resolvedPath, { throwIfNoEntry: false }) === undefined) return false;
  return realpathSync(resolvedPath) === fileURLToPath(import.meta.url);
}

if (isDirectInvocation(process.argv[1])) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerResidualAnalysisM4148());
}
