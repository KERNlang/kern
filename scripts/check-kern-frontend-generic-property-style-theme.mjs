#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../packages/core/dist/runtime-handler.js';
import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithGenericPropertyStyleThemeSafety,
} from '../packages/core/dist/mutable-node-type-registry-snapshot.js';
import { KernRuntime } from '../packages/core/dist/runtime-state.js';
import {
  loadGenericPropertyThemeRefsSource,
  parseGenericPropertyThemeRefsEnvelope,
} from './check-kern-frontend-generic-property-theme-refs.mjs';
import { parseRetainedTokenStreamEnvelope } from './check-kern-frontend-retained-token-stream.mjs';
import { parseGenericPropertyStyleThemeReplay } from './kern-frontend-generic-property-style-theme/envelope.mjs';
import { GENERIC_PROPERTY_STYLE_THEME_FIXTURES } from './kern-frontend-generic-property-style-theme/fixtures.mjs';
import { normalizeGenericPropertyStyleThemeOracle } from './kern-frontend-generic-property-style-theme/oracle.mjs';
import { loadFrontendGenericPropertyStyleThemePolicy } from './kern-frontend-generic-property-style-theme/policy.mjs';

const SOURCE_URLS = [
  new URL('../examples/kern-frontend/style-block-helpers.kern', import.meta.url),
  new URL('../examples/kern-frontend/generic-property-style-theme-replay.kern', import.meta.url),
  new URL('../examples/kern-frontend/generic-property-style-theme.kern', import.meta.url),
];
const EXPECTED_NATIVE_FUNCTIONS = [
  'styletrimspace', 'styletrim', 'styleunquote', 'stylelowerletter', 'stylekeychar', 'styleuint',
  'stylearrayindex', 'interpretstylepair', 'observestyleblockvalue', 'stylefinalrecords',
  'stylethemereplayfailure', 'replaygenericpropertystyletheme', 'stylethemeouterfailure',
  'observegenericpropertystyletheme',
];
const RECORD_WIDTH = 20;

function fail(category, detail) {
  throw new Error(`${category}: ${detail}`);
}

function readRegularSource(url) {
  const path = fileURLToPath(url);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('source containment', `${path} must be a regular file`);
  const source = readFileSync(path, 'utf8');
  if (source.includes('\r')) fail('source containment', `${path} must use LF line endings`);
  const lines = source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length;
  if (lines >= 500) fail('source containment', `${path} has ${lines} lines; expected fewer than 500`);
  return source;
}

export function validateNativeGenericPropertyStyleThemeSource(source) {
  const declarations = [...source.matchAll(/^fn name=([^\t ]+)([^\r\n]*)$/gmu)];
  const functionNames = declarations.map((match) => match[1]);
  if (
    functionNames.length !== EXPECTED_NATIVE_FUNCTIONS.length ||
    functionNames.some((name, index) => name !== EXPECTED_NATIVE_FUNCTIONS[index]) ||
    declarations.some((match, index) => (
      index === declarations.length - 1 ? !/\bexport=true\b/u.test(match[2]) : /\bexport=true\b/u.test(match[2])
    ))
  ) fail('composition rejection', 'M4.167 function surface must match the closed native allowlist');
  for (const forbidden of [
    'TokenStream', 'parseProp', 'parseStyleBlock', 'splitStylePairs', 'parseWithDiagnostics',
    'parseDocument', 'tokenizeLineInternal', 'normalizeGenericPropertyStyleThemeOracle', 'Map(', 'Set(',
    'Object.', 'crypto', 'digest', 'hmac', 'capability',
  ]) if (source.includes(forbidden)) fail('delegation rejection', `M4.167 member contains ${forbidden}`);
  for (const [needle, label] of [
    ['observegenericpropertythemerefs(', 'M4.166'],
    ['observeretainedtokenstream(', 'M4.159'],
    ['replaygenericpropertystyletheme(', 'integrated replay'],
  ]) {
    if ((source.match(new RegExp(needle.replace('(', '\\('), 'gu')) ?? []).length !== 1) {
      fail('composition rejection', `M4.167 must invoke ${label} exactly once`);
    }
  }
  const handlers = [...source.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length === 0 || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'all M4.167 handlers must be native KERN');
  }
  return source;
}

export function loadGenericPropertyStyleThemeSource() {
  const members = SOURCE_URLS.map(readRegularSource);
  validateNativeGenericPropertyStyleThemeSource(members.join('\n\n'));
  return [loadGenericPropertyThemeRefsSource(), ...members].join('\n\n');
}

function uint(field, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(field)) fail('record rejection', `${label} must be canonical uint`);
  const value = Number(field);
  if (!Number.isSafeInteger(value)) fail('record rejection', `${label} exceeds safe integer`);
  return value;
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
    const count = uint(record[3], `${tag} count`);
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

