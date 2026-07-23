import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { decodeStructuralKir, encodeStructuralKir } from '../../packages/core/dist/kir-structural/canonical.js';
import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../../packages/core/dist/runtime-handler.js';

import { flattenKirRoots, tableArguments } from './flatten.mjs';
import {
  CANONICALIZER_COMPOSITE_PATH,
  verifyCanonicalizerComposition,
} from './composition.mjs';
import { migrateLegacyFunctionForPrerequisite } from './coverage-prerequisite.mjs';
import { loadPublishedCanonicalizerDualRowHeadroomM471 } from './dual-row-headroom-m4-71.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const COMPOSITION = verifyCanonicalizerComposition();
const HEADROOM = loadPublishedCanonicalizerDualRowHeadroomM471().record;
const POLICY = loadCanonicalizerPolicy();

function structuralWitness(row) {
  const source = readFileSync(
    new URL('../../examples/kern-canonicalizer/canonicalizer-statement-helpers.kern', import.meta.url),
    'utf8',
  );
  const parsed = parseDocumentWithDiagnostics(source);
  assert.ok(!parsed.partial);
  assert.deepEqual(parsed.diagnostics.filter(({ severity }) => severity === 'error'), []);
  const sourceRoot = (parsed.root.children ?? [])[1];
  assert.equal(sourceRoot?.type, 'fn');
  assert.equal(sourceRoot?.props?.name, 'validstatementlist');
  assert.equal(sourceRoot.children.some(({ type }) => type === 'param'), false);
  const { parameters, root } = migrateLegacyFunctionForPrerequisite(sourceRoot);
  assert.deepEqual(parameters, [
    { name: 'parent', type: 'number' },
    { name: 'returnType', type: 'string' },
    { name: 'nodeKind', type: 'string[]' },
    { name: 'nodeParent', type: 'number[]' },
    { name: 'nodeOrder', type: 'number[]' },
    { name: 'propNode', type: 'number[]' },
    { name: 'propKey', type: 'string[]' },
    { name: 'propValue', type: 'number[]' },
    { name: 'valueTag', type: 'string[]' },
    { name: 'valueParent', type: 'number[]' },
    { name: 'valueRole', type: 'string[]' },
    { name: 'valueOrder', type: 'number[]' },
    { name: 'valueText', type: 'string[]' },
    { name: 'valueBool', type: 'number[]' },
  ]);
  assert.equal(root.props.params, undefined);
  const bytes = encodeStructuralKir(root, POLICY.kirLimits);
  const artifact = decodeStructuralKir(bytes, POLICY.kirLimits);
  const tables = flattenKirRoots([artifact.root]);
  assert.deepEqual({
    nodes: tables.nodeKind.length,
    properties: tables.propNode.length,
    values: tables.valueTag.length,
  }, row.profileRows);
  return { bytes, tables };
}

function executeWitness(witness, maxCollectionLength) {
  const profile = HEADROOM.limits.candidateProfile;
  return executeKernRuntimeHandlerSync(
    {
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: [
        ...tableArguments(witness.tables),
        profile.maxNodeRows,
        profile.maxPropertyRows,
        profile.maxValueRows,
      ],
      identity: { handlerName: 'canonicalize', sourcePath: CANONICALIZER_COMPOSITE_PATH },
      source: COMPOSITION.source,
    },
    {
      enabled: true,
      limits: { ...POLICY.runtimeLimits, maxCollectionLength },
    },
  );
}

function assertRoundTrip(witness, envelope) {
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
  const reparsed = parseDocumentWithDiagnostics(source);
  assert.ok(!reparsed.partial);
  assert.deepEqual(reparsed.diagnostics.filter(({ severity }) => severity === 'error'), []);
  assert.equal(reparsed.root.children?.length, 1);
  assert.deepEqual(
    Buffer.from(encodeStructuralKir(reparsed.root.children[0], POLICY.kirLimits)),
    Buffer.from(witness.bytes),
  );
}

test('M4.71 validstatementlist has exact structural runtime floor 36193', () => {
  const row = HEADROOM.witnesses[0];
  assert.equal(HEADROOM.source.runtimeHandlerAbi, KERN_RUNTIME_HANDLER_ABI);
  assert.equal(POLICY.runtimeLimits.maxCollectionLength, HEADROOM.limits.productionMaxCollectionLength);
  assert.ok(row.exactFloor <= HEADROOM.limits.promotionBudget);
  const witness = structuralWitness(row);
  const largestDirectInput = Math.max(...tableArguments(witness.tables).map((value) =>
    Array.isArray(value) ? value.length : 0));
  assert.ok(row.exactFloor - 1 > largestDirectInput);
  assert.deepEqual(executeWitness(witness, row.exactFloor - 1), {
    completion: { kind: 'error' },
    diagnostics: [{ category: 'runtime', code: 'unsupported-runtime-input', phase: 'execution' }],
    events: [],
    format: KERN_RUNTIME_HANDLER_ABI,
    outcome: 'failure',
    result: { presence: 'absent' },
  });
  assertRoundTrip(witness, executeWitness(witness, row.exactFloor));
  assert.equal(HEADROOM.limits.promotionBudget - row.exactFloor, row.promotionHeadroom);
  assert.equal(
    HEADROOM.limits.productionMaxCollectionLength - row.exactFloor,
    row.productionHeadroom,
  );
  assert.equal(row.roundTrip, true);
});

test('M4.71 keeps module-envelope admission outside the structural claim', () => {
  assert.deepEqual(HEADROOM.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.equal(HEADROOM.witnesses.reduce((total, { parameterRows }) => total + parameterRows, 0), 14);
});
