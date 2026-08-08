#!/usr/bin/env node
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../packages/core/dist/runtime-handler.js';
import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithGenericPropertyStyleThemeDiagnosticsSafety,
} from '../packages/core/dist/mutable-node-type-registry-snapshot.js';
import { KernRuntime } from '../packages/core/dist/runtime-state.js';
import {
  executeGenericPropertyStyleThemeFields,
  loadGenericPropertyStyleThemeSource,
} from './check-kern-frontend-generic-property-style-theme.mjs';
import {
  loadRetainedTokenStreamSource,
  parseRetainedTokenStreamEnvelope,
} from './check-kern-frontend-retained-token-stream.mjs';
import { GENERIC_PROPERTY_STYLE_THEME_DIAGNOSTIC_FIXTURES } from './kern-frontend-generic-property-style-theme-diagnostics/fixtures.mjs';
import { parseGenericPropertyStyleThemeDiagnosticsEnvelope } from './kern-frontend-generic-property-style-theme-diagnostics/envelope.mjs';
import { loadFrontendGenericPropertyStyleThemeDiagnosticsPolicy } from './kern-frontend-generic-property-style-theme-diagnostics/policy.mjs';
import { parseGenericPropertyStyleThemeDiagnosticProjection } from './kern-frontend-generic-property-style-theme-diagnostics/projection.mjs';
import { parseGenericPropertyStyleThemeDiagnosticRecovery } from './kern-frontend-generic-property-style-theme-diagnostics/recovery.mjs';

const MEMBER_URLS = [
  new URL('../examples/kern-frontend/generic-property-style-theme-diagnostic-predecessor.kern', import.meta.url),
  new URL('../examples/kern-frontend/generic-property-style-theme-diagnostic-projection.kern', import.meta.url),
  new URL('../examples/kern-frontend/generic-property-style-theme-diagnostics.kern', import.meta.url),
];
const EXPECTED_DIAGNOSTIC_FUNCTIONS = [
  'stylethemediagnosticrecoveryfailure', 'recovergenericpropertystylethemediagnosticpredecessor',
  'stylethemediagnosticprojectionfailure', 'projectgenericpropertystylethemediagnostics',
  'stylethemediagnosticsfailure', 'observegenericpropertystylethemediagnostics',
];

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

function executeHandler(handlerName, sourcePath, source, args, policy) {
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: args,
    identity: { handlerName, sourcePath },
    source,
  }, { enabled: true, limits: policy.runtimeLimits });
  if (
    envelope.outcome !== 'success' || envelope.completion.kind !== 'return' ||
    envelope.events.length !== 0 || envelope.result.presence !== 'value'
  ) fail('runtime rejection', JSON.stringify(envelope.diagnostics));
  return textFields(envelope.result.value);
}

export function validateNativeGenericPropertyStyleThemeDiagnosticsSource(source) {
  const declarations = [...source.matchAll(/^fn name=([^\t ]+)([^\r\n]*)$/gmu)];
  const functionNames = declarations.map((match) => match[1]);
  if (
    functionNames.length !== EXPECTED_DIAGNOSTIC_FUNCTIONS.length ||
    functionNames.some((name, index) => name !== EXPECTED_DIAGNOSTIC_FUNCTIONS[index]) ||
    declarations.some((match, index) => (
      index === declarations.length - 1 ? !/\bexport=true\b/u.test(match[2]) : /\bexport=true\b/u.test(match[2])
    ))
  ) fail('composition rejection', 'M4.168 function surface must match the closed native allowlist');
  for (const forbidden of [
    'TokenStream', 'parseProp', 'parseStyleBlock', 'parseWithDiagnostics', 'parseDocument',
    'tokenizeLineInternal', 'normalizeGenericPropertyStyleThemeOracle', 'Map(', 'Set(', 'Object.',
    'crypto', 'digest', 'hmac', 'capability',
  ]) if (source.includes(forbidden)) fail('delegation rejection', `M4.168 member contains ${forbidden}`);
  for (const [needle, label] of [
    ['let name=predecessor value="observegenericpropertystyletheme(', 'M4.167 predecessor'],
    ['let name=recovery value="recovergenericpropertystylethemediagnosticpredecessor(', 'recovery'],
    ['let name=projection value="projectgenericpropertystylethemediagnostics(', 'projection'],
    ['let name=replay value="replaygenericpropertystyletheme(', 'derived replay'],
  ]) {
    if ((source.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu')) ?? []).length !== 1) {
      fail('composition rejection', `M4.168 must invoke ${label} exactly once`);
    }
  }
  const handlers = [...source.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length !== declarations.length || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'all M4.168 handlers must be native KERN');
  }
  return source;
}

