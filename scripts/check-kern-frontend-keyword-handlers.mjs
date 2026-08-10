#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../packages/core/dist/runtime-handler.js';
import {
  evolvedHintsArguments,
  loadEvolvedHintsSource,
  serializeParserHintSnapshot,
} from './check-kern-frontend-evolved-hints.mjs';
import { parseRetainedTokenStreamEnvelope } from './check-kern-frontend-retained-token-stream.mjs';
import { parseGenericPropertyStyleThemeDiagnosticsEnvelope } from './kern-frontend-generic-property-style-theme-diagnostics/envelope.mjs';
import { parseEvolvedHintsEnvelope } from './kern-frontend-evolved-hints/envelope.mjs';
import {
  KEYWORD_HANDLER_EDGE_FIXTURES,
  KEYWORD_HANDLER_FALLBACK_FIXTURES,
  KEYWORD_HANDLER_FIXTURES,
  KEYWORD_HANDLER_NUMERIC_FIXTURES,
} from './kern-frontend-keyword-handlers/fixtures.mjs';
import { loadFrontendKeywordHandlerPolicy } from './kern-frontend-keyword-handlers/policy.mjs';
import {
  assertKeywordHandlerBootstrapParity,
  assertKeywordHandlerCompositionOracle,
  normalizeKeywordHandlerCompositionOracle,
} from './kern-frontend-keyword-handlers/composition-oracle.mjs';
import {
  loadKeywordHandlerMemberSource,
  validateNativeKeywordHandlerSource,
} from './kern-frontend-keyword-handlers/source.mjs';
import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithGenericPropertyLoopSafety,
} from '../packages/core/dist/mutable-node-type-registry-snapshot.js';

const HEADER_FIELDS = 12;
const WRITE_FIELDS = 8;
const SEAL_FIELDS = 12;

function fail(category, detail) {
  throw new Error(`${category}: ${detail}`);
}

function uint(value, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) fail('envelope rejection', `${label} must be a canonical uint`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail('envelope rejection', `${label} exceeds safe integer`);
  return parsed;
}

export { loadKeywordHandlerMemberSource, validateNativeKeywordHandlerSource };

export function loadKeywordHandlerSource() {
  return `${loadEvolvedHintsSource()}\n\n${loadKeywordHandlerMemberSource()}`;
}

function textFields(value) {
  if (value.tag !== 'list') fail('runtime rejection', 'handler result must be a list');
  return value.value.map((entry, index) => {
    if (entry.tag !== 'text') fail('runtime rejection', `result field ${index} must be text`);
    return entry.value;
  });
}

function executeFields(content, policy, source) {
  const limits = policy.profileLimits;
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [
      content, '', 0, limits.maxCodePoints, limits.maxTokens, limits.maxDiagnostics, policy.maxStreamRecords,
      policy.maxLexicalDepth, policy.keywordHandlerFormat, policy.retainedTokenStreamFormat,
      policy.maxKeywordHandlerWrites, policy.maxKeywordHandlerEnvelopeFields,
      policy.maxKeywordHandlerEnvelopeBytes,
    ],
    identity: {
      handlerName: 'observekeywordhandlers',
      sourcePath: 'examples/kern-frontend/keyword-handlers-simple.kern',
    },
    source,
  }, { enabled: true, limits: policy.runtimeLimits });
  if (
    envelope.outcome !== 'success' || envelope.completion.kind !== 'return' || envelope.events.length !== 0 ||
    envelope.result.presence !== 'value'
  ) fail('runtime rejection', JSON.stringify(envelope.diagnostics));
  return textFields(envelope.result.value);
}

export function executeComposedFields(content, snapshot, policy, source, exported = false) {
  const args = evolvedHintsArguments(content, snapshot, policy, serializeParserHintSnapshot(snapshot));
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [
      ...args,
      policy.keywordHandlerFormat,
      policy.maxKeywordHandlerWrites,
      policy.maxKeywordHandlerEnvelopeFields,
      policy.maxKeywordHandlerEnvelopeBytes,
      policy.keywordHandlerSourceProfile,
      exported,
    ],
    identity: {
      handlerName: 'observekeywordhandlerscomposed',
      sourcePath: 'examples/kern-frontend/keyword-handlers-composed.kern',
    },
    source,
  }, { enabled: true, limits: policy.runtimeLimits });
  if (
    envelope.outcome !== 'success' || envelope.completion.kind !== 'return' || envelope.events.length !== 0 ||
    envelope.result.presence !== 'value'
  ) fail('runtime rejection', JSON.stringify(envelope.diagnostics));
  return textFields(envelope.result.value);
}

