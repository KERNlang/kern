#!/usr/bin/env node
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../packages/core/dist/runtime-handler.js';
import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithGenericPropertyStyleThemeDiagnosticsSafety,
} from '../packages/core/dist/mutable-node-type-registry-snapshot.js';
import { KernRuntime } from '../packages/core/dist/runtime-state.js';
import { loadGenericPropertyStyleThemeDiagnosticsSource } from './check-kern-frontend-generic-property-style-theme-diagnostics.mjs';
import { EVOLVED_HINT_FIXTURES } from './kern-frontend-evolved-hints/fixtures.mjs';
import { parseEvolvedHintsEnvelope } from './kern-frontend-evolved-hints/envelope.mjs';
import { loadFrontendEvolvedHintsPolicy } from './kern-frontend-evolved-hints/policy.mjs';

const MEMBER_URLS = [
  new URL('../examples/kern-frontend/evolved-hints-helpers.kern', import.meta.url),
  new URL('../examples/kern-frontend/evolved-hints.kern', import.meta.url),
];
const EXPECTED_FUNCTIONS = [
  'validevolvedhintname', 'evolvedhintspaces', 'maskevolvedhinttokens', 'evolvedhintfailure', 'observeevolvedhints',
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

function occurrenceCount(source, needle) {
  return source.split(needle).length - 1;
}

export function validateNativeEvolvedHintsSource(source) {
  const declarations = [...source.matchAll(/^fn name=([^\t ]+)([^\r\n]*)$/gmu)];
  const names = declarations.map((match) => match[1]);
  if (
    names.length !== EXPECTED_FUNCTIONS.length || names.some((name, index) => name !== EXPECTED_FUNCTIONS[index]) ||
    declarations.some((match, index) => (
      index === declarations.length - 1 ? !/\bexport=true\b/u.test(match[2]) : /\bexport=true\b/u.test(match[2])
    ))
  ) fail('composition rejection', 'M4.169 function surface must match the closed native allowlist');
  for (const forbidden of [
    'TokenStream', 'parseProp', 'parseStyleBlock', 'parseWithDiagnostics', 'parseDocument', 'tokenizeLineInternal',
    'normalizeEvolvedHintsOracle', 'Map(', 'Set(', 'Object.', 'crypto', 'digest', 'hmac', 'capability',
  ]) if (source.includes(forbidden)) fail('delegation rejection', `M4.169 member contains ${forbidden}`);
  if (occurrenceCount(source, 'observegenericpropertystylethemediagnostics(') !== 1) {
    fail('composition rejection', 'M4.169 must invoke M4.168 exactly once');
  }
  if (occurrenceCount(source, 'observeretainedtokenstream(') !== 2) {
    fail('composition rejection', 'M4.169 must invoke original and masked retained streams exactly once each');
  }
  const handlers = [...source.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length !== declarations.length || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'all M4.169 handlers must be native KERN');
  }
  return source;
}

export function loadEvolvedHintsMemberSource() {
  const members = MEMBER_URLS.map(readRegularSource);
  return validateNativeEvolvedHintsSource(members.join('\n\n'));
}

export function loadEvolvedHintsSource() {
  return [loadGenericPropertyStyleThemeDiagnosticsSource(), loadEvolvedHintsMemberSource()].join('\n\n');
}

function textFields(value) {
  if (value.tag !== 'list') fail('runtime rejection', 'handler result must be a list');
  return value.value.map((entry, index) => {
    if (entry.tag !== 'text') fail('runtime rejection', `result field ${index} must be text`);
    return entry.value;
  });
}

function executeHandler(source, args, policy) {
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: args,
    identity: { handlerName: 'observeevolvedhints', sourcePath: 'examples/kern-frontend/evolved-hints.kern' },
    source,
  }, { enabled: true, limits: policy.runtimeLimits });
  if (
    envelope.outcome !== 'success' || envelope.completion.kind !== 'return' || envelope.events.length !== 0 ||
    envelope.result.presence !== 'value'
  ) fail('runtime rejection', JSON.stringify(envelope.diagnostics));
  return textFields(envelope.result.value);
}

export function serializeParserHintSnapshot(snapshot) {
  return {
    bareWords: snapshot.parserHints.map((entry) => entry.bareWord ?? ''),
    positionalNames: snapshot.parserHints.flatMap((entry) => entry.positionalArgs),
    positionalOwners: snapshot.parserHints.flatMap((entry) => entry.positionalArgs.map(() => entry.type)),
    types: snapshot.parserHints.map((entry) => entry.type),
  };
}

export function evolvedHintsArguments(
  content,
  snapshot,
  policy,
  serializedHints = serializeParserHintSnapshot(snapshot),
) {
  const limits = policy.profileLimits;
  return [
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
    serializedHints.types, serializedHints.bareWords, serializedHints.positionalOwners, serializedHints.positionalNames,
    policy.maxEvolvedHintWrites, policy.maxEvolvedHintsEnvelopeFields, policy.maxEvolvedHintsEnvelopeBytes,
    policy.evolvedHintsFormat, policy.evolvedHintsSourceProfile,
  ];
}

export function executeEvolvedHintsFields(
  content,
  snapshot,
  policy,
  source = loadEvolvedHintsSource(),
  serializedHints = serializeParserHintSnapshot(snapshot),
) {
  return executeHandler(source, evolvedHintsArguments(content, snapshot, policy, serializedHints), policy);
}

export function runtimeForEvolvedHintFixture(fixture) {
  const runtime = new KernRuntime();
  if (fixture.type !== 'class') runtime.registerEvolvedType(fixture.type);
  if (fixture.hints !== undefined) runtime.registerParserHints(fixture.type, fixture.hints);
  return runtime;
}

export function captureEvolvedHintsEvidence(content, runtime, policy, source = loadEvolvedHintsSource()) {
  const evidence = parseWithGenericPropertyStyleThemeDiagnosticsSafety(content, runtime, {
    maxNameBytes: policy.maxNameBytes,
    maxNameCodePoints: policy.maxNameCodePoints,
    maxRegistryEntries: policy.maxRegistryEntries,
  });
  const consumed = consumeMutableNodeTypeRegistryParseEvidence(evidence);
  const fields = executeEvolvedHintsFields(content, consumed.snapshot, policy, source);
  return { consumed, fields };
}

export function evaluateEvolvedHints(content, runtime, policy, source = loadEvolvedHintsSource()) {
  const { consumed, fields } = captureEvolvedHintsEvidence(content, runtime, policy, source);
  return parseEvolvedHintsEnvelope(content, consumed.snapshot, fields, policy);
}

export function runKernFrontendEvolvedHintsCheck() {
  const policy = loadFrontendEvolvedHintsPolicy();
  const source = loadEvolvedHintsSource();
  for (const fixture of EVOLVED_HINT_FIXTURES) {
    evaluateEvolvedHints(fixture.source, runtimeForEvolvedHintFixture(fixture), policy, source);
  }
  return EVOLVED_HINT_FIXTURES.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`KERN frontend evolved-hints shadow: ${runKernFrontendEvolvedHintsCheck()} fixtures`);
}
