#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../packages/core/dist/runtime-handler.js';
import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithGenericPropertyAdmissionSafety,
} from '../packages/core/dist/mutable-node-type-registry-snapshot.js';
import { KernRuntime } from '../packages/core/dist/runtime-state.js';
import {
  loadKnownNodeWarningSource,
  parseKnownNodeWarningEnvelope,
} from './check-kern-frontend-known-node-warning.mjs';
import { GENERIC_PROPERTY_ADMISSION_FIXTURES } from './kern-frontend-generic-property-admission/fixtures.mjs';
import { normalizeGenericPropertyAdmissionOracle } from './kern-frontend-generic-property-admission/oracle.mjs';
import { loadFrontendGenericPropertyAdmissionPolicy } from './kern-frontend-generic-property-admission/policy.mjs';
import { normalizeRetainedTokenStreamOracle } from './kern-frontend-retained-token-stream/oracle.mjs';

const SOURCE_URL = new URL('../examples/kern-frontend/generic-property-admission.kern', import.meta.url);
const RECORD_WIDTH = 20;
const TOKENIZER_DIAGNOSTICS = new Set(['INVALID_BIGINT', 'UNCLOSED_EXPR', 'UNCLOSED_STRING', 'UNCLOSED_STYLE']);

function fail(category, detail) {
  throw new Error(`${category}: ${detail}`);
}

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

function readRegularSource(url) {
  const path = fileURLToPath(url);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('source containment', `${path} must be a regular file`);
  const source = readFileSync(path, 'utf8');
  if (source.includes('\r')) fail('source containment', `${path} must use LF line endings`);
  return source;
}

export function validateNativeGenericPropertyAdmissionSource(source) {
  const declarations = [...source.matchAll(/^fn name=observegenericpropertyadmission(?:[\t ]|$)/gmu)];
  if (declarations.length !== 1) fail('composition rejection', 'M4.164 must contain exactly one successor member');
  const member = source.slice(declarations[0].index);
  for (const forbidden of [
    'TokenStream', 'parseProp', 'parseWithDiagnostics', 'parseDocument', 'tokenizeLineInternal',
    'normalizeGenericPropertyAdmissionOracle', 'crypto', 'digest', 'hmac', 'capability',
  ]) {
    if (member.includes(forbidden)) fail('delegation rejection', `M4.164 member contains ${forbidden}`);
  }
  if ((member.match(/observeknownnodewarning\(/gu) ?? []).length !== 1) {
    fail('composition rejection', 'M4.164 must invoke M4.163 exactly once');
  }
  if ((member.match(/observeretainedtokenstream\(/gu) ?? []).length !== 1) {
    fail('composition rejection', 'M4.164 must re-observe M4.159 exactly once');
  }
  const handlers = [...member.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length !== 1 || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'the M4.164 handler must be native KERN');
  }
  return source;
}

export function loadGenericPropertyAdmissionSource() {
  return validateNativeGenericPropertyAdmissionSource([
    loadKnownNodeWarningSource(), readRegularSource(SOURCE_URL),
  ].join('\n\n'));
}

function uint(field, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(field)) fail('record rejection', `${label} must be canonical uint`);
  const value = Number(field);
  if (!Number.isSafeInteger(value)) fail('record rejection', `${label} exceeds safe integer`);
  return value;
}

function optionalUint(field, label) {
  return field === 'none' ? null : uint(field, label);
}

