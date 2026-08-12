#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../packages/core/dist/runtime-handler.js';
import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithGenericPropertyLoopSafety,
} from '../packages/core/dist/mutable-node-type-registry-snapshot.js';
import {
  evolvedHintsArguments,
  serializeParserHintSnapshot,
} from './check-kern-frontend-evolved-hints.mjs';
import { parseComposedKeywordHandlerEnvelope } from './check-kern-frontend-keyword-handlers.mjs';
import {
  runtimeForSuccessfulLineFixture,
  SUCCESSFUL_LINE_FIXTURES,
} from './kern-frontend-successful-line-composition/fixtures.mjs';
import { loadFrontendSuccessfulLinePolicy } from './kern-frontend-successful-line-composition/policy.mjs';
import {
  loadSuccessfulLineSource,
  loadSuccessfulLineMemberSource,
  validateNativeSuccessfulLineSource,
} from './kern-frontend-successful-line-composition/source.mjs';
import { normalizeWhitespaceTrimOracle } from './kern-frontend-whitespace-trim/oracle.mjs';

const RECORD_WIDTH = 20;
const FAILURE_ENVELOPE_FIELDS = 1 + 2 * RECORD_WIDTH;
const UNSUPPORTED_LEADING_WHITESPACE = /[\t\v\f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/u;
const FAILURE_CODES = new Set([
  'SUCCESSFUL_LINE_CHILD_INVALID', 'SUCCESSFUL_LINE_ENVELOPE_LIMIT',
  'SUCCESSFUL_LINE_SOURCE_PROFILE', 'SUCCESSFUL_LINE_TRIM_INVALID',
]);

function fail(category, detail) {
  throw new Error(`${category}: ${detail}`);
}

function uint(value, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) fail('envelope rejection', `${label} must be a canonical uint`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail('envelope rejection', `${label} exceeds safe integer`);
  return parsed;
}

function textFields(value) {
  if (value.tag !== 'list') fail('runtime rejection', 'successful-line result must be a list');
  return value.value.map((entry, index) => {
    if (entry.tag !== 'text') fail('runtime rejection', `result field ${index} must be text`);
    return entry.value;
  });
}

function assertRawInputBounds(raw, policy) {
  if (typeof raw !== 'string') fail('source rejection', 'raw must be a string');
  if (raw.length === 0) fail('source rejection', 'raw must not be empty');
  if (/[\n\r\u2028\u2029]/u.test(raw)) fail('source rejection', 'raw must be one logical line');
  let codePoints = 0;
  for (const _scalar of raw) {
    codePoints += 1;
    if (codePoints > policy.profileLimits.maxCodePoints) {
      fail('source rejection', 'raw exceeds the code-point limit');
    }
  }
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (
    bytes > policy.profileLimits.maxSourceBytes ||
    bytes > policy.runtimeLimits.maxStringBytes
  ) fail('source rejection', 'raw exceeds the UTF-8 byte limit');
}

export function executeSuccessfulLineFields(raw, snapshot, policy, source) {
  const inherited = evolvedHintsArguments('', snapshot, policy, serializeParserHintSnapshot(snapshot)).slice(1);
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [
      raw,
      ...inherited,
      policy.keywordHandlerFormat,
      policy.maxKeywordHandlerWrites,
      policy.maxKeywordHandlerEnvelopeFields,
      policy.maxKeywordHandlerEnvelopeBytes,
      policy.keywordHandlerSourceProfile,
      policy.successfulLineFormat,
      policy.maxSuccessfulLineEnvelopeFields,
      policy.maxSuccessfulLineEnvelopeBytes,
      policy.successfulLineSourceProfile,
    ],
    identity: {
      handlerName: 'observesuccessfullinecomposition',
      sourcePath: 'examples/kern-frontend/successful-line-composition.kern',
    },
    source,
  }, { enabled: true, limits: policy.runtimeLimits });
  if (
    envelope.outcome !== 'success' || envelope.completion.kind !== 'return' ||
    envelope.events.length !== 0 || envelope.result.presence !== 'value'
  ) fail('runtime rejection', JSON.stringify(envelope.diagnostics));
  return textFields(envelope.result.value);
}

