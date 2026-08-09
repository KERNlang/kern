import assert from 'node:assert/strict';

const RECORD_WIDTH = 20;

function fail(detail) {
  throw new Error(`style/theme diagnostic projection rejection: ${detail}`);
}

function uint(field, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(field)) fail(`${label} must be a canonical uint`);
  const value = Number(field);
  if (!Number.isSafeInteger(value)) fail(`${label} exceeds safe integer`);
  return value;
}

function emptyTail(record, start, label) {
  if (record.slice(start).some(Boolean)) fail(`${label} padding drift`);
}

function classifyUnexpectedTokens(tokens, maximum) {
  let startUtf16 = 0;
  const positionedTokens = tokens.map((token) => {
    startUtf16 += token.startDelta?.length ?? 0;
    return { ...token, startUtf16: token.startUtf16 ?? startUtf16 };
  });
  const diagnostics = [];
  let phase = 'handoff';
  let equalsIndex = -1;
  let reachableStyleCount = 0;
  for (let tokenIndex = 1; tokenIndex < positionedTokens.length; tokenIndex += 1) {
    const token = positionedTokens[tokenIndex];
    if (tokenIndex === equalsIndex) {
      equalsIndex = -1;
      continue;
    }
    if (phase === 'handoff') {
      if (['whitespace', 'style', 'themeRef'].includes(token.kind)) {
        if (token.kind === 'style') reachableStyleCount += 1;
        continue;
      }
      if (token.kind === 'identifier' && positionedTokens[tokenIndex + 1]?.kind === 'equals') {
        equalsIndex = tokenIndex + 1;
        phase = 'value';
        continue;
      }
      if (diagnostics.length >= maximum) return { code: 'STYLE_DIAGNOSTIC_LIMIT', status: 'failure' };
      const col = 1 + token.startUtf16;
      diagnostics.push({
        category: 'parser', code: 'UNEXPECTED_TOKEN', col,
        endCol: col + token.value.length, index: diagnostics.length, line: 1,
        message: `Unexpected token "${token.value}" at line 1:${col}`,
        severity: 'warning',
        suggestion: 'Remove the stray token or quote it so the parser can treat it as a value.',
        tokenIndex, tokenKind: token.kind, tokenStart: token.startUtf16, value: token.value,
      });
      continue;
    }
    if (phase === 'value') {
      if (['whitespace', 'style', 'themeRef'].includes(token.kind)) {
        phase = 'handoff';
        if (token.kind === 'style') reachableStyleCount += 1;
      }
      else if (['quoted', 'expr'].includes(token.kind)) phase = 'handoff';
      else phase = 'bare';
      continue;
    }
    if (phase === 'bare' && ['whitespace', 'style', 'themeRef'].includes(token.kind)) {
      phase = 'handoff';
      if (token.kind === 'style') reachableStyleCount += 1;
    }
  }
  return { diagnostics, reachableStyleCount, status: 'decision' };
}

function tokenKindFieldIndexes(streamFields) {
  const indexes = new Map();
  let tokenIndex = 0;
  for (let start = 1; start < streamFields.length; start += 10) {
    if (streamFields[start] === 'token') {
      indexes.set(tokenIndex, start + 2);
      tokenIndex += 1;
    }
  }
  return indexes;
}

function parseFailure(content, fields, policy) {
  if (fields.length !== 41 || fields[1] !== 'failure' || fields[21] !== 'failure-seal') {
    fail('invalid bounded failure envelope');
  }
  if (
    fields[2] !== fields[22] || fields[3] !== fields[23] || fields[24] !== content ||
    fields[4] !== fields[25] || fields[5] !== fields[26] || fields.slice(6, 21).some(Boolean) ||
    fields.slice(27).some(Boolean)
  ) fail('failure seal drift');
  return { code: fields[2], detail: fields[3], format: policy.genericPropertyStyleThemeDiagnosticProjectionFormat, status: 'failure' };
}

