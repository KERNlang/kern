import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { makeEnv } from '../../packages/core/dist/ir/semantics/semantic-env.js';
import { decodeModuleKir, encodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
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
import { flattenKirRoots, tableArguments } from './flatten.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const WITNESS_ID =
  'examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk';

function exactCandidate() {
  const source = readFileSync(
    new URL('../../examples/capstone-checker-subset/checker-while.kern', import.meta.url),
    'utf8',
  );
  const parsed = parseDocumentWithDiagnostics(source);
  assert.notEqual(parsed.partial, true);
  assert.deepEqual(parsed.diagnostics.filter(({ severity }) => severity === 'error'), []);
  const sourceRoot = parsed.root.children?.[15];
  assert.equal(sourceRoot?.props?.name, 'comparisonOperandsOk', WITNESS_ID);
  assert.ok(sourceRoot);
  const root = migrateLegacyFunctionForPrerequisite(sourceRoot).root;
  const policy = loadCanonicalizerPolicy();
  const bytes = encodeModuleKir([{ id: 'm4-96-witness.kern', roots: [root] }], policy.kirLimits);
  const decoded = decodeModuleKir(bytes, policy.kirLimits);
  const tables = flattenKirRoots(decoded.modules[0].roots);
  assert.deepEqual({
    nodes: tables.nodeKind.length,
    properties: tables.propNode.length,
    values: tables.valueTag.length,
  }, { nodes: 53, properties: 95, values: 832 });
  return { policy, tables };
}

function increment(record, key, amount = 1) {
  record[key] = (record[key] ?? 0) + amount;
}

function diagnosticSummary() {
  const summary = {
    cache: { hits: 0, misses: 0 },
    cacheKeyCodeUnits: { maximum: 0, total: 0 },
    helperExecutions: {},
    helperPreparations: {},
    helperFrameSuspensions: {},
    loopIterations: { attempted: {}, retained: 0, rolledBack: 0 },
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
        increment(summary.loopIterations.attempted, event.nodeType);
      }
    },
    summary,
  };
}

export function measureCanonicalizerRuntimeBottleneckM496(
  iterationBudget,
  { verifyPublicParity = false } = {},
) {
  if (!Number.isSafeInteger(iterationBudget) || iterationBudget <= 0) {
    throw new TypeError('M4.96 iteration budget must be a positive safe integer');
  }
  const composition = verifyCanonicalizerComposition();
  const { policy, tables } = exactCandidate();
  const limits = { ...policy.runtimeLimits, maxIterations: iterationBudget };
  const linked = resolveInternalRuntimeSourceHandler(
    composition.source,
    { handlerName: 'canonicalize', sourcePath: CANONICALIZER_COMPOSITE_PATH },
    { enabled: true, limits },
  );
  assert.equal('format' in linked, false, JSON.stringify(linked));
  if ('format' in linked) throw new Error('M4.96 candidate failed to link');
  const diagnostics = diagnosticSummary();
  const arguments_ = [...tableArguments(tables), 74, 95, 832];
  const started = performance.now();
  const envelope = executeInternalRuntimeHandlerSync(
    linked,
    arguments_,
    makeEnv(),
    { enabled: true, limits, observer: diagnostics.observe },
  );
  diagnostics.summary.loopIterations.retained =
    Object.values(diagnostics.summary.loopIterations.attempted)
      .reduce((total, count) => total + count, 0) -
    diagnostics.summary.loopIterations.rolledBack;
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
    elapsedMilliseconds: Math.round((performance.now() - started) * 1_000) / 1_000,
    envelope,
    iterationBudget,
    publicParityVerified,
    summary: diagnostics.summary,
    witness: {
      id: WITNESS_ID,
      structuralRows: { nodes: 53, properties: 95, values: 832 },
    },
  };
}

const budget = Number(process.argv[2]);
if (Number.isSafeInteger(budget) && budget > 0) {
  process.stdout.write(`${JSON.stringify(measureCanonicalizerRuntimeBottleneckM496(budget), null, 2)}\n`);
}
