import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadCoveragePolicy, measureCanonicalizerCoverage } from './coverage.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM4125,
} from './coverage-residual-analysis-m4-125.mjs';
import { canonicalProfileRowsForPreM4135 } from './historical-expression-projector.mjs';
import {
  migrateFunctionFact,
  migrateLegacyFunctionForPrerequisite,
  sourceFunctionRoots,
} from './coverage-prerequisite.mjs';
import {
  canonicalizerCompletionProfile,
  canonicalizerFunctionCompletes,
} from './coverage-selection.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadPreM4131CoverageInputs } from './historical-parameter-sources.mjs';
import { loadPreM4130CanonicalizerPolicy } from './historical-policy.mjs';

const FORMAT = 'kern.kir-canonicalizer.projection-analysis.1';
const PUBLISHED_DIGEST = '25f1ba6ed40efdff909a6c95a11c385c12f9eba2b0025375ed4943f14393e369';
const INPUT_COMMIT = '9b5a5dc7c64a257356c412b6e1d98d85404d538b';
const RESIDUAL_ANALYSIS_DIGEST =
  'eb2b075097025b9f91089a0587e84807279061801850b10402dd0978a2fe9652';
const SUMMARY_URL = new URL('./projection-analysis-m4-126.json', import.meta.url);
const LIMIT_AXES = [
  ['maxBytes', 'limit-bytes'],
  ['maxDepth', 'limit-depth'],
  ['maxNodes', 'limit-nodes'],
];
const PROFILE_AXES = [
  ['maxNodeRows', 'nodes'],
  ['maxPropertyRows', 'properties'],
  ['maxValueRows', 'values'],
];
const BASE_KIR_LIMITS = {
  maxBytes: 262_144,
  maxDepth: 77,
  maxNodes: 4_096,
};

function fail(message) {
  throw new TypeError(`coverage M4.126 projection analysis rejection: ${message}`);
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
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('arrays must use the plain prototype');
    const keys = Reflect.ownKeys(value);
    if (
      keys.some((key) => typeof key === 'symbol') ||
      keys.length !== value.length + 1 ||
      Object.keys(value).length !== value.length
    ) {
      fail('arrays must be dense and undecorated');
    }
    for (const [index, key] of Object.keys(value).entries()) {
      if (key !== String(index)) fail('arrays must contain canonical indices');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('arrays must contain plain enumerable data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) fail('objects must use the plain prototype');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') fail('objects must not contain symbol properties');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      fail('objects must contain only plain enumerable data properties');
    }
    assertPlainReceiptData(descriptor.value, seen);
  }
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function exactKirLimits(limits) {
  return Object.fromEntries(LIMIT_AXES.map(([key]) => [key, limits[key]]));
}

function exactProfileLimits(limits) {
  return Object.fromEntries(PROFILE_AXES.map(([key]) => [key, limits[key]]));
}

function project(root, limits) {
  try {
    return {
      outcome: 'projected',
      profileRows: canonicalProfileRowsForPreM4135(root, limits),
    };
  } catch (error) {
    if (typeof error?.code !== 'string' || error.code.length === 0) throw error;
    return { outcome: 'unsupported', projectionCode: error.code };
  }
}

