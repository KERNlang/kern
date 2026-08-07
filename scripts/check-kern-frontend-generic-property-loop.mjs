#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../packages/core/dist/runtime-handler.js';
import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithGenericPropertyLoopSafety,
} from '../packages/core/dist/mutable-node-type-registry-snapshot.js';
import { KernRuntime } from '../packages/core/dist/runtime-state.js';
import {
  loadGenericPropertyAdmissionSource,
  parseGenericPropertyAdmissionEnvelope,
} from './check-kern-frontend-generic-property-admission.mjs';
import { parseRetainedTokenStreamEnvelope } from './check-kern-frontend-retained-token-stream.mjs';
import { GENERIC_PROPERTY_LOOP_FIXTURES } from './kern-frontend-generic-property-loop/fixtures.mjs';
import { normalizeGenericPropertyLoopOracle } from './kern-frontend-generic-property-loop/oracle.mjs';
import { loadFrontendGenericPropertyLoopPolicy } from './kern-frontend-generic-property-loop/policy.mjs';

const SOURCE_URL = new URL('../examples/kern-frontend/generic-property-loop.kern', import.meta.url);
const RECORD_WIDTH = 20;

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

export function validateNativeGenericPropertyLoopSource(source) {
  const declarations = [...source.matchAll(/^fn name=observegenericpropertyloop(?:[\t ]|$)/gmu)];
  if (declarations.length !== 1) fail('composition rejection', 'M4.165 must contain exactly one successor member');
  const member = source.slice(declarations[0].index);
  for (const forbidden of [
    'TokenStream', 'parseProp', 'parseWithDiagnostics', 'parseDocument', 'tokenizeLineInternal',
    'normalizeGenericPropertyLoopOracle', 'Map(', 'Set(', 'crypto', 'digest', 'hmac', 'capability',
  ]) {
    if (member.includes(forbidden)) fail('delegation rejection', `M4.165 member contains ${forbidden}`);
  }
  if ((member.match(/observegenericpropertyadmission\(/gu) ?? []).length !== 1) {
    fail('composition rejection', 'M4.165 must invoke M4.164 exactly once');
  }
  if ((member.match(/observeretainedtokenstream\(/gu) ?? []).length !== 1) {
    fail('composition rejection', 'M4.165 must re-observe M4.159 exactly once');
  }
  const handlers = [...member.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length !== 1 || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'the M4.165 handler must be native KERN');
  }
  return source;
}

export function loadGenericPropertyLoopSource() {
  return validateNativeGenericPropertyLoopSource([
    loadGenericPropertyAdmissionSource(), readRegularSource(SOURCE_URL),
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

function bool(field, label) {
  if (field === 'true') return true;
  if (field === 'false') return false;
  fail('record rejection', `${label} must be canonical boolean`);
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

function collectAuth(fields, cursor, fieldCount, tag) {
  const authenticated = [];
  let authIndex = 0;
  while (authenticated.length < fieldCount) {
    const record = fields.slice(cursor, cursor + RECORD_WIDTH);
    const count = uint(record[3], `${tag} field count`);
    if (
      record.length !== RECORD_WIDTH || record[0] !== tag || uint(record[1], `${tag} index`) !== authIndex ||
      uint(record[2], `${tag} start`) !== authenticated.length || count <= 0 || count > 16 ||
      count > fieldCount - authenticated.length || record.slice(4 + count).some(Boolean)
    ) fail('record rejection', `invalid ${tag} authentication`);
    authenticated.push(...record.slice(4, 4 + count));
    cursor += RECORD_WIDTH;
    authIndex += 1;
  }
  return { authenticated, cursor };
}

function parseWrite(record, index) {
  if (record[0] !== 'write' || uint(record[1], 'write index') !== index || record.slice(18).some(Boolean)) {
    fail('record rejection', 'invalid write record');
  }
  const write = {
    consumedValueTokenCount: uint(record[12], 'consumed value-token count'),
    cursorAfter: uint(record[11], 'write cursor after'),
    cursorBefore: uint(record[7], 'write cursor before'),
    diagnosticIndex: optionalUint(record[13], 'diagnostic index'),
    duplicate: bool(record[6], 'duplicate'),
    equalsIndex: uint(record[9], 'equals index'),
    key: record[2],
    propertyIndex: uint(record[8], 'property index'),
    quoteGeneration: uint(record[17], 'quote generation'),
    quoted: bool(record[5], 'quoted'),
    uniqueIndex: uint(record[16], 'unique index'),
    value: record[4],
    valueIndex: optionalUint(record[10], 'value index'),
    valueKind: record[3],
    writeIndex: index,
  };
  if (
    write.key === '' || !['empty', 'quoted', 'expr', 'bare'].includes(write.valueKind) ||
    write.equalsIndex !== write.propertyIndex + 1 || write.cursorAfter < write.equalsIndex + 1 ||
    write.quoted !== (write.valueKind === 'quoted') || write.duplicate !== (write.diagnosticIndex !== null) ||
    (!write.duplicate && (record[14] !== 'none' || record[15] !== 'none'))
  ) fail('record rejection', 'write semantics drift');
  if (write.duplicate) {
    write.diagnosticCol = uint(record[14], 'duplicate col');
    write.diagnosticEndCol = uint(record[15], 'duplicate end col');
  }
  return write;
}

function parseProperty(record, index) {
  if (record[0] !== 'property' || uint(record[1], 'property index') !== index || record.slice(10).some(Boolean)) {
    fail('record rejection', 'invalid final property record');
  }
  const property = {
    firstWriteIndex: uint(record[7], 'first write index'),
    key: record[2],
    lastWriteIndex: uint(record[8], 'last write index'),
    quoteGeneration: uint(record[9], 'property quote generation'),
    quoted: bool(record[6], 'property quoted'),
    uniqueIndex: index,
    value: record[4],
    valueKind: record[3],
  };
  if (bool(record[5], 'expression flag') !== (property.valueKind === 'expr')) {
    fail('record rejection', 'expression flag drift');
  }
  return property;
}

function parseDiagnostic(record, index) {
  if (
    record[0] !== 'duplicate' || uint(record[1], 'duplicate index') !== index ||
    record[3] !== 'DUPLICATE_PROP' || record[4] !== 'warning' || record.slice(10).some(Boolean)
  ) fail('record rejection', 'invalid duplicate diagnostic record');
  return {
    code: record[3], col: uint(record[7], 'duplicate col'), endCol: uint(record[9], 'duplicate end col'),
    endLine: uint(record[8], 'duplicate end line'), index, line: uint(record[6], 'duplicate line'),
    message: record[5], severity: record[4], writeIndex: uint(record[2], 'duplicate write index'),
  };
}

export function parseGenericPropertyLoopEnvelope(content, snapshot, value, policy) {
  const fields = textFields(value);
  if (
    fields[0] !== policy.genericPropertyLoopFormat || fields.length < 1 + 4 * RECORD_WIDTH ||
    (fields.length - 1) % RECORD_WIDTH !== 0 || fields.length > policy.maxGenericPropertyLoopEnvelopeFields
  ) fail('record rejection', 'invalid generic-property loop envelope');
  const header = fields.slice(1, 1 + RECORD_WIDTH);
  if (!['decision', 'failure'].includes(header[0])) fail('record rejection', 'invalid loop header');
  const admissionFieldCount = uint(header[header[0] === 'failure' ? 5 : 13], 'admission field count');
  const streamFieldCount = uint(header[header[0] === 'failure' ? 6 : 15], 'stream field count');
  if (
    admissionFieldCount <= 0 || admissionFieldCount > policy.maxGenericPropertyAdmissionEnvelopeFields ||
    streamFieldCount <= 0 || streamFieldCount > policy.maxRetainedTokenStreamEnvelopeFields
  ) fail('record rejection', 'inherited field count exceeds policy');

  let cursor = 1 + RECORD_WIDTH;
  const writes = [];
  const finalProperties = [];
  const quotedProperties = [];
  const diagnostics = [];
  let state;
  let knownState;
  let admittedType;
  let terminalCursor;
  let terminalKind;
  if (header[0] === 'decision') {
    const writeCount = uint(header[4], 'write count');
    const propertyCount = uint(header[5], 'property count');
    const duplicateCount = uint(header[6], 'duplicate count');
    const quotedCount = uint(header[7], 'quoted count');
    if ([writeCount, propertyCount, duplicateCount, quotedCount].some((count) => count > policy.maxGenericPropertyLoopProperties)) {
      fail('record rejection', 'loop record count exceeds policy');
    }
    state = header[1];
    knownState = header[2];
    admittedType = header[3];
    terminalCursor = uint(header[8], 'terminal cursor');
    terminalKind = header[9];
    if (
      !['dropped', 'loop'].includes(state) || !['dropped', 'known', 'unknown'].includes(knownState) ||
      !['dropped', 'eof'].includes(terminalKind) || uint(header[10], 'runtime instance') !== snapshot.runtimeInstance ||
      uint(header[11], 'parse epoch') !== snapshot.parseEpoch ||
      header[12] !== policy.genericPropertyAdmissionFormat || header[14] !== policy.retainedTokenStreamFormat ||
      header.slice(16).some(Boolean)
    ) fail('record rejection', 'loop identity drift');
    for (let index = 0; index < writeCount; index += 1, cursor += RECORD_WIDTH) {
      writes.push(parseWrite(fields.slice(cursor, cursor + RECORD_WIDTH), index));
    }
    for (let index = 0; index < propertyCount; index += 1, cursor += RECORD_WIDTH) {
      finalProperties.push(parseProperty(fields.slice(cursor, cursor + RECORD_WIDTH), index));
    }
    quotedProperties.push(...finalProperties
      .filter(({ quoted }) => quoted)
      .sort((left, right) => left.quoteGeneration - right.quoteGeneration)
      .map(({ key, quoteGeneration: generation, uniqueIndex: propertyIndex }, orderIndex) => (
        { generation, key, orderIndex, propertyIndex }
      )));
    if (quotedProperties.length !== quotedCount) fail('record rejection', 'quoted count drift');
    for (let index = 0; index < duplicateCount; index += 1, cursor += RECORD_WIDTH) {
      diagnostics.push(parseDiagnostic(fields.slice(cursor, cursor + RECORD_WIDTH), index));
    }
  } else if (
    header[1] === '' || uint(header[3], 'failure runtime') !== snapshot.runtimeInstance ||
    uint(header[4], 'failure epoch') !== snapshot.parseEpoch || header.slice(7).some(Boolean)
  ) fail('record rejection', 'invalid loop failure header');

  const admissionAuth = collectAuth(fields, cursor, admissionFieldCount, 'admission-auth');
  cursor = admissionAuth.cursor;
  const streamAuth = collectAuth(fields, cursor, streamFieldCount, 'stream-auth');
  cursor = streamAuth.cursor;
  const inherited = parseGenericPropertyAdmissionEnvelope(content, snapshot, textList(admissionAuth.authenticated), policy);
  const stream = parseRetainedTokenStreamEnvelope(content, textList(streamAuth.authenticated), policy);
  const expected = normalizeGenericPropertyLoopOracle(content, snapshot, policy);
  const seal = fields.slice(cursor, cursor + RECORD_WIDTH);
  if (cursor !== fields.length - RECORD_WIDTH) fail('record rejection', 'loop seal must be terminal');

  if (header[0] === 'failure') {
    if (
      seal[0] !== 'failure-seal' || seal[1] !== header[1] || seal[2] !== header[2] || seal[3] !== content ||
      seal[4] !== header[3] || seal[5] !== header[4] || seal[6] !== header[5] || seal[7] !== header[6] ||
      seal.slice(8).some(Boolean) || (inherited.status !== 'failure' && stream.status !== 'failure' &&
      !['LOOP_INVALID', 'LOOP_PROFILE', 'LOOP_LIMIT'].includes(header[1]))
    ) fail('record rejection', 'invalid loop failure seal');
    const actualFailure = failure(header[1], header[2]);
    assert.deepEqual(actualFailure, expected);
    return actualFailure;
  }

  if (inherited.status === 'failure' || stream.status === 'failure') fail('record rejection', 'decision contradicts inherited failure');
  const actual = {
    admittedType, diagnostics, finalProperties, format: policy.genericPropertyLoopFormat, inherited,
    knownState, parseEpoch: snapshot.parseEpoch, quotedProperties, runtimeInstance: snapshot.runtimeInstance,
    sourceProfile: policy.genericPropertyLoopSourceProfile, state, stream, terminalCursor, terminalKind, writes,
  };
  if (
    seal[0] !== 'seal' || seal[1] !== state || seal[2] !== knownState || seal[3] !== admittedType ||
    seal[4] !== header[4] || seal[5] !== header[5] || seal[6] !== header[6] || seal[7] !== header[7] ||
    seal[8] !== header[8] || seal[9] !== terminalKind || seal[10] !== header[10] || seal[11] !== header[11] ||
    seal[12] !== content || seal[13] !== header[12] || seal[14] !== header[13] ||
    seal[15] !== header[14] || seal[16] !== header[15] || seal.slice(17).some(Boolean)
  ) fail('record rejection', 'loop terminal seal drift');
  assert.deepEqual(actual, expected);
  return actual;
}

export function executeGenericPropertyLoopFields(content, snapshot, policy, kernSource) {
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
      policy.knownNodeWarningFormat, policy.retainedTokenStreamFormat, policy.maxGenericPropertyLoopProperties,
      policy.genericPropertyAdmissionFormat, policy.genericPropertyLoopFormat,
    ],
    identity: { handlerName: 'observegenericpropertyloop', sourcePath: 'examples/kern-frontend/generic-property-loop.kern' },
    source: kernSource,
  }, { enabled: true, limits: policy.runtimeLimits });
  if (
    envelope.outcome !== 'success' || envelope.completion.kind !== 'return' || envelope.events.length !== 0 ||
    envelope.result.presence !== 'value'
  ) fail('runtime rejection', JSON.stringify(envelope.diagnostics));
  return envelope.result.value;
}

function assertBootstrapParity(result, parseResult) {
  if (result.status === 'failure' || result.state === 'dropped') return;
  assert.equal(parseResult.root.type, result.admittedType);
  const expectedProps = Object.fromEntries(result.finalProperties.map((property) => [
    property.key,
    property.valueKind === 'expr' ? { __expr: true, code: property.value } : property.value,
  ]));
  assert.deepEqual(Object.keys(parseResult.root.props), result.finalProperties.map(({ key }) => key));
  assert.deepEqual(parseResult.root.props, expectedProps);
  const expectedQuoted = result.quotedProperties.map(({ key }) => key);
  assert.deepEqual(parseResult.root.__quotedProps ?? [], expectedQuoted);
  assert.deepEqual(
    parseResult.diagnostics.filter(({ code }) => code === 'DUPLICATE_PROP').map(
      ({ code, col, endCol, endLine, line, message, severity }) => (
        { code, col, endCol, endLine: endLine ?? line, line, message, severity }
      ),
    ),
    result.diagnostics.map(({ code, col, endCol, endLine, line, message, severity }) => (
      { code, col, endCol, endLine, line, message, severity }
    )),
  );
}

export function executeGenericPropertyLoop(evidence, policy, kernSource) {
  const consumed = consumeMutableNodeTypeRegistryParseEvidence(evidence);
  const result = parseGenericPropertyLoopEnvelope(
    consumed.source,
    consumed.snapshot,
    executeGenericPropertyLoopFields(consumed.source, consumed.snapshot, policy, kernSource),
    policy,
  );
  assertBootstrapParity(result, consumed.parseResult);
  return result;
}

export function evaluateGenericPropertyLoopFixture(fixture, policy, kernSource) {
  const runtime = new KernRuntime();
  const evidence = parseWithGenericPropertyLoopSafety(fixture.source, runtime, {
    maxNameBytes: policy.maxNameBytes,
    maxNameCodePoints: policy.maxNameCodePoints,
    maxRegistryEntries: policy.maxRegistryEntries,
  });
  return executeGenericPropertyLoop(evidence, policy, kernSource);
}

export function runKernFrontendGenericPropertyLoopCheck() {
  const policy = loadFrontendGenericPropertyLoopPolicy();
  const source = loadGenericPropertyLoopSource();
  for (const fixture of GENERIC_PROPERTY_LOOP_FIXTURES) evaluateGenericPropertyLoopFixture(fixture, policy, source);
  return { differential: GENERIC_PROPERTY_LOOP_FIXTURES.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  const counts = runKernFrontendGenericPropertyLoopCheck();
  console.log(`KERN frontend generic-property loop: ${counts.differential} fixtures passed.`);
}
