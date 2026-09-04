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
import { executeInternalRuntimeHandlerSync } from '../../packages/core/dist/runtime-envelope/handler-entry.js';
import { resolveInternalRuntimeSourceHandler } from '../../packages/core/dist/runtime-envelope/source-handler.js';

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
import { loadPreM4130CanonicalizerPolicy } from './historical-policy.mjs';
import { loadPreM4124CoverageInputs } from './historical-parameter-sources.mjs';
import { loadPublishedCanonicalizerProjectionAnalysisM4121 } from './projection-analysis-m4-121.mjs';

const PROJECTION_ANALYSIS_DIGEST =
  '2579208ec9759c7c31fc76d64dbbe4f09ac9852801506584e78450742a40f1b1';
const HISTORICAL_ACTIVE_DEPTH = 76;
const CANDIDATE_DEPTH = 77;
const WITNESS_ID = 'examples/capstone-checker-subset/checker.kern#2:rejectLine';

function fail(message) {
  throw new TypeError(`M4.122 KIR depth headroom measurement rejection: ${message}`);
}

function exactInput(witnessId) {
  if (typeof witnessId !== 'string' || witnessId.length === 0) {
    fail('witness id must be non-empty text');
  }
  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4121();
  if (analysis.digest !== PROJECTION_ANALYSIS_DIGEST) {
    fail('published M4.121 receipt digest must remain exact');
  }
  const selected = analysis.record.selectedNextAction;
  if (
    selected?.changedLimits?.length !== 1 ||
    selected.changedLimits[0] !== 'maxDepth' ||
    selected.kirLimits?.maxDepth !== CANDIDATE_DEPTH ||
    selected.completeFunctions !== 1 ||
    selected.completeTools !== 1 ||
    selected.migratedParameterRows !== 5 ||
    selected.witnesses?.length !== 1 ||
    selected.witnesses[0] !== WITNESS_ID
  ) {
    fail('published M4.121 candidate must remain exact');
  }
  if (witnessId !== WITNESS_ID) {
    fail(`witness ${witnessId} must belong to the exact M4.121 selection`);
  }
  const requirement = analysis.record.requirements.find(({ id }) => id === witnessId);
  if (
    requirement?.outcome !== 'projected' ||
    requirement.requiredKirLimits?.maxDepth !== CANDIDATE_DEPTH ||
    requirement.parameterRows !== 5
  ) {
    fail(`witness ${witnessId} must have exact projected M4.121 evidence`);
  }
  const currentCoveragePolicy = loadCoveragePolicy();
  const historical = loadPreM4124CoverageInputs(currentCoveragePolicy);
  const sourceRoot = sourceFunctionRoots(
    historical.policy,
    historical.sourceOverrides,
  ).get(witnessId);
  if (sourceRoot === undefined) fail(`missing source root ${witnessId}`);
  const { parameters, root } = migrateLegacyFunctionForPrerequisite(sourceRoot);
  if (parameters.length !== requirement.parameterRows) {
    fail(`witness ${witnessId} parameter rows must remain exact`);
  }
  const policy = loadPreM4130CanonicalizerPolicy();
  if (
    policy.kirLimits.maxDepth !== CANDIDATE_DEPTH ||
    policy.runtimeLimits.maxDepth !== 64
  ) {
    fail('live KIR depth must retain M4.123 while runtime depth remains 64');
  }
  const candidateKirLimits = { ...policy.kirLimits, maxDepth: CANDIDATE_DEPTH };
  const bytes = encodeStructuralKir(root, candidateKirLimits);
  assert.throws(
    () => encodeStructuralKir(root, {
      ...policy.kirLimits,
      maxDepth: HISTORICAL_ACTIVE_DEPTH,
    }),
    (error) => error?.code === 'limit-depth',
  );
  const artifact = decodeStructuralKir(bytes, candidateKirLimits);
  const tables = flattenKirRoots([artifact.root]);
  const structuralRows = {
    nodes: tables.nodeKind.length,
    properties: tables.propNode.length,
    values: tables.valueTag.length,
  };
  assert.deepEqual(structuralRows, requirement.profileRows);
  return {
    bytes,
    candidateKirLimits,
    parameterRows: parameters.length,
    policy,
    requiredDepth: requirement.requiredKirLimits.maxDepth,
    structuralRows,
    tables,
  };
}

function assertRoundTrip(bytes, candidateKirLimits, envelope) {
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
  assert.ok(parsed.root, 'round-tripped source must produce a document root');
  assert.equal(parsed.root.children?.length, 1);
  assert.deepEqual(
    Buffer.from(encodeStructuralKir(parsed.root.children[0], candidateKirLimits)),
    Buffer.from(bytes),
  );
}

