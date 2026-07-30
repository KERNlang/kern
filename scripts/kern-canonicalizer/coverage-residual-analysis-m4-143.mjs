import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  migrateFunctionFact,
  partitionMigratedFunctions,
  sourceFunctionRoots,
} from './coverage-prerequisite.mjs';
import {
  canonicalizerCompletionProfile,
  canonicalizerFunctionCompletes,
} from './coverage-selection.mjs';
import {
  loadPublishedM4142CoverageInput,
  measureAuthenticatedM4142CoverageInput,
} from './coverage-input-m4-142.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import {
  validateCanonicalizerPolicy,
} from './policy.mjs';
import {
  loadPreM4146CanonicalizerPolicy,
} from './historical-policy.mjs';

const FORMAT = 'kern.kir-canonicalizer.residual-analysis.3';
const PUBLISHED_DIGEST = '22639a2453389244611a91560afcd8d03ecefca8874089015f338622e5ba6e3e';
const INPUT_COMMIT = '91a2fda256cc16b62bd2faf1f2fdfb8cf0581f90';
const SUMMARY_URL = new URL('./coverage-residual-analysis-m4-143.json', import.meta.url);
const EXPECTED_ASSIGNMENTS_DIGEST =
  '1da9a57ec132a8147f75ab0d252e188aa86b2744b23d58cf3dfa3510b7bcc106';
const PROFILE_AXES = [
  ['maxNodeRows', 'nodes'],
  ['maxPropertyRows', 'properties'],
  ['maxValueRows', 'values'],
];
const PUBLISHED_BASELINE = {
  baseCompleteFunctions: 110,
  baseId: 'kern.kir-canonicalizer.profile.m4.141',
  canonicalizerDigest: '9e7ecb330e665b7bf2a0d7e13d78f4cf3c0b9e5b27a799bdafbabd0e18ca770a',
  canonicalizerPolicyDigest: '54d5a78b40f47e1ca1bfdbf1a7d3836c756aae1ace22ff0245d008af78178ff4',
  compiledCoreDigest: '29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2',
  corpusDigest: '923813c69d6f7e8cdb15e68237e61f155ab7bca0f764102cfeb29b5071288c89',
  coverageImplementationDigest: '7f7d25c5dc4ff389789ab72af5a7831ff180bacb354d1f648db19d189a295e24',
  coveragePolicyDigest: '3512347baf3870f21b879b632041eea72ffea304e037f0a26fcf720cbe596877',
  coverageSummaryDigest: 'c7d7d31a693df43302368fd1dc19e8f0488bdceea74d76da3037e3e54aa735cc',
  currentProfileLimits: {
    maxNodeRows: 202,
    maxPropertyRows: 308,
    maxValueRows: 4_493,
  },
  familyRegistryDigest: '2be9640b87d863298e5fa93704d526d8b09f58a5c4eed78a46cb8213cca56df8',
  functionFactsDigest: '72c677544b56de4b6e714d0f124f88f7f3db811b6442aeb6c8cb405ad7b9998f',
  legacyParameterBlockers: 2,
  prerequisiteSummaryDigest: '98aaa464c5b4da345664949dd865a006b8ac8580775695b74705ae31b25c3ef3',
  profileDigest: 'fe14493f42136a4c6d5593b0ec6eb8c5c96c89076264cbdb961e8c2e03acb44b',
  residualFunctionCount: 2,
};

function fail(message) {
  throw new TypeError(`coverage M4.143 residual analysis rejection: ${message}`);
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
  if (digest !== PUBLISHED_DIGEST) fail('receipt must match the exact published M4.143 analysis');
  return { digest, inputCommit: INPUT_COMMIT, record: structuredClone(value) };
}

export function assertM4143PublishedInput(
  receipt,
  canonicalizerPolicy,
  {
    canonicalizerDigest = receipt.canonicalizerDigest,
    coveragePolicyDigest = receipt.coveragePolicyDigest,
  } = {},
) {
  assertPlainReceiptData(canonicalizerPolicy);
  const validatedCanonicalizerPolicy = validateCanonicalizerPolicy(
    structuredClone(canonicalizerPolicy),
  );
  const suppliedCanonicalizerPolicyDigest = createHash('sha256')
    .update(Buffer.from(`${JSON.stringify(validatedCanonicalizerPolicy, null, 2)}\n`))
    .digest('hex');
  if (receipt.canonicalizerPolicyDigest !== suppliedCanonicalizerPolicyDigest) {
    fail('canonicalizer policy must match the measured receipt');
  }
  const published = loadPublishedM4142CoverageInput();
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
    fail('archived M4.142 input must match the exact independently pinned baseline');
  }
  const liveSemanticInput = {
    baseCompleteFunctions: receipt.baseCompleteFunctions,
    baseId: receipt.base.id,
    canonicalizerDigest,
    canonicalizerPolicyDigest: receipt.canonicalizerPolicyDigest,
    compiledCoreDigest: receipt.compiledCoreDigest,
    corpusDigest: receipt.corpusDigest,
    coveragePolicyDigest,
    currentProfileLimits: exactLimits(canonicalizerPolicy.profileLimits),
    familyRegistryDigest: receipt.familyRegistryDigest,
    functionFactsDigest: receipt.functionFactsDigest,
    profileDigest: receipt.profileDigest,
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
    profileDigest: PUBLISHED_BASELINE.profileDigest,
  };
  if (!isDeepStrictEqual(liveSemanticInput, expected)) {
    fail('live semantic facts must match the exact published M4.142 input');
  }
}

export function measureCanonicalizerResidualAnalysisM4143() {
  const historical = measureAuthenticatedM4142CoverageInput();
  const policy = historical.policy;
  const canonicalizerPolicy = loadPreM4146CanonicalizerPolicy();
  const receipt = historical.coverage;
  assertM4143PublishedInput(receipt, canonicalizerPolicy, {
    canonicalizerDigest: historical.canonicalizerDigest,
    coveragePolicyDigest: historical.coveragePolicyDigest,
  });

  const roots = sourceFunctionRoots(policy, historical.sourceOverrides);
  const legacyFacts = receipt.functions.filter(({ excludedProperties }) =>
    excludedProperties.includes('fn.params'));
  if (legacyFacts.length !== PUBLISHED_BASELINE.legacyParameterBlockers) {
    fail('legacy parameter population must remain exactly 2 functions');
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
    fail('M4.142 must expose an empty queue and exactly 2 residual functions');
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
    fail('reason assignments must reproduce the M4.142 exhaustion frontier');
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
    analysis.frontier.profileRowsAvailableFunctions !== 1 ||
    analysis.frontier.evaluatedObservedSettings !== 0 ||
    analysis.frontier.actionableCandidates.length !== 0 ||
    analysis.selectedNextAction !== null
  ) {
    fail('M4.142 residual frontier must expose no actionable profile widening');
  }
  assertPlainReceiptData(analysis);
  return analysis;
}

export function validatePublishedCanonicalizerResidualAnalysisM4143(value) {
  return publishedHandoff(value);
}

export function loadPublishedCanonicalizerResidualAnalysisM4143() {
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
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerResidualAnalysisM4143());
}
