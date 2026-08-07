#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../packages/core/dist/runtime-handler.js';
import { KernRuntime } from '../packages/core/dist/runtime-state.js';
import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithMutableNodeTypeRegistrySnapshot,
} from '../packages/core/dist/mutable-node-type-registry-snapshot.js';
import {
  loadBuiltinNodeTypeAttestationSource,
  parseBuiltinNodeTypeAttestationEnvelope,
} from './check-kern-frontend-builtin-node-type-attestation.mjs';
import { MUTABLE_REGISTRY_SNAPSHOT_FIXTURES } from './kern-frontend-mutable-node-type-registry-snapshot/fixtures.mjs';
import { normalizeMutableNodeTypeRegistrySnapshotOracle } from './kern-frontend-mutable-node-type-registry-snapshot/oracle.mjs';
import { loadFrontendMutableNodeTypeRegistrySnapshotPolicy } from './kern-frontend-mutable-node-type-registry-snapshot/policy.mjs';

const SOURCE_URL = new URL('../examples/kern-frontend/mutable-node-type-registry-snapshot.kern', import.meta.url);
const RECORD_WIDTH = 16;
const FAILURE_CODES = new Set([
  'ADMISSION_INVALID', 'ATTESTATION_INVALID', 'CODE_POINTS_LIMIT', 'DIAGNOSTIC_LIMIT', 'EMPTY_RETAINED_CODE',
  'INVALID_LIMITS', 'LEXICAL_DEPTH_LIMIT', 'RECORD_LIMIT', 'REGISTRY_INVALID', 'STREAM_INVALID', 'TOKEN_LIMIT',
  'TRIM_INVALID', 'UNSUPPORTED_UNKNOWN',
]);

function fail(category, detail) {
  throw new Error(`${category}: ${detail}`);
}

function readRegularSource(url) {
  const path = fileURLToPath(url);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('source containment', `${path} must be a regular file`);
  const source = readFileSync(path, 'utf8');
  if (source.includes('\r')) fail('source containment', `${path} must use LF line endings`);
  return source;
}

export function validateNativeMutableNodeTypeRegistrySnapshotSource(source) {
  const memberStart = source.lastIndexOf('fn name=mutableregistryfailure');
  if (memberStart < 0) fail('composition rejection', 'M4.162 member is missing');
  const member = source.slice(memberStart);
  for (const forbidden of [
    'UNKNOWN_NODE_TYPE', 'isKnownNodeType', 'parseWithMutableNodeTypeRegistrySnapshot', 'KernRuntime',
    'dynamicNodeTypes', 'multilineBlockTypes', 'templateRegistry', 'capability',
  ]) {
    if (member.includes(forbidden)) fail('delegation rejection', `KERN source contains ${forbidden}`);
  }
  if ((member.match(/observebuiltinnodetypeattestation\(/gu) ?? []).length !== 1) {
    fail('composition rejection', 'M4.162 must invoke M4.161 exactly once');
  }
  const handlers = [...member.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length === 0 || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'every M4.162 handler must be native KERN');
  }
  return source;
}

export function loadMutableNodeTypeRegistrySnapshotSource() {
  return validateNativeMutableNodeTypeRegistrySnapshotSource([
    loadBuiltinNodeTypeAttestationSource(), readRegularSource(SOURCE_URL),
  ].join('\n\n'));
}

function uint(field, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(field)) fail('record rejection', `${label} must be canonical uint`);
  const value = Number(field);
  if (!Number.isSafeInteger(value)) fail('record rejection', `${label} exceeds safe integer`);
  return value;
}

function bool(field, label) {
  if (field !== 'true' && field !== 'false') fail('record rejection', `${label} must be canonical boolean`);
  return field === 'true';
}

function textFields(value) {
  if (value.tag !== 'list') fail('runtime rejection', 'handler result must be a list');
  return value.value.map((entry, index) => {
    if (entry.tag !== 'text') fail('runtime rejection', `result field ${index} must be text`);
    return entry.value;
  });
}

function textList(fields) {
  return { tag: 'list', value: fields.map((value) => ({ tag: 'text', value })) };
}

function failure(code) {
  return { code, detail: '', status: 'failure' };
}

