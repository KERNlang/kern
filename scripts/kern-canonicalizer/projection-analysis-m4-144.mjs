import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
} from './coverage.mjs';
import {
  assertM4143PublishedInput,
  loadPublishedCanonicalizerResidualAnalysisM4143,
  measureCanonicalizerResidualAnalysisM4143,
} from './coverage-residual-analysis-m4-143.mjs';
import { canonicalProfileRowsForFunction } from './coverage-profile.mjs';
import {
  migrateFunctionFact,
  migrateLegacyFunctionForPrerequisite,
  sourceFunctionRoots,
} from './coverage-prerequisite.mjs';
import { assertExactPlainData } from './coverage-prerequisite-shape.mjs';
import {
  canonicalizerCompletionProfile,
  canonicalizerFunctionCompletes,
} from './coverage-selection.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadPreM4146CanonicalizerPolicy } from './historical-policy.mjs';

const FORMAT = 'kern.kir-canonicalizer.projection-analysis.2';
const PUBLISHED_DIGEST = '0aa57f2721cd76c9fed61ab5aaf22deccb868277e3627587712c92c907a6b086';
const INPUT_COMMIT = 'e3cc1d133ef90c4e802d8df5318935e3c826398b';
const RESIDUAL_ANALYSIS_DIGEST =
  '22639a2453389244611a91560afcd8d03ecefca8874089015f338622e5ba6e3e';
const ASSIGNMENT_DIGEST =
  '1da9a57ec132a8147f75ab0d252e188aa86b2744b23d58cf3dfa3510b7bcc106';
const SUMMARY_URL = new URL('./projection-analysis-m4-144.json', import.meta.url);
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
  maxBytes: 273_051,
  maxDepth: 98,
  maxNodes: 5_313,
};
const BASE_PROFILE_LIMITS = {
  maxNodeRows: 202,
  maxPropertyRows: 308,
  maxValueRows: 4_493,
};
const EXPRESSIONSOURCES_ID =
  'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources';

function fail(message) {
  throw new TypeError(`coverage M4.144 projection analysis rejection: ${message}`);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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
      profileRows: canonicalProfileRowsForFunction(root, limits),
    };
  } catch (error) {
    if (typeof error?.code !== 'string' || error.code.length === 0) throw error;
    return { outcome: 'unsupported', projectionCode: error.code };
  }
}

