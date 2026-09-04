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
import { executeInternalRuntimeHandlerSync } from '../../packages/core/dist/runtime-envelope/handler-entry.js';
import { resolveInternalRuntimeSourceHandler } from '../../packages/core/dist/runtime-envelope/source-handler.js';

import {
  CANONICALIZER_COMPOSITE_PATH,
} from './composition.mjs';
import {
  loadPreM4129CanonicalizerComposition,
} from './historical-composition.mjs';
import { migrateLegacyFunctionForPrerequisite } from './coverage-prerequisite.mjs';
import { flattenKirRoots, tableArguments } from './flatten.mjs';
import { loadPreM4130CanonicalizerPolicy } from './historical-policy.mjs';
import { reconstructLegacyParameterSource } from './historical-parameter-sources.mjs';
import { loadCanonicalizerTripleRowHeadroomM4115 } from './triple-row-headroom-m4-115.mjs';

const WITNESS_ID =
  'examples/capstone-checker-subset/checker.kern#24:checkModule';
const WITNESS_SOURCE_URL =
  new URL('../../examples/capstone-checker-subset/checker.kern', import.meta.url);
const WITNESS_SOURCE_SHA256 =
  'f8c9b50d5be28074479bebed4c93e6e6d7f8f15ea9efab54c2b396dcde924d99';
const M4115_RECEIPT_URL =
  new URL('./triple-row-headroom-m4-115.json', import.meta.url);
const M4115_RECEIPT_SHA256 =
  '0142e5d39fc94ec76e2cf793a62a922fa9087a12fb4cd83b9499cfc58f922b9d';
const PROFILE_ROWS = { nodes: 122, properties: 193, values: 2411 };
const CANDIDATE_PROFILE = {
  maxNodeRows: PROFILE_ROWS.nodes,
  maxPropertyRows: PROFILE_ROWS.properties,
  maxValueRows: PROFILE_ROWS.values,
};

function exactWitness() {
  const m4115 = loadCanonicalizerTripleRowHeadroomM4115();
  assert.equal(
    createHash('sha256').update(readFileSync(M4115_RECEIPT_URL)).digest('hex'),
    M4115_RECEIPT_SHA256,
  );
  assert.equal(m4115.witnesses[0]?.id, WITNESS_ID);
  assert.equal(m4115.witnesses[0]?.exactFloor, 176_119);
  assert.deepEqual(m4115.limits.candidateProfile, CANDIDATE_PROFILE);

  const source = reconstructLegacyParameterSource({
    additionalNames: ['rejectLine'],
    currentSource: readFileSync(WITNESS_SOURCE_URL),
    expectedDigest: WITNESS_SOURCE_SHA256,
    milestone: 'M4.116 checkModule witness',
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
  };
  return {
    observe(event) {
      if (event.kind === 'helper-prepare') {
        increment(summary.helperPreparations, event.name);
        if (event.cacheKeyLength !== null) {
          summary.cacheKeyCodeUnits.total += event.cacheKeyLength;
          summary.cacheKeyCodeUnits.maximum = Math.max(
            summary.cacheKeyCodeUnits.maximum,
            event.cacheKeyLength,
          );
        }
      } else if (event.kind === 'helper-cache') {
        summary.cache[event.hit ? 'hits' : 'misses'] += 1;
      } else if (event.kind === 'helper-execute') {
        increment(summary.helperExecutions, event.name);
      } else if (event.kind === 'helper-parent-restart') {
        increment(summary.parentRestarts, `${event.parent}->${event.dependency}`);
        summary.loopIterations.rolledBack += event.rolledBackIterations;
      } else if (event.kind === 'helper-frame-suspend') {
        increment(summary.helperFrameSuspensions, `${event.parent}->${event.dependency}`);
      } else if (event.kind === 'loop-iteration') {
        increment(summary.loopIterations.attemptedByType, event.nodeType);
      }
    },
    summary,
  };
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

export function measureCanonicalizerRuntimeBottleneckM4116(iterationBudget) {
  if (!Number.isSafeInteger(iterationBudget) || iterationBudget <= 0) {
    throw new TypeError('M4.116 iteration budget must be a positive safe integer');
  }
  const composition = loadPreM4129CanonicalizerComposition();
  const { bytes, policy, tables } = exactWitness();
  const limits = { ...policy.runtimeLimits, maxIterations: iterationBudget };
  const linked = resolveInternalRuntimeSourceHandler(
    composition.source,
    { handlerName: 'canonicalize', sourcePath: CANONICALIZER_COMPOSITE_PATH },
    { enabled: true, limits },
  );
  assert.equal('format' in linked, false, JSON.stringify(linked));
  if ('format' in linked) throw new Error('M4.116 candidate failed to link');
  const arguments_ = [
    ...tableArguments(tables),
    CANDIDATE_PROFILE.maxNodeRows,
    CANDIDATE_PROFILE.maxPropertyRows,
    CANDIDATE_PROFILE.maxValueRows,
  ];
  const diagnostics = diagnosticSummary();
  const started = performance.now();
  const observedEnvelope = executeInternalRuntimeHandlerSync(
    linked,
    arguments_,
    makeEnv(),
    { enabled: true, limits, observer: diagnostics.observe },
  );
  const elapsedMilliseconds = Math.round((performance.now() - started) * 1_000) / 1_000;
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
  if (roundTrip) assertRoundTrip(bytes, policy, observedEnvelope);
  return {
    elapsedMilliseconds,
    envelope: observedEnvelope,
    iterationBudget,
    observerParityVerified: true,
    roundTrip,
    summary: diagnostics.summary,
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
      `${JSON.stringify(measureCanonicalizerRuntimeBottleneckM4116(budget), null, 2)}\n`,
    );
  }
}
