import { isDeepStrictEqual } from 'node:util';

import { normalizeKeywordHandlerOracle } from './oracle.mjs';

const TOKEN_SEPARATORS = new Set(['whitespace', 'style', 'themeRef']);
const TOKEN_SPAN_HANDLERS = new Set(['error', 'island', 'route']);

function fail(detail) {
  throw new Error(`keyword-handler envelope rejection: ${detail}`);
}

function tokenEnd(stream, index) {
  return stream.tokens[index + 1]?.startScalar ?? stream.boundary.codeEndOffset;
}

function significantTokenIndexes(stream, start, end) {
  const indexes = [];
  for (let index = start; index < end; index += 1) {
    if (stream.tokens[index]?.kind !== 'whitespace') indexes.push(index);
  }
  return indexes;
}

function writeKind(type, name, value) {
  if (typeof value === 'boolean') return 'boolean';
  if (type === 'params' && name === 'items') return 'params-items-v1';
  if (type === 'import' && name === '__firstClassBindings') return 'bindings-v1';
  if (type === 'middleware' && name === 'names') return 'middleware-list';
  if ((type === 'error' || type === 'respond') && name === 'status') return 'number-token';
  return 'text';
}

function expectedWrites(type, oracle, stream) {
  const semanticWrites = oracle.writes.filter(({ name }) => Object.hasOwn(oracle.props, name));
  if (semanticWrites.length === 0) return [];
  const significant = significantTokenIndexes(stream, oracle.initialCursor, oracle.finalCursor);
  if (significant.length === 0) fail('semantic writes have no consumed token span');
  const wholeStart = stream.tokens[significant[0]].startScalar;
  const wholeEnd = stream.tokens[oracle.finalCursor]?.startScalar ?? stream.boundary.codeEndOffset;
  const tokenSpans = TOKEN_SPAN_HANDLERS.has(type) ||
    (type === 'import' && oracle.props.__firstClassImport !== true);
  return semanticWrites.map(({ name, value }, index) => {
    const tokenIndex = tokenSpans ? significant[index] : undefined;
    if (tokenSpans && tokenIndex === undefined) {
      fail(`${type} write ${index} has no independently consumed token`);
    }
    return {
      endScalar: tokenIndex === undefined ? wholeEnd : tokenEnd(stream, tokenIndex),
      kind: writeKind(type, name, value),
      name,
      startScalar: tokenIndex === undefined ? wholeStart : stream.tokens[tokenIndex].startScalar,
      value,
    };
  });
}

export function normalizeKeywordHandlerLocalOracle(content, type, stream, startCursor) {
  const oracle = normalizeKeywordHandlerOracle(content, type, stream, startCursor);
  const writes = expectedWrites(type, oracle, stream);
  return {
    finalCursor: oracle.finalCursor,
    handlerProps: oracle.props,
    initialCursor: oracle.initialCursor,
    type,
    writes,
  };
}

function maskHandlerRange(base, stream, initialCursor, finalCursor) {
  if (finalCursor <= initialCursor) return base;
  const start = stream.tokens[initialCursor]?.startScalar;
  const end = stream.tokens[finalCursor]?.startScalar ?? stream.boundary.codeEndOffset;
  if (start === undefined || end < start || finalCursor > stream.tokens.length) {
    fail('handler cursor does not identify a bounded mask range');
  }
  const scalars = [...base];
  for (let index = start; index < end; index += 1) {
    if (scalars[index] === undefined) fail('handler mask exceeds the source boundary');
    scalars[index] = ' '.repeat(scalars[index].length);
  }
  return scalars.join('');
}

