import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
import { migrateLegacyFunctionForPrerequisite } from './coverage-prerequisite.mjs';
import { loadPublishedCanonicalizerResidualAnalysisM4114 } from './coverage-residual-analysis-m4-114.mjs';
import { flattenKirRoots, tableArguments } from './flatten.mjs';
import { loadPreM4130CanonicalizerPolicy } from './historical-policy.mjs';
import { reconstructLegacyParameterSource } from './historical-parameter-sources.mjs';

const WITNESS_ID =
  'examples/capstone-checker-subset/checker.kern#24:checkModule';
const WITNESS_SOURCE_URL =
  new URL('../../examples/capstone-checker-subset/checker.kern', import.meta.url);
const WITNESS_SOURCE_SHA256 =
  'f8c9b50d5be28074479bebed4c93e6e6d7f8f15ea9efab54c2b396dcde924d99';
const RESIDUAL_ANALYSIS_SHA256 =
  '23fd8f52fa70e2a72fb4b4b1b7ae4c477b369a5f46853691b86b7506a9717e0c';
const PROFILE_ROWS = { nodes: 122, properties: 193, values: 2411 };
const CANDIDATE_PROFILE = {
  maxNodeRows: PROFILE_ROWS.nodes,
  maxPropertyRows: PROFILE_ROWS.properties,
  maxValueRows: PROFILE_ROWS.values,
};

function exactWitness() {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM4114();
  assert.equal(analysis.digest, RESIDUAL_ANALYSIS_SHA256);
  assert.deepEqual(analysis.record.selectedNextAction, {
    changedLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: CANDIDATE_PROFILE,
    totalDelta: 412,
    witnesses: [WITNESS_ID],
  });
  const source = reconstructLegacyParameterSource({
    additionalNames: ['rejectLine'],
    currentSource: readFileSync(WITNESS_SOURCE_URL),
    expectedDigest: WITNESS_SOURCE_SHA256,
    milestone: 'M4.115 checkModule witness',
    name: 'checkModule',
  });
  assert.equal(createHash('sha256').update(source).digest('hex'), WITNESS_SOURCE_SHA256);
  const parsed = parseDocumentWithDiagnostics(source.toString('utf8'));
  assert.notEqual(parsed.partial, true);
  assert.deepEqual(parsed.diagnostics.filter(({ severity }) => severity === 'error'), []);
  const sourceRoot = parsed.root.children?.[24];
  assert.equal(sourceRoot?.type, 'fn');
  assert.equal(sourceRoot?.props?.name, 'checkModule');
  const { parameters, root } = migrateLegacyFunctionForPrerequisite(sourceRoot);
  assert.equal(parameters.length, 58);
  const policy = loadPreM4130CanonicalizerPolicy();
  assert.equal(policy.kirLimits.maxDepth, 77);
  assert.equal(policy.runtimeLimits.maxDepth, 64);
  const bytes = encodeStructuralKir(root, policy.kirLimits);
  const artifact = decodeStructuralKir(bytes, policy.kirLimits);
  const tables = flattenKirRoots([artifact.root]);
  assert.deepEqual({
    nodes: tables.nodeKind.length,
    properties: tables.propNode.length,
    values: tables.valueTag.length,
  }, PROFILE_ROWS);
  return { bytes, policy, tables };
}

function assertRoundTrip(bytes, policy, envelope) {
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
    Buffer.from(encodeStructuralKir(parsed.root.children[0], policy.kirLimits)),
    Buffer.from(bytes),
  );
}

export function measureCanonicalizerTripleRowHeadroomM4115(
  iterationBudget,
  { verifyPublicParity = false } = {},
) {
  if (!Number.isSafeInteger(iterationBudget) || iterationBudget <= 0) {
    throw new TypeError('M4.115 iteration budget must be a positive safe integer');
  }
  const composition = verifyCanonicalizerComposition();
  const { bytes, policy, tables } = exactWitness();
  const limits = { ...policy.runtimeLimits, maxIterations: iterationBudget };
  const linked = resolveInternalRuntimeSourceHandler(
    composition.source,
    { handlerName: 'canonicalize', sourcePath: CANONICALIZER_COMPOSITE_PATH },
    { enabled: true, limits },
  );
  assert.equal('format' in linked, false, JSON.stringify(linked));
  const arguments_ = [
    ...tableArguments(tables),
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
  let roundTrip = false;
  if (envelope.outcome === 'success') {
    assertRoundTrip(bytes, policy, envelope);
    roundTrip = true;
  }
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
    artifactBytes: bytes.length,
    elapsedMilliseconds: Math.round((performance.now() - started) * 1_000) / 1_000,
    envelope,
    iterationBudget,
    publicParityVerified,
    roundTrip,
    witness: {
      id: WITNESS_ID,
      parameterRows: 58,
      structuralRows: PROFILE_ROWS,
    },
  };
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const budget = Number(process.argv[2]);
  if (Number.isSafeInteger(budget) && budget > 0) {
    process.stdout.write(
      `${JSON.stringify(measureCanonicalizerTripleRowHeadroomM4115(budget), null, 2)}\n`,
    );
  }
}