export function loadGenericPropertyStyleThemeDiagnosticsSource() {
  const members = MEMBER_URLS.map(readRegularSource);
  validateNativeGenericPropertyStyleThemeDiagnosticsSource(members.join('\n\n'));
  return [loadGenericPropertyStyleThemeSource(), ...members].join('\n\n');
}

export function executeRetainedTokenStreamFields(content, policy) {
  const limits = policy.profileLimits;
  return executeHandler(
    'observeretainedtokenstream',
    'examples/kern-frontend/retained-token-stream.kern',
    loadRetainedTokenStreamSource(),
    [content, limits.maxCodePoints, limits.maxTokens, limits.maxDiagnostics, policy.maxStreamRecords, policy.maxLexicalDepth],
    policy,
  );
}

export function executeGenericPropertyStyleThemeDiagnosticProjectionFields(
  content,
  snapshot,
  policy,
  source = loadGenericPropertyStyleThemeDiagnosticsSource(),
  streamFields = executeRetainedTokenStreamFields(content, policy),
) {
  return executeHandler(
    'projectgenericpropertystylethemediagnostics',
    'examples/kern-frontend/generic-property-style-theme-diagnostic-projection.kern',
    source,
    [
      content, streamFields, snapshot.runtimeInstance, snapshot.parseEpoch,
      policy.maxGenericPropertyStyleThemeUnexpectedDiagnostics,
      policy.maxGenericPropertyStyleThemeDiagnosticProjectionFields,
      policy.maxGenericPropertyStyleThemeDiagnosticsEnvelopeBytes,
      policy.retainedTokenStreamFormat,
      policy.genericPropertyStyleThemeDiagnosticProjectionFormat,
    ],
    policy,
  );
}

export function executeGenericPropertyStyleThemeDiagnosticRecoveryFields(
  content,
  snapshot,
  policy,
  source = loadGenericPropertyStyleThemeDiagnosticsSource(),
  predecessorFields = executeGenericPropertyStyleThemeFields(
    content, snapshot, policy, loadGenericPropertyStyleThemeSource(),
  ).value.map((entry) => entry.value),
) {
  return executeHandler(
    'recovergenericpropertystylethemediagnosticpredecessor',
    'examples/kern-frontend/generic-property-style-theme-diagnostic-predecessor.kern',
    source,
    [
      content, predecessorFields, snapshot.runtimeInstance, snapshot.parseEpoch,
      policy.maxGenericPropertyStyleThemeEnvelopeFields,
      policy.maxGenericPropertyStyleThemeDiagnosticRecoveryFields,
      policy.maxGenericPropertyStyleThemeDiagnosticsEnvelopeBytes,
      policy.genericPropertyStyleThemeFormat, policy.genericPropertyThemeRefsFormat,
      policy.retainedTokenStreamFormat, policy.genericPropertyStyleThemeReplayFormat,
      policy.genericPropertyStyleThemeDiagnosticRecoveryFormat,
    ],
    policy,
  );
}

export function executeGenericPropertyStyleThemeDiagnosticsFields(content, snapshot, policy, source) {
  const limits = policy.profileLimits;
  return executeHandler(
    'observegenericpropertystylethemediagnostics',
    'examples/kern-frontend/generic-property-style-theme-diagnostics.kern',
    source,
    [
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
      policy.genericPropertyStyleThemeFormat, policy.maxGenericPropertyStyleThemeUnexpectedDiagnostics,
      policy.maxGenericPropertyStyleThemeDiagnosticProjectionFields,
      policy.maxGenericPropertyStyleThemeDiagnosticRecoveryFields,
      policy.maxGenericPropertyStyleThemeDiagnosticsEnvelopeFields,
      policy.maxGenericPropertyStyleThemeDiagnosticsEnvelopeBytes,
      policy.genericPropertyStyleThemeDiagnosticProjectionFormat,
      policy.genericPropertyStyleThemeDiagnosticRecoveryFormat,
      policy.genericPropertyStyleThemeDiagnosticsFormat,
    ],
    policy,
  );
}