export function parseMutableNodeTypeRegistrySnapshotEnvelope(content, snapshot, value, policy) {
  const fields = textFields(value);
  if (fields[0] !== policy.mutableNodeTypeRegistrySnapshotFormat || (fields.length - 1) % RECORD_WIDTH !== 0) {
    fail('record rejection', 'invalid mutable registry envelope');
  }
  const expected = normalizeMutableNodeTypeRegistrySnapshotOracle(content, snapshot, policy);
  if (fields[1] === 'failure') {
    if (
      fields.length !== 17 || !FAILURE_CODES.has(fields[2]) || fields.slice(3).some(Boolean) ||
      expected.status !== 'failure' || expected.code !== fields[2]
    ) fail('record rejection', 'invalid failure envelope');
    return failure(fields[2]);
  }
  if (expected.status === 'failure') fail('record rejection', 'success contradicts oracle failure');
  const decision = fields.slice(1, 17);
  if (
    decision[0] !== 'decision' || !['admitted', 'dropped'].includes(decision[1]) ||
    !['builtin', 'none', 'unresolved'].includes(decision[3]) ||
    !['none', 'registered', 'unresolved'].includes(decision[5]) || decision[15] !== ''
  ) fail('record rejection', 'invalid decision record');
  const actual = {
    admittedType: decision[2],
    evolved: bool(decision[6], 'evolved'),
    inheritedAttestation: decision[3],
    inheritedIndex: decision[4],
    multiline: bool(decision[7], 'multiline'),
    mutableAttestation: decision[5],
    parseEpoch: uint(decision[10], 'parse epoch'),
    runtimeInstance: uint(decision[9], 'runtime instance'),
    status: decision[1],
    template: bool(decision[8], 'template'),
  };
  const counts = {
    evolved: uint(decision[11], 'evolved count'),
    multiline: uint(decision[12], 'multiline count'),
    template: uint(decision[13], 'template count'),
  };
  const inheritedCount = uint(decision[14], 'inherited count');
  let cursor = 17;
  const inheritedFields = [];
  let authIndex = 0;
  while (inheritedFields.length < inheritedCount) {
    const record = fields.slice(cursor, cursor + RECORD_WIDTH);
    const count = uint(record[3], 'attestation auth count');
    if (
      record[0] !== 'attestation-auth' || uint(record[1], 'attestation auth index') !== authIndex ||
      uint(record[2], 'attestation auth start') !== inheritedFields.length || count <= 0 || count > 12 ||
      count > inheritedCount - inheritedFields.length || record.slice(4 + count).some(Boolean)
    ) fail('record rejection', 'invalid inherited authentication');
    inheritedFields.push(...record.slice(4, 4 + count));
    cursor += RECORD_WIDTH;
    authIndex += 1;
  }
  const inherited = parseBuiltinNodeTypeAttestationEnvelope(content, textList(inheritedFields), policy);
  if (inherited.status === 'failure') fail('record rejection', 'success contains failure');
  if (
    actual.inheritedAttestation !== inherited.attestation ||
    actual.inheritedIndex !== (inherited.catalogIndex === null ? 'none' : String(inherited.catalogIndex))
  ) fail('record rejection', 'inherited decision identity drift');
  for (const category of ['evolved', 'multiline', 'template']) {
    const names = snapshot[`${category}Types`];
    if (counts[category] !== names.length) fail('record rejection', `${category} count drift`);
    for (let index = 0; index < names.length; index += 1) {
      const record = fields.slice(cursor, cursor + RECORD_WIDTH);
      if (
        record[0] !== 'registry' || record[1] !== category || uint(record[2], `${category} index`) !== index ||
        record[3] !== names[index] || record.slice(4).some(Boolean)
      ) fail('record rejection', `${category} registry authentication drift`);
      cursor += RECORD_WIDTH;
    }
  }
  const seal = fields.slice(cursor, cursor + RECORD_WIDTH);
  if (
    cursor !== fields.length - RECORD_WIDTH || seal[0] !== 'seal' || seal[1] !== actual.status ||
    seal[2] !== actual.mutableAttestation || bool(seal[3], 'seal evolved') !== actual.evolved ||
    bool(seal[4], 'seal multiline') !== actual.multiline || bool(seal[5], 'seal template') !== actual.template ||
    uint(seal[6], 'seal runtime') !== actual.runtimeInstance || uint(seal[7], 'seal epoch') !== actual.parseEpoch ||
    uint(seal[8], 'seal evolved count') !== counts.evolved || uint(seal[9], 'seal multiline count') !== counts.multiline ||
    uint(seal[10], 'seal template count') !== counts.template || seal[11] !== actual.admittedType ||
    seal[12] !== content || seal[13] !== policy.builtinNodeTypeAttestationFormat ||
    uint(seal[14], 'seal inherited count') !== inheritedCount || seal[15] !== ''
  ) fail('record rejection', 'seal drift');
  const normalized = {
    admittedType: actual.admittedType,
    evolved: actual.evolved,
    format: policy.mutableNodeTypeRegistrySnapshotFormat,
    inherited,
    multiline: actual.multiline,
    mutableAttestation: actual.mutableAttestation,
    parseEpoch: actual.parseEpoch,
    runtimeInstance: actual.runtimeInstance,
    snapshotFormat: snapshot.format,
    sourceProfile: policy.mutableNodeTypeRegistrySnapshotSourceProfile,
    status: actual.status,
    template: actual.template,
  };
  assert.deepEqual(normalized, expected);
  return normalized;
}

