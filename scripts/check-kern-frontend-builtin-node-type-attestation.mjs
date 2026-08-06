#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../packages/core/dist/runtime-handler.js';
import {
  loadNodeTypeTokenAdmissionSource,
  parseNodeTypeTokenAdmissionEnvelope,
} from './check-kern-frontend-node-type-token-admission.mjs';
import { BUILTIN_ATTESTATION_FIXTURES } from './kern-frontend-builtin-node-type-attestation/fixtures.mjs';
import { loadBuiltinNodeCatalog } from './kern-frontend-builtin-node-type-attestation/catalog.mjs';
import { normalizeBuiltinNodeTypeAttestationOracle } from './kern-frontend-builtin-node-type-attestation/oracle.mjs';
import { loadFrontendBuiltinNodeTypeAttestationPolicy } from './kern-frontend-builtin-node-type-attestation/policy.mjs';

const GENERATED_URL = new URL('../examples/kern-frontend/builtin-node-types.generated.kern', import.meta.url);
const SOURCE_URL = new URL('../examples/kern-frontend/builtin-node-type-attestation.kern', import.meta.url);
const RECORD_WIDTH = 16;
const FAILURE_CODES = new Set([
  'ADMISSION_INVALID', 'ATTESTATION_INVALID', 'CODE_POINTS_LIMIT', 'DIAGNOSTIC_LIMIT', 'EMPTY_RETAINED_CODE',
  'INVALID_LIMITS', 'LEXICAL_DEPTH_LIMIT', 'RECORD_LIMIT', 'STREAM_INVALID', 'TOKEN_LIMIT', 'TRIM_INVALID',
  'UNSUPPORTED_UNKNOWN',
]);

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

export function validateNativeBuiltinNodeTypeAttestationSource(source) {
  const memberStart = source.lastIndexOf('fn name=attestationfailure');
  if (memberStart < 0) fail('composition rejection', 'M4.161 member is missing');
  const member = source.slice(memberStart);
  for (const forbidden of [
    'NODE_TYPES', 'isKnownNodeType', 'KernRuntime', 'dynamicNodeTypes', 'multilineBlockTypes', 'templateRegistry',
    'UNKNOWN_NODE_TYPE', 'parseDocument', 'normalizeBuiltinNodeTypeAttestationOracle', 'capability',
  ]) {
    if (member.includes(forbidden)) fail('delegation rejection', `KERN source contains ${forbidden}`);
  }
  const handlers = [...source.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length === 0 || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'every source handler must be native KERN');
  }
  for (const [name, expected] of [
    ['observenodetypetokenadmission', 1], ['builtinnodetypes', 1], ['observebuiltinnodetypeattestation', 1],
  ]) {
    if ((source.match(new RegExp(`fn name=${name}\\b`, 'gu')) ?? []).length !== expected) {
      fail('composition rejection', `source must contain exactly one ${name}`);
    }
  }
  if (!source.includes('observenodetypetokenadmission(content, maxCodePoints,')) {
    fail('composition rejection', 'built-in attestation must compose M4.160');
  }
  if (!source.includes('let name=catalog value="builtinnodetypes()"')) {
    fail('composition rejection', 'built-in attestation must use the generated native catalog');
  }
  return source;
}

export function loadBuiltinNodeTypeAttestationSource() {
  return validateNativeBuiltinNodeTypeAttestationSource([
    loadNodeTypeTokenAdmissionSource(), readRegularSource(GENERATED_URL), readRegularSource(SOURCE_URL),
  ].join('\n\n'));
}

