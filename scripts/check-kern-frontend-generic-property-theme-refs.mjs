#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../packages/core/dist/runtime-handler.js';
import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithGenericPropertyThemeRefsSafety,
} from '../packages/core/dist/mutable-node-type-registry-snapshot.js';
import { KernRuntime } from '../packages/core/dist/runtime-state.js';
import {
  loadGenericPropertyLoopSource,
  parseGenericPropertyLoopEnvelope,
  parseGenericPropertyLoopExpectedProfileEnvelope,
} from './check-kern-frontend-generic-property-loop.mjs';
import { parseRetainedTokenStreamEnvelope } from './check-kern-frontend-retained-token-stream.mjs';
import { GENERIC_PROPERTY_THEME_REFS_FIXTURES } from './kern-frontend-generic-property-theme-refs/fixtures.mjs';
import { normalizeGenericPropertyThemeRefsOracle } from './kern-frontend-generic-property-theme-refs/oracle.mjs';
import { loadFrontendGenericPropertyThemeRefsPolicy } from './kern-frontend-generic-property-theme-refs/policy.mjs';

const SOURCE_URL = new URL('../examples/kern-frontend/generic-property-theme-refs.kern', import.meta.url);
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

export function validateNativeGenericPropertyThemeRefsSource(source) {
  const declarations = [...source.matchAll(/^fn name=observegenericpropertythemerefs(?:[\t ]|$)/gmu)];
  if (declarations.length !== 1) fail('composition rejection', 'M4.166 must contain exactly one successor member');
  const member = source.slice(declarations[0].index);
  for (const forbidden of [
    'TokenStream', 'parseProp', 'parseWithDiagnostics', 'parseDocument', 'tokenizeLineInternal',
    'normalizeGenericPropertyThemeRefsOracle', 'Map(', 'Set(', 'crypto', 'digest', 'hmac', 'capability',
  ]) if (member.includes(forbidden)) fail('delegation rejection', `M4.166 member contains ${forbidden}`);
  if ((member.match(/observegenericpropertyloop\(/gu) ?? []).length !== 1) {
    fail('composition rejection', 'M4.166 must invoke M4.165 exactly once');
  }
  if ((member.match(/observeretainedtokenstream\(/gu) ?? []).length !== 1) {
    fail('composition rejection', 'M4.166 must re-observe M4.159 exactly once');
  }
  const handlers = [...member.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length !== 1 || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'the M4.166 handler must be native KERN');
  }
  return source;
}

export function loadGenericPropertyThemeRefsSource() {
  return validateNativeGenericPropertyThemeRefsSource([
    loadGenericPropertyLoopSource(), readRegularSource(SOURCE_URL),
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

function parsePropertyTransition(record, transitionIndex, writeIndex) {
  if (
    record[0] !== 'property-write' || uint(record[1], 'property transition index') !== transitionIndex ||
    uint(record[2], 'write index') !== writeIndex || record[19] !== ''
  ) fail('record rejection', 'invalid property transition record');
  const write = {
    consumedValueTokenCount: uint(record[13], 'consumed value-token count'),
    cursorAfter: uint(record[12], 'property cursor after'),
    cursorBefore: uint(record[8], 'property cursor before'),
    diagnosticIndex: optionalUint(record[14], 'diagnostic index'),
    duplicate: bool(record[7], 'duplicate'),
    equalsIndex: uint(record[10], 'equals index'),
    key: record[3],
    propertyIndex: uint(record[9], 'property index'),
    quoteGeneration: uint(record[18], 'quote generation'),
    quoted: bool(record[6], 'quoted'),
    transitionIndex,
    type: 'property',
    uniqueIndex: uint(record[17], 'unique index'),
    value: record[5],
    valueIndex: optionalUint(record[11], 'value index'),
    valueKind: record[4],
    writeIndex,
  };
  if (
    write.key === '' || !['empty', 'quoted', 'expr', 'bare'].includes(write.valueKind) ||
    write.equalsIndex !== write.propertyIndex + 1 || write.cursorAfter < write.equalsIndex + 1 ||
    write.quoted !== (write.valueKind === 'quoted') || write.duplicate !== (write.diagnosticIndex !== null) ||
    (['quoted', 'expr'].includes(write.valueKind) && write.valueIndex === null) ||
    (!write.duplicate && (record[15] !== 'none' || record[16] !== 'none'))
  ) fail('record rejection', 'property transition semantics drift');
  if (write.duplicate) {
    write.diagnosticCol = uint(record[15], 'duplicate col');
    write.diagnosticEndCol = uint(record[16], 'duplicate end col');
  }
  return write;
}

function parseThemeTransition(record, transitionIndex, themeIndex) {
  if (
    record[0] !== 'theme' || uint(record[1], 'theme transition index') !== transitionIndex ||
    uint(record[2], 'theme index') !== themeIndex || record[4] === '' || record.slice(7).some(Boolean)
  ) fail('record rejection', 'invalid theme transition record');
  const tokenIndex = uint(record[3], 'theme token index');
  const cursorBefore = uint(record[5], 'theme cursor before');
  const cursorAfter = uint(record[6], 'theme cursor after');
  if (cursorBefore !== tokenIndex || cursorAfter !== tokenIndex + 1) fail('record rejection', 'theme cursor drift');
  return { cursorAfter, cursorBefore, themeIndex, tokenIndex, transitionIndex, type: 'theme', value: record[4] };
}

function deriveState(writes) {
  const properties = new Map();
  const diagnostics = [];
  for (const write of writes) {
    const existing = properties.get(write.key);
    if (write.duplicate !== Boolean(existing) || write.uniqueIndex !== (existing?.uniqueIndex ?? properties.size)) {
      fail('record rejection', 'property identity drift');
    }
    if (write.duplicate) {
      diagnostics.push({
        code: 'DUPLICATE_PROP', col: write.diagnosticCol, endCol: write.diagnosticEndCol, endLine: 1,
        index: write.diagnosticIndex, line: 1, message: `Duplicate property '${write.key}' at line 1`,
        severity: 'warning', writeIndex: write.writeIndex,
      });
    }
    properties.set(write.key, {
      firstWriteIndex: existing?.firstWriteIndex ?? write.writeIndex,
      key: write.key,
      lastWriteIndex: write.writeIndex,
      quoteGeneration: write.quoteGeneration,
      quoted: write.quoted,
      uniqueIndex: write.uniqueIndex,
      value: write.value,
      valueKind: write.valueKind,
    });
  }
  const finalProperties = [...properties.values()];
  const quotedProperties = finalProperties.filter(({ quoted }) => quoted)
    .sort((left, right) => left.quoteGeneration - right.quoteGeneration)
    .map(({ key, quoteGeneration: generation, uniqueIndex: propertyIndex }, orderIndex) => (
      { generation, key, orderIndex, propertyIndex }
    ));
  return { diagnostics, finalProperties, quotedProperties };
}

export function parseGenericPropertyThemeRefsEnvelope(content, snapshot, value, policy) {
  const fields = textFields(value);
  if (
    fields[0] !== policy.genericPropertyThemeRefsFormat || fields.length < 1 + 4 * RECORD_WIDTH ||
    (fields.length - 1) % RECORD_WIDTH !== 0 || fields.length > policy.maxGenericPropertyThemeRefsEnvelopeFields
  ) fail('record rejection', 'invalid generic-property theme-ref envelope');
  const header = fields.slice(1, 1 + RECORD_WIDTH);
  if (!['decision', 'failure'].includes(header[0])) fail('record rejection', 'invalid theme-ref header');
  const loopFieldCount = uint(header[header[0] === 'failure' ? 5 : 12], 'loop field count');
  const streamFieldCount = uint(header[header[0] === 'failure' ? 6 : 14], 'stream field count');
  if (
    loopFieldCount <= 0 || loopFieldCount > policy.maxGenericPropertyLoopEnvelopeFields ||
    streamFieldCount <= 0 || streamFieldCount > policy.maxRetainedTokenStreamEnvelopeFields
  ) fail('record rejection', 'inherited field count exceeds policy');

  let cursor = 1 + RECORD_WIDTH;
  const transitions = [];
  const writes = [];
  const themeRecords = [];
  let decision;
  if (header[0] === 'decision') {
    const transitionCount = uint(header[4], 'transition count');
    const writeCount = uint(header[5], 'write count');
    const themeCount = uint(header[6], 'theme count');
    if (
      transitionCount !== writeCount + themeCount ||
      writeCount > policy.maxGenericPropertyThemeRefsProperties ||
      themeCount > policy.maxGenericPropertyThemeRefsThemeRefs ||
      transitionCount > policy.maxGenericPropertyThemeRefsTransitions
    ) fail('record rejection', 'transition count exceeds policy');
    let writeIndex = 0;
    let themeIndex = 0;
    for (let index = 0; index < transitionCount; index += 1, cursor += RECORD_WIDTH) {
      const record = fields.slice(cursor, cursor + RECORD_WIDTH);
      const transition = record[0] === 'property-write'
        ? parsePropertyTransition(record, index, writeIndex++)
        : parseThemeTransition(record, index, themeIndex++);
      transitions.push(transition);
      if (transition.type === 'property') writes.push(transition);
      else themeRecords.push(transition);
    }
    if (writeIndex !== writeCount || themeIndex !== themeCount) fail('record rejection', 'transition kind count drift');
    decision = {
      admittedType: header[3],
      firstFailureCursor: optionalUint(header[15], 'first failure cursor'),
      knownState: header[2],
      predecessorState: header[16],
      state: header[1],
      terminalCursor: uint(header[7], 'terminal cursor'),
      terminalKind: header[8],
    };
    if (
      !['dropped', 'loop'].includes(decision.state) ||
      !['dropped', 'known', 'unknown'].includes(decision.knownState) ||
      !['dropped', 'eof'].includes(decision.terminalKind) ||
      !['dropped', 'success', 'expected-profile'].includes(decision.predecessorState) ||
      uint(header[9], 'runtime instance') !== snapshot.runtimeInstance ||
      uint(header[10], 'parse epoch') !== snapshot.parseEpoch ||
      header[11] !== policy.genericPropertyLoopFormat || header[13] !== policy.retainedTokenStreamFormat ||
      header.slice(17).some(Boolean)
    ) fail('record rejection', 'theme-ref identity drift');
  } else if (
    header[1] === '' || uint(header[3], 'failure runtime') !== snapshot.runtimeInstance ||
    uint(header[4], 'failure epoch') !== snapshot.parseEpoch || header.slice(7).some(Boolean)
  ) fail('record rejection', 'invalid theme-ref failure header');

  const loopAuth = collectAuth(fields, cursor, loopFieldCount, 'loop-auth');
  cursor = loopAuth.cursor;
  const streamAuth = collectAuth(fields, cursor, streamFieldCount, 'stream-auth');
  cursor = streamAuth.cursor;
  const loopValue = textList(loopAuth.authenticated);
  const inherited = loopAuth.authenticated[1] === 'failure' && loopAuth.authenticated[2] === 'LOOP_PROFILE'
    ? parseGenericPropertyLoopExpectedProfileEnvelope(content, snapshot, loopValue, policy)
    : parseGenericPropertyLoopEnvelope(content, snapshot, loopValue, policy);
  const stream = parseRetainedTokenStreamEnvelope(content, textList(streamAuth.authenticated), policy);
  const seal = fields.slice(cursor, cursor + RECORD_WIDTH);
  if (cursor !== fields.length - RECORD_WIDTH) fail('record rejection', 'theme-ref seal must be terminal');
  const expected = normalizeGenericPropertyThemeRefsOracle(content, snapshot, policy, inherited);

  if (header[0] === 'failure') {
    if (
      seal[0] !== 'failure-seal' || seal[1] !== header[1] || seal[2] !== header[2] || seal[3] !== content ||
      seal[4] !== header[3] || seal[5] !== header[4] || seal[6] !== header[5] || seal[7] !== header[6] ||
      seal.slice(8).some(Boolean)
    ) fail('record rejection', 'invalid theme-ref failure seal');
    const actualFailure = failure(header[1], header[2]);
    assert.deepEqual(actualFailure, expected);
    return actualFailure;
  }

  if (inherited.status === 'failure' && inherited.code !== 'LOOP_PROFILE') {
    fail('record rejection', 'decision contradicts inherited failure');
  }
  const state = deriveState(writes);
  const actual = {
    admittedType: decision.admittedType,
    ...state,
    firstFailureCursor: decision.firstFailureCursor,
    format: policy.genericPropertyThemeRefsFormat,
    inherited,
    knownState: decision.knownState,
    parseEpoch: snapshot.parseEpoch,
    predecessorState: decision.predecessorState,
    runtimeInstance: snapshot.runtimeInstance,
    sourceProfile: policy.genericPropertyThemeRefsSourceProfile,
    state: decision.state,
    stream,
    terminalCursor: decision.terminalCursor,
    terminalKind: decision.terminalKind,
    themeRefs: themeRecords.map(({ value }) => value),
    transitions,
    writes,
  };
  if (
    seal[0] !== 'seal' || seal[1] !== header[1] || seal[2] !== header[2] || seal[3] !== header[3] ||
    seal[4] !== header[4] || seal[5] !== header[5] || seal[6] !== header[6] || seal[7] !== header[7] ||
    seal[8] !== header[8] || seal[9] !== header[9] || seal[10] !== header[10] || seal[11] !== content ||
    seal[12] !== header[11] || seal[13] !== header[12] || seal[14] !== header[13] || seal[15] !== header[14] ||
    seal[16] !== header[15] || seal[17] !== header[16] || seal.slice(18).some(Boolean)
  ) fail('record rejection', 'theme-ref terminal seal drift');
  assert.deepEqual(actual, expected);
  return actual;
}

export function executeGenericPropertyThemeRefsFields(content, snapshot, policy, kernSource) {
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
      policy.maxGenericPropertyThemeRefsProperties, policy.genericPropertyAdmissionFormat,
      policy.genericPropertyLoopFormat, policy.maxGenericPropertyThemeRefsThemeRefs,
      policy.genericPropertyThemeRefsFormat,
    ],
    identity: {
      handlerName: 'observegenericpropertythemerefs',
      sourcePath: 'examples/kern-frontend/generic-property-theme-refs.kern',
    },
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
  assert.deepEqual(parseResult.root.props, {
    ...expectedProps,
    ...(result.themeRefs.length > 0 ? { themeRefs: result.themeRefs } : {}),
  });
  assert.deepEqual(parseResult.root.__quotedProps ?? [], result.quotedProperties.map(({ key }) => key));
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

export function executeGenericPropertyThemeRefs(evidence, policy, kernSource) {
  const consumed = consumeMutableNodeTypeRegistryParseEvidence(evidence);
  const result = parseGenericPropertyThemeRefsEnvelope(
    consumed.source,
    consumed.snapshot,
    executeGenericPropertyThemeRefsFields(consumed.source, consumed.snapshot, policy, kernSource),
    policy,
  );
  assertBootstrapParity(result, consumed.parseResult);
  return result;
}

export function evaluateGenericPropertyThemeRefsFixture(fixture, policy, kernSource) {
  const runtime = new KernRuntime();
  const evidence = parseWithGenericPropertyThemeRefsSafety(fixture.source, runtime, {
    maxNameBytes: policy.maxNameBytes,
    maxNameCodePoints: policy.maxNameCodePoints,
    maxRegistryEntries: policy.maxRegistryEntries,
  });
  return executeGenericPropertyThemeRefs(evidence, policy, kernSource);
}

export function runKernFrontendGenericPropertyThemeRefsCheck() {
  const policy = loadFrontendGenericPropertyThemeRefsPolicy();
  const source = loadGenericPropertyThemeRefsSource();
  for (const fixture of GENERIC_PROPERTY_THEME_REFS_FIXTURES) {
    evaluateGenericPropertyThemeRefsFixture(fixture, policy, source);
  }
  return GENERIC_PROPERTY_THEME_REFS_FIXTURES.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`KERN frontend generic-property theme-ref checks passed: ${runKernFrontendGenericPropertyThemeRefsCheck()}`);
}
