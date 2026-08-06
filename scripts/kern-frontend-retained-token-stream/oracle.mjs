import { createParseState } from '../../packages/core/dist/parser-diagnostics.js';
import { tokenizeLineInternal } from '../../packages/core/dist/parser-tokenizer.js';
import { normalizeWhitespaceTrimOracle } from '../kern-frontend-whitespace-trim/oracle.mjs';

const TOKENIZER_DIAGNOSTICS = new Set([
  'INVALID_BIGINT',
  'UNCLOSED_EXPR',
  'UNCLOSED_STRING',
  'UNCLOSED_STYLE',
]);

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

function scalarOffset(source, utf16Offset) {
  return [...source.slice(0, utf16Offset)].length;
}

function byteOffset(source, utf16Offset) {
  return Buffer.byteLength(source.slice(0, utf16Offset), 'utf8');
}

function deltaFromStarts(source, starts) {
  let previous = 0;
  return starts.map((start) => {
    const delta = source.slice(previous, start);
    previous = start;
    return delta;
  });
}

export function normalizeRetainedTokenStreamOracle(content, policy) {
  const trimmed = normalizeWhitespaceTrimOracle(content, policy);
  if ('status' in trimmed) return trimmed;
  const boundary = trimmed.trim;
  const contentScalars = [...content];
  const retainedCode = contentScalars.slice(0, boundary.codeEndOffset).join('');
  if (retainedCode.length === 0 || [...retainedCode].every((scalar) => scalar === ' ' || scalar === '\t')) {
    return failure('EMPTY_RETAINED_CODE');
  }

  const state = createParseState();
  const bootstrapTokens = tokenizeLineInternal(retainedCode, state, 'line');
  const tokenStarts = bootstrapTokens.map((token) => token.pos);
  const tokenDeltas = deltaFromStarts(retainedCode, tokenStarts);
  const tokens = bootstrapTokens.map((token, index) => ({
    index,
    kind: token.kind,
    startByte: byteOffset(retainedCode, token.pos),
    startDelta: tokenDeltas[index],
    startScalar: scalarOffset(retainedCode, token.pos),
    value: token.value,
  }));

  const bootstrapDiagnostics = state.diagnostics.filter((diagnostic) => TOKENIZER_DIAGNOSTICS.has(diagnostic.code));
  const diagnosticStarts = bootstrapDiagnostics.map((diagnostic) => diagnostic.col - 1);
  const diagnosticDeltas = deltaFromStarts(retainedCode, diagnosticStarts);
  const diagnostics = bootstrapDiagnostics.map((diagnostic, index) => {
    const start = diagnostic.col - 1;
    const end = diagnostic.endCol - 1;
    return {
      code: diagnostic.code,
      endByte: byteOffset(retainedCode, end),
      endScalar: scalarOffset(retainedCode, end),
      index,
      span: retainedCode.slice(start, end),
      startByte: byteOffset(retainedCode, start),
      startDelta: diagnosticDeltas[index],
      startScalar: scalarOffset(retainedCode, start),
    };
  });

  const lastTokenStart = tokenStarts.at(-1) ?? 0;
  const lastDiagnosticStart = diagnosticStarts.at(-1) ?? 0;
  return {
    boundary: {
      codeEndOffset: boundary.codeEndOffset,
      content,
      markerKind: boundary.markerKind,
      markerOffset: boundary.markerOffset,
      markerText: boundary.markerText,
      rawPayload: boundary.rawPayload,
      retainedLength: boundary.codeEndOffset,
      triviaEndOffset: boundary.triviaEndOffset,
    },
    diagnostics,
    format: policy.retainedTokenStreamFormat,
    seal: {
      content,
      diagnosticCount: diagnostics.length,
      diagnosticTail: retainedCode.slice(lastDiagnosticStart),
      retainedByteLength: Buffer.byteLength(retainedCode, 'utf8'),
      retainedScalarLength: [...retainedCode].length,
      tokenCount: tokens.length,
      tokenTail: retainedCode.slice(lastTokenStart),
    },
    sourceProfile: policy.retainedTokenStreamSourceProfile,
    tokens,
  };
}
