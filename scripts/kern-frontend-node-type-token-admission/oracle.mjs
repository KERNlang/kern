import { normalizeRetainedTokenStreamOracle } from '../kern-frontend-retained-token-stream/oracle.mjs';

const SUGGESTION = 'Rewrite this line so it starts with a valid KERN node type and move stray symbols into props.';

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

function retainedStreamFields(stream) {
  const boundary = stream.boundary;
  const fields = [
    stream.format,
    'stream',
    '0',
    boundary.content,
    String(boundary.codeEndOffset),
    String(boundary.triviaEndOffset),
    boundary.markerOffset === null ? 'none' : String(boundary.markerOffset),
    boundary.markerKind,
    boundary.markerText,
    boundary.rawPayload,
    String(boundary.retainedLength),
  ];
  for (const token of stream.tokens) {
    fields.push(
      'token', String(token.index), token.kind, token.value, token.startDelta,
      String(token.startScalar), String(token.startByte), '', '', '',
    );
  }
  for (const diagnostic of stream.diagnostics) {
    fields.push(
      'diagnostic', String(diagnostic.index), diagnostic.code, diagnostic.startDelta, diagnostic.span,
      String(diagnostic.startScalar), String(diagnostic.endScalar),
      String(diagnostic.startByte), String(diagnostic.endByte), '',
    );
  }
  fields.push(
    'seal', String(stream.seal.tokenCount), String(stream.seal.diagnosticCount),
    stream.seal.tokenTail, stream.seal.diagnosticTail,
    String(stream.seal.retainedScalarLength), String(stream.seal.retainedByteLength),
    stream.seal.content, String(boundary.codeEndOffset), String(boundary.triviaEndOffset),
  );
  return fields;
}

export function normalizeInheritedRetainedStreamFields(content, policy) {
  const stream = normalizeRetainedTokenStreamOracle(content, policy);
  if (
    'status' in stream || stream.tokens.length > policy.profileLimits.maxTokens ||
    stream.diagnostics.length > policy.profileLimits.maxDiagnostics ||
    stream.tokens.length + stream.diagnostics.length > policy.maxStreamRecords
  ) return null;
  return retainedStreamFields(stream);
}

export function normalizeNodeTypeTokenAdmissionOracle(content, policy) {
  const stream = normalizeRetainedTokenStreamOracle(content, policy);
  if ('status' in stream) return failure(stream.code, stream.detail);
  if (stream.tokens.length > policy.profileLimits.maxTokens) return failure('TOKEN_LIMIT');
  if (stream.diagnostics.length > policy.profileLimits.maxDiagnostics) return failure('DIAGNOSTIC_LIMIT');
  if (stream.tokens.length + stream.diagnostics.length > policy.maxStreamRecords) return failure('RECORD_LIMIT');
  const retainedSource = [...content].slice(0, stream.boundary.codeEndOffset).join('');
  const tokenZero = stream.tokens[0];
  const admitted = tokenZero.kind === 'identifier';
  const firstNonWhitespace = stream.tokens.find((token) => token.kind !== 'whitespace');
  const firstNonWhitespaceIndex = firstNonWhitespace?.index ?? null;
  const cursorAfter = admitted ? 1 : 0;
  const admittedType = admitted ? tokenZero.value : '';
  const inheritedStreamFieldCount = retainedStreamFields(stream).length;
  const decision = {
    admittedType,
    codeEndOffset: stream.boundary.codeEndOffset,
    cursorAfter,
    cursorBefore: 0,
    firstNonWhitespaceIndex,
    firstNonWhitespaceStartScalar: firstNonWhitespace?.startScalar ?? null,
    inheritedStreamFieldCount,
    retainedSource,
    retainedTokenStreamFormat: stream.format,
    status: admitted ? 'admitted' : 'dropped',
    tokenCount: stream.tokens.length,
    tokenZeroKind: tokenZero.kind,
    tokenZeroStartScalar: tokenZero.startScalar,
    tokenZeroValue: tokenZero.value,
    triviaEndOffset: stream.boundary.triviaEndOffset,
  };
  const seal = {
    admittedType,
    codeEndOffset: stream.boundary.codeEndOffset,
    cursorAfter,
    diagnosticCount: admitted ? 0 : 1,
    errorCount: admitted ? 0 : 1,
    firstNonWhitespaceIndex,
    markerKind: stream.boundary.markerKind,
    originalContent: content,
    retainedByteLength: Buffer.byteLength(retainedSource, 'utf8'),
    retainedScalarLength: [...retainedSource].length,
    retainedSource,
    status: decision.status,
    tokenCount: stream.tokens.length,
    triviaEndOffset: stream.boundary.triviaEndOffset,
  };
  const result = {
    decision,
    format: policy.nodeTypeTokenAdmissionFormat,
    seal,
    sourceProfile: policy.nodeTypeTokenAdmissionSourceProfile,
  };
  if (admitted) return result;
  const firstNonWhitespaceUtf16Start = [...retainedSource]
    .slice(0, firstNonWhitespace?.startScalar ?? 0)
    .join('').length;
  const endCol = retainedSource.length + 1;
  return {
    ...result,
    diagnostic: {
      category: 'parser',
      code: 'DROPPED_LINE',
      col: firstNonWhitespaceUtf16Start + 1,
      endCol,
      line: 1,
      message: 'Dropped line 1: expected a node type at the start of the line',
      severity: 'error',
      suggestion: SUGGESTION,
    },
    error: {
      indent: 0,
      loc: { col: 1, endCol, endLine: 1, line: 1 },
      props: { code: 'DROPPED_LINE', message: 'Dropped line 1: expected a node type', raw: retainedSource },
      pseudoStyleCount: 0,
      quotedProps: 'absent',
      rawLength: retainedSource.length,
      styleCount: 0,
      themeRefCount: 0,
      type: '__error',
    },
  };
}
