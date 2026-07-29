import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { makeEnv } from '../../packages/core/dist/ir/semantics/semantic-env.js';
import {
  decodeStructuralKir,
  encodeStructuralKir,
} from '../../packages/core/dist/kir-structural/canonical.js';
import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../../packages/core/dist/runtime-handler.js';
import {
  executeInternalRuntimeHandlerSync,
} from '../../packages/core/dist/runtime-envelope/handler-entry.js';
import {
  resolveInternalRuntimeSourceHandler,
} from '../../packages/core/dist/runtime-envelope/source-handler.js';

import {
  CANONICALIZER_COMPOSITE_PATH,
} from './composition.mjs';
import {
  loadPreM4129CanonicalizerComposition,
} from './historical-composition.mjs';
import { loadCoveragePolicy } from './coverage.mjs';
import {
  migrateLegacyFunctionForPrerequisite,
  sourceFunctionRoots,
} from './coverage-prerequisite.mjs';
import { flattenKirRoots, tableArguments } from './flatten.mjs';
import { loadPreM4131CoverageInputs } from './historical-parameter-sources.mjs';
import { loadPreM4130CanonicalizerPolicy } from './historical-policy.mjs';
import {
  loadPublishedCanonicalizerProjectionAnalysisM4126,
} from './projection-analysis-m4-126.mjs';

const PROJECTION_ANALYSIS_DIGEST =
  '25f1ba6ed40efdff909a6c95a11c385c12f9eba2b0025375ed4943f14393e369';
const WITNESS_ID =
  'examples/selfhost-validator/validator.kern#20:validate';
const ACTIVE_KIR_LIMITS = {
  maxBytes: 262_144,
  maxDepth: 77,
  maxNodes: 4_096,
};
const CANDIDATE_KIR_LIMITS = {
  maxBytes: 273_051,
  maxDepth: 98,
  maxNodes: 5_313,
};
const ACTIVE_PROFILE = {
  maxNodeRows: 122,
  maxPropertyRows: 193,
  maxValueRows: 2_411,
};
const CANDIDATE_PROFILE = {
  maxNodeRows: 202,
  maxPropertyRows: 308,
  maxValueRows: 4_493,
};
const STRUCTURAL_ROWS = { nodes: 202, properties: 308, values: 4_493 };
const STRUCTURAL_AXES = [
  ['maxBytes', 'limit-bytes'],
  ['maxDepth', 'limit-depth'],
  ['maxNodes', 'limit-nodes'],
];

function fail(message) {
  throw new TypeError(`M4.127 combined headroom measurement rejection: ${message}`);
}

function exactInput() {
  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4126();
  if (analysis.digest !== PROJECTION_ANALYSIS_DIGEST) {
    fail('published M4.126 receipt digest must remain exact');
  }
  const selected = analysis.record.selectedNextAction;
  assert.deepEqual(selected, {
    changedKirLimits: ['maxBytes', 'maxDepth', 'maxNodes'],
    changedProfileLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    kirLimits: CANDIDATE_KIR_LIMITS,
    migratedParameterRows: 41,
    profileLimits: CANDIDATE_PROFILE,
    totalDelta: 14_422,
    witnesses: [WITNESS_ID],
  });
  const requirement = analysis.record.requirements.find(({ id }) => id === WITNESS_ID);
  assert.deepEqual(requirement, {
    id: WITNESS_ID,
    outcome: 'projected',
    parameterRows: 41,
    profileRows: STRUCTURAL_ROWS,
    requiredKirLimits: CANDIDATE_KIR_LIMITS,
    requiredProfileLimits: CANDIDATE_PROFILE,
    tool: 'validator',
  });

  const currentCoveragePolicy = loadCoveragePolicy();
  const historical = loadPreM4131CoverageInputs(currentCoveragePolicy);
  const sourceRoot = sourceFunctionRoots(
    historical.policy,
    historical.sourceOverrides,
  ).get(WITNESS_ID);
  if (sourceRoot === undefined) fail(`missing source root ${WITNESS_ID}`);
  const { parameters, root } = migrateLegacyFunctionForPrerequisite(sourceRoot);
  if (parameters.length !== requirement.parameterRows) {
    fail('validate parameter rows must remain exact');
  }
  const policy = loadPreM4130CanonicalizerPolicy();
  assert.deepEqual({
    maxBytes: policy.kirLimits.maxBytes,
    maxDepth: policy.kirLimits.maxDepth,
    maxNodes: policy.kirLimits.maxNodes,
  }, ACTIVE_KIR_LIMITS);
  assert.deepEqual(policy.profileLimits, ACTIVE_PROFILE);
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.runtimeLimits.maxDepth, 64);

  const fullCandidateKirLimits = {
    ...policy.kirLimits,
    ...CANDIDATE_KIR_LIMITS,
  };
  const bytes = encodeStructuralKir(root, fullCandidateKirLimits);
  for (const [key, code] of STRUCTURAL_AXES) {
    assert.throws(
      () => encodeStructuralKir(root, {
        ...fullCandidateKirLimits,
        [key]: CANDIDATE_KIR_LIMITS[key] - 1,
      }),
      (error) => error?.code === code,
    );
  }
  const artifact = decodeStructuralKir(bytes, fullCandidateKirLimits);
  const tables = flattenKirRoots([artifact.root]);
  const structuralRows = {
    nodes: tables.nodeKind.length,
    properties: tables.propNode.length,
    values: tables.valueTag.length,
  };
  assert.deepEqual(structuralRows, STRUCTURAL_ROWS);
  return {
    bytes,
    fullCandidateKirLimits,
    parameterRows: parameters.length,
    policy,
    structuralRows,
    tables,
  };
}

