import assert from 'node:assert/strict';
import { lstatSync, realpathSync } from 'node:fs';
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
  verifyCanonicalizerComposition,
} from './composition.mjs';
import { loadCoveragePolicy } from './coverage.mjs';
import {
  migrateLegacyFunctionForPrerequisite,
  sourceFunctionRoots,
} from './coverage-prerequisite.mjs';
import { flattenKirRoots, tableArguments } from './flatten.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import {
  loadPublishedCanonicalizerProjectionAnalysisM4144,
} from './projection-analysis-m4-144.mjs';

const PROJECTION_ANALYSIS_DIGEST =
  '0aa57f2721cd76c9fed61ab5aaf22deccb868277e3627587712c92c907a6b086';
const WITNESS_ID =
  'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources';
const ACTIVE_KIR_LIMITS = {
  maxBytes: 273_051,
  maxDepth: 98,
  maxNodes: 5_313,
};
const CANDIDATE_KIR_LIMITS = {
  maxBytes: 367_368,
  maxDepth: 122,
  maxNodes: 7_136,
};
const ACTIVE_PROFILE = {
  maxNodeRows: 202,
  maxPropertyRows: 308,
  maxValueRows: 4_493,
};
const ACTIVE_RUNTIME_LIMITS = {
  maxBytes: 2_184_408,
  maxCollectionLength: 65_536,
  maxDepth: 64,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxStringBytes: 1_092_204,
};
const CANDIDATE_PROFILE = {
  maxNodeRows: 205,
  maxPropertyRows: 332,
  maxValueRows: 6_304,
};
const STRUCTURAL_ROWS = { nodes: 205, properties: 332, values: 6_304 };
const STRUCTURAL_AXES = [
  ['maxBytes', 'limit-bytes'],
  ['maxDepth', 'limit-depth'],
  ['maxNodes', 'limit-nodes'],
];

function fail(message) {
  throw new TypeError(`M4.145 combined headroom measurement rejection: ${message}`);
}

