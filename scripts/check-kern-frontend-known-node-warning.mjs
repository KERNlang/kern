#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../packages/core/dist/runtime-handler.js';
import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithMutableNodeTypeRegistrySnapshot,
} from '../packages/core/dist/mutable-node-type-registry-snapshot.js';
import { KernRuntime } from '../packages/core/dist/runtime-state.js';
import {
  loadMutableNodeTypeRegistrySnapshotSource,
  parseMutableNodeTypeRegistrySnapshotEnvelope,
} from './check-kern-frontend-mutable-node-type-registry-snapshot.mjs';
import { knownNodeWarningTruthTableFixtures } from './kern-frontend-known-node-warning/fixtures.mjs';
import { normalizeKnownNodeWarningOracle } from './kern-frontend-known-node-warning/oracle.mjs';
import { loadFrontendKnownNodeWarningPolicy } from './kern-frontend-known-node-warning/policy.mjs';

const SOURCE_URL = new URL('../examples/kern-frontend/known-node-warning.kern', import.meta.url);
const RECORD_WIDTH = 16;

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

export function validateNativeKnownNodeWarningSource(source) {
  const declarations = [...source.matchAll(/^fn name=observeknownnodewarning(?:[\t ]|$)/gmu)];
  if (declarations.length !== 1) {
    fail('composition rejection', 'M4.163 must contain exactly one successor member');
  }
  const memberStart = declarations[0].index;
  const member = source.slice(memberStart);
  for (const forbidden of [
    'UNKNOWN_NODE_TYPE', 'isKnownNodeType', 'parseWithDiagnostics', 'parseDocument', 'KernRuntime',
    'dynamicNodeTypes', 'multilineBlockTypes', 'templateRegistry', 'crypto', 'digest', 'hmac', 'capability',
  ]) {
    if (member.includes(forbidden)) fail('delegation rejection', `KERN source contains ${forbidden}`);
  }
  if ((member.match(/observemutablenodetyperegistrysnapshot\(/gu) ?? []).length !== 1) {
    fail('composition rejection', 'M4.163 must invoke M4.162 exactly once');
  }
  if ((member.match(/String\(1 \+ utf16units\(admittedType\)\)/gu) ?? []).length !== 1) {
    fail('composition rejection', 'M4.163 must own the exact UTF-16 warning end coordinate');
  }
  const handlers = [...member.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length !== 1 || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'the M4.163 handler must be native KERN');
  }
  return source;
}