function wellFormedUtf16(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
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

export function parseBuiltinNodeTypeAttestationEnvelope(
  content,
  value,
  policy = loadFrontendBuiltinNodeTypeAttestationPolicy(),
) {
  const fields = textFields(value);
  if (fields[0] !== policy.builtinNodeTypeAttestationFormat || (fields.length - 1) % RECORD_WIDTH !== 0) {
    fail('record rejection', 'invalid built-in attestation envelope');
  }
  const expected = normalizeBuiltinNodeTypeAttestationOracle(content, policy);
  if (fields[1] === 'failure') {
    if (
      fields.length !== RECORD_WIDTH + 1 || !FAILURE_CODES.has(fields[2]) || fields[3] !== '' ||
      fields.slice(4).some(Boolean)
    ) fail('record rejection', 'invalid failure envelope');
    const actual = failure(fields[2], fields[3]);
    if (expected.status !== 'failure' || actual.code !== expected.code || actual.detail !== expected.detail) {
      fail('record rejection', 'failure envelope drift');
    }
    return actual;
  }
  if (expected.status === 'failure') fail('record rejection', 'success contradicts oracle failure');
  const decision = fields.slice(1, 1 + RECORD_WIDTH);
  if (
    decision[0] !== 'decision' || !['admitted', 'dropped'].includes(decision[1]) ||
    !['builtin', 'none', 'unresolved'].includes(decision[3]) || decision[7] !== content ||
    decision[8] !== policy.nodeTypeTokenAdmissionFormat || decision[9] !== policy.retainedTokenStreamFormat ||
    decision[15] !== ''
  ) fail('record rejection', 'invalid decision record');
  const actualDecision = {
    admittedType: decision[2],
    attestation: decision[3],
    catalogCount: uint(decision[5], 'catalog count'),
    catalogIndex: optionalUint(decision[4], 'catalog index'),
    cursorAfter: uint(decision[12], 'cursor after'),
    diagnosticCount: uint(decision[13], 'diagnostic count'),
    errorCount: uint(decision[14], 'error count'),
    inheritedFieldCount: uint(decision[6], 'inherited field count'),
    retainedSource: decision[10],
    status: decision[1],
    tokenCount: uint(decision[11], 'token count'),
  };
  let cursor = 1 + RECORD_WIDTH;
  const inheritedFields = [];
  let authIndex = 0;
  while (inheritedFields.length < actualDecision.inheritedFieldCount) {
    const record = fields.slice(cursor, cursor + RECORD_WIDTH);
    const count = uint(record[3], 'admission-auth count');
    if (
      record[0] !== 'admission-auth' || uint(record[1], 'admission-auth index') !== authIndex ||
      uint(record[2], 'admission-auth start') !== inheritedFields.length || count <= 0 || count > 12 ||
      count > actualDecision.inheritedFieldCount - inheritedFields.length || record.slice(4 + count).some(Boolean)
    ) fail('record rejection', 'invalid admission-auth record');
    inheritedFields.push(...record.slice(4, 4 + count));
    cursor += RECORD_WIDTH;
    authIndex += 1;
  }
  const inherited = parseNodeTypeTokenAdmissionEnvelope(content, textList(inheritedFields), policy);
  if ('status' in inherited) fail('record rejection', 'success contains inherited failure');
  const seal = fields.slice(cursor, cursor + RECORD_WIDTH);
  if (cursor !== fields.length - RECORD_WIDTH || seal[0] !== 'seal' || seal[15] !== '') {
    fail('record rejection', 'seal must be exact and terminal');
  }
  const sealIdentity = {
    admittedType: seal[4], attestation: seal[2], catalogCount: uint(seal[5], 'seal catalog count'),
    catalogIndex: optionalUint(seal[3], 'seal catalog index'), content: seal[7],
    cursorAfter: uint(seal[14], 'seal cursor after'), inheritedFieldCount: uint(seal[6], 'seal inherited count'),
    nodeTypeTokenAdmissionFormat: seal[10], retainedByteLength: uint(seal[9], 'seal retained byte length'),
    retainedSource: seal[12], retainedTokenStreamFormat: seal[11],
    retainedScalarLength: uint(seal[8], 'seal retained scalar length'), status: seal[1],
    tokenCount: uint(seal[13], 'seal token count'),
  };
  const catalog = policy.builtinNodeCatalog;
  const expectedIndex = inherited.decision.status === 'admitted'
    ? catalog.indexOf(inherited.decision.admittedType) : -1;
  const expectedAttestation = inherited.decision.status === 'dropped'
    ? 'none' : expectedIndex === -1 ? 'unresolved' : 'builtin';
  if (
    actualDecision.status !== inherited.decision.status || actualDecision.admittedType !== inherited.decision.admittedType ||
    actualDecision.attestation !== expectedAttestation || actualDecision.catalogCount !== catalog.length ||
    actualDecision.catalogIndex !== (expectedIndex === -1 ? null : expectedIndex) ||
    actualDecision.retainedSource !== inherited.decision.retainedSource ||
    actualDecision.tokenCount !== inherited.decision.tokenCount || actualDecision.cursorAfter !== inherited.decision.cursorAfter ||
    actualDecision.diagnosticCount !== (inherited.decision.status === 'dropped' ? 1 : 0) ||
    actualDecision.errorCount !== (inherited.decision.status === 'dropped' ? 1 : 0) ||
    actualDecision.inheritedFieldCount !== inheritedFields.length ||
    sealIdentity.status !== actualDecision.status || sealIdentity.attestation !== actualDecision.attestation ||
    sealIdentity.catalogIndex !== actualDecision.catalogIndex || sealIdentity.admittedType !== actualDecision.admittedType ||
    sealIdentity.catalogCount !== actualDecision.catalogCount || sealIdentity.inheritedFieldCount !== inheritedFields.length ||
    sealIdentity.content !== content || sealIdentity.retainedSource !== inherited.decision.retainedSource ||
    sealIdentity.retainedScalarLength !== [...inherited.decision.retainedSource].length ||
    sealIdentity.retainedByteLength !== Buffer.byteLength(inherited.decision.retainedSource, 'utf8') ||
    sealIdentity.nodeTypeTokenAdmissionFormat !== policy.nodeTypeTokenAdmissionFormat ||
    sealIdentity.retainedTokenStreamFormat !== policy.retainedTokenStreamFormat ||
    sealIdentity.tokenCount !== inherited.decision.tokenCount || sealIdentity.cursorAfter !== inherited.decision.cursorAfter
  ) fail('record rejection', 'attestation identity or semantics drift');
  const actual = {
    admittedType: actualDecision.admittedType,
    attestation: actualDecision.attestation,
    catalogCount: actualDecision.catalogCount,
    catalogFormat: policy.builtinNodeCatalogFormat,
    catalogIndex: actualDecision.catalogIndex,
    format: policy.builtinNodeTypeAttestationFormat,
    inherited,
    sourceProfile: policy.builtinNodeTypeAttestationSourceProfile,
    status: actualDecision.status,
  };
  assert.deepEqual(actual, expected);
  return actual;
}

function executeHandler(content, policy, kernSource) {
  const limits = policy.profileLimits;
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [content, limits.maxCodePoints, limits.maxTokens, limits.maxDiagnostics, policy.maxStreamRecords,
      policy.maxLexicalDepth, policy.maxCatalogEntries],
    identity: { handlerName: 'observebuiltinnodetypeattestation', sourcePath: 'examples/kern-frontend/builtin-node-type-attestation.kern' },
    source: kernSource,
  }, { enabled: true, limits: policy.runtimeLimits });
  if (Buffer.byteLength(`${JSON.stringify(envelope)}\n`, 'utf8') > limits.maxOutputJsonBytes) {
    fail('runtime rejection', 'OUTPUT_JSON_BYTES_LIMIT');
  }
  if (
    envelope.outcome !== 'success' || envelope.completion.kind !== 'return' || envelope.events.length !== 0 ||
    envelope.result.presence !== 'value'
  ) fail('runtime rejection', JSON.stringify(envelope.diagnostics));
  return envelope.result.value;
}