function exactInput() {
  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4144();
  if (analysis.digest !== PROJECTION_ANALYSIS_DIGEST) {
    fail('published M4.144 receipt digest must remain exact');
  }
  assert.equal(analysis.inputCommit, 'e3cc1d133ef90c4e802d8df5318935e3c826398b');
  assert.equal(
    analysis.record.input.inputCommit,
    'e3cc1d133ef90c4e802d8df5318935e3c826398b',
  );
  const selected = analysis.record.selectedNextAction;
  assert.deepEqual(selected, {
    changedKirLimits: ['maxBytes', 'maxDepth', 'maxNodes'],
    changedProfileLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    kirLimits: CANDIDATE_KIR_LIMITS,
    migratedParameterRows: 6,
    profileLimits: CANDIDATE_PROFILE,
    totalDelta: 98_002,
    witnesses: [WITNESS_ID],
  });
  const requirement = analysis.record.requirements.find(({ id }) => id === WITNESS_ID);
  assert.deepEqual(requirement, {
    canonicalSurfaceBlockers: [],
    id: WITNESS_ID,
    kirMinimumRejections: {
      maxBytes: { code: 'limit-bytes', limit: 367_367 },
      maxDepth: { code: 'limit-depth', limit: 121 },
      maxNodes: { code: 'limit-nodes', limit: 7_135 },
    },
    outcome: 'projected',
    parameterRows: 6,
    profileRows: STRUCTURAL_ROWS,
    requiredKirLimits: CANDIDATE_KIR_LIMITS,
    requiredProfileLimits: CANDIDATE_PROFILE,
    tool: 'canonicalizer',
  });

  const sourceRoot = sourceFunctionRoots(loadCoveragePolicy()).get(WITNESS_ID);
  if (sourceRoot === undefined) fail(`missing source root ${WITNESS_ID}`);
  const { parameters, root } = migrateLegacyFunctionForPrerequisite(sourceRoot);
  if (parameters.length !== requirement.parameterRows) {
    fail('expressionsources parameter rows must remain exact');
  }

  const policy = loadCanonicalizerPolicy();
  assert.deepEqual({
    maxBytes: policy.kirLimits.maxBytes,
    maxDepth: policy.kirLimits.maxDepth,
    maxNodes: policy.kirLimits.maxNodes,
  }, ACTIVE_KIR_LIMITS);
  assert.deepEqual(policy.profileLimits, ACTIVE_PROFILE);
  assert.deepEqual(policy.runtimeLimits, ACTIVE_RUNTIME_LIMITS);

  const candidateKirLimits = {
    ...policy.kirLimits,
    ...CANDIDATE_KIR_LIMITS,
  };
  const bytes = encodeStructuralKir(root, candidateKirLimits);
  assert.equal(bytes.length, CANDIDATE_KIR_LIMITS.maxBytes);
  for (const [key, code] of STRUCTURAL_AXES) {
    assert.throws(
      () => encodeStructuralKir(root, {
        ...candidateKirLimits,
        [key]: CANDIDATE_KIR_LIMITS[key] - 1,
      }),
      (error) => error?.code === code,
    );
  }
  const artifact = decodeStructuralKir(bytes, candidateKirLimits);
  const tables = flattenKirRoots([artifact.root]);
  const structuralRows = {
    nodes: tables.nodeKind.length,
    properties: tables.propNode.length,
    values: tables.valueTag.length,
  };
  assert.deepEqual(structuralRows, STRUCTURAL_ROWS);
  return {
    bytes,
    candidateKirLimits,
    parameterRows: parameters.length,
    policy,
    structuralRows,
    tables,
  };
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function loopObserver() {
  const attemptedByType = {};
  return {
    attemptedByType,
    observe(event) {
      if (event.kind === 'loop-iteration') increment(attemptedByType, event.nodeType);
    },
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

export function measureCanonicalizerCombinedHeadroomWitnessM4145(
  iterationBudget,
  {
    verifyObserverParity = false,
    verifyPublicParity = false,
  } = {},
) {
  if (!Number.isSafeInteger(iterationBudget) || iterationBudget <= 0) {
    fail('iteration budget must be a positive safe integer');
  }
  const composition = verifyCanonicalizerComposition();
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
  const observer = loopObserver();
  const started = performance.now();
  const envelope = executeInternalRuntimeHandlerSync(
    linked,
    arguments_,
    makeEnv(),
    { enabled: true, limits, observer: observer.observe },
  );
  const elapsedMilliseconds =
    Math.round((performance.now() - started) * 1_000) / 1_000;
  let observerParityVerified = false;
  if (verifyObserverParity) {
    assert.deepEqual(
      executeInternalRuntimeHandlerSync(
        linked,
        arguments_,
        makeEnv(),
        { enabled: true, limits },
      ),
      envelope,
    );
    observerParityVerified = true;
  }
  const roundTrip = envelope.outcome === 'success';
  if (roundTrip) assertRoundTrip(input.bytes, input.candidateKirLimits, envelope);
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
  const attemptedByType = Object.fromEntries(
    Object.entries(observer.attemptedByType)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
  );
  const attemptedTotal = Object.values(attemptedByType)
    .reduce((total, count) => total + count, 0);
  return {
    artifactBytes: input.bytes.length,
    candidateKirLimits: structuredClone(CANDIDATE_KIR_LIMITS),
    candidateProfileLimits: structuredClone(CANDIDATE_PROFILE),
    elapsedMilliseconds,
    envelope,
    iterationBudget,
    loopIterations: { attemptedByType, attemptedTotal },
    observerParityVerified,
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

function isDirectInvocation(invokedPath) {
  if (invokedPath === undefined || invokedPath === '-') return false;
  const resolvedPath = resolve(invokedPath);
  if (lstatSync(resolvedPath, { throwIfNoEntry: false }) === undefined) return false;
  return realpathSync(resolvedPath) === fileURLToPath(import.meta.url);
}

if (isDirectInvocation(process.argv[1])) {
  if (process.argv.length !== 3) {
    fail('direct invocation requires exactly one positive iteration budget');
  }
  process.stdout.write(`${JSON.stringify(
    measureCanonicalizerCombinedHeadroomWitnessM4145(Number(process.argv[2])),
    null,
    2,
  )}\n`);
}
