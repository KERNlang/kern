import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { decodeModuleKir, encodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../../packages/core/dist/runtime-handler.js';

import {
  CANONICALIZER_COMPOSITE_PATH,
  verifyCanonicalizerComposition,
} from './composition.mjs';
import { migrateLegacyFunctionForPrerequisite } from './coverage-prerequisite.mjs';
import { flattenKirRoots, tableArguments } from './flatten.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { loadCanonicalizerRuntimeCostM493 } from './runtime-cost-m4-93.mjs';

const COMPOSITION = verifyCanonicalizerComposition();
const POLICY = loadCanonicalizerPolicy();

function exactTables() {
  const parsed = parseDocumentWithDiagnostics(readFileSync(
    new URL('../../examples/capstone-checker-subset/checker-while.kern', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(parsed.diagnostics, []);
  const sourceRoot = parsed.root.children[15];
  assert.equal(sourceRoot?.props?.name, 'comparisonOperandsOk');
  const root = migrateLegacyFunctionForPrerequisite(sourceRoot).root;
  const bytes = encodeModuleKir([{ id: 'm4-93-witness.kern', roots: [root] }], POLICY.kirLimits);
  const decoded = decodeModuleKir(bytes, POLICY.kirLimits);
  const tables = flattenKirRoots(decoded.modules[0].roots);
  assert.deepEqual({
    nodes: tables.nodeKind.length,
    properties: tables.propNode.length,
    values: tables.valueTag.length,
  }, { nodes: 53, properties: 95, values: 832 });
  return tables;
}

function executeTablesOk(tables, maxIterations) {
  return executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: tableArguments(tables),
    identity: { handlerName: 'tablesok', sourcePath: CANONICALIZER_COMPOSITE_PATH },
    source: COMPOSITION.source,
  }, {
    enabled: true,
    limits: { ...POLICY.runtimeLimits, maxIterations },
  });
}

test('M4.93 exact table owner fails below 1075 and succeeds at 1075', () => {
  const receipt = loadCanonicalizerRuntimeCostM493();
  const tables = exactTables();
  const below = executeTablesOk(tables, receipt.result.belowFloor);
  assert.equal(below.outcome, 'failure');
  assert.deepEqual(below.diagnostics, [{
    category: 'runtime',
    code: 'unsupported-runtime-input',
    phase: 'execution',
  }]);
  const floor = executeTablesOk(tables, receipt.result.exactFloor);
  assert.equal(floor.outcome, 'success', JSON.stringify(floor));
  assert.deepEqual(floor.completion, { kind: 'return' });
  assert.deepEqual(floor.diagnostics, []);
  assert.deepEqual(floor.result, {
    presence: 'value',
    value: { tag: 'boolean', value: true },
  });
});
