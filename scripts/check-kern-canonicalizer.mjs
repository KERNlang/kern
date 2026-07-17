#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { decodeModuleKir, encodeModuleKir } from '../packages/core/dist/kir-structural/module-canonical.js';
import { parseDocumentWithDiagnostics } from '../packages/core/dist/parser.js';
import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../packages/core/dist/runtime-handler.js';
import { flattenKirRoots, tableArguments } from './kern-canonicalizer/flatten.mjs';
import { HOSTILE_FIXTURES, VALID_FIXTURES } from './kern-canonicalizer/fixtures.mjs';
import { loadCanonicalizerPolicy } from './kern-canonicalizer/policy.mjs';
import { rehydrateKirRoots } from './kern-canonicalizer/rehydrate.mjs';
import { PROFILE_LIMIT_FIXTURES } from './kern-canonicalizer/profile-limit-fixtures.mjs';

const CANONICALIZER_POLICY = loadCanonicalizerPolicy();
const { kirLimits: KIR_LIMITS, profileLimits: PROFILE_LIMITS, runtimeLimits: RUNTIME_LIMITS } =
  CANONICALIZER_POLICY;
const CANONICALIZER_PATH = fileURLToPath(
  new URL('../examples/kern-canonicalizer/canonicalizer.kern', import.meta.url),
);
const CANONICALIZER_SOURCE = readFileSync(CANONICALIZER_PATH, 'utf8');
const fixtureById = new Map(VALID_FIXTURES.map((fixture) => [fixture.id, fixture]));

function fail(category, detail) {
  throw new Error(`${category}: ${detail}`);
}

function canonicalizerArguments(tables) {
  return [
    ...tableArguments(tables),
    PROFILE_LIMITS.maxNodeRows,
    PROFILE_LIMITS.maxPropertyRows,
    PROFILE_LIMITS.maxValueRows,
  ];
}

function rowCounts(tables) {
  return {
    nodes: tables.nodeKind.length,
    properties: tables.propNode.length,
    values: tables.valueTag.length,
  };
}

function parsedRoots(source, label) {
  const parsed = parseDocumentWithDiagnostics(source);
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (parsed.partial || errors.length > 0) fail('parse rejection', `${label} produced ${errors.length} errors`);
  return parsed.root.type === 'document' ? (parsed.root.children ?? []) : [];
}

function semanticArtifact(source, moduleId, label) {
  const roots = parsedRoots(source, label);
  const bytes = encodeModuleKir([{ id: moduleId, roots }], KIR_LIMITS);
  const decoded = decodeModuleKir(bytes, KIR_LIMITS);
  const module = decoded.modules.find((candidate) => candidate.id === moduleId);
  if (!module) fail('KIR mismatch', `${label} omitted ${moduleId}`);
  return { bytes, roots: module.roots };
}

function executeTables(tables, label) {
  const envelope = executeTableEnvelope(tables);
  if (envelope.outcome !== 'success') {
    const code = envelope.diagnostics[0]?.code ?? 'missing-diagnostic';
    fail('profile rejection', `${label} returned ${code}`);
  }
  if (
    envelope.completion.kind !== 'return' ||
    envelope.events.length !== 0 ||
    envelope.result.presence !== 'value' ||
    envelope.result.value.tag !== 'list'
  ) {
    fail('profile rejection', `${label} returned a malformed success envelope`);
  }
  const lines = envelope.result.value.value.map((value, index) => {
    if (value.tag !== 'text') fail('profile rejection', `${label} line ${index} is not text`);
    return value.value;
  });
  return lines;
}

function executeTableEnvelope(tables) {
  return executeKernRuntimeHandlerSync(
    {
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: canonicalizerArguments(tables),
      identity: { handlerName: 'canonicalize', sourcePath: 'examples/kern-canonicalizer/canonicalizer.kern' },
      source: CANONICALIZER_SOURCE,
    },
    { enabled: true, limits: RUNTIME_LIMITS },
  );
}