function framedDecoder(value, kind) {
  let cursor = 0;
  const uintField = (label) => {
    const colon = value.indexOf(':', cursor);
    if (colon === -1) fail('envelope rejection', `${kind} ${label} is unterminated`);
    const parsed = uint(value.slice(cursor, colon), `${kind} ${label}`);
    cursor = colon + 1;
    return parsed;
  };
  const count = uintField('count');
  const field = (label) => {
    const length = uintField(`${label} length`);
    const end = cursor + length;
    if (end > value.length) fail('envelope rejection', `${kind} ${label} exceeds payload`);
    const decoded = value.slice(cursor, end);
    cursor = end;
    return decoded;
  };
  const flag = (label) => {
    const decoded = value[cursor++];
    if (decoded !== '0' && decoded !== '1') fail('envelope rejection', `${kind} ${label} is invalid`);
    return decoded === '1';
  };
  const finish = () => {
    if (cursor !== value.length) fail('envelope rejection', `${kind} payload has trailing data`);
  };
  return { count, field, finish, flag };
}

function bindingsValue(value) {
  const decoder = framedDecoder(value, 'bindings-v1');
  const bindings = [];
  for (let index = 0; index < decoder.count; index += 1) {
    const name = decoder.field(`name ${index}`);
    const hasAlias = decoder.flag(`alias ${index}`);
    bindings.push({ name, ...(hasAlias ? { as: decoder.field(`alias ${index}`) } : {}) });
  }
  decoder.finish();
  return bindings;
}

function paramItemsValue(value) {
  const decoder = framedDecoder(value, 'params-items-v1');
  const items = [];
  for (let index = 0; index < decoder.count; index += 1) {
    const name = decoder.field(`name ${index}`);
    const type = decoder.field(`type ${index}`);
    const hasDefault = decoder.flag(`default ${index}`);
    items.push({ name, type, ...(hasDefault ? { default: decoder.field(`default ${index}`) } : {}) });
  }
  decoder.finish();
  return items;
}

function typedValue(kind, value) {
  if (kind === 'text') return value;
  if (kind === 'boolean') {
    if (value !== 'true' && value !== 'false') fail('envelope rejection', 'boolean write is not canonical');
    return value === 'true';
  }
  if (kind === 'number') return Number(value);
  if (kind === 'number-nan' && value === 'NaN') return Number.NaN;
  if (kind === 'number-token') return Number.parseInt(value, 10);
  if (kind === 'middleware-list') return value.split(',').map((name) => name.trim()).filter(Boolean);
  if (kind === 'bindings-v1') return bindingsValue(value);
  if (kind === 'params-items-v1') return paramItemsValue(value);
  if (kind === 'bindings') {
    return value.split('|').filter(Boolean).map((binding) => {
      const [name, as] = binding.split('>');
      return as === undefined ? { name } : { name, as };
    });
  }
  if (kind === 'params-items') {
    return value.split('|').filter(Boolean).map((item) => {
      const colon = item.indexOf(':');
      const equals = item.indexOf('=', colon + 1);
      return {
        name: item.slice(0, colon),
        type: item.slice(colon + 1, equals === -1 ? undefined : equals),
        ...(equals === -1 ? {} : { default: item.slice(equals + 1) }),
      };
    });
  }
  fail('envelope rejection', `unknown write kind ${kind}`);
}

