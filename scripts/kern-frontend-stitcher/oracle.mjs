import { normalizeBootstrap } from '../check-kern-frontend-tokenizer.mjs';

function scanLineState(line, previous = { exprDepth: 0, inQuote: false }) {
  let { exprDepth, inQuote } = previous;
  let styleDepth = 0;
  let styleInQuote = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    const prior = line[index - 1] ?? '';
    if (inQuote) {
      if (character === '\\') index += 1;
      else if (character === '"') inQuote = false;
      continue;
    }
    if (exprDepth > 0) {
      if (character === '{' && next === '{') {
        exprDepth += 1;
        index += 1;
      } else if (character === '}' && next === '}') {
        exprDepth -= 1;
        index += 1;
      }
      continue;
    }
    if (styleDepth > 0) {
      if (character === '\\' && styleInQuote) index += 1;
      else if (character === '"') styleInQuote = !styleInQuote;
      else if (!styleInQuote && character === '{') styleDepth += 1;
      else if (!styleInQuote && character === '}') styleDepth -= 1;
      continue;
    }
    const precededByWhitespace = index === 0 || prior === ' ' || prior === '\t';
    if (precededByWhitespace && (character === '#' || (character === '/' && next === '/'))) break;
    if (character === '{' && next === '{') {
      exprDepth += 1;
      index += 1;
    } else if (character === '{') {
      styleDepth = 1;
    } else if (character === '"') {
      inQuote = true;
    }
  }
  return { exprDepth, inQuote };
}

function fenceOutsideQuotes(line) {
  let inQuote = false;
  let quoteCharacter;
  let expressionDepth = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    if (inQuote && character === '\\') {
      index += 1;
      continue;
    }
    if ((character === '"' || character === "'") && (!inQuote || character === quoteCharacter)) {
      inQuote = !inQuote;
      quoteCharacter = inQuote ? character : undefined;
      continue;
    }
    if (inQuote) continue;
    if (character === '{' && next === '{') {
      expressionDepth += 1;
      index += 1;
      continue;
    }
    if (character === '}' && next === '}' && expressionDepth > 0) {
      expressionDepth -= 1;
      index += 1;
      continue;
    }
    if (expressionDepth === 0 && line.startsWith('<<<', index)) return true;
  }
  return false;
}

function classify(line, rawTypes) {
  const trimmed = line.trimStart();
  if (trimmed.length === 0) return 'blank';
  if (trimmed.startsWith('#') || trimmed.startsWith('//')) return 'file-comment-candidate';
  for (const type of rawTypes) {
    if (trimmed.startsWith(type) && /^\s/u.test(trimmed.slice(type.length)) && fenceOutsideQuotes(trimmed)) {
      return 'raw-opener-candidate';
    }
  }
  return 'ordinary';
}

export function physicalOracle(source, rawTypes) {
  const parts = source === '' ? [''] : source.split('\n');
  if (source.endsWith('\n')) parts.pop();
  let startByte = 0;
  return parts.map((content, index) => {
    const hasLf = index < parts.length - 1 || source.endsWith('\n');
    const contentEndByte = startByte + Buffer.byteLength(content);
    const recordEndByte = contentEndByte + Number(hasLf);
    const record = {
      class: classify(content, rawTypes),
      content,
      contentEndByte,
      hasLf,
      indent: /^[\t ]*/u.exec(content)?.[0] ?? '',
      index,
      recordEndByte,
      startByte,
    };
    startByte = recordEndByte;
    return record;
  });
}

export function normalizeStitchOracle(source, rawTypes) {
  const physical = physicalOracle(source, rawTypes);
  const groups = [];
  for (let index = 0; index < physical.length;) {
    const first = physical[index];
    if (first.class !== 'ordinary') {
      index += 1;
      continue;
    }
    const physicalIndexes = [index];
    let groupSource = first.content;
    let state = scanLineState(first.content);
    let termination = 'complete';
    while ((state.inQuote || state.exprDepth > 0) && index + 1 < physical.length) {
      const next = physical[index + 1];
      if (next.class === 'file-comment-candidate') {
        termination = 'comment-boundary';
        break;
      }
      if (next.class === 'raw-opener-candidate') {
        termination = 'raw-opener-boundary';
        break;
      }
      index += 1;
      physicalIndexes.push(index);
      groupSource += `\n${physical[index].content}`;
      state = scanLineState(physical[index].content, state);
    }
    if ((state.inQuote || state.exprDepth > 0) && termination === 'complete') termination = 'eof-unclosed';
    const tokenizer = termination === 'complete' ? normalizeBootstrap(groupSource) : undefined;
    if (tokenizer !== undefined) {
      const documentBase = physical[physicalIndexes[0]].startByte;
      tokenizer.tokens = tokenizer.tokens.map((token) => ({
        ...token,
        documentStartByte: documentBase + token.startByte,
      }));
      tokenizer.diagnostics = tokenizer.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        documentEndByte: documentBase + diagnostic.endColByte - 1,
        documentStartByte: documentBase + diagnostic.colByte - 1,
      }));
    }
    groups.push({
      exprDepth: state.exprDepth,
      inQuote: state.inQuote,
      physicalIndexes,
      termination,
      ...(tokenizer === undefined ? {} : { tokenizer }),
    });
    index += 1;
  }
  return { format: 'kern.frontend.stitch-shadow.1', groups, physical };
}