export function executeMutableNodeTypeRegistrySnapshotFields(content, snapshot, policy, kernSource) {
  const limits = policy.profileLimits;
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [
      content, limits.maxCodePoints, limits.maxTokens, limits.maxDiagnostics, policy.maxStreamRecords,
      policy.maxLexicalDepth, policy.maxCatalogEntries, snapshot.runtimeInstance, snapshot.parseEpoch,
      snapshot.evolvedTypes, snapshot.multilineTypes, snapshot.templateTypes, policy.maxRegistryEntries,
      policy.maxNameCodePoints, policy.maxNameBytes,
    ],
    identity: {
      handlerName: 'observemutablenodetyperegistrysnapshot',
      sourcePath: 'examples/kern-frontend/mutable-node-type-registry-snapshot.kern',
    },
    source: kernSource,
  }, { enabled: true, limits: policy.runtimeLimits });
  if (
    envelope.outcome !== 'success' || envelope.completion.kind !== 'return' || envelope.events.length !== 0 ||
    envelope.result.presence !== 'value'
  ) fail('runtime rejection', JSON.stringify(envelope.diagnostics));
  return envelope.result.value;
}

export function executeMutableNodeTypeRegistrySnapshot(evidence, policy, kernSource) {
  const { source: content, snapshot } = consumeMutableNodeTypeRegistryParseEvidence(evidence);
  return parseMutableNodeTypeRegistrySnapshotEnvelope(
    content,
    snapshot,
    executeMutableNodeTypeRegistrySnapshotFields(content, snapshot, policy, kernSource),
    policy,
  );
}

export function runtimeForFixture(fixture) {
  const runtime = new KernRuntime();
  for (const name of fixture.evolved ?? []) runtime.dynamicNodeTypes.add(name);
  for (const name of fixture.multiline ?? []) runtime.multilineBlockTypes.add(name);
  for (const name of fixture.templates ?? []) {
    runtime.templateRegistry.set(name, { name, slots: [], imports: [], body: '' });
  }
  return runtime;
}

export function evaluateMutableNodeTypeRegistryFixture(fixture, policy, kernSource) {
  const runtime = runtimeForFixture(fixture);
  const bound = parseWithMutableNodeTypeRegistrySnapshot(fixture.source, runtime, {
    maxNameBytes: policy.maxNameBytes,
    maxNameCodePoints: policy.maxNameCodePoints,
    maxRegistryEntries: policy.maxRegistryEntries,
  });
  const result = executeMutableNodeTypeRegistrySnapshot(bound, policy, kernSource);
  const warned = bound.parseResult.diagnostics.some((diagnostic) => diagnostic.code === 'UNKNOWN_NODE_TYPE');
  const expectedWarning = result.status === 'admitted' && result.inherited.attestation === 'unresolved' &&
    result.mutableAttestation === 'unresolved';
  assert.equal(warned, expectedWarning, `${fixture.id}: bootstrap warning parity`);
  return { bound, result };
}

export function runKernFrontendMutableNodeTypeRegistrySnapshotCheck() {
  const policy = loadFrontendMutableNodeTypeRegistrySnapshotPolicy();
  const source = loadMutableNodeTypeRegistrySnapshotSource();
  for (const fixture of MUTABLE_REGISTRY_SNAPSHOT_FIXTURES) {
    evaluateMutableNodeTypeRegistryFixture(fixture, policy, source);
  }
  return { differential: MUTABLE_REGISTRY_SNAPSHOT_FIXTURES.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  const counts = runKernFrontendMutableNodeTypeRegistrySnapshotCheck();
  console.log(`KERN frontend mutable node-type registry snapshot: ${counts.differential} fixtures passed.`);
}