export function parseKeywordHandlerEnvelope(content, fields, policy) {
  if (fields.length < HEADER_FIELDS + SEAL_FIELDS || fields[0] !== policy.keywordHandlerFormat) {
    fail('envelope rejection', 'invalid keyword-handler envelope');
  }
  const writeCount = uint(fields[5], 'write count');
  const expectedLength = HEADER_FIELDS + writeCount * WRITE_FIELDS + SEAL_FIELDS;
  if (fields.length !== expectedLength || fields.length > policy.maxKeywordHandlerEnvelopeFields) {
    fail('envelope rejection', 'keyword-handler field count drift');
  }
  if (
    fields[1] !== 'decision' || fields[6] !== content || fields[7] !== policy.retainedTokenStreamFormat ||
    uint(fields[8], 'max writes') !== policy.maxKeywordHandlerWrites ||
    uint(fields[9], 'max fields') !== policy.maxKeywordHandlerEnvelopeFields ||
    uint(fields[10], 'max bytes') !== policy.maxKeywordHandlerEnvelopeBytes || fields[11] !== ''
  ) fail('envelope rejection', 'keyword-handler header drift');
  const writes = [];
  const handlerProps = {};
  let cursor = HEADER_FIELDS;
  for (let index = 0; index < writeCount; index += 1) {
    const record = fields.slice(cursor, cursor + WRITE_FIELDS);
    if (record[0] !== 'write' || uint(record[1], 'write index') !== index || record[7] !== '') {
      fail('envelope rejection', 'keyword-handler write drift');
    }
    const write = {
      endScalar: uint(record[6], 'write end'),
      kind: record[3],
      name: record[2],
      startScalar: uint(record[5], 'write start'),
      value: typedValue(record[3], record[4]),
    };
    if (write.endScalar < write.startScalar) fail('envelope rejection', 'write span is reversed');
    writes.push(write);
    handlerProps[write.name] = write.value;
    cursor += WRITE_FIELDS;
  }
  const seal = fields.slice(cursor);
  if (
    seal[0] !== 'seal' || seal[1] !== fields[2] || seal[2] !== fields[3] || seal[3] !== fields[4] ||
    seal[4] !== fields[5] || seal[5] !== content || seal[6] !== fields[7] || seal[7] !== fields[8] ||
    seal[8] !== fields[9] || seal[9] !== fields[10] || seal[10] !== fields[0] || seal[11] !== ''
  ) fail('envelope rejection', 'keyword-handler seal drift');
  return {
    finalCursor: uint(fields[4], 'final cursor'),
    format: fields[0],
    handlerProps,
    initialCursor: uint(fields[3], 'initial cursor'),
    status: 'decision',
    type: fields[2],
    writes,
  };
}

function collectAuth(fields, cursor, fieldCount, tag) {
  const authenticated = [];
  let authIndex = 0;
  while (authenticated.length < fieldCount) {
    const record = fields.slice(cursor, cursor + 20);
    const count = uint(record[3], `${tag} count`);
    if (
      record.length !== 20 || record[0] !== tag || uint(record[1], `${tag} index`) !== authIndex ||
      uint(record[2], `${tag} start`) !== authenticated.length || count <= 0 || count > 16 ||
      count > fieldCount - authenticated.length || record.slice(4 + count).some(Boolean)
    ) fail('envelope rejection', `${tag} authentication drift`);
    authenticated.push(...record.slice(4, 4 + count));
    cursor += 20;
    authIndex += 1;
  }
  return { authenticated, cursor };
}

function genericValue(property) {
  return property.valueKind === 'expr' ? { __expr: true, code: property.value } : property.value;
}

function applyComposedProperties(exported, hints, local, continuation) {
  const props = {};
  if (exported) props.export = true;
  for (const write of hints.writes) props[write.name] = write.value;
  for (const write of local.writes) props[write.name] = write.value;
  for (const property of continuation.finalProperties) props[property.key] = genericValue(property);
  if (continuation.finalStyles.length > 0) {
    props.styles = Object.fromEntries(continuation.finalStyles.map(({ key, value }) => [key, value]));
  }
  if (continuation.finalPseudoStyles.length > 0) {
    props.pseudoStyles = Object.fromEntries(continuation.finalPseudoStyles.map(
      ({ entries, pseudo }) => [pseudo, Object.fromEntries(entries.map(({ key, value }) => [key, value]))],
    ));
  }
  if (continuation.themeRefs.length > 0) props.themeRefs = continuation.themeRefs;
  return props;
}

function mergedComposedDiagnostics(seedDuplicates, continuation, exported) {
  const columnOffset = exported ? 'export '.length : 0;
  const seeded = seedDuplicates.map((duplicate) => ({
    category: 'parser',
    code: 'DUPLICATE_PROP',
    col: duplicate.startScalar + columnOffset + 1,
    endCol: duplicate.startScalar + duplicate.key.length + columnOffset + 1,
    endLine: 1,
    line: 1,
    message: `Duplicate property '${duplicate.key}' at line 1`,
    severity: 'warning',
    suggestion: 'Remove the duplicate property or merge the values into a single prop assignment.',
    tokenIndex: duplicate.tokenIndex,
  }));
  return [...continuation.diagnostics, ...seeded]
    .sort((left, right) => left.tokenIndex - right.tokenIndex)
    .map((diagnostic, index) => ({ ...diagnostic, index }));
}

