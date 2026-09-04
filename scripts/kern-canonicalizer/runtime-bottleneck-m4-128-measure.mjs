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
import {
  loadCanonicalizerCombinedHeadroomM4127,
} from './combined-headroom-m4-127.mjs';
import { loadCoveragePolicy } from './coverage.mjs';
import {
  migrateLegacyFunctionForPrerequisite,
  sourceFunctionRoots,
} from './coverage-prerequisite.mjs';
import { flattenKirRoots, tableArguments } from './flatten.mjs';
import { loadPreM4131CoverageInputs } from './historical-parameter-sources.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const M4127_RECEIPT_URL =
  new URL('./combined-headroom-m4-127.json', import.meta.url);
const M4127_RECEIPT_SHA256 =
  '604f2b9a59d2cd4b56b2a4263fcbb5129dd7bfb41c0601e7573b4a576515dcce';
const WITNESS_ID =
  'examples/selfhost-validator/validator.kern#20:validate';

function fail(message) {
  throw new TypeError(`M4.128 runtime-bottleneck measurement rejection: ${message}`);
}

function exactWitness() {
  if (
    createHash('sha256').update(readFileSync(M4127_RECEIPT_URL)).digest('hex') !==
      M4127_RECEIPT_SHA256
  ) fail('M4.127 receipt bytes must remain exact');
  const receipt = loadCanonicalizerCombinedHeadroomM4127();
  assert.equal(receipt.witnesses.length, 1);
  assert.equal(receipt.witnesses[0].id, WITNESS_ID);
  assert.equal(receipt.witnesses[0].exactFloor, 54_894);
  assert.equal(receipt.limits.promotionBudget, 49_152);
  assert.equal(receipt.limits.productionBudget, 65_536);
  assert.deepEqual(receipt.limits.candidateKir, {
    maxBytes: 273_051,
    maxDepth: 98,
    maxNodes: 5_313,
  });
  assert.deepEqual(receipt.limits.candidateProfile, {
    maxNodeRows: 202,
    maxPropertyRows: 308,
    maxValueRows: 4_493,
  });

  const policy = loadCanonicalizerPolicy();
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.runtimeLimits.maxDepth, 64);
  const currentCoveragePolicy = loadCoveragePolicy();
  const historical = loadPreM4131CoverageInputs(currentCoveragePolicy);
  const sourceRoot = sourceFunctionRoots(
    historical.policy,
    historical.sourceOverrides,
  ).get(WITNESS_ID);
  if (sourceRoot === undefined) fail(`missing source root ${WITNESS_ID}`);
  const { parameters, root } = migrateLegacyFunctionForPrerequisite(sourceRoot);
  assert.equal(parameters.length, 41);
  const candidateKirLimits = {
    ...policy.kirLimits,
    ...receipt.limits.candidateKir,
  };
  const bytes = encodeStructuralKir(root, candidateKirLimits);
  assert.equal(bytes.length, receipt.witnesses[0].artifactBytes);
  const artifact = decodeStructuralKir(bytes, candidateKirLimits);
  const tables = flattenKirRoots([artifact.root]);
  assert.deepEqual({
    nodes: tables.nodeKind.length,
    properties: tables.propNode.length,
    values: tables.valueTag.length,
  }, receipt.witnesses[0].profileRows);
  return {
    bytes,
    candidateKirLimits,
    candidateProfile: receipt.limits.candidateProfile,
    parameterRows: parameters.length,
    policy,
    receipt,
    tables,
  };
}

function increment(record, key, amount = 1) {
  record[key] = (record[key] ?? 0) + amount;
}