function assertRoundTrip(bytes, fullCandidateKirLimits, envelope) {
  assert.equal(envelope.outcome, 'success', JSON.stringify(envelope));
  assert.deepEqual(envelope.diagnostics, []);
  assert.deepEqual(envelope.events, []);
  assert.deepEqual(envelope.completion, { kind: 'return' });
  assert.equal(envelope.result.presence, 'value');
  assert.equal(envelope.result.value.tag, 'list');
  const source = `${envelope.result.value.value.map((value) => {
    assert.equal(value.tag, 'text');
    return value.value;
  }).join('\n')}\n`;
  const parsed = parseDocumentWithDiagnostics(source);
  assert.notEqual(parsed.partial, true);
  assert.deepEqual(parsed.diagnostics.filter(({ severity }) => severity === 'error'), []);
  assert.equal(parsed.root.children?.length, 1);
  assert.deepEqual(
    Buffer.from(encodeStructuralKir(parsed.root.children[0], fullCandidateKirLimits)),
    Buffer.from(bytes),
  );
}

export function measureCanonicalizerCombinedHeadroomWitnessM4127(
  iterationBudget,
  { verifyPublicParity = false } = {},
) {
  if (!Number.isSafeInteger(iterationBudget) || iterationBudget <= 0) {
    fail('iteration budget must be a positive safe integer');
  }
  const composition = loadPreM4129CanonicalizerComposition();
  const input = exactInput();
  const limits = {
    ...input.policy.runtimeLimits,
    maxCollectionLength: iterationBudget,
  };
  const linked = resolveInternalRuntimeSourceHandler(
    composition.source,
    { handlerName: 'canonicalize', sourcePath: CANONICALIZER_COMPOSITE_PATH },
    { enabled: true, limits },
  );
  if ('format' in linked) fail('canonicalizer candidate must link');
  const arguments_ = [
    ...tableArguments(input.tables),
    CANDIDATE_PROFILE.maxNodeRows,
    CANDIDATE_PROFILE.maxPropertyRows,
    CANDIDATE_PROFILE.maxValueRows,
  ];
  const started = performance.now();
  const envelope = executeInternalRuntimeHandlerSync(
    linked,
    arguments_,
    makeEnv(),
    { enabled: true, limits },
  );
  const elapsedMilliseconds = Math.round((performance.now() - started) * 1_000) / 1_000;
  const roundTrip = envelope.outcome === 'success';
  if (roundTrip) assertRoundTrip(input.bytes, input.fullCandidateKirLimits, envelope);
  let publicParityVerified = false;
  if (verifyPublicParity) {
    const publicEnvelope = executeKernRuntimeHandlerSync({
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: arguments_,
      identity: {
        handlerName: 'canonicalize',
        sourcePath: CANONICALIZER_COMPOSITE_PATH,
      },
      source: composition.source,
    }, { enabled: true, limits });
    const { format: _internalFormat, ...internalCommon } = envelope;
    const { format: _publicFormat, ...publicCommon } = publicEnvelope;
    assert.deepEqual(publicCommon, internalCommon);
    publicParityVerified = true;
  }
  return {
    artifactBytes: input.bytes.length,
    candidateKirLimits: structuredClone(CANDIDATE_KIR_LIMITS),
    candidateProfileLimits: structuredClone(CANDIDATE_PROFILE),
    elapsedMilliseconds,
    envelope,
    iterationBudget,
    parameterRows: input.parameterRows,
    publicParityVerified,
    roundTrip,
    runtimeLimits: {
      maxBytes: limits.maxBytes,
      maxCollectionLength: limits.maxCollectionLength,
      maxDepth: limits.maxDepth,
      maxStringBytes: limits.maxStringBytes,
    },
    structuralRows: input.structuralRows,
    witnessId: WITNESS_ID,
  };
}