function structuralOracle(raw, policy) {
  if (/[\n\r\u2028\u2029]/u.test(raw)) fail('source rejection', 'logical line contains a line break');
  let indent = 0;
  while (raw[indent] === ' ') indent += 1;
  if (indent >= raw.length || UNSUPPORTED_LEADING_WHITESPACE.test(raw[indent])) {
    fail('source rejection', 'line is blank or uses unsupported indentation');
  }
  const lineBody = raw.slice(indent);
  const trimmed = normalizeWhitespaceTrimOracle(lineBody, policy);
  if ('status' in trimmed) fail('source rejection', `whitespace trim failed with ${trimmed.code}`);
  const retained = [...lineBody].slice(0, trimmed.trim.codeEndOffset).join('');
  const exportMatch = /^export\s+(fn\b[\s\S]*)$/u.exec(retained);
  const semanticContent = exportMatch ? exportMatch[1] : retained;
  const col = indent + 1;
  const parseCol = col + retained.length - semanticContent.length;
  return {
    col,
    endCol: col + retained.length,
    exported: exportMatch !== null,
    indent,
    lineBody,
    parseCol,
    rawLength: retained.length,
    retained,
    semanticContent,
  };
}

function collectChild(fields, cursor, fieldCount) {
  const child = [];
  let authIndex = 0;
  while (child.length < fieldCount) {
    const record = fields.slice(cursor, cursor + RECORD_WIDTH);
    const count = uint(record[3], 'child-auth count');
    if (
      record.length !== RECORD_WIDTH || record[0] !== 'child-auth' ||
      uint(record[1], 'child-auth index') !== authIndex ||
      uint(record[2], 'child-auth start') !== child.length || count <= 0 || count > 16 ||
      count > fieldCount - child.length || record.slice(4 + count).some(Boolean)
    ) fail('envelope rejection', 'child authentication drift');
    child.push(...record.slice(4, 4 + count));
    cursor += RECORD_WIDTH;
    authIndex += 1;
  }
  return { child, cursor };
}

function tokenizerDiagnostic(diagnostic, semanticContent, parseCol) {
  const utf16Start = [...semanticContent].slice(0, diagnostic.startScalar).join('').length;
  const col = parseCol + utf16Start;
  const contracts = {
    INVALID_BIGINT: {
      category: 'validator', endCol: col + 1,
      message: 'BigInt literal cannot have a fractional part',
      suggestion: 'Remove the `n` suffix or drop the fractional part — BigInt literals must be whole integers.',
    },
    UNCLOSED_EXPR: {
      category: 'parser', endCol: col + 2,
      message: `Unclosed expression block '{{' at column ${utf16Start + 1}`,
      suggestion: 'Close the `{{ ... }}` expression or move the unfinished code into a quoted string.',
    },
    UNCLOSED_STRING: {
      category: 'parser', endCol: col + 1,
      message: `Unclosed quoted string at column ${utf16Start + 1}`,
      suggestion: 'Add the missing closing quote or escape any embedded quotes inside the string.',
    },
    UNCLOSED_STYLE: {
      category: 'parser', endCol: col + 1,
      message: `Unclosed style block '{' at column ${utf16Start + 1}`,
      suggestion: 'Close the `{ ... }` style block with `}` and keep any commas inside the block.',
    },
  };
  const contract = contracts[diagnostic.code];
  if (!contract) fail('diagnostic rejection', `unknown tokenizer diagnostic ${diagnostic.code}`);
  return {
    category: contract.category,
    code: diagnostic.code,
    col,
    endCol: contract.endCol,
    line: 1,
    message: contract.message,
    severity: 'error',
    suggestion: contract.suggestion,
  };
}

function semanticDiagnostic(diagnostic, baseCol) {
  const offset = baseCol - 1;
  const col = diagnostic.col + offset;
  const message = diagnostic.code === 'UNEXPECTED_TOKEN'
    ? diagnostic.message.replace(/at line 1:[0-9]+$/u, `at line 1:${col}`)
    : diagnostic.message;
  return {
    category: diagnostic.category,
    code: diagnostic.code,
    col,
    endCol: diagnostic.endCol + offset,
    line: 1,
    message,
    severity: diagnostic.severity,
    suggestion: diagnostic.suggestion,
  };
}