function minimumLimit(root, baseLimits, probeLimits, key, expectedCode) {
  if (project(root, { ...probeLimits, [key]: baseLimits[key] }).outcome === 'projected') {
    return baseLimits[key];
  }
  let low = baseLimits[key] + 1;
  let high = probeLimits[key];
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (project(root, { ...probeLimits, [key]: middle }).outcome === 'projected') {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  const accepted = project(root, { ...probeLimits, [key]: low });
  const rejected = project(root, { ...probeLimits, [key]: low - 1 });
  if (
    accepted.outcome !== 'projected' ||
    rejected.outcome !== 'unsupported' ||
    rejected.projectionCode !== expectedCode
  ) {
    fail(`${key} minimum must pass exactly above an ${expectedCode} rejection`);
  }
  return low;
}

function candidateOrder(left, right) {
  return left.changedKirLimits.length + left.changedProfileLimits.length -
      right.changedKirLimits.length - right.changedProfileLimits.length ||
    right.completeTools - left.completeTools ||
    left.totalDelta - right.totalDelta ||
    right.completeFunctions - left.completeFunctions ||
    compareText(
      JSON.stringify([left.kirLimits, left.profileLimits]),
      JSON.stringify([right.kirLimits, right.profileLimits]),
    );
}

function publishedHandoff(value) {
  assertPlainReceiptData(value);
  if (value === null || Array.isArray(value) || value.format !== FORMAT) {
    fail(`published format must be ${FORMAT}`);
  }
  const digest = createHash('sha256').update(canonicalBytes(value)).digest('hex');
  if (digest !== PUBLISHED_DIGEST) fail('receipt must match the exact published M4.126 analysis');
  return { digest, inputCommit: INPUT_COMMIT, record: structuredClone(value) };
}

export function measureCanonicalizerProjectionAnalysisM4126() {
  const residualHandoff = loadPublishedCanonicalizerResidualAnalysisM4125();
  if (residualHandoff.digest !== RESIDUAL_ANALYSIS_DIGEST) {
    fail('M4.125 input digest must remain exact');
  }
  const currentPolicy = loadCoveragePolicy();
  const historical = loadPreM4131CoverageInputs(currentPolicy);
  const policy = historical.policy;
  const canonicalizerPolicy = loadPreM4130CanonicalizerPolicy();
  const coverage = measureCanonicalizerCoverage(
    policy,
    canonicalizerPolicy,
    { sourceOverrides: historical.sourceOverrides },
  );
  const roots = sourceFunctionRoots(policy, historical.sourceOverrides);
  const legacyFacts = coverage.functions
    .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
    .sort((left, right) => compareText(left.id, right.id));
  const expectedIds = residualHandoff.record.assignments.map(({ id }) => id);
  if (JSON.stringify(legacyFacts.map(({ id }) => id)) !== JSON.stringify(expectedIds)) {
    fail('live legacy functions must match the exact M4.125 assignments');
  }
  if (
    canonicalBytes(exactKirLimits(canonicalizerPolicy.kirLimits))
      .compare(canonicalBytes(BASE_KIR_LIMITS)) !== 0
  ) {
    fail('live structural KIR policy must retain the exact M4.123 promotion');
  }

  const baseKirLimits = {
    ...canonicalizerPolicy.kirLimits,
    ...BASE_KIR_LIMITS,
  };
  const baseProfileLimits = exactProfileLimits(canonicalizerPolicy.profileLimits);
  const probeLimits = {
    ...baseKirLimits,
    ...Object.fromEntries(LIMIT_AXES.map(([key]) => [key, baseKirLimits[key] * 2])),
  };
  const migratedRoots = new Map(legacyFacts.map((fact) => [
    fact.id,
    migrateLegacyFunctionForPrerequisite(roots.get(fact.id)).root,
  ]));
  const requirements = legacyFacts.map((fact) => {
    const root = migratedRoots.get(fact.id);
    const assignment = residualHandoff.record.assignments.find(({ id }) => id === fact.id);
    const probe = project(root, probeLimits);
    if (probe.outcome !== 'projected') {
      return {
        id: fact.id,
        outcome: 'unsupported',
        parameterRows: assignment.parameterRows,
        projectionCode: probe.projectionCode,
        tool: fact.tool,
      };
    }
    const requiredKirLimits = Object.fromEntries(
      LIMIT_AXES
        .map(([key, code]) => [
          key,
          minimumLimit(root, baseKirLimits, probeLimits, key, code),
        ])
        .filter(([key, value]) => value > baseKirLimits[key]),
    );
    return {
      id: fact.id,
      outcome: 'projected',
      parameterRows: assignment.parameterRows,
      profileRows: probe.profileRows,
      requiredKirLimits,
      requiredProfileLimits: Object.fromEntries(
        PROFILE_AXES
          .map(([key, row]) => [key, Math.max(baseProfileLimits[key], probe.profileRows[row])])
          .filter(([key, value]) => value > baseProfileLimits[key]),
      ),
      tool: fact.tool,
    };
  });

  const observedSettings = new Map();
  for (const requirement of requirements) {
    if (requirement.outcome !== 'projected') continue;
    const setting = {
      kirLimits: {
        ...exactKirLimits(baseKirLimits),
        ...requirement.requiredKirLimits,
      },
      profileLimits: {
        ...baseProfileLimits,
        ...requirement.requiredProfileLimits,
      },
    };
    if (
      JSON.stringify(setting) !== JSON.stringify({
        kirLimits: exactKirLimits(baseKirLimits),
        profileLimits: baseProfileLimits,
      })
    ) {
      observedSettings.set(JSON.stringify(setting), setting);
    }
  }

  const baseProfile = canonicalizerCompletionProfile(policy.base, []);
  const candidates = [...observedSettings.values()]
    .map(({ kirLimits, profileLimits }) => {
      const fullKirLimits = { ...baseKirLimits, ...kirLimits };
      const witnesses = legacyFacts
        .map((fact) => migrateFunctionFact(
          {
            ...fact,
            excludedProperties: fact.excludedProperties
              .filter((property) => !property.startsWith('projection.')),
          },
          roots.get(fact.id),
          policy.base,
          { ...canonicalizerPolicy, kirLimits: fullKirLimits, profileLimits },
          canonicalProfileRowsForPreM4135,
        ))
        .filter((fact) =>
          canonicalizerFunctionCompletes(baseProfile, fact, profileLimits))
        .sort((left, right) => compareText(left.id, right.id));
      const changedKirLimits = LIMIT_AXES
        .map(([key]) => key)
        .filter((key) => kirLimits[key] !== baseKirLimits[key]);
      const changedProfileLimits = PROFILE_AXES
        .map(([key]) => key)
        .filter((key) => profileLimits[key] !== baseProfileLimits[key]);
      return {
        changedKirLimits,
        changedProfileLimits,
        completeFunctions: witnesses.length,
        completeTools: new Set(witnesses.map(({ tool }) => tool)).size,
        kirLimits,
        migratedParameterRows: witnesses.reduce(
          (total, row) => total + row.parameterRows,
          0,
        ),
        profileLimits,
        totalDelta: changedKirLimits.reduce(
          (total, key) => total + kirLimits[key] - baseKirLimits[key],
          0,
        ) + changedProfileLimits.reduce(
          (total, key) => total + profileLimits[key] - baseProfileLimits[key],
          0,
        ),
        witnesses: witnesses.map(({ id }) => id),
      };
    })
    .filter(({ completeFunctions }) => completeFunctions > 0)
    .sort(candidateOrder);

  const analysis = {
    candidates,
    format: FORMAT,
    input: {
      assignmentDigest: residualHandoff.record.assignmentsDigest,
      baseKirLimits: exactKirLimits(baseKirLimits),
      profileLimits: baseProfileLimits,
      residualAnalysisDigest: RESIDUAL_ANALYSIS_DIGEST,
      residualFunctions: requirements.length,
    },
    requirements,
    selectedNextAction: structuredClone(candidates[0] ?? null),
    summary: {
      observedSettings: observedSettings.size,
      projectedFunctions: requirements.filter(({ outcome }) => outcome === 'projected').length,
      unsupportedFunctions: requirements.filter(({ outcome }) => outcome === 'unsupported').length,
    },
  };
  if (
    analysis.requirements.length !== 4 ||
    analysis.candidates.length !== 1 ||
    analysis.summary.observedSettings !== 2 ||
    analysis.summary.projectedFunctions !== 2 ||
    analysis.summary.unsupportedFunctions !== 2 ||
    analysis.selectedNextAction?.completeFunctions !== 1 ||
    analysis.selectedNextAction?.completeTools !== 1 ||
    analysis.selectedNextAction?.migratedParameterRows !== 41 ||
    JSON.stringify(analysis.selectedNextAction?.kirLimits) !== JSON.stringify({
      maxBytes: 273_051,
      maxDepth: 98,
      maxNodes: 5_313,
    }) ||
    JSON.stringify(analysis.selectedNextAction?.profileLimits) !== JSON.stringify({
      maxNodeRows: 202,
      maxPropertyRows: 308,
      maxValueRows: 4_493,
    }) ||
    analysis.selectedNextAction?.totalDelta !== 14_422 ||
    analysis.selectedNextAction?.witnesses[0] !==
      'examples/selfhost-validator/validator.kern#20:validate'
  ) {
    fail('measured M4.126 projection frontier must retain the exact combined candidate');
  }
  assertPlainReceiptData(analysis);
  return analysis;
}

export function validatePublishedCanonicalizerProjectionAnalysisM4126(value) {
  return publishedHandoff(value);
}

export function loadPublishedCanonicalizerProjectionAnalysisM4126() {
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
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerProjectionAnalysisM4126());
}
