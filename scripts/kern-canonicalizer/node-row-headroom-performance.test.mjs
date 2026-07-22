import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { decodeStructuralKir, encodeStructuralKir } from '../../packages/core/dist/kir-structural/canonical.js';
import { encodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
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
import {
  M449_PARAMETER_MIGRATION_TARGETS,
} from './coverage-m4-49-parameter-migrations.mjs';
import { assertDirectParameterPrefix } from './coverage-value-band-parameter-migrations.mjs';
import { loadPublishedCanonicalizerNodeRowHeadroomM447 } from './node-row-headroom-m4-47.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const COMPOSITION = verifyCanonicalizerComposition();
const HEADROOM = loadPublishedCanonicalizerNodeRowHeadroomM447().record;
const POLICY = loadCanonicalizerPolicy();

function witnessIdentity(id) {
  const match = /^(.*)#([0-9]+):([^:]+)$/u.exec(id);
  assert.ok(match, `invalid witness id ${id}`);
  return { name: match[3], ordinal: Number(match[2]), path: match[1] };
}

function parsedRoot(path, ordinal, name) {
  const parsed = parseDocumentWithDiagnostics(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
  assert.ok(!parsed.partial);
  assert.deepEqual(parsed.diagnostics.filter(({ severity }) => severity === 'error'), []);
  const root = (parsed.root.children ?? [])[ordinal];
  assert.equal(root?.type, 'fn');
  assert.equal(root?.props?.name, name);
  return root;
}

function structuralWitness(row) {
  const identity = witnessIdentity(row.id);
  const root = parsedRoot(identity.path, identity.ordinal, identity.name);
  const target = M449_PARAMETER_MIGRATION_TARGETS.find(({ id }) => id === row.id);
  assert.ok(target, `missing M4.49 direct-parameter contract for ${row.id}`);
  assert.equal(root.props.params, undefined);
  assert.equal(target.parameters.length, row.parameterRows);
  assertDirectParameterPrefix(root, target.parameters);
  const bytes = encodeStructuralKir(root, POLICY.kirLimits);
  const artifact = decodeStructuralKir(bytes, POLICY.kirLimits);
  const tables = flattenKirRoots([artifact.root]);
  assert.deepEqual(
    {
      nodes: tables.nodeKind.length,
      properties: tables.propNode.length,
      values: tables.valueTag.length,
    },
    row.profileRows,
  );
  return { ...identity, bytes, root, tables };
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

function assertBudgetBoundaryFailure(witness, row, envelope) {
  const largestDirectInput = Math.max(...tableArguments(witness.tables).map((value) =>
    Array.isArray(value) ? value.length : 0));
  assert.ok(row.exactFloor - 1 > largestDirectInput);
  assert.deepEqual(envelope, {
    completion: { kind: 'error' },
    diagnostics: [{ category: 'runtime', code: 'unsupported-runtime-input', phase: 'execution' }],
    events: [],
    format: KERN_RUNTIME_HANDLER_ABI,
    outcome: 'failure',
    result: { presence: 'absent' },
  });
}

for (const row of HEADROOM.witnesses) {
  test(`M4.47 ${row.id} has exact structural runtime floor ${row.exactFloor}`, () => {
    assert.equal(HEADROOM.source.runtimeHandlerAbi, KERN_RUNTIME_HANDLER_ABI);
    assert.equal(POLICY.runtimeLimits.maxCollectionLength, HEADROOM.limits.productionMaxCollectionLength);
    assert.ok(row.exactFloor <= HEADROOM.limits.promotionBudget);
    const witness = structuralWitness(row);
    const belowFloor = executeWitness(witness, row.exactFloor - 1);
    assert.equal(belowFloor.outcome, row.belowFloorOutcome);
    assertBudgetBoundaryFailure(witness, row, belowFloor);
    const envelope = executeWitness(witness, row.exactFloor);
    assert.equal(envelope.outcome, row.floorOutcome);
    assertRoundTrip(witness, envelope);
    assert.equal(
      HEADROOM.limits.promotionBudget - row.exactFloor,
      row.promotionHeadroom,
    );
    assert.equal(
      HEADROOM.limits.productionMaxCollectionLength - row.exactFloor,
      row.productionHeadroom,
    );
    assert.equal(row.roundTrip, true);
  });
}

test('M4.47 keeps module-envelope depth outside the structural headroom claim', () => {
  assert.deepEqual(HEADROOM.moduleEnvelope, {
    disposition: 'not-claimed',
    knownDepthBlocker: 'examples/selfhost-validator/validator.kern#3:isportable',
    maxDepth: 64,
    moduleCodecSha256: HEADROOM.moduleEnvelope.moduleCodecSha256,
  });
  for (const row of HEADROOM.witnesses) {
    const witness = structuralWitness(row);
    const encode = () => encodeModuleKir(
      [{ id: `m4-47-${witness.name}.kern`, roots: [witness.root] }],
      POLICY.kirLimits,
    );
    if (row.id === HEADROOM.moduleEnvelope.knownDepthBlocker) {
      assert.throws(encode, (error) => error?.code === 'limit-depth');
    } else {
      assert.ok(encode().length > 0);
    }
  }
});