function minimumLimit(root, baseLimits, probeLimits, key, expectedCode) {
  if (project(root, { ...probeLimits, [key]: baseLimits[key] }).outcome === 'projected') {
    return {
      minimum: baseLimits[key],
      rejection: null,
    };
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
  return {
    minimum: low,
    rejection: {
      code: expectedCode,
      limit: low - 1,
    },
  };
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
  assertExactPlainData(
    value,
    'coverage M4.144 projection analysis rejection: analysis data',
  );
  if (value === null || Array.isArray(value) || value.format !== FORMAT) {
    fail(`published format must be ${FORMAT}`);
  }
  const digest = createHash('sha256').update(canonicalBytes(value)).digest('hex');
  if (digest !== PUBLISHED_DIGEST) fail('receipt must match the exact published M4.144 analysis');
  return { digest, inputCommit: INPUT_COMMIT, record: structuredClone(value) };
}

export function measureCanonicalizerProjectionAnalysisM4144() {
  const residualHandoff = loadPublishedCanonicalizerResidualAnalysisM4143();
  if (residualHandoff.digest !== RESIDUAL_ANALYSIS_DIGEST) {
    fail('M4.143 input digest must remain exact');
  }
  if (residualHandoff.record.assignmentsDigest !== ASSIGNMENT_DIGEST) {
    fail('M4.143 reason assignments must remain exact');
  }
  const liveResidual = measureCanonicalizerResidualAnalysisM4143();
  if (!isDeepStrictEqual(liveResidual, residualHandoff.record)) {
    fail('live M4.143 residual analysis must exactly reproduce the published input');
  }

  const policy = loadCoveragePolicy();
  const canonicalizerPolicy = loadPreM4146CanonicalizerPolicy();
  const coverage = measureCanonicalizerCoverage(policy, canonicalizerPolicy);
  assertM4143PublishedInput(coverage, canonicalizerPolicy);
  const roots = sourceFunctionRoots(policy);
  const legacyFacts = coverage.functions
    .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
    .sort((left, right) => compareText(left.id, right.id));
  const expectedIds = residualHandoff.record.assignments.map(({ id }) => id);
  if (!isDeepStrictEqual(legacyFacts.map(({ id }) => id), expectedIds)) {
    fail('live legacy functions must match the exact M4.143 assignments');
  }

  const fullBaseKirLimits = structuredClone(canonicalizerPolicy.kirLimits);
  const baseKirLimits = exactKirLimits(fullBaseKirLimits);
  const baseProfileLimits = exactProfileLimits(canonicalizerPolicy.profileLimits);
  if (!isDeepStrictEqual(baseKirLimits, BASE_KIR_LIMITS)) {
    fail('live structural KIR policy must retain the exact M4.130 promotion');
  }
  if (!isDeepStrictEqual(baseProfileLimits, BASE_PROFILE_LIMITS)) {
    fail('live profile policy must retain the exact M4.130 promotion');
  }

  const probeLimits = {
    ...fullBaseKirLimits,
    ...Object.fromEntries(
      LIMIT_AXES.map(([key]) => [key, baseKirLimits[key] * 2]),
    ),
  };
  const migratedRoots = new Map(legacyFacts.map((fact) => [
    fact.id,
    migrateLegacyFunctionForPrerequisite(roots.get(fact.id)).root,
  ]));
  const requirements = legacyFacts.map((fact) => {
    const assignment = residualHandoff.record.assignments
      .find(({ id }) => id === fact.id);
    if (assignment === undefined || assignment.tool !== fact.tool) {
      fail(`M4.143 assignment must remain exact for ${fact.id}`);
    }
    const root = migratedRoots.get(fact.id);
    const probe = project(root, probeLimits);
    if (probe.outcome !== 'projected') {
      return {
        canonicalSurfaceBlockers: assignment.reasons
          .filter((reason) => !reason.startsWith('projection.')),
        id: fact.id,
        outcome: 'unsupported',
        parameterRows: assignment.parameterRows,
        projectionCode: probe.projectionCode,
        tool: fact.tool,
      };
    }
    const kirMinimums = Object.fromEntries(
      LIMIT_AXES.map(([key, code]) => [
        key,
        minimumLimit(root, fullBaseKirLimits, probeLimits, key, code),
      ]),
    );
    const requiredKirLimits = Object.fromEntries(
      LIMIT_AXES
        .map(([key]) => [key, kirMinimums[key].minimum])
        .filter(([key, value]) => value > baseKirLimits[key]),
    );
    return {
      canonicalSurfaceBlockers: assignment.reasons
        .filter((reason) => !reason.startsWith('projection.')),
      id: fact.id,
      kirMinimumRejections: Object.fromEntries(
        LIMIT_AXES
          .filter(([key]) => kirMinimums[key].rejection !== null)
          .map(([key]) => [key, kirMinimums[key].rejection]),
      ),
      outcome: 'projected',
      parameterRows: assignment.parameterRows,
      profileRows: probe.profileRows,
      requiredKirLimits,
      requiredProfileLimits: Object.fromEntries(
        PROFILE_AXES
          .map(([key, row]) => [
            key,
            Math.max(baseProfileLimits[key], probe.profileRows[row]),
          ])
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
        ...baseKirLimits,
        ...requirement.requiredKirLimits,
      },
      profileLimits: {
        ...baseProfileLimits,
        ...requirement.requiredProfileLimits,
      },
    };
    if (
      !isDeepStrictEqual(setting, {
        kirLimits: baseKirLimits,
        profileLimits: baseProfileLimits,
      })
    ) {
      observedSettings.set(JSON.stringify(setting), setting);
    }
  }

  const baseProfile = canonicalizerCompletionProfile(policy.base, []);
  const candidates = [...observedSettings.values()]
    .map(({ kirLimits, profileLimits }) => {
      const witnesses = legacyFacts
        .map((fact) => migrateFunctionFact(
          {
            ...fact,
            excludedProperties: fact.excludedProperties
              .filter((property) => !property.startsWith('projection.')),
          },
          roots.get(fact.id),
          policy.base,
          {
            ...canonicalizerPolicy,
            kirLimits: { ...fullBaseKirLimits, ...kirLimits },
            profileLimits,
          },
        ))
        .filter((fact) => canonicalizerFunctionCompletes(baseProfile, fact, profileLimits))
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
      assignmentDigest: ASSIGNMENT_DIGEST,
      baseKirLimits,
      inputCommit: INPUT_COMMIT,
      profileLimits: baseProfileLimits,
      residualAnalysisDigest: RESIDUAL_ANALYSIS_DIGEST,
      residualFunctions: requirements.length,
    },
    requirements,
    selectedNextAction: structuredClone(candidates[0] ?? null),
    summary: {
      canonicalSurfaceFunctions: requirements
        .filter(({ canonicalSurfaceBlockers }) => canonicalSurfaceBlockers.length > 0).length,
      observedSettings: observedSettings.size,
      projectedFunctions: requirements.filter(({ outcome }) => outcome === 'projected').length,
      unsupportedFunctions: requirements.filter(({ outcome }) => outcome === 'unsupported').length,
    },
  };
  const expectedAction = {
    changedKirLimits: ['maxBytes', 'maxDepth', 'maxNodes'],
    changedProfileLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    kirLimits: { maxBytes: 367_368, maxDepth: 122, maxNodes: 7_136 },
    migratedParameterRows: 6,
    profileLimits: { maxNodeRows: 205, maxPropertyRows: 332, maxValueRows: 6_304 },
    totalDelta: 98_002,
    witnesses: [EXPRESSIONSOURCES_ID],
  };
  if (
    analysis.requirements.length !== 2 ||
    analysis.candidates.length !== 1 ||
    !isDeepStrictEqual(analysis.summary, {
      canonicalSurfaceFunctions: 1,
      observedSettings: 1,
      projectedFunctions: 2,
      unsupportedFunctions: 0,
    }) ||
    !isDeepStrictEqual(analysis.selectedNextAction, expectedAction)
  ) {
    fail('measured M4.144 projection frontier must retain the exact combined candidate');
  }
  assertExactPlainData(
    analysis,
    'coverage M4.144 projection analysis rejection: measured analysis',
  );
  return analysis;
}

export function validatePublishedCanonicalizerProjectionAnalysisM4144(value) {
  return publishedHandoff(value);
}

export function loadPublishedCanonicalizerProjectionAnalysisM4144() {
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
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerProjectionAnalysisM4144());
}