export function parseGenericPropertyStyleThemeEnvelope(content, snapshot, value, policy) {
  const fields = textFields(value);
  if (
    fields[0] !== policy.genericPropertyStyleThemeFormat || fields.length < 41 ||
    (fields.length - 1) % RECORD_WIDTH !== 0 || fields.length > policy.maxGenericPropertyStyleThemeEnvelopeFields
  ) fail('record rejection', 'invalid outer style/theme envelope');
  const header = fields.slice(1, 21);
  if (!['decision', 'failure'].includes(header[0])) fail('record rejection', 'invalid outer header tag');
  const failureHeader = header[0] === 'failure';
  const themeCountIndex = failureHeader ? 5 : 4;
  const streamCountIndex = failureHeader ? 6 : 5;
  const replayCountIndex = failureHeader ? 7 : 6;
  const themeFieldCount = uint(header[themeCountIndex], 'theme envelope field count');
  const streamFieldCount = uint(header[streamCountIndex], 'stream field count');
  const replayFieldCount = uint(header[replayCountIndex], 'replay field count');
  if (
    themeFieldCount <= 0 || themeFieldCount > policy.maxGenericPropertyThemeRefsEnvelopeFields ||
    streamFieldCount <= 0 || streamFieldCount > policy.maxRetainedTokenStreamEnvelopeFields ||
    replayFieldCount <= 0 || replayFieldCount > policy.maxGenericPropertyStyleThemeReplayEnvelopeFields
  ) fail('record rejection', 'outer inherited field count exceeds policy');

  let cursor = 21;
  const themeAuth = collectAuth(fields, cursor, themeFieldCount, 'theme-auth');
  cursor = themeAuth.cursor;
  const streamAuth = collectAuth(fields, cursor, streamFieldCount, 'stream-auth');
  cursor = streamAuth.cursor;
  const replayAuth = collectAuth(fields, cursor, replayFieldCount, 'replay-auth');
  cursor = replayAuth.cursor;
  if (cursor !== fields.length - RECORD_WIDTH) fail('record rejection', 'outer seal must be terminal');

  const inherited = parseGenericPropertyThemeRefsEnvelope(content, snapshot, textList(themeAuth.authenticated), policy);
  const stream = parseRetainedTokenStreamEnvelope(content, textList(streamAuth.authenticated), policy);
  const replay = parseGenericPropertyStyleThemeReplay(
    content, snapshot, replayAuth.authenticated, policy, inherited, stream,
  );
  const expected = normalizeGenericPropertyStyleThemeOracle(content, snapshot, policy, inherited, stream);
  const seal = fields.slice(cursor, cursor + RECORD_WIDTH);

  if (failureHeader) {
    if (
      header[1] === '' || uint(header[3], 'failure runtime') !== snapshot.runtimeInstance ||
      uint(header[4], 'failure epoch') !== snapshot.parseEpoch ||
      header[8] !== policy.genericPropertyThemeRefsFormat || header[9] !== policy.retainedTokenStreamFormat ||
      header[10] !== policy.genericPropertyStyleThemeReplayFormat || header.slice(11).some(Boolean)
    ) fail('record rejection', 'outer failure identity drift');
    if (
      seal[0] !== 'failure-seal' || seal[1] !== header[1] || seal[2] !== header[2] || seal[3] !== content ||
      seal[4] !== header[3] || seal[5] !== header[4] || seal[6] !== header[5] || seal[7] !== header[6] ||
      seal[8] !== header[7] || seal[9] !== header[8] || seal[10] !== header[9] || seal[11] !== header[10] ||
      seal.slice(12).some(Boolean)
    ) fail('record rejection', 'outer failure seal drift');
    const actual = { code: header[1], detail: header[2], status: 'failure' };
    assert.deepEqual(actual, expected);
    return actual;
  }

  if (replay.status === 'failure') fail('record rejection', 'outer decision contradicts replay failure');
  if (
    header[1] !== replay.state || uint(header[2], 'decision runtime') !== snapshot.runtimeInstance ||
    uint(header[3], 'decision epoch') !== snapshot.parseEpoch || header[7] !== policy.genericPropertyThemeRefsFormat ||
    header[8] !== policy.retainedTokenStreamFormat || header[9] !== policy.genericPropertyStyleThemeReplayFormat ||
    uint(header[10], 'outer style count') !== replay.transitions.filter(({ type }) => type === 'style').length ||
    (header[11] === 'none' ? null : uint(header[11], 'outer first style cursor')) !== replay.firstStyleCursor ||
    uint(header[12], 'bound max fields') !== policy.maxGenericPropertyStyleThemeEnvelopeFields ||
    uint(header[13], 'bound max bytes') !== policy.maxGenericPropertyStyleThemeEnvelopeBytes ||
    header[14] !== policy.styleBlockEvidenceFormat || header.slice(15).some(Boolean)
  ) fail('record rejection', 'outer decision identity drift');
  if (
    seal[0] !== 'seal' || seal[1] !== header[1] || seal[2] !== header[2] || seal[3] !== header[3] ||
    seal[4] !== header[4] || seal[5] !== header[5] || seal[6] !== header[6] || seal[7] !== content ||
    seal[8] !== header[7] || seal[9] !== header[8] || seal[10] !== header[9] || seal[11] !== header[10] ||
    seal[12] !== header[11] || seal[13] !== header[12] || seal[14] !== header[13] || seal[15] !== header[14] ||
    seal.slice(16).some(Boolean)
  ) fail('record rejection', 'outer terminal seal drift');
  assert.deepEqual(replay, expected);
  return replay;
}

