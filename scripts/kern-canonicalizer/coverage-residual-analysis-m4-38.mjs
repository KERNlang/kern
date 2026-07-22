import { createHash } from 'node:crypto';

import { loadCoveragePolicy, measureCanonicalizerCoverage } from './coverage.mjs';
import {
  measureCanonicalizerPrerequisite,
  migrateFunctionFact,
  partitionMigratedFunctions,
  sourceFunctionRoots,
} from './coverage-prerequisite.mjs';
import {
  canonicalizerCompletionProfile,
  canonicalizerFunctionCompletes,
} from './coverage-selection.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const FORMAT = 'kern.kir-canonicalizer.residual-analysis.2';
const LIMIT_AXES = [
  { limit: 'maxNodeRows', row: 'nodes' },
  { limit: 'maxPropertyRows', row: 'properties' },
  { limit: 'maxValueRows', row: 'values' },
];

function fail(message) {
  throw new TypeError(`coverage M4.38 residual analysis rejection: ${message}`);
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
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('analysis arrays must use the plain prototype');
    const ownKeys = Reflect.ownKeys(value);
    const enumerableKeys = Object.keys(value);
    if (ownKeys.some((key) => typeof key === 'symbol') ||
        ownKeys.length !== value.length + 1 || enumerableKeys.length !== value.length) {
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
    if (Object.getPrototypeOf(value) !== Object.prototype) fail('analysis objects must use the plain prototype');
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

function residualState() {
  const policy = loadCoveragePolicy();
  const coverage = measureCanonicalizerCoverage(policy);
  const prerequisite = measureCanonicalizerPrerequisite();
  const canonicalizerPolicy = loadCanonicalizerPolicy();
  const roots = sourceFunctionRoots(policy);
  if (roots.size !== coverage.functions.length) fail('source functions must match authenticated facts');
  const migrated = coverage.functions
    .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
    .map((fact) => migrateFunctionFact(fact, roots.get(fact.id), policy.base, canonicalizerPolicy));
  const { parameterReady, residual } = partitionMigratedFunctions(
    policy.base,
    migrated,
    canonicalizerPolicy.profileLimits,
  );
  if (parameterReady.length !== 0) fail('M4.38 requires an empty parameter-ready partition');
  if (prerequisite.outcome !== 'bounded-exhaustion' || prerequisite.exhaustion === null) {
    fail('M4.38 requires authenticated bounded exhaustion');
  }
  if (residual.length !== prerequisite.exhaustion.residualFunctionCount) {
    fail('residual facts must match the published prerequisite population');
  }
  return { canonicalizerPolicy, coverage, policy, prerequisite, residual };
}

function reasonAssignments(residual) {
  return residual
    .map((fn) => ({
      id: fn.id,
      reasons: [...new Set([...fn.excludedProperties, ...fn.profileBlockers])].sort(compareText),
    }))
    .sort((left, right) => compareText(left.id, right.id));
}

function assignmentRows(residual, reasons) {
  const reasonById = new Map(reasons.map((row) => [row.id, row.reasons]));
  return residual
    .map((fn) => ({
      id: fn.id,
      parameterRows: fn.parameterRows,
      profileRows: fn.profileRows,
      reasons: reasonById.get(fn.id),
      tool: fn.tool,
    }))
    .sort((left, right) => compareText(left.id, right.id));
}

function observedLimitSettings(residual, currentLimits) {
  const settings = new Map();
  for (const fn of residual) {
    if (fn.profileRows === null) continue;
    const limits = { ...currentLimits };
    const changedLimits = [];
    for (const { limit, row } of LIMIT_AXES) {
      if (fn.profileRows[row] > limits[limit]) {
        limits[limit] = fn.profileRows[row];
        changedLimits.push(limit);
      }
    }
    if (changedLimits.length === 0) continue;
    const signature = LIMIT_AXES.map(({ limit }) => limits[limit]).join('/');
    settings.set(signature, { changedLimits, limits, signature });
  }
  return [...settings.values()].sort((left, right) => compareText(left.signature, right.signature));
}

function factAtLimits(fn, limits) {
  const satisfiedLimitBlockers = new Set(LIMIT_AXES
    .filter(({ limit, row }) => fn.profileRows !== null && fn.profileRows[row] <= limits[limit])
    .map(({ row }) => `profile.rows.${row}`));
  return {
    ...fn,
    profileBlockers: fn.profileBlockers.filter((blocker) => !satisfiedLimitBlockers.has(blocker)),
  };
}

function evaluateSetting(setting, residual, base, currentLimits) {
  const profile = canonicalizerCompletionProfile(base, []);
  const witnesses = residual
    .filter((fn) => canonicalizerFunctionCompletes(profile, factAtLimits(fn, setting.limits), setting.limits))
    .map(({ id }) => id)
    .sort(compareText);
  const witnessIds = new Set(witnesses);
  const tools = new Set(residual.filter(({ id }) => witnessIds.has(id)).map(({ tool }) => tool));
  return {
    changedLimits: setting.changedLimits,
    completeFunctions: witnesses.length,
    completeTools: tools.size,
    limits: setting.limits,
    totalDelta: LIMIT_AXES.reduce(
      (total, { limit }) => total + setting.limits[limit] - currentLimits[limit],
      0,
    ),
    witnesses,
  };
}

function candidateOrder(left, right) {
  return left.changedLimits.length - right.changedLimits.length ||
    right.completeTools - left.completeTools ||
    left.totalDelta - right.totalDelta ||
    right.completeFunctions - left.completeFunctions ||
    compareText(
      LIMIT_AXES.map(({ limit }) => left.limits[limit]).join('/'),
      LIMIT_AXES.map(({ limit }) => right.limits[limit]).join('/'),
    );
}

function buildCanonicalizerResidualAnalysisM438() {
  const { canonicalizerPolicy, coverage, policy, prerequisite, residual } = residualState();
  const reasons = reasonAssignments(residual);
  const assignmentsDigest = createHash('sha256').update(JSON.stringify(reasons)).digest('hex');
  if (assignmentsDigest !== prerequisite.exhaustion.reasonAssignmentsDigest) {
    fail('assignment digest must reproduce the published exhaustion receipt');
  }
  const currentProfileLimits = { ...canonicalizerPolicy.profileLimits };
  const settings = observedLimitSettings(residual, currentProfileLimits);
  const actionableCandidates = settings
    .map((setting) => evaluateSetting(setting, residual, policy.base, currentProfileLimits))
    .filter(({ completeFunctions }) => completeFunctions > 0)
    .sort(candidateOrder);
  return {
    assignments: assignmentRows(residual, reasons),
    assignmentsDigest,
    baseline: {
      baseCompleteFunctions: prerequisite.baseline.baseCompleteFunctions,
      baseId: prerequisite.baseline.baseId,
      coverageImplementationDigest: coverage.coverageImplementationDigest,
      coveragePolicyDigest: coverage.coveragePolicyDigest,
      currentProfileLimits,
      functionFactsDigest: coverage.functionFactsDigest,
      legacyParameterBlockers: prerequisite.baseline.legacyParameterBlockers,
      residualFunctionCount: residual.length,
    },
    format: FORMAT,
    frontier: {
      actionableCandidates,
      evaluatedObservedSettings: settings.length,
      profileRowsAvailableFunctions: residual.filter(({ profileRows }) => profileRows !== null).length,
    },
    selectedNextAction: actionableCandidates[0] ?? null,
  };
}

export function validateCanonicalizerResidualAnalysisM438(value) {
  assertPlainReceiptData(value);
  const expected = buildCanonicalizerResidualAnalysisM438();
  if (JSON.stringify(value) !== JSON.stringify(expected)) fail('analysis must match authenticated measurement');
  return expected;
}

export function measureCanonicalizerResidualAnalysisM438() {
  return buildCanonicalizerResidualAnalysisM438();
}
