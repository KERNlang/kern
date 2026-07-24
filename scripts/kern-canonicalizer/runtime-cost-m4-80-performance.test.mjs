import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { decodeStructuralKir, encodeStructuralKir } from '../../packages/core/dist/kir-structural/canonical.js';
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
import { loadCanonicalizerRuntimeCostM480 } from './runtime-cost-m4-80.mjs';

const COMPOSITION = verifyCanonicalizerComposition();
const POLICY = loadCanonicalizerPolicy();
const RECEIPT = loadCanonicalizerRuntimeCostM480();
const CANDIDATE_PROFILE = { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 461 };
const PROMOTION_BUDGET = 49_152;

function structuralWitness() {
  const source = readFileSync(
    new URL('../../examples/capstone-checker-subset/checker-while.kern', import.meta.url),
    'utf8',
  );
  const parsed = parseDocumentWithDiagnostics(source);
  assert.ok(!parsed.partial);
  assert.deepEqual(parsed.diagnostics.filter(({ severity }) => severity === 'error'), []);
  const sourceRoot = (parsed.root.children ?? [])[16];
  assert.equal(sourceRoot?.type, 'fn');
  assert.equal(sourceRoot?.props?.name, 'checkWhileCore');
  const { parameters, root } = migrateLegacyFunctionForPrerequisite(sourceRoot);
  assert.equal(parameters.length, 22);
  const bytes = encodeStructuralKir(root, POLICY.kirLimits);
  const artifact = decodeStructuralKir(bytes, POLICY.kirLimits);
  const tables = flattenKirRoots([artifact.root]);
  assert.deepEqual({
    nodes: tables.nodeKind.length,
    properties: tables.propNode.length,
    values: tables.valueTag.length,
  }, { nodes: 38, properties: 61, values: 460 });
  return { bytes, tables };
}

function executeWitness(witness, maxCollectionLength) {
  return executeKernRuntimeHandlerSync(
    {
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: [
        ...tableArguments(witness.tables),
        CANDIDATE_PROFILE.maxNodeRows,
        CANDIDATE_PROFILE.maxPropertyRows,
        CANDIDATE_PROFILE.maxValueRows,
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

test('M4.80 checkWhileCore has exact optimized structural floor 35998', () => {
  assert.equal(POLICY.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(PROMOTION_BUDGET, Math.floor(POLICY.runtimeLimits.maxCollectionLength * 3 / 4));
  assert.deepEqual(POLICY.profileLimits, {
    maxNodeRows: 38,
    maxPropertyRows: 53,
    maxValueRows: 461,
  });
  const witness = structuralWitness();
  assert.deepEqual(executeWitness(witness, RECEIPT.result.exactFloor - 1), {
    completion: { kind: 'error' },
    diagnostics: [{ category: 'runtime', code: 'unsupported-runtime-input', phase: 'execution' }],
    events: [],
    format: KERN_RUNTIME_HANDLER_ABI,
    outcome: 'failure',
    result: { presence: 'absent' },
  });
  assertRoundTrip(witness, executeWitness(witness, RECEIPT.result.exactFloor));
  assert.equal(RECEIPT.result.floorReduction, 56_238 - RECEIPT.result.exactFloor);
  assert.equal(RECEIPT.result.floorReduction, 20_240);
  assert.equal(RECEIPT.result.promotionHeadroom, PROMOTION_BUDGET - RECEIPT.result.exactFloor);
  assert.ok(RECEIPT.result.floorReduction >= 7_086);
  assert.ok(RECEIPT.result.exactFloor <= PROMOTION_BUDGET);
});

test('M4.80 leaves profile promotion and module-envelope admission to later slices', () => {
  assert.deepEqual(RECEIPT.limits.activeProfile, POLICY.profileLimits);
  assert.deepEqual(RECEIPT.limits.candidateProfile, CANDIDATE_PROFILE);
  assert.equal(RECEIPT.promotion.disposition, 'headroom-authenticated');
  assert.equal(RECEIPT.promotion.nextMilestone, 'M4.81');
  assert.equal(RECEIPT.limits.maxDepth, 64);
});
