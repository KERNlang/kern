import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
import { loadCanonicalizerRuntimeCostM489 } from './runtime-cost-m4-89.mjs';

const COMPOSITION = verifyCanonicalizerComposition();
const POLICY = loadCanonicalizerPolicy();
const RECEIPT = loadCanonicalizerRuntimeCostM489();
const M489_ACTIVE_PROFILE = {
  maxNodeRows: 38,
  maxPropertyRows: 61,
  maxValueRows: 580,
};
const M489_CANDIDATE_PROFILE = {
  maxNodeRows: 74,
  maxPropertyRows: 77,
  maxValueRows: 580,
};
const FAILURE = {
  completion: { kind: 'error' },
  diagnostics: [{ category: 'runtime', code: 'unsupported-runtime-input', phase: 'execution' }],
  events: [],
  format: KERN_RUNTIME_HANDLER_ABI,
  outcome: 'failure',
  result: { presence: 'absent' },
};

function structuralWitness(row) {
  const [path, selector] = row.id.split('#');
  const [ordinalText, name] = selector.split(':');
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const parsed = parseDocumentWithDiagnostics(source);
  assert.ok(!parsed.partial);
  assert.deepEqual(parsed.diagnostics.filter(({ severity }) => severity === 'error'), []);
  const sourceRoot = (parsed.root.children ?? [])[Number(ordinalText)];
  assert.equal(sourceRoot?.type, 'fn');
  assert.equal(sourceRoot?.props?.name, name);
  const { parameters, root } = typeof sourceRoot.props.params === 'string'
    ? migrateLegacyFunctionForPrerequisite(sourceRoot)
    : {
        parameters: sourceRoot.children.filter(({ type }) => type === 'param'),
        root: sourceRoot,
      };
  assert.equal(parameters.length, row.parameterRows);
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
  const profile = RECEIPT.limits.candidateProfile;
  return executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [
      ...tableArguments(witness.tables),
      profile.maxNodeRows,
      profile.maxPropertyRows,
      profile.maxValueRows,
    ],
    identity: { handlerName: 'canonicalize', sourcePath: CANONICALIZER_COMPOSITE_PATH },
    source: COMPOSITION.source,
  }, {
    enabled: true,
    limits: { ...POLICY.runtimeLimits, maxCollectionLength },
  });
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

export function verifyCanonicalizerRuntimeCostWitnessM489(index) {
  const row = RECEIPT.witnesses[index];
  assert.ok(row);
  assert.equal(POLICY.runtimeLimits.maxCollectionLength, 65_536);
  assert.deepEqual(RECEIPT.limits.activeProfile, M489_ACTIVE_PROFILE);
  assert.deepEqual(RECEIPT.limits.candidateProfile, M489_CANDIDATE_PROFILE);
  assert.ok(row.exactFloor <= RECEIPT.limits.promotionBudget);
  assert.equal(row.floorReduction, row.baselineExactFloor - row.exactFloor);
  const witness = structuralWitness(row);
  assert.deepEqual(executeWitness(witness, row.exactFloor - 1), FAILURE);
  assertRoundTrip(witness, executeWitness(witness, row.exactFloor));
}