export function parseComposedKeywordHandlerEnvelope(
  content,
  snapshot,
  fields,
  policy,
  exported = false,
) {
  if (
    fields[0] !== policy.keywordHandlerFormat || fields.length < 41 || (fields.length - 1) % 20 !== 0 ||
    fields.length > policy.maxKeywordHandlerEnvelopeFields ||
    Buffer.byteLength(fields.join(''), 'utf8') > policy.maxKeywordHandlerEnvelopeBytes
  ) fail('envelope rejection', 'invalid composed keyword-handler envelope');
  if (fields[1] === 'failure') {
    if (fields.length !== 41 || fields[21] !== 'failure-seal') {
      fail('envelope rejection', 'invalid bounded keyword-handler failure');
    }
    const codes = [
      'KEYWORD_HANDLER_BYTES_LIMIT', 'KEYWORD_HANDLER_CONTINUATION_INVALID', 'KEYWORD_HANDLER_DUPLICATE_LIMIT',
      'KEYWORD_HANDLER_FIELDS_LIMIT', 'KEYWORD_HANDLER_HINTS_INVALID', 'KEYWORD_HANDLER_INVALID_LIMITS',
      'KEYWORD_HANDLER_LOCAL_INVALID', 'KEYWORD_HANDLER_MASK_INVALID', 'KEYWORD_HANDLER_STREAM_INVALID',
    ];
    if (
      !codes.includes(fields[2]) || fields[3] !== '' || fields[2] !== fields[22] || fields[3] !== fields[23] ||
      fields[24] !== content || fields[4] !== fields[25] || fields[5] !== fields[26] ||
      uint(fields[4], 'failure runtime') !== snapshot.runtimeInstance ||
      uint(fields[5], 'failure epoch') !== snapshot.parseEpoch || fields.slice(6, 21).some(Boolean) ||
      fields.slice(27).some(Boolean)
    ) fail('envelope rejection', 'keyword-handler failure seal drift');
    return { code: fields[2], detail: '', format: fields[0], status: 'failure' };
  }
  const header = fields.slice(1, 21);
  const duplicateCount = uint(header[12], 'seed duplicate count');
  const hintsFieldCount = uint(header[8], 'hints field count');
  const localFieldCount = uint(header[9], 'local field count');
  const maskedStreamFieldCount = uint(header[10], 'masked stream field count');
  const continuationFieldCount = uint(header[11], 'continuation field count');
  if (
    header[0] !== 'decision' || header[1] !== content ||
    uint(header[13], 'runtime instance') !== snapshot.runtimeInstance ||
    uint(header[14], 'parse epoch') !== snapshot.parseEpoch ||
    uint(header[15], 'max fields') !== policy.maxKeywordHandlerEnvelopeFields ||
    uint(header[16], 'max bytes') !== policy.maxKeywordHandlerEnvelopeBytes ||
    header[17] !== policy.evolvedHintsFormat ||
    header[18] !== policy.genericPropertyStyleThemeDiagnosticsFormat ||
    header[19] !== policy.keywordHandlerSourceProfile
  ) fail('envelope rejection', 'composed keyword-handler header drift');
  let cursor = 21;
  const seedDuplicates = [];
  for (let index = 0; index < duplicateCount; index += 1) {
    const record = fields.slice(cursor, cursor + 20);
    if (
      record[0] !== 'seed-duplicate' || uint(record[1], 'seed duplicate index') !== index ||
      record[2] === '' || record.slice(5).some(Boolean)
    ) fail('envelope rejection', 'seed duplicate record drift');
    seedDuplicates.push({
      index,
      key: record[2],
      tokenIndex: uint(record[3], 'seed duplicate token'),
      startScalar: uint(record[4], 'seed duplicate start'),
    });
    cursor += 20;
  }
  const hintsAuth = collectAuth(fields, cursor, hintsFieldCount, 'hints-auth');
  cursor = hintsAuth.cursor;
  const localAuth = collectAuth(fields, cursor, localFieldCount, 'local-auth');
  cursor = localAuth.cursor;
  const maskedStreamAuth = collectAuth(fields, cursor, maskedStreamFieldCount, 'masked-stream-auth');
  cursor = maskedStreamAuth.cursor;
  const continuationAuth = collectAuth(fields, cursor, continuationFieldCount, 'continuation-auth');
  cursor = continuationAuth.cursor;
  if (cursor !== fields.length - 20) fail('envelope rejection', 'composed seal must be terminal');
  const seal = fields.slice(cursor);
  if (
    seal[0] !== 'seal' || seal[1] !== header[1] || seal[2] !== header[2] || seal[3] !== header[3] ||
    seal[4] !== header[4] || seal[5] !== header[5] || seal[6] !== header[6] || seal[7] !== header[7] ||
    seal[8] !== header[8] || seal[9] !== header[9] || seal[10] !== header[10] || seal[11] !== header[11] ||
    seal[12] !== header[12] || seal[13] !== header[13] || seal[14] !== header[14] ||
    seal[15] !== header[15] || seal[16] !== header[16] || seal[17] !== header[17] ||
    seal[18] !== header[18] || seal[19] !== header[19]
  ) fail('envelope rejection', 'composed keyword-handler seal drift');

  const hints = parseEvolvedHintsEnvelope(content, snapshot, hintsAuth.authenticated, policy);
  if (hints.status === 'failure') fail('envelope rejection', 'decision authenticates failed hints');
  const local = parseKeywordHandlerEnvelope(content, localAuth.authenticated, policy);
  const maskedStream = parseRetainedTokenStreamEnvelope(
    header[3],
    { tag: 'list', value: maskedStreamAuth.authenticated.map((value) => ({ tag: 'text', value })) },
    policy,
  );
  const continuation = parseGenericPropertyStyleThemeDiagnosticsEnvelope(
    header[3], snapshot, continuationAuth.authenticated, policy, maskedStreamAuth.authenticated, maskedStream,
  );
  if (continuation.status === 'failure') fail('envelope rejection', 'decision authenticates failed continuation');
  if (
    header[2] !== hints.maskedContent || header[4] !== hints.admittedType ||
    uint(header[5], 'initial cursor') !== local.initialCursor ||
    uint(header[6], 'final cursor') !== local.finalCursor ||
    uint(header[7], 'local write count') !== local.writes.length || local.type !== hints.admittedType
  ) fail('envelope rejection', 'composed decision drift');
  const result = {
    ...local,
    continuation,
    diagnostics: mergedComposedDiagnostics(seedDuplicates, continuation, exported),
    exported,
    finalProps: applyComposedProperties(exported, hints, local, continuation),
    format: fields[0],
    hintMaskedContent: header[2],
    hints,
    maskedContent: header[3],
    maskedStream,
    quotedProps: continuation.quotedProperties.map(({ key }) => key),
    seedDuplicates,
    status: 'decision',
  };
  assertKeywordHandlerCompositionOracle(
    result, normalizeKeywordHandlerCompositionOracle(content, hints, maskedStream, exported),
  );
  return result;
}