function diagnosticSummary() {
  const summary = {
    cache: { hits: 0, misses: 0 },
    cacheKeyCodeUnits: { maximum: 0, total: 0 },
    helperExecutions: {},
    helperFrameSuspensions: {},
    helperPreparations: {},
    loopIterations: { attemptedByType: {}, retained: 0, rolledBack: 0 },
    parentRestarts: {},
    recentNonLoopEvents: [],
  };
  function remember(value) {
    summary.recentNonLoopEvents.push(value);
    if (summary.recentNonLoopEvents.length > 16) {
      summary.recentNonLoopEvents.shift();
    }
  }
  return {
    observe(event) {
      if (event.kind === 'helper-prepare') {
        remember(`prepare:${event.name}`);
        increment(summary.helperPreparations, event.name);
        if (event.cacheKeyLength !== null) {
          summary.cacheKeyCodeUnits.total += event.cacheKeyLength;
          summary.cacheKeyCodeUnits.maximum = Math.max(
            summary.cacheKeyCodeUnits.maximum,
            event.cacheKeyLength,
          );
        }
      } else if (event.kind === 'helper-cache') {
        remember(`cache:${event.name}:${event.hit ? 'hit' : 'miss'}`);
        summary.cache[event.hit ? 'hits' : 'misses'] += 1;
      } else if (event.kind === 'helper-execute') {
        remember(`execute:${event.name}`);
        increment(summary.helperExecutions, event.name);
      } else if (event.kind === 'helper-parent-restart') {
        remember(`restart:${event.parent}->${event.dependency}`);
        increment(summary.parentRestarts, `${event.parent}->${event.dependency}`);
        summary.loopIterations.rolledBack += event.rolledBackIterations;
      } else if (event.kind === 'helper-frame-suspend') {
        remember(`suspend:${event.parent}->${event.dependency}`);
        increment(summary.helperFrameSuspensions, `${event.parent}->${event.dependency}`);
      } else if (event.kind === 'loop-iteration') {
        increment(summary.loopIterations.attemptedByType, event.nodeType);
      }
    },
    summary,
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

export function measureCanonicalizerRuntimeBottleneckM4128(iterationBudget) {
  if (!Number.isSafeInteger(iterationBudget) || iterationBudget <= 0) {
    fail('iteration budget must be a positive safe integer');
  }
  const composition = loadPreM4129CanonicalizerComposition();
  const input = exactWitness();
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
    input.candidateProfile.maxNodeRows,
    input.candidateProfile.maxPropertyRows,
    input.candidateProfile.maxValueRows,
  ];
  const diagnostics = diagnosticSummary();
  const started = performance.now();
  const observedEnvelope = executeInternalRuntimeHandlerSync(
    linked,
    arguments_,
    makeEnv(),
    { enabled: true, limits, observer: diagnostics.observe },
  );
  const elapsedMilliseconds =
    Math.round((performance.now() - started) * 1_000) / 1_000;
  const unobservedEnvelope = executeInternalRuntimeHandlerSync(
    linked,
    arguments_,
    makeEnv(),
    { enabled: true, limits },
  );
  assert.deepEqual(observedEnvelope, unobservedEnvelope);
  const attempted = Object.values(diagnostics.summary.loopIterations.attemptedByType)
    .reduce((total, count) => total + count, 0);
  diagnostics.summary.loopIterations.retained =
    attempted - diagnostics.summary.loopIterations.rolledBack;
  const roundTrip = observedEnvelope.outcome === 'success';
  if (roundTrip) {
    assertRoundTrip(input.bytes, input.candidateKirLimits, observedEnvelope);
  }
  return {
    elapsedMilliseconds,
    envelope: observedEnvelope,
    iterationBudget,
    observerParityVerified: true,
    roundTrip,
    summary: diagnostics.summary,
    witness: {
      artifactBytes: input.bytes.length,
      id: WITNESS_ID,
      parameterRows: input.parameterRows,
      structuralRows: input.receipt.witnesses[0].profileRows,
    },
  };
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const budget = Number(process.argv[2]);
  if (!Number.isSafeInteger(budget) || budget <= 0 || process.argv.length !== 3) {
    fail('direct invocation requires exactly one positive iteration budget');
  }
  process.stdout.write(
    `${JSON.stringify(measureCanonicalizerRuntimeBottleneckM4128(budget), null, 2)}\n`,
  );
}
