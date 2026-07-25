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
import { loadCanonicalizerDualRowHeadroomM488 } from './dual-row-headroom-m4-88.mjs';
import { flattenKirRoots, tableArguments } from './flatten.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const COMPOSITION = verifyCanonicalizerComposition();
const HEADROOM = loadCanonicalizerDualRowHeadroomM488();
const POLICY = loadCanonicalizerPolicy();
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
  const { parameters, root } = migrateLegacyFunctionForPrerequisite(sourceRoot);
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
    { enabled: true, limits: { ...POLICY.runtimeLimits, maxCollectionLength } },
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

export function verifyCanonicalizerDualRowWitnessM488(index) {
  const row = HEADROOM.witnesses[index];
  assert.ok(row);
  assert.equal(HEADROOM.source.runtimeHandlerAbi, KERN_RUNTIME_HANDLER_ABI);
  assert.equal(POLICY.runtimeLimits.maxCollectionLength, 65_536);
  assert.deepEqual(POLICY.profileLimits, HEADROOM.limits.activeProfile);
  const witness = structuralWitness(row);
  const directInputs = tableArguments(witness.tables);
  assert.ok(directInputs.length > 0);
  const largestDirectInput = Math.max(...directInputs.map((value) =>
    Array.isArray(value) ? value.length : 0));
  assert.ok(row.exactFloor - 1 > largestDirectInput);
  assert.deepEqual(executeWitness(witness, row.exactFloor - 1), FAILURE);
  assertRoundTrip(witness, executeWitness(witness, row.exactFloor));
  assert.equal(65_536 - row.exactFloor, row.productionDelta);
  assert.equal(49_152 - row.exactFloor, row.promotionDelta);
  if (row.productionOutcome === 'failure') {
    assert.deepEqual(executeWitness(witness, POLICY.runtimeLimits.maxCollectionLength), FAILURE);
  } else {
    assert.ok(row.exactFloor <= POLICY.runtimeLimits.maxCollectionLength);
  }
}

export function verifyCanonicalizerDualRowPolicyM488() {
  assert.deepEqual(HEADROOM.measurement, {
    disposition: 'diagnostic-only',
    runtimePolicyChanged: false,
  });
  assert.ok(HEADROOM.limits.diagnosticMaxCollectionLength > POLICY.runtimeLimits.maxCollectionLength);
  assert.deepEqual(HEADROOM.moduleEnvelope, { disposition: 'not-claimed', maxDepth: 64 });
  assert.equal(HEADROOM.witnesses.reduce((total, { parameterRows }) => total + parameterRows, 0), 40);
}