export function loadKnownNodeWarningSource() {
  return validateNativeKnownNodeWarningSource([
    loadMutableNodeTypeRegistrySnapshotSource(), readRegularSource(SOURCE_URL),
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

function optionalBool(field, label) {
  return field === 'none' ? null : bool(field, label);
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

function collectInheritedFields(fields, cursor, fieldCount, policy) {
  if (fieldCount <= 0 || fieldCount > policy.maxMutableRegistryEnvelopeFields) {
    fail('record rejection', 'inherited field count exceeds policy');
  }
  const inheritedFields = [];
  let authIndex = 0;
  while (inheritedFields.length < fieldCount) {
    const record = fields.slice(cursor, cursor + RECORD_WIDTH);
    const count = uint(record[3], 'snapshot-auth field count');
    if (
      record[0] !== 'snapshot-auth' || uint(record[1], 'snapshot-auth index') !== authIndex ||
      uint(record[2], 'snapshot-auth start') !== inheritedFields.length || count <= 0 || count > 12 ||
      count > fieldCount - inheritedFields.length || record.slice(4 + count).some(Boolean)
    ) fail('record rejection', 'invalid snapshot authentication');
    inheritedFields.push(...record.slice(4, 4 + count));
    cursor += RECORD_WIDTH;
    authIndex += 1;
  }
  return { cursor, inheritedFields };
}

function expectedCatalogIndex(inherited) {
  return inherited.inherited.catalogIndex === null ? 'none' : String(inherited.inherited.catalogIndex);
}

export function parseKnownNodeWarningEnvelope(content, snapshot, value, policy) {
  const fields = textFields(value);
  if (
    fields[0] !== policy.knownNodeWarningFormat || fields.length < 1 + RECORD_WIDTH ||
    (fields.length - 1) % RECORD_WIDTH !== 0 ||
    fields.length > policy.maxKnownNodeWarningEnvelopeFields
  ) fail('record rejection', 'invalid known-node warning envelope');
  const first = fields.slice(1, 1 + RECORD_WIDTH);
  if (first[0] !== 'failure' && first[0] !== 'decision') {
    fail('record rejection', 'invalid known-node warning record tag');
  }
  const inheritedFieldCount = uint(first[3 + (first[0] === 'failure' ? 0 : 10)], 'inherited field count');
  let { cursor, inheritedFields } = collectInheritedFields(
    fields, 1 + RECORD_WIDTH, inheritedFieldCount, policy,
  );
  const inherited = parseMutableNodeTypeRegistrySnapshotEnvelope(
    content, snapshot, textList(inheritedFields), policy,
  );
  const expected = normalizeKnownNodeWarningOracle(content, snapshot, policy);

  if (first[0] === 'failure') {
    if (
      first.length !== RECORD_WIDTH || first.slice(4).some(Boolean) ||
      inherited.status !== 'failure' || expected.status !== 'failure' ||
      first[1] !== inherited.code || first[2] !== inherited.detail ||
      inheritedFieldCount !== inheritedFields.length
    ) fail('record rejection', 'invalid known-node warning failure');
    const seal = fields.slice(cursor, cursor + RECORD_WIDTH);
    if (
      cursor !== fields.length - RECORD_WIDTH || seal[0] !== 'failure-seal' || seal[1] !== first[1] ||
      seal[2] !== first[2] || seal[3] !== content ||
      seal[4] !== policy.mutableNodeTypeRegistrySnapshotFormat ||
      uint(seal[5], 'failure seal field count') !== inheritedFieldCount ||
      uint(seal[6], 'failure seal runtime') !== snapshot.runtimeInstance ||
      uint(seal[7], 'failure seal epoch') !== snapshot.parseEpoch || seal.slice(8).some(Boolean)
    ) fail('record rejection', 'invalid known-node warning failure seal');
    return { code: first[1], detail: first[2], status: 'failure' };
  }

  if (first[0] !== 'decision' || inherited.status === 'failure' || expected.status === 'failure') {
    fail('record rejection', 'invalid known-node warning decision');
  }
  const actual = {
    admittedType: first[3],
    builtin: optionalBool(first[4], 'builtin'),
    evolved: optionalBool(first[5], 'evolved'),
    multiline: optionalBool(first[6], 'multiline'),
    parseEpoch: uint(first[11], 'parse epoch'),
    runtimeInstance: uint(first[10], 'runtime instance'),
    state: first[1],
    template: optionalBool(first[7], 'template'),
    warning: optionalBool(first[8], 'warning'),
  };
  const warningCount = uint(first[9], 'warning count');
  if (
    !['dropped', 'known', 'unknown'].includes(actual.state) ||
    !['admitted', 'dropped'].includes(first[2]) || first[12] !== policy.mutableNodeTypeRegistrySnapshotFormat ||
    first[2] !== inherited.status ||
    first[15] !== '' || actual.runtimeInstance !== snapshot.runtimeInstance ||
    actual.parseEpoch !== snapshot.parseEpoch || first[14] !== expectedCatalogIndex(inherited)
  ) fail('record rejection', 'known-node warning decision identity drift');

  let diagnostic = null;
  if (actual.state === 'unknown') {
    const record = fields.slice(cursor, cursor + RECORD_WIDTH);
    if (
      record[0] !== 'diagnostic' || record[1] !== policy.knownNodeWarningDiagnosticCode ||
      record[2] !== policy.knownNodeWarningDiagnosticSeverity || record[6] !== actual.admittedType ||
      record.slice(7).some(Boolean)
    ) fail('record rejection', 'invalid known-node warning diagnostic');
    diagnostic = {
      code: record[1],
      col: uint(record[4], 'diagnostic col'),
      endCol: uint(record[5], 'diagnostic end col'),
      line: uint(record[3], 'diagnostic line'),
      severity: record[2],
    };
    cursor += RECORD_WIDTH;
  }
  const expectedWarningCount = actual.state === 'unknown' ? 1 : 0;
  if (warningCount !== expectedWarningCount) {
    fail('record rejection', 'known-node warning count contradicts decision state');
  }
  const seal = fields.slice(cursor, cursor + RECORD_WIDTH);
  if (
    cursor !== fields.length - RECORD_WIDTH || seal[0] !== 'seal' || seal[1] !== actual.state ||
    seal[2] !== first[8] || seal[3] !== actual.admittedType || seal[4] !== first[4] ||
    seal[5] !== first[5] || seal[6] !== first[6] || seal[7] !== first[7] ||
    uint(seal[8], 'seal runtime') !== actual.runtimeInstance ||
    uint(seal[9], 'seal epoch') !== actual.parseEpoch || seal[10] !== content ||
    seal[11] !== policy.mutableNodeTypeRegistrySnapshotFormat ||
    uint(seal[12], 'seal inherited field count') !== inheritedFieldCount ||
    uint(seal[13], 'seal warning count') !== warningCount || seal[14] !== first[2] ||
    seal[15] !== first[14]
  ) fail('record rejection', 'known-node warning seal drift');
  const normalized = {
    ...actual,
    diagnostic,
    format: policy.knownNodeWarningFormat,
    inherited,
    sourceProfile: policy.knownNodeWarningSourceProfile,
  };
  assert.deepEqual(normalized, expected);
  return normalized;
}

export function executeKnownNodeWarningFields(content, snapshot, policy, kernSource) {
  const limits = policy.profileLimits;
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [
      content, limits.maxCodePoints, limits.maxTokens, limits.maxDiagnostics, policy.maxStreamRecords,
      policy.maxLexicalDepth, policy.maxCatalogEntries, snapshot.runtimeInstance, snapshot.parseEpoch,
      snapshot.evolvedTypes, snapshot.multilineTypes, snapshot.templateTypes, policy.maxRegistryEntries,
      policy.maxNameCodePoints, policy.maxNameBytes, policy.maxMutableRegistryEnvelopeFields,
      policy.mutableNodeTypeRegistrySnapshotFormat, policy.knownNodeWarningDiagnosticCode,
      policy.knownNodeWarningDiagnosticSeverity,
    ],
    identity: {
      handlerName: 'observeknownnodewarning',
      sourcePath: 'examples/kern-frontend/known-node-warning.kern',
    },
    source: kernSource,
  }, { enabled: true, limits: policy.runtimeLimits });
  if (
    envelope.outcome !== 'success' || envelope.completion.kind !== 'return' || envelope.events.length !== 0 ||
    envelope.result.presence !== 'value'
  ) fail('runtime rejection', JSON.stringify(envelope.diagnostics));
  return envelope.result.value;
}

function assertBootstrapWarningParity(result, parseResult, policy) {
  if (result.status === 'failure') return [];
  const diagnostics = parseResult.diagnostics.filter(
    (diagnostic) => diagnostic.code === policy.knownNodeWarningDiagnosticCode,
  );
  const expectedCount = result.state === 'unknown' ? 1 : 0;
  if (diagnostics.length !== expectedCount) {
    fail('bootstrap parity', `expected ${expectedCount} warning diagnostics, received ${diagnostics.length}`);
  }
  if (expectedCount === 1) {
    const diagnostic = diagnostics[0];
    assert.deepEqual(
      {
        code: diagnostic.code,
        col: diagnostic.col,
        endCol: diagnostic.endCol,
        line: diagnostic.line,
        severity: diagnostic.severity,
      },
      result.diagnostic,
    );
  }
  return diagnostics;
}

export function executeKnownNodeWarning(evidence, policy, kernSource) {
  const consumed = consumeMutableNodeTypeRegistryParseEvidence(evidence);
  const result = parseKnownNodeWarningEnvelope(
    consumed.source,
    consumed.snapshot,
    executeKnownNodeWarningFields(consumed.source, consumed.snapshot, policy, kernSource),
    policy,
  );
  const warningDiagnostics = assertBootstrapWarningParity(result, consumed.parseResult, policy);
  return { result, warningDiagnostics };
}

export function runtimeForKnownNodeWarningFixture(fixture) {
  const runtime = new KernRuntime();
  if (fixture.evolved) runtime.dynamicNodeTypes.add(fixture.type);
  if (fixture.multiline) runtime.multilineBlockTypes.add(fixture.type);
  if (fixture.template) {
    runtime.templateRegistry.set(fixture.type, { name: fixture.type, slots: [], imports: [], body: '' });
  }
  return runtime;
}

export function evaluateKnownNodeWarningFixture(fixture, policy, kernSource) {
  const runtime = runtimeForKnownNodeWarningFixture(fixture);
  const evidence = parseWithMutableNodeTypeRegistrySnapshot(fixture.source, runtime, {
    maxNameBytes: policy.maxNameBytes,
    maxNameCodePoints: policy.maxNameCodePoints,
    maxRegistryEntries: policy.maxRegistryEntries,
  });
  return executeKnownNodeWarning(evidence, policy, kernSource);
}

export function runKernFrontendKnownNodeWarningCheck() {
  const policy = loadFrontendKnownNodeWarningPolicy();
  const source = loadKnownNodeWarningSource();
  const fixtures = knownNodeWarningTruthTableFixtures(policy);
  for (const fixture of fixtures) evaluateKnownNodeWarningFixture(fixture, policy, source);
  return { differential: fixtures.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  const counts = runKernFrontendKnownNodeWarningCheck();
  console.log(`KERN frontend known-node warning: ${counts.differential} fixtures passed.`);
}