function completeDiagnostics(child, structural) {
  if (
    child.hints === null || typeof child.hints !== 'object' ||
    child.hints.stream === null || typeof child.hints.stream !== 'object' ||
    !Array.isArray(child.hints.stream.diagnostics) ||
    child.hints.predecessor === null || typeof child.hints.predecessor !== 'object' ||
    typeof child.hints.predecessor.knownState !== 'string'
  ) fail('envelope rejection', 'authenticated child hint shape drift');
  const tokenizer = child.hints.stream.diagnostics.map((diagnostic) => (
    tokenizerDiagnostic(diagnostic, structural.semanticContent, structural.parseCol)
  ));
  const known = child.hints.predecessor.knownState === 'unknown' ? [{
    category: 'parser',
    code: 'UNKNOWN_NODE_TYPE',
    col: structural.parseCol,
    endCol: structural.parseCol + child.type.length,
    line: 1,
    message: `Unknown node type '${child.type}' at line 1`,
    severity: 'warning',
    suggestion: 'Rename this node to a supported KERN keyword or register it as an evolved node type.',
  }] : [];
  const exportOffset = structural.exported ? 'export '.length : 0;
  const isSeedDuplicate = (diagnostic) => child.seedDuplicates.some((duplicate) => (
    diagnostic.code === 'DUPLICATE_PROP' &&
    diagnostic.tokenIndex === duplicate.tokenIndex &&
    diagnostic.col === duplicate.startScalar + exportOffset + 1 &&
    diagnostic.endCol === duplicate.startScalar + duplicate.key.length + exportOffset + 1
  ));
  return [
    ...tokenizer,
    ...known,
    ...child.diagnostics.map((diagnostic) => semanticDiagnostic(
      diagnostic,
      isSeedDuplicate(diagnostic) ? structural.col : structural.parseCol,
    )),
  ];
}

function genericValue(property) {
  return property.valueKind === 'expr' ? { __expr: true, code: property.value } : property.value;
}

function lineProperties(child) {
  const props = {};
  if (child.exported) props.export = true;
  for (const write of child.hints.writes) props[write.name] = write.value;
  for (const write of child.writes) props[write.name] = write.value;
  for (const property of child.continuation.finalProperties) {
    props[property.key] = genericValue(property);
  }
  return props;
}

function lineRecord(child, structural) {
  const props = lineProperties(child);
  const styles = Object.fromEntries(child.continuation.finalStyles.map(({ key, value }) => [key, value]));
  const pseudoStyles = Object.fromEntries(child.continuation.finalPseudoStyles.map(({ entries, pseudo }) => [
    pseudo,
    Object.fromEntries(entries.map(({ key, value }) => [key, value])),
  ]));
  return {
    indent: structural.indent,
    rawLength: structural.rawLength,
    type: child.type,
    props,
    ...(child.quotedProps.length > 0 ? { quotedProps: child.quotedProps } : {}),
    styles,
    pseudoStyles,
    themeRefs: child.continuation.themeRefs,
    loc: { line: 1, col: structural.parseCol, endLine: 1, endCol: structural.endCol },
  };
}

function bootstrapProps(line) {
  const props = { ...line.props };
  if (line.type === 'fn') delete props.__firstClassSyntax;
  if (line.type === 'import' && props.__firstClassImport === true) {
    delete props.__firstClassImport;
    delete props.__firstClassBindings;
  }
  if (Object.keys(line.styles).length > 0) props.styles = line.styles;
  if (Object.keys(line.pseudoStyles).length > 0) props.pseudoStyles = line.pseudoStyles;
  if (line.themeRefs.length > 0) props.themeRefs = line.themeRefs;
  return props;
}

function assertBootstrapParity(line, diagnostics, parseResult) {
  assert.equal(parseResult.root.type, line.type, 'bootstrap node type drift');
  assert.deepEqual(parseResult.root.loc, line.loc, 'bootstrap location drift');
  assert.deepEqual(parseResult.root.props, bootstrapProps(line), 'bootstrap property drift');
  assert.deepEqual(parseResult.root.__quotedProps, line.quotedProps, 'bootstrap quoted-property presence drift');
  assert.deepEqual(parseResult.diagnostics, diagnostics, 'bootstrap diagnostic tape drift');
}

