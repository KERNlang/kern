export function validateTapePreflight(tape, policy, reject) {
  const limits = policy.profileLimits;
  if (Array.from(tape).length > limits.maxTapeScalars) reject('tape scalar limit');
  if (Buffer.byteLength(tape, 'utf8') > limits.maxTapeUtf8Bytes) reject('tape byte limit');
}

export function validateSuccessGeometry(
  { chunks, expectedChunks, expectedRecords, maxGuestListLength },
  policy,
  reject,
) {
  const limits = policy.profileLimits;
  if (expectedChunks > limits.maxChunks || expectedRecords > limits.maxSourceScalars) {
    reject('declared success geometry');
  }
  if (chunks.length !== expectedChunks) reject('chunk result');
  const canonicalChunks = expectedRecords === 0 ? 0 : Math.ceil(expectedRecords / limits.recordsPerChunk);
  if (expectedChunks !== canonicalChunks) reject('canonical chunk count');
  for (const [index, chunk] of chunks.entries()) {
    const remaining = expectedRecords - index * limits.recordsPerChunk;
    const canonicalCount = Math.min(limits.recordsPerChunk, remaining);
    if (chunk.records.length !== canonicalCount) reject('canonical chunk fill');
  }
  const actualMaximum = Math.max(chunks.length, 0, ...chunks.map((chunk) => chunk.records.length));
  if (maxGuestListLength !== actualMaximum) reject('maximum guest list length');
}

export function validateSuccessSource(source, sourceScalars, policy, reject) {
  if (typeof source.isWellFormed !== 'function' || !source.isWellFormed()) reject('ill-formed success source');
  if (sourceScalars > policy.profileLimits.maxSourceScalars) reject('success source limit');
}

function quotedEnd(points, start) {
  const quote = points[start];
  for (let cursor = start + 1; cursor < points.length; cursor += 1) {
    if (points[cursor] === '\\' && cursor + 1 < points.length && points[cursor + 1] !== '\r' && points[cursor + 1] !== '\n') {
      cursor += 1;
    } else if (points[cursor] === quote) {
      return cursor + 1;
    }
  }
  return -1;
}

function expressionEnd(points, start) {
  let depth = 1;
  let quote = null;
  for (let cursor = start + 2; cursor < points.length; cursor += 1) {
    const point = points[cursor];
    const next = points[cursor + 1];
    if (quote !== null) {
      if (point === '\\' && cursor + 1 < points.length && next !== '\r' && next !== '\n') cursor += 1;
      else if (point === quote) quote = null;
    } else if (point === '"' || point === "'") quote = point;
    else if (point === '{' && next === '{') {
      depth += 1;
      cursor += 1;
    } else if (point === '}' && next === '}') {
      depth -= 1;
      cursor += 1;
      if (depth === 0) return cursor + 1;
    }
  }
  return -1;
}

function styleEnd(points, start) {
  let quoted = false;
  for (let cursor = start + 1; cursor < points.length; cursor += 1) {
    const point = points[cursor];
    if (point === '\r' || point === '\n') return -1;
    if (
      point === '\\' && quoted && cursor + 1 < points.length &&
      points[cursor + 1] !== '\r' && points[cursor + 1] !== '\n'
    ) cursor += 1;
    else if (point === '"') quoted = !quoted;
    else if (point === '}' && !quoted) return cursor + 1;
  }
  return -1;
}

function fenceEnd(points, start) {
  let inline = true;
  let lineStart = false;
  for (let cursor = start + 3; cursor < points.length; cursor += 1) {
    const point = points[cursor];
    const next = points[cursor + 1];
    if (point === '\n' || (point === '\r' && next === '\n')) {
      if (point === '\r') cursor += 1;
      inline = false;
      lineStart = true;
      continue;
    }
    if (inline && points.slice(cursor, cursor + 3).join('') === '>>>') return cursor + 3;
    if (!inline && lineStart) {
      let marker = cursor;
      while (points[marker] === ' ' || points[marker] === '\t') marker += 1;
      if (points.slice(marker, marker + 3).join('') === '>>>') return marker + 3;
    }
    lineStart = false;
  }
  return -1;
}