function canonicalizeSource(source, moduleId, label) {
  const artifact = semanticArtifact(source, moduleId, label);
  const tables = flattenKirRoots(artifact.roots);
  assert.deepEqual(rehydrateKirRoots(tables), artifact.roots, `adapter rejection: ${label} was not lossless`);
  return { artifact, source: `${executeTables(tables, label).join('\n')}\n`, tables };
}

export function runKernCanonicalizerCheck() {
  for (const fixture of VALID_FIXTURES) {
    const moduleId = `${fixture.id}.kern`;
    const first = canonicalizeSource(fixture.source, moduleId, fixture.id);
    if (fixture.expectedRows) assert.deepEqual(rowCounts(first.tables), fixture.expectedRows, fixture.id);
    if (first.source !== fixture.golden) fail('golden mismatch', fixture.id);

    const formattedArtifact = semanticArtifact(first.source, moduleId, `${fixture.id}:formatted`);
    if (!Buffer.from(formattedArtifact.bytes).equals(Buffer.from(first.artifact.bytes))) {
      fail('KIR mismatch', fixture.id);
    }

    const second = canonicalizeSource(first.source, moduleId, `${fixture.id}:second-pass`);
    if (second.source !== first.source) fail('idempotence mismatch', fixture.id);
  }

  for (const fixture of PROFILE_LIMIT_FIXTURES) {
    const artifact = semanticArtifact(fixture.source, `${fixture.id}.kern`, fixture.id);
    const tables = flattenKirRoots(artifact.roots);
    assert.deepEqual(rowCounts(tables), fixture.expectedRows, fixture.id);
    const envelope = executeTableEnvelope(tables);
    assert.equal(envelope.outcome, 'failure', `${fixture.id} must reject`);
    assert.equal(envelope.diagnostics[0]?.code, 'uncaught-throw', `${fixture.id} must reject explicitly in KERN`);
    assert.deepEqual(envelope.events, [], `${fixture.id} must not emit partial events`);
    assert.deepEqual(envelope.result, { presence: 'absent' }, `${fixture.id} must not return partial source`);
  }

  for (const hostile of HOSTILE_FIXTURES) {
    const fixture = fixtureById.get(hostile.base);
    if (!fixture) fail('adapter rejection', `${hostile.id} names missing base ${hostile.base}`);
    const moduleId = `${fixture.id}.kern`;
    const artifact = semanticArtifact(fixture.source, moduleId, `${hostile.id}:base`);
    const tables = structuredClone(flattenKirRoots(artifact.roots));
    hostile.mutate(tables);

    if (hostile.category === 'adapter rejection') {
      assert.throws(() => rehydrateKirRoots(tables), /adapter rejection:/u, hostile.id);
      continue;
    }

    if (hostile.category === 'direct profile rejection') {
      assert.throws(() => rehydrateKirRoots(tables), /adapter rejection:/u, hostile.id);
    } else {
      const hostileRoots = rehydrateKirRoots(tables);
      assert.notDeepEqual(hostileRoots, artifact.roots, `${hostile.id} mutation must change the graph`);
      assert.deepEqual(rehydrateKirRoots(flattenKirRoots(hostileRoots)), hostileRoots, hostile.id);
    }
    const envelope = executeTableEnvelope(tables);
    assert.equal(envelope.outcome, 'failure', `${hostile.id} must reject`);
    assert.equal(envelope.diagnostics[0]?.code, 'uncaught-throw', `${hostile.id} must reject explicitly in KERN`);
    assert.deepEqual(envelope.events, [], `${hostile.id} must not emit partial events`);
    assert.deepEqual(envelope.result, { presence: 'absent' }, `${hostile.id} must not return partial source`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runKernCanonicalizerCheck();
  process.stdout.write(
    `KERN canonicalizer: ${VALID_FIXTURES.length} golden/idempotence/KIR fixtures, ${PROFILE_LIMIT_FIXTURES.length} profile-limit fixtures, and ${HOSTILE_FIXTURES.length} hostile fixtures passed.\n`,
  );
}