export function parseGenericPropertyStyleThemeDiagnosticProjection(
  content,
  snapshot,
  fields,
  policy,
  originalStreamFields,
  originalStream,
) {
  if (
    fields[0] !== policy.genericPropertyStyleThemeDiagnosticProjectionFormat ||
    fields.length < 41 || (fields.length - 1) % RECORD_WIDTH !== 0 ||
    fields.length > policy.maxGenericPropertyStyleThemeDiagnosticProjectionFields ||
    Buffer.byteLength(fields.join(''), 'utf8') > policy.maxGenericPropertyStyleThemeDiagnosticsEnvelopeBytes
  ) fail('invalid projection envelope');
  if (fields[1] === 'failure') return parseFailure(content, fields, policy);
  const header = fields.slice(1, 21);
  if (header[0] !== 'decision') fail('invalid decision tag');
  const unexpectedCount = uint(header[1], 'unexpected count');
  const originalFieldCount = uint(header[2], 'original stream fields');
  const derivedFieldCount = uint(header[3], 'derived stream fields');
  if (
    uint(header[4], 'runtime instance') !== snapshot.runtimeInstance ||
    uint(header[5], 'parse epoch') !== snapshot.parseEpoch ||
    uint(header[6], 'bound diagnostics') !== policy.maxGenericPropertyStyleThemeUnexpectedDiagnostics ||
    uint(header[7], 'bound projection fields') !== policy.maxGenericPropertyStyleThemeDiagnosticProjectionFields ||
    uint(header[8], 'bound bytes') !== policy.maxGenericPropertyStyleThemeDiagnosticsEnvelopeBytes ||
    header[9] !== policy.retainedTokenStreamFormat ||
    header[10] !== policy.genericPropertyStyleThemeDiagnosticProjectionFormat ||
    header.slice(12).some(Boolean) || originalFieldCount !== originalStreamFields.length ||
    derivedFieldCount !== originalFieldCount
  ) fail('projection header drift');

  const diagnostics = [];
  let cursor = 21;
  for (let index = 0; index < unexpectedCount; index += 1) {
    const record = fields.slice(cursor, cursor + RECORD_WIDTH);
    if (record.length !== RECORD_WIDTH || record[0] !== 'unexpected-token' || uint(record[1], 'diagnostic index') !== index) {
      fail('diagnostic record order drift');
    }
    emptyTail(record, 13, 'diagnostic record');
    diagnostics.push({
      category: record[12], code: record[8], col: uint(record[6], 'diagnostic col'),
      endCol: uint(record[7], 'diagnostic end col'), index, line: 1, message: record[10],
      severity: record[9], suggestion: record[11], tokenIndex: uint(record[2], 'diagnostic token index'),
      tokenKind: record[3], tokenStart: uint(record[5], 'diagnostic token start'), value: record[4],
    });
    cursor += RECORD_WIDTH;
  }

  const derivedFields = [];
  let authIndex = 0;
  while (derivedFields.length < derivedFieldCount) {
    const record = fields.slice(cursor, cursor + RECORD_WIDTH);
    const count = uint(record[3], 'derived auth count');
    if (
      record.length !== RECORD_WIDTH || record[0] !== 'derived-auth' ||
      uint(record[1], 'derived auth index') !== authIndex ||
      uint(record[2], 'derived auth start') !== derivedFields.length || count <= 0 || count > 16 ||
      count > derivedFieldCount - derivedFields.length || record.slice(4 + count).some(Boolean)
    ) fail('derived authentication drift');
    derivedFields.push(...record.slice(4, 4 + count));
    authIndex += 1;
    cursor += RECORD_WIDTH;
  }
  if (cursor !== fields.length - RECORD_WIDTH) fail('projection seal must be terminal');
  const seal = fields.slice(cursor);
  if (
    seal[0] !== 'seal' || uint(seal[1], 'seal unexpected count') !== unexpectedCount ||
    uint(seal[2], 'seal original fields') !== originalFieldCount ||
    uint(seal[3], 'seal derived fields') !== derivedFieldCount || seal[4] !== content ||
    uint(seal[5], 'seal runtime') !== snapshot.runtimeInstance || uint(seal[6], 'seal epoch') !== snapshot.parseEpoch ||
    seal[7] !== header[6] || seal[8] !== header[7] || seal[9] !== header[8] ||
    seal[10] !== header[9] || seal[11] !== header[10] || seal[12] !== header[11] || seal.slice(13).some(Boolean)
  ) fail('projection seal drift');

  const expected = classifyUnexpectedTokens(originalStream.tokens, policy.maxGenericPropertyStyleThemeUnexpectedDiagnostics);
  if (expected.status === 'failure') fail('decision contradicts independent diagnostic limit');
  assert.deepEqual(diagnostics, expected.diagnostics);
  if (uint(header[11], 'reachable style count') !== expected.reachableStyleCount) fail('reachable style count drift');
  const expectedDerived = [...originalStreamFields];
  const kindIndexes = tokenKindFieldIndexes(originalStreamFields);
  for (const diagnostic of diagnostics) {
    const kindIndex = kindIndexes.get(diagnostic.tokenIndex);
    if (kindIndex === undefined) fail('diagnostic token is absent from original stream');
    expectedDerived[kindIndex] = 'whitespace';
  }
  assert.deepEqual(derivedFields, expectedDerived);
  return {
    derivedFields, diagnostics, format: fields[0],
    reachableStyleCount: uint(header[11], 'reachable style count'), status: 'decision',
  };
}

export { classifyUnexpectedTokens };