export function executeNativeBuiltinNodeTypeAttestationFields(content, policy, kernSource) {
  return textFields(executeHandler(content, policy, kernSource));
}

export function executeFrontendBuiltinNodeTypeAttestation(
  content,
  policy = loadFrontendBuiltinNodeTypeAttestationPolicy(),
  kernSource = loadBuiltinNodeTypeAttestationSource(),
) {
  if (!wellFormedUtf16(content)) return failure('MALFORMED_UTF16');
  if (Buffer.byteLength(content, 'utf8') > policy.profileLimits.maxSourceBytes) return failure('SOURCE_BYTES_LIMIT');
  if ([...content].length > policy.profileLimits.maxCodePoints) return failure('CODE_POINTS_LIMIT');
  if (content.includes('\n') || content.includes('\r')) return failure('UNSUPPORTED_LINE_ENDING');
  return parseBuiltinNodeTypeAttestationEnvelope(content, executeHandler(content, policy, kernSource), policy);
}

export function runKernFrontendBuiltinNodeTypeAttestationCheck() {
  const policy = loadFrontendBuiltinNodeTypeAttestationPolicy();
  const source = loadBuiltinNodeTypeAttestationSource();
  const catalog = loadBuiltinNodeCatalog();
  for (const fixture of BUILTIN_ATTESTATION_FIXTURES) {
    assert.deepEqual(
      executeFrontendBuiltinNodeTypeAttestation(fixture.source, policy, source),
      normalizeBuiltinNodeTypeAttestationOracle(fixture.source, policy),
      fixture.id,
    );
  }
  for (const [index, type] of catalog.entries()) {
    const result = executeFrontendBuiltinNodeTypeAttestation(type, policy, source);
    assert.equal(result.attestation, 'builtin', type);
    assert.equal(result.catalogIndex, index, type);
  }
  return { catalog: catalog.length, differential: BUILTIN_ATTESTATION_FIXTURES.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  const counts = runKernFrontendBuiltinNodeTypeAttestationCheck();
  console.log(`KERN frontend built-in node-type attestation: ${counts.catalog} catalog and ${counts.differential} differential cases passed.`);
}