function expectedSeedDuplicates(hints, local, stream, exported) {
  const seededNames = [
    ...(exported ? ['export'] : []),
    ...hints.writes.map(({ name }) => name),
    ...local.writes.map(({ name }) => name),
  ];
  const genericSeen = [];
  const duplicates = [];
  let phase = 'handoff';
  let equalsIndex = -1;
  for (let tokenIndex = 1; tokenIndex < stream.tokens.length; tokenIndex += 1) {
    const token = stream.tokens[tokenIndex];
    if (tokenIndex === equalsIndex) {
      equalsIndex = -1;
      continue;
    }
    if (phase === 'handoff') {
      if (TOKEN_SEPARATORS.has(token.kind)) continue;
      if (token.kind === 'identifier' && stream.tokens[tokenIndex + 1]?.kind === 'equals') {
        const key = token.value;
        if (seededNames.includes(key) && !genericSeen.includes(key)) {
          duplicates.push({
            index: duplicates.length,
            key,
            startScalar: token.startScalar,
            tokenIndex,
          });
        }
        genericSeen.push(key);
        equalsIndex = tokenIndex + 1;
        phase = 'value';
      }
      continue;
    }
    if (phase === 'value') {
      phase = TOKEN_SEPARATORS.has(token.kind) || token.kind === 'quoted' || token.kind === 'expr'
        ? 'handoff'
        : 'bare';
      continue;
    }
    if (phase === 'bare' && TOKEN_SEPARATORS.has(token.kind)) phase = 'handoff';
  }
  return duplicates;
}

export function normalizeKeywordHandlerCompositionOracle(content, hints, maskedStream, exported) {
  const startCursor = (hints.exitFieldCursor - 11) / 10;
  if (!Number.isInteger(startCursor) || startCursor < 0) fail('hint cursor is not a token boundary');
  const local = normalizeKeywordHandlerLocalOracle(content, hints.admittedType, hints.stream, startCursor);
  return {
    local,
    maskedContent: maskHandlerRange(
      hints.maskedContent, hints.stream, local.initialCursor, local.finalCursor,
    ),
    seedDuplicates: expectedSeedDuplicates(hints, local, maskedStream, exported),
  };
}

function bootstrapDiagnosticProjection(diagnostics) {
  return diagnostics
    .filter(({ code }) => code === 'DUPLICATE_PROP' || code === 'UNEXPECTED_TOKEN')
    .map(({ category, code, col, endCol, line, message, severity, suggestion }) => ({
      category, code, col, endCol, line, message, severity, suggestion,
    }));
}

export function assertKeywordHandlerCompositionOracle(actual, expected) {
  const actualLocal = {
    finalCursor: actual.finalCursor,
    handlerProps: actual.handlerProps,
    initialCursor: actual.initialCursor,
    type: actual.type,
    writes: actual.writes,
  };
  if (!isDeepStrictEqual(actualLocal, expected.local)) fail('local semantic payload drift');
  if (actual.maskedContent !== expected.maskedContent) fail('handler mask drift');
  if (!isDeepStrictEqual(actual.seedDuplicates, expected.seedDuplicates)) {
    fail('seeded duplicate drift');
  }
}

function bootstrapNodeProjection(result) {
  const props = { ...result.finalProps };
  if (result.type === 'fn') delete props.__firstClassSyntax;
  if (result.type === 'import') {
    delete props.__firstClassImport;
    delete props.__firstClassBindings;
  }
  return props;
}

export function assertKeywordHandlerBootstrapParity(result, parseResult) {
  const firstClassKernImport = result.type === 'import' &&
    result.finalProps.__firstClassImport === true &&
    typeof result.finalProps.from === 'string' && result.finalProps.from.endsWith('.kern');
  if (firstClassKernImport && parseResult.root.type === 'use') return 'out-of-scope-canonicalization';
  if (parseResult.root.type !== result.type) fail('bootstrap node-type drift');
  if ((parseResult.root.children?.length ?? 0) > 0) return 'out-of-scope-tree';
  if (!isDeepStrictEqual(bootstrapNodeProjection(result), parseResult.root.props)) {
    fail('bootstrap property drift');
  }
  if (!isDeepStrictEqual(result.quotedProps, parseResult.root.__quotedProps ?? [])) {
    fail('bootstrap quoted-property drift');
  }
  if (!isDeepStrictEqual(
    bootstrapDiagnosticProjection(result.diagnostics),
    bootstrapDiagnosticProjection(parseResult.diagnostics),
  )) fail('bootstrap diagnostic drift');
  return 'compared';
}
