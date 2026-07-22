import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { decodeModuleKir, encodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
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
import { loadCanonicalizerPolicy } from './policy.mjs';

const COMPOSITION = verifyCanonicalizerComposition();
const PROFILE_LIMITS = { maxNodeRows: 16, maxPropertyRows: 30, maxValueRows: 388 };

function parsedRoot(source, ordinal, name) {
  const parsed = parseDocumentWithDiagnostics(source);
  assert.ok(!parsed.partial);
  assert.deepEqual(parsed.diagnostics.filter(({ severity }) => severity === 'error'), []);
  const root = (parsed.root.children ?? [])[ordinal];
  assert.equal(root?.type, 'fn');
  assert.equal(root?.props?.name, name);
  return root;
}

function witnessForRoot(root, name, expectedRows) {
  const policy = loadCanonicalizerPolicy();
  const moduleId = `m4-44-${name}.kern`;
  const bytes = encodeModuleKir([{ id: moduleId, roots: [root] }], policy.kirLimits);
  const decoded = decodeModuleKir(bytes, policy.kirLimits);
  const module = decoded.modules.find(({ id }) => id === moduleId);
  assert.ok(module);
  const tables = flattenKirRoots(module.roots);
  const rows = {
    nodes: tables.nodeKind.length,
    properties: tables.propNode.length,
    values: tables.valueTag.length,
  };
  if (expectedRows) assert.deepEqual(rows, expectedRows);
  assert.ok(rows.nodes <= PROFILE_LIMITS.maxNodeRows);
  assert.ok(rows.properties <= PROFILE_LIMITS.maxPropertyRows);
  assert.ok(rows.values <= PROFILE_LIMITS.maxValueRows);
  return { bytes, moduleId, policy, rows, tables };
}

function migratedWitness(source, ordinal, name, expectedRows) {
  const { root } = migrateLegacyFunctionForPrerequisite(parsedRoot(source, ordinal, name));
  return witnessForRoot(root, name, expectedRows);
}

function repositoryWitness(path, ordinal, name, expectedRows) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  return migratedWitness(source, ordinal, name, expectedRows);
}

function directRepositoryWitness(path, ordinal, name, expectedRows) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  return witnessForRoot(parsedRoot(source, ordinal, name), name, expectedRows);
}

function executeWitness(witness, maxCollectionLength) {
  return executeKernRuntimeHandlerSync(
    {
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: [
        ...tableArguments(witness.tables),
        PROFILE_LIMITS.maxNodeRows,
        PROFILE_LIMITS.maxPropertyRows,
        PROFILE_LIMITS.maxValueRows,
      ],
      identity: { handlerName: 'canonicalize', sourcePath: CANONICALIZER_COMPOSITE_PATH },
      source: COMPOSITION.source,
    },
    {
      enabled: true,
      limits: { ...witness.policy.runtimeLimits, maxCollectionLength },
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
  assert.deepEqual(
    Buffer.from(encodeModuleKir([{ id: witness.moduleId, roots: reparsed.root.children ?? [] }], witness.policy.kirLimits)),
    Buffer.from(witness.bytes),
  );
}

function assertExactFloor(witness, floor) {
  assert.notEqual(executeWitness(witness, floor - 1).outcome, 'success');
  const envelope = executeWitness(witness, floor);
  assert.ok(floor <= 49_152, `exact floor ${floor} exceeds the precommitted promotion budget`);
  assertRoundTrip(witness, envelope);
}

test('M4.43 exact 14/20/161 witness retains byte identity at its indexed floor', () => {
  const witness = repositoryWitness(
    'examples/capstone-checker-subset/checker-while.kern',
    2,
    'checkerSafeIntText',
    { nodes: 14, properties: 20, values: 161 },
  );
  assertExactFloor(witness, 6_533);
});

test('M4.43 exact 12/15/388 selected witness fits the precommitted promotion budget', () => {
  const witness = repositoryWitness(
    'examples/kern-canonicalizer/canonicalizer.kern',
    1,
    'validbinaryop',
    { nodes: 12, properties: 15, values: 388 },
  );
  assert.equal(Math.floor(witness.policy.runtimeLimits.maxCollectionLength * 3 / 4), 49_152);
  assertExactFloor(witness, 10_614);
});

test('M4.44 exact 16/29/197 direct admission fits the same non-composing budget', () => {
  const witness = directRepositoryWitness(
    'examples/capstone-assertion-engine/sort.kern',
    2,
    'sortStrings',
    { nodes: 16, properties: 29, values: 197 },
  );
  assertExactFloor(witness, 9_926);
});

test('M4.43 bottom-up projection handles a deep binary expression', () => {
  const expression = Array.from({ length: 5 }, () => 'x')
    .reduce((left, right) => `(${left} + ${right})`);
  const source = `fn name=deepBinary params="x:number" returns=number export=true\n` +
    `  handler lang="kern"\n` +
    `    return value="${expression}"\n`;
  const witness = migratedWitness(source, 0, 'deepBinary');
  assertRoundTrip(witness, executeWitness(witness, 49_152));
});

test('M4.43 bottom-up projection handles wide call and list children', () => {
  const list = `[${Array.from({ length: 12 }, () => 'x').join(', ')}]`;
  const args = [list, ...Array.from({ length: 10 }, () => 'x')].join(', ');
  const source = `fn name=wideCall params="x:number" returns=number export=true\n` +
    `  handler lang="kern"\n` +
    `    return value="collect(${args})"\n`;
  const witness = migratedWitness(source, 0, 'wideCall');
  assertRoundTrip(witness, executeWitness(witness, 49_152));
});