export function parseSuccessfulLineEnvelope(raw, snapshot, fields, policy = loadFrontendSuccessfulLinePolicy()) {
  if (
    fields[0] !== policy.successfulLineFormat || fields.length < 41 ||
    (fields.length - 1) % RECORD_WIDTH !== 0 || fields.length > policy.maxSuccessfulLineEnvelopeFields ||
    Buffer.byteLength(fields.join(''), 'utf8') > policy.maxSuccessfulLineEnvelopeBytes
  ) fail('envelope rejection', 'invalid successful-line envelope');
  if (fields[1] === 'failure') {
    if (
      fields.length !== FAILURE_ENVELOPE_FIELDS || !FAILURE_CODES.has(fields[2]) ||
      fields[3] !== '' || fields[4] !== raw ||
      uint(fields[5], 'failure runtime') !== snapshot.runtimeInstance ||
      uint(fields[6], 'failure epoch') !== snapshot.parseEpoch || fields.slice(7, 21).some(Boolean) ||
      fields[21] !== 'failure-seal' || fields[22] !== fields[2] || fields[23] !== '' ||
      fields[24] !== raw || fields[25] !== fields[5] || fields[26] !== fields[6] || fields.slice(27).some(Boolean)
    ) fail('envelope rejection', 'invalid successful-line failure');
    return { code: fields[2], detail: '', status: 'failure' };
  }
  const structural = structuralOracle(raw, policy);
  const childFieldCount = uint(fields[14], 'child field count');
  if (
    fields[1] !== 'decision' || fields[2] !== raw || fields[3] !== structural.lineBody ||
    fields[4] !== structural.retained || fields[5] !== structural.semanticContent ||
    fields[6] !== String(structural.exported) || uint(fields[7], 'indent') !== structural.indent ||
    uint(fields[8], 'raw length') !== structural.rawLength || uint(fields[9], 'column') !== structural.col ||
    uint(fields[10], 'parse column') !== structural.parseCol || uint(fields[11], 'end column') !== structural.endCol ||
    uint(fields[12], 'runtime') !== snapshot.runtimeInstance || uint(fields[13], 'epoch') !== snapshot.parseEpoch ||
    uint(fields[15], 'max fields') !== policy.maxSuccessfulLineEnvelopeFields ||
    uint(fields[16], 'max bytes') !== policy.maxSuccessfulLineEnvelopeBytes ||
    fields[17] !== policy.keywordHandlerFormat || fields[18] !== policy.keywordHandlerSourceProfile ||
    fields[19] !== policy.whitespaceTrimFormat || fields[20] !== policy.successfulLineSourceProfile
  ) fail('envelope rejection', 'successful-line header drift');
  const authenticated = collectChild(fields, 21, childFieldCount);
  if (authenticated.cursor !== fields.length - RECORD_WIDTH) fail('envelope rejection', 'seal must be terminal');
  const seal = fields.slice(authenticated.cursor);
  if (seal[0] !== 'seal' || seal.slice(1).some((field, index) => field !== fields[index + 2])) {
    fail('envelope rejection', 'successful-line seal drift');
  }
  const child = parseComposedKeywordHandlerEnvelope(
    structural.semanticContent,
    snapshot,
    authenticated.child,
    policy,
    structural.exported,
  );
  if (child.status === 'failure') fail('envelope rejection', 'decision authenticates a failed M4.170 child');
  return {
    child,
    diagnostics: completeDiagnostics(child, structural),
    exported: structural.exported,
    format: fields[0],
    line: lineRecord(child, structural),
    sourceProfile: policy.successfulLineSourceProfile,
    status: 'decision',
    structural,
  };
}

export function evaluateSuccessfulLineComposition(
  raw,
  runtime,
  policy = loadFrontendSuccessfulLinePolicy(),
  source = loadSuccessfulLineSource(),
) {
  const captured = captureSuccessfulLineEvidence(raw, runtime, policy, source);
  const result = parseSuccessfulLineEnvelope(raw, captured.snapshot, captured.envelopeFields, policy);
  if (result.status === 'decision') assertBootstrapParity(result.line, result.diagnostics, captured.parseResult);
  return { ...result, ...captured };
}

export function captureSuccessfulLineEvidence(
  raw,
  runtime,
  policy = loadFrontendSuccessfulLinePolicy(),
  source = loadSuccessfulLineSource(),
) {
  assertRawInputBounds(raw, policy);
  const evidence = parseWithGenericPropertyLoopSafety(raw, runtime, {
    maxNameBytes: policy.maxNameBytes,
    maxNameCodePoints: policy.maxNameCodePoints,
    maxRegistryEntries: policy.maxRegistryEntries,
  });
  const captured = consumeMutableNodeTypeRegistryParseEvidence(evidence);
  return {
    envelopeFields: executeSuccessfulLineFields(raw, captured.snapshot, policy, source),
    parseResult: captured.parseResult,
    snapshot: captured.snapshot,
  };
}

export { loadSuccessfulLineMemberSource, loadSuccessfulLineSource, validateNativeSuccessfulLineSource };

export function runKernFrontendSuccessfulLineCompositionCheck() {
  const policy = loadFrontendSuccessfulLinePolicy();
  const source = loadSuccessfulLineSource();
  for (const fixture of SUCCESSFUL_LINE_FIXTURES) {
    evaluateSuccessfulLineComposition(fixture.raw, runtimeForSuccessfulLineFixture(fixture), policy, source);
  }
  return SUCCESSFUL_LINE_FIXTURES.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`KERN frontend successful-line composition shadow: ${runKernFrontendSuccessfulLineCompositionCheck()} fixtures`);
}