function optionalBool(field, label) {
  if (field === 'none') return null;
  if (field === 'true') return true;
  if (field === 'false') return false;
  fail('record rejection', `${label} must be canonical optional boolean`);
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

function collectInheritedFields(fields, cursor, fieldCount) {
  const inheritedFields = [];
  let authIndex = 0;
  while (inheritedFields.length < fieldCount) {
    const record = fields.slice(cursor, cursor + RECORD_WIDTH);
    const count = uint(record[3], 'warning-auth field count');
    if (
      record[0] !== 'warning-auth' || uint(record[1], 'warning-auth index') !== authIndex ||
      uint(record[2], 'warning-auth start') !== inheritedFields.length || count <= 0 || count > 16 ||
      count > fieldCount - inheritedFields.length || record.slice(4 + count).some(Boolean)
    ) fail('record rejection', 'invalid warning authentication');
    inheritedFields.push(...record.slice(4, 4 + count));
    cursor += RECORD_WIDTH;
    authIndex += 1;
  }
  return { cursor, inheritedFields };
}

export function parseGenericPropertyAdmissionEnvelope(content, snapshot, value, policy) {
  const fields = textFields(value);
  if (
    fields[0] !== policy.genericPropertyAdmissionFormat || fields.length < 1 + 3 * RECORD_WIDTH ||
    (fields.length - 1) % RECORD_WIDTH !== 0 ||
    fields.length > policy.maxGenericPropertyAdmissionEnvelopeFields
  ) fail('record rejection', 'invalid generic-property admission envelope');

  const first = fields.slice(1, 1 + RECORD_WIDTH);
  if (first[0] !== 'decision' && first[0] !== 'failure') fail('record rejection', 'invalid first record');
  const inheritedFieldCount = uint(first[first[0] === 'failure' ? 3 : 17], 'inherited field count');
  if (inheritedFieldCount <= 0 || inheritedFieldCount > policy.maxKnownNodeWarningEnvelopeFields) {
    fail('record rejection', 'inherited field count exceeds policy');
  }
  const collected = collectInheritedFields(fields, 1 + RECORD_WIDTH, inheritedFieldCount);
  let cursor = collected.cursor;
  const inherited = parseKnownNodeWarningEnvelope(
    content,
    snapshot,
    textList(collected.inheritedFields),
    policy,
  );
  const expected = normalizeGenericPropertyAdmissionOracle(content, snapshot, policy);

  if (first[0] === 'failure') {
    if (
      first[1] === '' || first[4] !== String(snapshot.runtimeInstance) ||
      first[5] !== String(snapshot.parseEpoch) || first[6] !== policy.knownNodeWarningFormat ||
      first[7] !== policy.retainedTokenStreamFormat || first.slice(8).some(Boolean) ||
      inherited.status !== 'failure'
    ) fail('record rejection', 'invalid propagated failure record');
    const seal = fields.slice(cursor, cursor + RECORD_WIDTH);
    if (
      cursor !== fields.length - RECORD_WIDTH || seal[0] !== 'failure-seal' || seal[1] !== first[1] ||
      seal[2] !== first[2] || seal[3] !== content || seal[4] !== first[4] || seal[5] !== first[5] ||
      seal[6] !== first[6] || seal[7] !== first[3] || seal[8] !== first[7] || seal.slice(9).some(Boolean)
    ) fail('record rejection', 'invalid failure seal');
    const actualFailure = failure(first[1], first[2]);
    assert.deepEqual(actualFailure, expected);
    return actualFailure;
  }

  if (inherited.status === 'failure') fail('record rejection', 'decision contradicts inherited failure');
  const actual = {
    admittedType: first[3],
    consumedValueTokenCount: uint(first[13], 'consumed value-token count'),
    cursorAfter: uint(first[12], 'cursor after'),
    cursorBefore: uint(first[8], 'cursor before'),
    equalsIndex: optionalUint(first[10], 'equals index'),
    format: policy.genericPropertyAdmissionFormat,
    inherited,
    key: first[4],
    knownState: first[2],
    parseEpoch: uint(first[15], 'parse epoch'),
    propertyIndex: optionalUint(first[9], 'property index'),
    quoted: optionalBool(first[7], 'quoted'),
    runtimeInstance: uint(first[14], 'runtime instance'),
    sourceProfile: policy.genericPropertyAdmissionSourceProfile,
    state: first[1],
    value: first[6],
    valueIndex: optionalUint(first[11], 'value index'),
    valueKind: first[5],
  };
  if (
    !['dropped', 'none', 'property'].includes(actual.state) ||
    !['dropped', 'known', 'unknown'].includes(actual.knownState) ||
    !['none', 'empty', 'quoted', 'expr', 'bare'].includes(actual.valueKind) ||
    actual.runtimeInstance !== snapshot.runtimeInstance || actual.parseEpoch !== snapshot.parseEpoch ||
    first[16] !== policy.knownNodeWarningFormat || first[18] !== policy.retainedTokenStreamFormat || first[19] !== ''
  ) fail('record rejection', 'decision identity or enum drift');
  if (
    (actual.state === 'dropped' && (
      actual.knownState !== 'dropped' || actual.admittedType !== '' || actual.key !== '' ||
      actual.valueKind !== 'none' || actual.quoted !== null || actual.cursorBefore !== 0 || actual.cursorAfter !== 0 ||
      actual.propertyIndex !== null || actual.equalsIndex !== null || actual.valueIndex !== null ||
      actual.consumedValueTokenCount !== 0
    )) ||
    (actual.state === 'none' && (
      actual.knownState === 'dropped' || actual.admittedType === '' || actual.key !== '' ||
      actual.valueKind !== 'none' || actual.quoted !== null || actual.cursorBefore !== 1 ||
      actual.propertyIndex !== null || actual.equalsIndex !== null || actual.valueIndex !== null ||
      actual.consumedValueTokenCount !== 0
    )) ||
    (actual.state === 'property' && (
      actual.knownState === 'dropped' || actual.admittedType === '' || actual.key === '' ||
      actual.valueKind === 'none' || actual.quoted === null || actual.cursorBefore !== 1 ||
      actual.propertyIndex === null || actual.equalsIndex !== actual.propertyIndex + 1 ||
      actual.cursorAfter < actual.equalsIndex + 1
    ))
  ) fail('record rejection', 'decision semantics drift');

  const seal = fields.slice(cursor, cursor + RECORD_WIDTH);
  if (
    cursor !== fields.length - RECORD_WIDTH || seal[0] !== 'seal' ||
    seal[1] !== first[1] || seal[2] !== first[2] || seal[3] !== first[3] || seal[4] !== first[4] ||
    seal[5] !== first[5] || seal[6] !== first[6] || seal[7] !== first[7] || seal[8] !== first[8] ||
    seal[9] !== first[9] || seal[10] !== first[10] || seal[11] !== first[11] || seal[12] !== first[12] ||
    seal[13] !== first[13] || seal[14] !== first[14] || seal[15] !== first[15] || seal[16] !== content ||
    seal[17] !== first[16] || seal[18] !== first[17] || seal[19] !== first[18]
  ) fail('record rejection', 'terminal seal drift');
  assert.deepEqual(actual, expected);
  return actual;
}

export function executeGenericPropertyAdmissionFields(content, snapshot, policy, kernSource) {
  const limits = policy.profileLimits;
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [
      content, limits.maxCodePoints, limits.maxTokens, limits.maxDiagnostics, policy.maxStreamRecords,
      policy.maxLexicalDepth, policy.maxCatalogEntries, snapshot.runtimeInstance, snapshot.parseEpoch,
      snapshot.evolvedTypes, snapshot.multilineTypes, snapshot.templateTypes, policy.maxRegistryEntries,
      policy.maxNameCodePoints, policy.maxNameBytes, policy.maxMutableRegistryEnvelopeFields,
      policy.mutableNodeTypeRegistrySnapshotFormat, policy.knownNodeWarningDiagnosticCode,
      policy.knownNodeWarningDiagnosticSeverity, policy.maxKnownNodeWarningEnvelopeFields,
      policy.knownNodeWarningFormat, policy.retainedTokenStreamFormat,
    ],
    identity: {
      handlerName: 'observegenericpropertyadmission',
      sourcePath: 'examples/kern-frontend/generic-property-admission.kern',
    },
    source: kernSource,
  }, { enabled: true, limits: policy.runtimeLimits });
  if (
    envelope.outcome !== 'success' || envelope.completion.kind !== 'return' || envelope.events.length !== 0 ||
    envelope.result.presence !== 'value'
  ) fail('runtime rejection', JSON.stringify(envelope.diagnostics));
  return envelope.result.value;
}