export function evaluateGenericPropertyStyleThemeDiagnosticProjection(content, policy, source) {
  const runtime = new KernRuntime();
  const evidence = parseWithGenericPropertyStyleThemeDiagnosticsSafety(content, runtime, {
    maxNameBytes: policy.maxNameBytes,
    maxNameCodePoints: policy.maxNameCodePoints,
    maxRegistryEntries: policy.maxRegistryEntries,
  });
  const consumed = consumeMutableNodeTypeRegistryParseEvidence(evidence);
  const streamFields = executeRetainedTokenStreamFields(content, policy);
  const stream = parseRetainedTokenStreamEnvelope(content, textList(streamFields), policy);
  const fields = executeGenericPropertyStyleThemeDiagnosticProjectionFields(
    content, consumed.snapshot, policy, source, streamFields,
  );
  return parseGenericPropertyStyleThemeDiagnosticProjection(
    content, consumed.snapshot, fields, policy, streamFields, stream,
  );
}

export function evaluateGenericPropertyStyleThemeDiagnosticRecovery(content, policy, source) {
  const runtime = new KernRuntime();
  const evidence = parseWithGenericPropertyStyleThemeDiagnosticsSafety(content, runtime, {
    maxNameBytes: policy.maxNameBytes,
    maxNameCodePoints: policy.maxNameCodePoints,
    maxRegistryEntries: policy.maxRegistryEntries,
  });
  const consumed = consumeMutableNodeTypeRegistryParseEvidence(evidence);
  const streamFields = executeRetainedTokenStreamFields(content, policy);
  const predecessorValue = executeGenericPropertyStyleThemeFields(
    content, consumed.snapshot, policy, loadGenericPropertyStyleThemeSource(),
  );
  const predecessorFields = predecessorValue.value.map((entry) => entry.value);
  const fields = executeGenericPropertyStyleThemeDiagnosticRecoveryFields(
    content, consumed.snapshot, policy, source, predecessorFields,
  );
  return parseGenericPropertyStyleThemeDiagnosticRecovery(
    content, consumed.snapshot, fields, policy, predecessorFields, streamFields,
  );
}

export function captureGenericPropertyStyleThemeDiagnosticsEvidence(content, policy, source) {
  const runtime = new KernRuntime();
  const evidence = parseWithGenericPropertyStyleThemeDiagnosticsSafety(content, runtime, {
    maxNameBytes: policy.maxNameBytes,
    maxNameCodePoints: policy.maxNameCodePoints,
    maxRegistryEntries: policy.maxRegistryEntries,
  });
  const consumed = consumeMutableNodeTypeRegistryParseEvidence(evidence);
  const streamFields = executeRetainedTokenStreamFields(content, policy);
  const stream = parseRetainedTokenStreamEnvelope(content, textList(streamFields), policy);
  const fields = executeGenericPropertyStyleThemeDiagnosticsFields(content, consumed.snapshot, policy, source);
  return { fields, snapshot: consumed.snapshot, stream, streamFields };
}

export function evaluateGenericPropertyStyleThemeDiagnostics(content, policy, source) {
  const evidence = captureGenericPropertyStyleThemeDiagnosticsEvidence(content, policy, source);
  return parseGenericPropertyStyleThemeDiagnosticsEnvelope(
    content, evidence.snapshot, evidence.fields, policy, evidence.streamFields, evidence.stream,
  );
}

export function runKernFrontendGenericPropertyStyleThemeDiagnosticsCheck() {
  const policy = loadFrontendGenericPropertyStyleThemeDiagnosticsPolicy();
  const source = loadGenericPropertyStyleThemeDiagnosticsSource();
  for (const fixture of GENERIC_PROPERTY_STYLE_THEME_DIAGNOSTIC_FIXTURES) {
    evaluateGenericPropertyStyleThemeDiagnostics(fixture.source, policy, source);
  }
  return GENERIC_PROPERTY_STYLE_THEME_DIAGNOSTIC_FIXTURES.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const count = runKernFrontendGenericPropertyStyleThemeDiagnosticsCheck();
  console.log(`KERN frontend generic-property style/theme diagnostic projection: ${count} fixtures`);
}
