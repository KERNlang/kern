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
  verifyCanonicalizerComposition,
} from './composition.mjs';
import { loadCoveragePolicy } from './coverage.mjs';
import {
  migrateLegacyFunctionForPrerequisite,
  sourceFunctionRoots,
} from './coverage-prerequisite.mjs';
import { flattenKirRoots, tableArguments } from './flatten.mjs';
import { loadPreM4130CanonicalizerPolicy } from './historical-policy.mjs';
import { loadPublishedCanonicalizerProjectionAnalysisM4110 } from './projection-analysis-m4-110.mjs';

const PROJECTION_ANALYSIS_DIGEST =
  '38f26bb48237832163acb8fa99ee0b65b8dc343f77f6a7570481e54d01d6732f';
const HISTORICAL_ACTIVE_DEPTH = 64;
const CANDIDATE_DEPTH = 76;
const LIVE_DEPTH = 77;

function fail(message) {
  throw new TypeError(`M4.111 KIR depth headroom measurement rejection: ${message}`);
}

function exactInput(witnessId) {
  if (typeof witnessId !== 'string' || witnessId.length === 0) {
    fail('witness id must be non-empty text');
  }
  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4110();
  if (analysis.digest !== PROJECTION_ANALYSIS_DIGEST) {
    fail('published M4.110 receipt digest must remain exact');
  }
  const selected = analysis.record.selectedNextAction;
  if (
    selected?.changedLimits?.length !== 1 ||
    selected.changedLimits[0] !== 'maxDepth' ||
    selected.kirLimits?.maxDepth !== CANDIDATE_DEPTH ||
    selected.completeFunctions !== 9 ||
    selected.completeTools !== 4 ||
    selected.migratedParameterRows !== 134
  ) {
    fail('published M4.110 candidate must remain exact');
  }
  if (!selected.witnesses.includes(witnessId)) {
    fail(`witness ${witnessId} must belong to the exact M4.110 selection`);
  }
  const requirement = analysis.record.requirements.find(({ id }) => id === witnessId);
  if (requirement?.outcome !== 'projected') {
    fail(`witness ${witnessId} must have exact projected M4.110 evidence`);
  }
  const coveragePolicy = loadCoveragePolicy();
  const sourceRoot = sourceFunctionRoots(coveragePolicy).get(witnessId);
  if (sourceRoot === undefined) fail(`missing source root ${witnessId}`);
  const { parameters, root } = migrateLegacyFunctionForPrerequisite(sourceRoot);
  if (parameters.length !== requirement.parameterRows) {
    fail(`witness ${witnessId} parameter rows must remain exact`);
  }
  const policy = loadPreM4130CanonicalizerPolicy();
  if (
    policy.kirLimits.maxDepth !== LIVE_DEPTH ||
    policy.runtimeLimits.maxDepth !== HISTORICAL_ACTIVE_DEPTH
  ) {
    fail('live KIR depth must retain M4.123 while runtime depth remains 64');
  }
  const requiredDepth = requirement.requiredKirLimits.maxDepth;
  if (
    !Number.isSafeInteger(requiredDepth) ||
    requiredDepth <= HISTORICAL_ACTIVE_DEPTH ||
    requiredDepth > CANDIDATE_DEPTH
  ) {
    fail(`witness ${witnessId} must have an exact selected depth requirement`);
  }
  const candidateKirLimits = { ...policy.kirLimits, maxDepth: CANDIDATE_DEPTH };
  const bytes = encodeStructuralKir(root, candidateKirLimits);
  assert.deepEqual(
    Buffer.from(encodeStructuralKir(root, { ...policy.kirLimits, maxDepth: requiredDepth })),
    Buffer.from(bytes),
  );
  assert.throws(
    () => encodeStructuralKir(root, { ...policy.kirLimits, maxDepth: requiredDepth - 1 }),
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
    requiredDepth,
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
  assert.equal(parsed.root.children?.length, 1);
  assert.deepEqual(
    Buffer.from(encodeStructuralKir(parsed.root.children[0], candidateKirLimits)),
    Buffer.from(bytes),
  );
}

export function measureCanonicalizerKirDepthHeadroomWitnessM4111(
  witnessId,
  iterationBudget,
  { verifyPublicParity = false } = {},
) {
  if (!Number.isSafeInteger(iterationBudget) || iterationBudget <= 0) {
    fail('iteration budget must be a positive safe integer');
  }
  const input = exactInput(witnessId);
  const composition = verifyCanonicalizerComposition();
  const limits = {
    ...input.policy.runtimeLimits,
    maxIterations: iterationBudget,
  };
  const linked = resolveInternalRuntimeSourceHandler(
    composition.source,
    { handlerName: 'canonicalize', sourcePath: CANONICALIZER_COMPOSITE_PATH },
    { enabled: true, limits },
  );
  assert.equal('format' in linked, false, JSON.stringify(linked));
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
  let atHigh = measureCanonicalizerKirDepthHeadroomWitnessM4111(witnessId, high);
  if (!successful(atHigh)) {
    high = productionBudget;
    atHigh = measureCanonicalizerKirDepthHeadroomWitnessM4111(witnessId, high);
  }
  while (!successful(atHigh)) {
    high *= 2;
    if (!Number.isSafeInteger(high) || high > productionBudget * 4) {
      fail(`witness ${witnessId} does not complete within the bounded diagnostic envelope`);
    }
    atHigh = measureCanonicalizerKirDepthHeadroomWitnessM4111(witnessId, high);
  }
  let low = 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const measured = measureCanonicalizerKirDepthHeadroomWitnessM4111(witnessId, middle);
    if (successful(measured)) high = middle;
    else low = middle + 1;
  }
  const exact = measureCanonicalizerKirDepthHeadroomWitnessM4111(
    witnessId,
    low,
    { verifyPublicParity: true },
  );
  if (!successful(exact) || !exact.publicParityVerified) {
    fail(`witness ${witnessId} exact floor must round-trip with public parity`);
  }
  const below = measureCanonicalizerKirDepthHeadroomWitnessM4111(witnessId, low - 1);
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

export function measureCanonicalizerKirDepthHeadroomM4111() {
  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4110();
  const policy = loadPreM4130CanonicalizerPolicy();
  const productionBudget = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionBudget * 3 / 4);
  const witnesses = analysis.record.selectedNextAction.witnesses.map((witnessId) =>
    exactFloor(witnessId, promotionBudget, productionBudget));
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
        measureCanonicalizerKirDepthHeadroomWitnessM4111(witnessId, budget),
        null,
        2,
      )}\n`,
    );
  }
}