function assertBootstrapParity(result, parseResult, content, policy) {
  if (result.status === 'failure') return;
  const knownWarnings = parseResult.diagnostics.filter(
    ({ code }) => code === policy.knownNodeWarningDiagnosticCode,
  );
  assert.equal(knownWarnings.length, result.knownState === 'unknown' ? 1 : 0);
  const stream = normalizeRetainedTokenStreamOracle(content, policy);
  if (!('status' in stream)) {
    const tokenizerDiagnostics = parseResult.diagnostics.filter(({ code }) => TOKENIZER_DIAGNOSTICS.has(code));
    assert.deepEqual(
      tokenizerDiagnostics.map(({ code, col, endCol }) => ({ code, endScalar: endCol - 1, startScalar: col - 1 })),
      stream.diagnostics.map(({ code, endScalar, startScalar }) => ({ code, endScalar, startScalar })),
    );
  }
  if (result.state !== 'property') return;
  assert.equal(parseResult.root.type, result.admittedType);
  const expectedValue = result.valueKind === 'expr'
    ? { __expr: true, code: result.value }
    : result.value;
  assert.deepEqual(parseResult.root.props?.[result.key], expectedValue);
  assert.equal(parseResult.root.__quotedProps?.includes(result.key) ?? false, result.quoted);
}

export function executeGenericPropertyAdmission(evidence, policy, kernSource) {
  const consumed = consumeMutableNodeTypeRegistryParseEvidence(evidence);
  const result = parseGenericPropertyAdmissionEnvelope(
    consumed.source,
    consumed.snapshot,
    executeGenericPropertyAdmissionFields(consumed.source, consumed.snapshot, policy, kernSource),
    policy,
  );
  assertBootstrapParity(result, consumed.parseResult, consumed.source, policy);
  return result;
}

export function evaluateGenericPropertyAdmissionFixture(fixture, policy, kernSource) {
  const runtime = new KernRuntime();
  const evidence = parseWithGenericPropertyAdmissionSafety(fixture.source, runtime, {
    maxNameBytes: policy.maxNameBytes,
    maxNameCodePoints: policy.maxNameCodePoints,
    maxRegistryEntries: policy.maxRegistryEntries,
  });
  return executeGenericPropertyAdmission(evidence, policy, kernSource);
}

export function runKernFrontendGenericPropertyAdmissionCheck() {
  const policy = loadFrontendGenericPropertyAdmissionPolicy();
  const source = loadGenericPropertyAdmissionSource();
  for (const fixture of GENERIC_PROPERTY_ADMISSION_FIXTURES) {
    evaluateGenericPropertyAdmissionFixture(fixture, policy, source);
  }
  return { differential: GENERIC_PROPERTY_ADMISSION_FIXTURES.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  const counts = runKernFrontendGenericPropertyAdmissionCheck();
  console.log(`KERN frontend generic-property admission: ${counts.differential} fixtures passed.`);
}
