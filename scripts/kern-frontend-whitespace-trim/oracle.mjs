import { executeTokenizer } from '../check-kern-frontend-tokenizer.mjs';

export const ECMASCRIPT_TRIM_CODE_POINTS = Object.freeze([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
]);

const TRIM_SCALARS = new Set(ECMASCRIPT_TRIM_CODE_POINTS.map((codePoint) => String.fromCodePoint(codePoint)));

export function isEcmaTrimScalar(value) {
  return TRIM_SCALARS.has(value);
}

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

function scanContent(content, maxLexicalDepth) {
  const scalars = [...content];
  let quote = 'none';
  let escapePending = false;
  let expressionDepth = 0;
  let styleDepth = 0;
  let markerOffset = null;

  for (let index = 0; index < scalars.length;) {
    const character = scalars[index];
    const next = scalars[index + 1] ?? '';
    const previous = scalars[index - 1] ?? '';
    if (quote !== 'none') {
      if (character === '\\') {
        if (index + 1 < scalars.length) index += 2;
        else {
          escapePending = true;
          index += 1;
        }
        continue;
      }
      if ((quote === 'double' && character === '"') || (quote === 'single' && character === "'")) quote = 'none';
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character === '"' ? 'double' : 'single';
      index += 1;
      continue;
    }
    if (character === '{' && next === '{') {
      expressionDepth += 1;
      if (expressionDepth > maxLexicalDepth) return failure('LEXICAL_DEPTH_LIMIT');
      index += 2;
      continue;
    }
    if (character === '}' && next === '}' && expressionDepth > 0) {
      expressionDepth -= 1;
      index += 2;
      continue;
    }
    if (expressionDepth > 0) {
      index += 1;
      continue;
    }
    if (character === '{') {
      styleDepth += 1;
      if (styleDepth > maxLexicalDepth) return failure('LEXICAL_DEPTH_LIMIT');
      index += 1;
      continue;
    }
    if (character === '}' && styleDepth > 0) {
      styleDepth -= 1;
      index += 1;
      continue;
    }
    if (styleDepth > 0) {
      index += 1;
      continue;
    }
    if (
      (previous === ' ' || previous === '\t') &&
      (character === '#' || (character === '/' && next === '/'))
    ) {
      markerOffset = index;
      break;
    }
    index += 1;
  }
  return { escapePending, expressionDepth, markerOffset, quote, styleDepth };
}

export function normalizeWhitespaceTrimOracle(content, limits = {}) {
  const maxLexicalDepth = limits.maxLexicalDepth ?? Number.MAX_SAFE_INTEGER;
  if (maxLexicalDepth <= 0) return failure('INVALID_LIMITS');
  const scan = scanContent(content, maxLexicalDepth);
  if ('status' in scan) return scan;
  const scalars = [...content];
  let codeEndOffset = scalars.length;
  let triviaEndOffset = scalars.length;
  let markerKind = 'none';
  let markerText = '';
  let rawPayload = '';
  let stop = 'record-end';
  if (scan.markerOffset !== null) {
    stop = 'eligible-marker';
    triviaEndOffset = scan.markerOffset;
    codeEndOffset = triviaEndOffset;
    while (codeEndOffset > 0 && isEcmaTrimScalar(scalars[codeEndOffset - 1])) codeEndOffset -= 1;
    markerText = scalars[scan.markerOffset] === '#' ? '#' : '//';
    markerKind = markerText === '#' ? 'hash' : 'slash-slash';
    rawPayload = scalars.slice(scan.markerOffset + markerText.length).join('');
  }
  const retainedCode = scalars.slice(0, codeEndOffset).join('');
  const tokenized = executeTokenizer(retainedCode, {
    ...limits,
    format: 'kern.frontend.tokenizer-shadow.2',
    profileLimits: {
      ...limits.profileLimits,
      maxRecords: limits.tokenizerMaxRecords ?? limits.profileLimits?.maxRecords,
    },
  });
  if ('status' in tokenized && tokenized.status === 'failure') return tokenized;
  return {
    format: 'kern.frontend.whitespace-trim-shadow.1',
    sourceProfile: 'single-parser-content-record-v1',
    trim: {
      checkpointIndex: 0,
      codeEndOffset,
      content,
      escapePending: scan.escapePending,
      expressionDepth: scan.expressionDepth,
      groupIndex: 0,
      groupRecordIndex: 0,
      markerKind,
      markerOffset: scan.markerOffset,
      markerText,
      physicalIndex: 0,
      quote: scan.quote,
      rawPayload,
      stop,
      styleDepth: scan.styleDepth,
      trimIndex: 0,
      triviaEndOffset,
    },
  };
}