function deriveLexicalFailure(source) {
  const points = Array.from(source);
  for (let cursor = 0; cursor < points.length;) {
    const point = points[cursor];
    const next = points[cursor + 1];
    const triple = points.slice(cursor, cursor + 3).join('');
    const commentGated = cursor === 0 || points[cursor - 1] === ' ' || points[cursor - 1] === '\t' || points[cursor - 1] === '\n';
    if (commentGated && (point === '#' || (point === '/' && next === '/'))) {
      cursor += point === '#' ? 1 : 2;
      while (cursor < points.length && points[cursor] !== '\r' && points[cursor] !== '\n') cursor += 1;
    } else if (triple === '<<<') {
      const end = fenceEnd(points, cursor);
      if (end < 0) return { code: 'UNEXPECTED_TOKEN', endScalar: cursor + 3, startScalar: cursor };
      cursor = end;
    } else if (triple === '>>>') {
      cursor += 3;
    } else if (point === '{' && next === '{') {
      const end = expressionEnd(points, cursor);
      if (end < 0) return { code: 'UNCLOSED_EXPR', endScalar: cursor + 2, startScalar: cursor };
      cursor = end;
    } else if (point === '"' || point === "'") {
      const end = quotedEnd(points, cursor);
      if (end < 0) return { code: 'UNCLOSED_STRING', endScalar: cursor + 1, startScalar: cursor };
      cursor = end;
    } else if (point === '{') {
      const end = styleEnd(points, cursor);
      if (end < 0) return { code: 'UNCLOSED_STYLE', endScalar: cursor + 1, startScalar: cursor };
      cursor = end;
    } else if (point === '/') {
      cursor += 1;
      while (
        cursor < points.length && points[cursor] !== ' ' && points[cursor] !== '\t' &&
        points[cursor] !== '\r' && points[cursor] !== '\n' && points[cursor] !== '{' && points[cursor] !== '$'
      ) cursor += 1;
    } else {
      cursor += 1;
    }
  }
  return null;
}

export function validateFailureDisposition(
  diagnostic,
  source,
  sourceScalars,
  policy,
  options,
  reject,
) {
  const { code, endScalar, startScalar } = diagnostic;
  if (startScalar < 0 || endScalar < startScalar || endScalar > sourceScalars) reject('failure span');
  const wellFormed = typeof source.isWellFormed === 'function' && source.isWellFormed();
  if (!wellFormed) {
    if (code !== 'ILL_FORMED_SOURCE' || startScalar !== 0 || endScalar !== sourceScalars) {
      reject('ill-formed source precedence');
    }
    return;
  }
  if (code === 'ILL_FORMED_SOURCE') reject('ill-formed source failure');
  const overSourceLimit = sourceScalars > policy.profileLimits.maxSourceScalars;
  if (overSourceLimit) {
    if (code !== 'SOURCE_LIMIT' || startScalar !== 0 || endScalar !== sourceScalars) reject('source limit precedence');
    return;
  }
  if (code === 'SOURCE_LIMIT') reject('source limit failure');
  const lexicalFailure = deriveLexicalFailure(source);
  if (code === 'FORCED_LATE_FAILURE') {
    if (
      lexicalFailure !== null || options.allowForcedLateFailure !== true ||
      startScalar !== sourceScalars || endScalar !== sourceScalars
    ) {
      reject('forced late failure');
    }
    return;
  }
  if (code === 'TRANSPORT_LIMIT') reject('impossible authenticated transport failure');
  if (
    lexicalFailure === null || code !== lexicalFailure.code ||
    startScalar !== lexicalFailure.startScalar || endScalar !== lexicalFailure.endScalar
  ) {
    reject('lexical failure disposition');
  }
}