function successful(measurement) {
  return measurement.envelope.outcome === 'success' && measurement.roundTrip;
}

export function measureCanonicalizerCombinedHeadroomM4127() {
  const policy = loadPreM4130CanonicalizerPolicy();
  const productionBudget = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionBudget * 3 / 4);
  let high = promotionBudget;
  let atHigh = measureCanonicalizerCombinedHeadroomWitnessM4127(high);
  let low = 1;
  if (!successful(atHigh)) {
    low = promotionBudget + 1;
    high = productionBudget;
    atHigh = measureCanonicalizerCombinedHeadroomWitnessM4127(high);
  }
  while (!successful(atHigh)) {
    low = high + 1;
    high *= 2;
    if (!Number.isSafeInteger(high) || high > productionBudget * 16) {
      fail('validate does not complete within the bounded diagnostic envelope');
    }
    atHigh = measureCanonicalizerCombinedHeadroomWitnessM4127(high);
  }
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const measured = measureCanonicalizerCombinedHeadroomWitnessM4127(middle);
    if (successful(measured)) high = middle;
    else low = middle + 1;
  }
  const exact = measureCanonicalizerCombinedHeadroomWitnessM4127(
    low,
    { verifyPublicParity: true },
  );
  if (!successful(exact) || !exact.publicParityVerified) {
    fail('exact floor must round-trip with public parity');
  }
  const below = measureCanonicalizerCombinedHeadroomWitnessM4127(low - 1);
  if (successful(below) || below.envelope.outcome !== 'failure') {
    fail('validate must fail immediately below its exact floor');
  }
  const decision = low <= promotionBudget
    ? 'go'
    : low <= productionBudget
      ? 'promotion-budget-no-go'
      : 'production-ceiling-no-go';
  return {
    candidateKirLimits: structuredClone(CANDIDATE_KIR_LIMITS),
    candidateProfileLimits: structuredClone(CANDIDATE_PROFILE),
    decision,
    maxExactFloor: low,
    minimumProductionHeadroom: productionBudget - low,
    minimumPromotionHeadroom: promotionBudget - low,
    productionBudget,
    promotionBudget,
    runtimeMaxDepth: policy.runtimeLimits.maxDepth,
    witnesses: [{
      artifactBytes: exact.artifactBytes,
      belowFloor: low - 1,
      belowFloorOutcome: below.envelope.outcome,
      exactFloor: low,
      floorOutcome: exact.envelope.outcome,
      id: WITNESS_ID,
      parameterRows: exact.parameterRows,
      productionDelta: productionBudget - low,
      profileRows: exact.structuralRows,
      promotionDelta: promotionBudget - low,
      publicParityVerified: exact.publicParityVerified,
      roundTrip: exact.roundTrip,
    }],
  };
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 2) {
    process.stdout.write(
      `${JSON.stringify(measureCanonicalizerCombinedHeadroomM4127(), null, 2)}\n`,
    );
  } else {
    const budget = Number(process.argv[2]);
    if (!Number.isSafeInteger(budget) || budget <= 0 || process.argv.length !== 3) {
      fail('direct invocation accepts no arguments or one positive iteration budget');
    }
    process.stdout.write(
      `${JSON.stringify(
        measureCanonicalizerCombinedHeadroomWitnessM4127(budget),
        null,
        2,
      )}\n`,
    );
  }
}