export function executeGenericPropertyStyleThemeFields(content, snapshot, policy, kernSource) {
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
      policy.maxGenericPropertyStyleThemeProperties, policy.genericPropertyAdmissionFormat,
      policy.genericPropertyLoopFormat, policy.maxGenericPropertyStyleThemeThemeRefs,
      policy.genericPropertyThemeRefsFormat, policy.maxGenericPropertyStyleThemeStyleTokens,
      policy.maxGenericPropertyStyleThemeStyleBlockCodePoints,
      policy.maxGenericPropertyStyleThemeStyleBlockUtf16Units,
      policy.maxGenericPropertyStyleThemeStyleBlockBytes, policy.maxGenericPropertyStyleThemeStyleSegments,
      policy.maxGenericPropertyStyleThemeStylePairs, policy.maxGenericPropertyStyleThemeStyleWrites,
      policy.maxGenericPropertyStyleThemeStyleParenDepth,
      policy.maxGenericPropertyStyleThemeReplayEnvelopeFields,
      policy.maxGenericPropertyStyleThemeEnvelopeFields, policy.maxGenericPropertyStyleThemeEnvelopeBytes,
      policy.styleBlockEvidenceFormat, policy.genericPropertyStyleThemeReplayFormat,
      policy.genericPropertyStyleThemeFormat,
    ],
    identity: {
      handlerName: 'observegenericpropertystyletheme',
      sourcePath: 'examples/kern-frontend/generic-property-style-theme.kern',
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
  const props = Object.fromEntries(result.finalProperties.map((property) => [
    property.key, property.valueKind === 'expr' ? { __expr: true, code: property.value } : property.value,
  ]));
  if (result.finalStyles.length > 0) props.styles = Object.fromEntries(result.finalStyles.map(({ key, value }) => [key, value]));
  if (result.finalPseudoStyles.length > 0) props.pseudoStyles = Object.fromEntries(result.finalPseudoStyles.map(
    ({ entries, pseudo }) => [pseudo, Object.fromEntries(entries.map(({ key, value }) => [key, value]))],
  ));
  if (result.themeRefs.length > 0) props.themeRefs = result.themeRefs;
  assert.deepEqual(parseResult.root.props, props);
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

export function executeGenericPropertyStyleTheme(evidence, policy, kernSource) {
  const consumed = consumeMutableNodeTypeRegistryParseEvidence(evidence);
  const result = parseGenericPropertyStyleThemeEnvelope(
    consumed.source, consumed.snapshot,
    executeGenericPropertyStyleThemeFields(consumed.source, consumed.snapshot, policy, kernSource), policy,
  );
  assertBootstrapParity(result, consumed.parseResult);
  return result;
}

export function evaluateGenericPropertyStyleThemeFixture(fixture, policy, kernSource) {
  const runtime = new KernRuntime();
  const evidence = parseWithGenericPropertyStyleThemeSafety(fixture.source, runtime, {
    maxNameBytes: policy.maxNameBytes,
    maxNameCodePoints: policy.maxNameCodePoints,
    maxRegistryEntries: policy.maxRegistryEntries,
  });
  return executeGenericPropertyStyleTheme(evidence, policy, kernSource);
}

export function runKernFrontendGenericPropertyStyleThemeCheck() {
  const policy = loadFrontendGenericPropertyStyleThemePolicy();
  const source = loadGenericPropertyStyleThemeSource();
  for (const fixture of GENERIC_PROPERTY_STYLE_THEME_FIXTURES) {
    evaluateGenericPropertyStyleThemeFixture(fixture, policy, source);
  }
  return GENERIC_PROPERTY_STYLE_THEME_FIXTURES.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const count = runKernFrontendGenericPropertyStyleThemeCheck();
  console.log(`KERN frontend generic-property style/theme shadow passed (${count} fixtures).`);
}