export function measureCanonicalizerKirDepthHeadroomWitnessM4122(
  witnessId,
  iterationBudget,
  { verifyPublicParity = false } = {},
) {
  if (!Number.isSafeInteger(iterationBudget) || iterationBudget <= 0) {
    fail('iteration budget must be a positive safe integer');
  }
  const input = exactInput(witnessId);
  const composition = loadPreM4129CanonicalizerComposition();
  const limits = {
    ...input.policy.runtimeLimits,
    maxIterations: iterationBudget,
  };
  const linked = resolveInternalRuntimeSourceHandler(
    composition.source,
    { handlerName: 'canonicalize', sourcePath: CANONICALIZER_COMPOSITE_PATH },
    { enabled: true, limits },
  );
  if ('format' in linked) fail('canonicalizer candidate must link');
  const arguments_ = [
    ...tableArguments(input.tables),
    input.policy.profileLimits.maxNodeRows,
    input.policy.profileLimits.maxPropertyRows,
    input.policy.profileLimits.maxValueRows,
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
  if (roundTrip) assertRoundTrip(input.bytes, input.candidateKirLimits, envelope);
  let publicParityVerified = false;
  if (verifyPublicParity) {
    const publicEnvelope = executeKernRuntimeHandlerSync({
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: arguments_,
      identity: { handlerName: 'canonicalize', sourcePath: CANONICALIZER_COMPOSITE_PATH },
      source: composition.source,
    }, { enabled: true, limits });
    const { format: _internalFormat, ...internalCommon } = envelope;
    const { format: _publicFormat, ...publicCommon } = publicEnvelope;
    assert.deepEqual(publicCommon, internalCommon);
    publicParityVerified = true;
  }
  return {
    artifactBytes: input.bytes.length,
    candidateKirLimits: {
      maxBytes: input.candidateKirLimits.maxBytes,
      maxDepth: input.candidateKirLimits.maxDepth,
      maxNodes: input.candidateKirLimits.maxNodes,
    },
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
    requiredDepth: input.requiredDepth,
    structuralRows: input.structuralRows,
    witnessId,
  };
}

function successful(measurement) {
  return measurement.envelope.outcome === 'success' && measurement.roundTrip;
}

function exactFloor(witnessId, promotionBudget, productionBudget) {
  let high = promotionBudget;
  let atHigh = measureCanonicalizerKirDepthHeadroomWitnessM4122(witnessId, high);
  if (!successful(atHigh)) {
    high = productionBudget;
    atHigh = measureCanonicalizerKirDepthHeadroomWitnessM4122(witnessId, high);
  }
  while (!successful(atHigh)) {
    high *= 2;
    if (!Number.isSafeInteger(high) || high > productionBudget * 4) {
      fail(`witness ${witnessId} does not complete within the bounded diagnostic envelope`);
    }
    atHigh = measureCanonicalizerKirDepthHeadroomWitnessM4122(witnessId, high);
  }
  let low = 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const measured = measureCanonicalizerKirDepthHeadroomWitnessM4122(witnessId, middle);
    if (successful(measured)) high = middle;
    else low = middle + 1;
  }
  const exact = measureCanonicalizerKirDepthHeadroomWitnessM4122(
    witnessId,
    low,
    { verifyPublicParity: true },
  );
  if (!successful(exact) || !exact.publicParityVerified) {
    fail(`witness ${witnessId} exact floor must round-trip with public parity`);
  }
  const below = measureCanonicalizerKirDepthHeadroomWitnessM4122(witnessId, low - 1);
  if (successful(below) || below.envelope.outcome !== 'failure') {
    fail(`witness ${witnessId} must fail immediately below its exact floor`);
  }
  return {
    artifactBytes: exact.artifactBytes,
    belowFloor: low - 1,
    belowFloorOutcome: below.envelope.outcome,
    exactFloor: low,
    floorOutcome: exact.envelope.outcome,
    id: witnessId,
    parameterRows: exact.parameterRows,
    productionDelta: productionBudget - low,
    promotionDelta: promotionBudget - low,
    publicParityVerified: exact.publicParityVerified,
    requiredDepth: exact.requiredDepth,
    roundTrip: exact.roundTrip,
    structuralRows: exact.structuralRows,
  };
}

export function measureCanonicalizerKirDepthHeadroomM4122() {
  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4121();
  const policy = loadPreM4130CanonicalizerPolicy();
  const productionBudget = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionBudget * 3 / 4);
  const witnesses = analysis.record.selectedNextAction.witnesses.map((witnessId) =>
    exactFloor(witnessId, promotionBudget, productionBudget));
  if (witnesses.length !== 1) {
    fail('published M4.121 selection must contain exactly one witness');
  }
  const maxExactFloor = Math.max(...witnesses.map(({ exactFloor: floor }) => floor));
  return {
    candidateKirLimits: {
      maxBytes: policy.kirLimits.maxBytes,
      maxDepth: CANDIDATE_DEPTH,
      maxNodes: policy.kirLimits.maxNodes,
    },
    decision: maxExactFloor <= promotionBudget ? 'go' : 'no-go',
    maxExactFloor,
    minimumProductionHeadroom: productionBudget - maxExactFloor,
    minimumPromotionHeadroom: promotionBudget - maxExactFloor,
    productionBudget,
    promotionBudget,
    runtimeMaxDepth: policy.runtimeLimits.maxDepth,
    witnesses,
  };
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const witnessId = process.argv[2];
  const budget = Number(process.argv[3]);
  if (typeof witnessId === 'string' && Number.isSafeInteger(budget) && budget > 0) {
    process.stdout.write(
      `${JSON.stringify(
        measureCanonicalizerKirDepthHeadroomWitnessM4122(witnessId, budget),
        null,
        2,
      )}\n`,
    );
  }
}