function cursorDecision(local) {
  if (local.writes.length === 0 && local.finalCursor === local.initialCursor) return 'rewind';
  if (local.writes.length === 1) return 'commit-one';
  if (local.writes.length === 2) return 'commit-two';
  return local.finalCursor > local.initialCursor ? 'commit-all' : 'noop';
}

export function evaluateLocalKeywordHandler(
  content,
  policy = loadFrontendKeywordHandlerPolicy(),
  source = loadKeywordHandlerSource(),
) {
  const local = parseKeywordHandlerEnvelope(content, executeFields(content, policy, source), policy);
  return { ...local, cursorDecision: cursorDecision(local) };
}

export function evaluateKeywordHandlers(
  content,
  runtime,
  policy = loadFrontendKeywordHandlerPolicy(),
  source = loadKeywordHandlerSource(),
  options = {},
) {
  const exported = options.exported === true;
  const physicalSource = exported ? `export ${content}` : content;
  const evidence = parseWithGenericPropertyLoopSafety(physicalSource, runtime, {
    maxNameBytes: policy.maxNameBytes,
    maxNameCodePoints: policy.maxNameCodePoints,
    maxRegistryEntries: policy.maxRegistryEntries,
  });
  const captured = consumeMutableNodeTypeRegistryParseEvidence(evidence);
  const result = parseComposedKeywordHandlerEnvelope(
    content,
    captured.snapshot,
    executeComposedFields(content, captured.snapshot, policy, source, exported),
    policy,
    exported,
  );
  const bootstrapParity = assertKeywordHandlerBootstrapParity(result, captured.parseResult);
  return {
    ...result,
    bootstrapParity,
    bootstrapParseResult: captured.parseResult,
    cursorDecision: result.status === 'decision' ? cursorDecision(result) : 'failure',
  };
}

export function runKernFrontendKeywordHandlersCheck() {
  const policy = loadFrontendKeywordHandlerPolicy();
  const source = loadKeywordHandlerSource();
  const fixtures = [
    ...KEYWORD_HANDLER_FIXTURES,
    ...KEYWORD_HANDLER_FALLBACK_FIXTURES,
    ...KEYWORD_HANDLER_EDGE_FIXTURES,
    ...KEYWORD_HANDLER_NUMERIC_FIXTURES,
  ];
  for (const fixture of fixtures) evaluateLocalKeywordHandler(fixture.source, policy, source);
  return fixtures.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`KERN frontend keyword-handler shadow: ${runKernFrontendKeywordHandlersCheck()} fixtures`);
}
