function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

function utf8Bytes(value) {
  return Buffer.byteLength(value, 'utf8');
}

function arrayIndexValue(key) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(key) || key.length > 10) return null;
  const value = Number(key);
  return Number.isSafeInteger(value) && value >= 0 && value <= 4_294_967_294 ? value : null;
}

export function ordinaryOwnKeyOrder(keys) {
  const indices = [];
  const strings = [];
  for (const [insertionIndex, key] of keys.entries()) {
    const index = arrayIndexValue(key);
    if (index === null) strings.push({ insertionIndex, key });
    else indices.push({ index, key });
  }
  indices.sort((left, right) => left.index - right.index);
  return [...indices.map(({ key }) => key), ...strings.map(({ key }) => key)];
}

function trimSegment(block, start, end) {
  const raw = block.slice(start, end);
  const trimmed = raw.trim();
  if (trimmed === '') return { raw, text: '', trimEnd: end, trimStart: end };
  const trimStart = start + (raw.length - raw.trimStart().length);
  return { raw, text: trimmed, trimEnd: start + raw.trimEnd().length, trimStart };
}

function unquoteValue(value) {
  if (!(value.startsWith('"') && value.endsWith('"'))) return value;
  return value.slice(1, -1).replace(/\\"/gu, '"').replace(/\\\\/gu, '\\');
}

function interpretPair(text) {
  const pseudoMatch = text.match(/^:([a-z]+):([A-Za-z0-9_-]+):(.+)$/u);
  if (pseudoMatch) {
    return {
      key: pseudoMatch[2], kind: 'pseudo', pseudo: pseudoMatch[1], retained: true,
      value: pseudoMatch[3].trim(),
    };
  }
  const quotedKeyMatch = text.match(/^"([^"]+)"\s*:\s*(.*)/u);
  if (quotedKeyMatch) {
    const rawValue = quotedKeyMatch[2].trim();
    return { key: quotedKeyMatch[1], kind: 'quoted-key', pseudo: '', retained: true, value: unquoteValue(rawValue) };
  }
  const colonIndex = text.indexOf(':');
  if (colonIndex > 0) {
    const rawValue = text.slice(colonIndex + 1).trim();
    return {
      key: text.slice(0, colonIndex).trim(), kind: 'normal', pseudo: '', retained: true,
      value: unquoteValue(rawValue),
    };
  }
  return { key: '', kind: 'ignored', pseudo: '', retained: true, value: '' };
}

function splitAndInterpretStyle(block, context, policy) {
  if ([...block].length > policy.maxGenericPropertyStyleThemeStyleBlockCodePoints) {
    return failure('STYLE_BLOCK_CODE_POINTS_LIMIT');
  }
  if (block.length > policy.maxGenericPropertyStyleThemeStyleBlockUtf16Units) {
    return failure('STYLE_BLOCK_UTF16_LIMIT');
  }
  if (utf8Bytes(block) > policy.maxGenericPropertyStyleThemeStyleBlockBytes) {
    return failure('STYLE_BLOCK_BYTES_LIMIT');
  }
  const rawSegments = [];
  let inQuote = false;
  let parenDepth = 0;
  let segmentStart = 0;
  function addSegment(end, delimiterOffset) {
    if (context.segments.length + rawSegments.length >= policy.maxGenericPropertyStyleThemeStyleSegments) {
      return failure('STYLE_SEGMENT_LIMIT');
    }
    const trimmed = trimSegment(block, segmentStart, end);
    rawSegments.push({
      delimiterOffset,
      end,
      raw: trimmed.raw,
      retained: trimmed.text !== '',
      segmentIndex: context.segments.length + rawSegments.length,
      segmentOrdinal: rawSegments.length,
      start: segmentStart,
      styleOrdinal: context.styleOrdinal,
      text: trimmed.text,
      tokenIndex: context.tokenIndex,
      trimEnd: trimmed.trimEnd,
      trimStart: trimmed.trimStart,
    });
    return null;
  }
  for (let index = 0; index < block.length; index += 1) {
    const character = block[index];
    if (character === '\\' && index + 1 < block.length) {
      index += 1;
    } else if (character === '"') {
      inQuote = !inQuote;
    } else if (!inQuote && character === '(') {
      parenDepth += 1;
      if (parenDepth > policy.maxGenericPropertyStyleThemeStyleParenDepth) {
        return failure('STYLE_PAREN_DEPTH_LIMIT');
      }
    } else if (!inQuote && character === ')') {
      parenDepth -= 1;
    } else if (!inQuote && parenDepth === 0 && character === ',') {
      const failed = addSegment(index, index);
      if (failed) return failed;
      segmentStart = index + 1;
    }
  }
  const failed = addSegment(block.length, null);
  if (failed) return failed;

  const interpretations = [];
  const writes = [];
  for (const segment of rawSegments) {
    if (!segment.retained) continue;
    if (context.interpretations.length + interpretations.length >= policy.maxGenericPropertyStyleThemeStylePairs) {
      return failure('STYLE_PAIR_LIMIT');
    }
    const interpretation = {
      ...interpretPair(segment.text),
      interpretationIndex: context.interpretations.length + interpretations.length,
      segmentIndex: segment.segmentIndex,
      styleOrdinal: context.styleOrdinal,
      tokenIndex: context.tokenIndex,
    };
    interpretations.push(interpretation);
    if (interpretation.kind === 'ignored') continue;
    if (context.writes.length + writes.length >= policy.maxGenericPropertyStyleThemeStyleWrites) {
      return failure('STYLE_WRITE_LIMIT');
    }
    const pseudo = interpretation.kind === 'pseudo' ? interpretation.pseudo : '';
    writes.push({
      interpretationIndex: interpretation.interpretationIndex,
      key: interpretation.key,
      kind: interpretation.kind === 'pseudo' ? 'pseudo' : 'style',
      pseudo,
      segmentIndex: segment.segmentIndex,
      styleOrdinal: context.styleOrdinal,
      tokenIndex: context.tokenIndex,
      value: interpretation.value,
      visible: interpretation.key !== '__proto__' && pseudo !== 'constructor',
      writeIndex: context.writes.length + writes.length,
    });
  }
  return { interpretations, segments: rawSegments, writes };
}

function parseValue(tokens, cursor) {
  const valueIndex = cursor < tokens.length ? cursor : null;
  const token = tokens[cursor];
  if (token === undefined || token.kind === 'whitespace') {
    return { consumedValueTokenCount: 0, cursorAfter: cursor, quoted: false, value: '', valueIndex, valueKind: 'empty' };
  }
  if (token.kind === 'quoted' || token.kind === 'expr') {
    return {
      consumedValueTokenCount: 1, cursorAfter: cursor + 1, quoted: token.kind === 'quoted',
      value: token.value, valueIndex, valueKind: token.kind,
    };
  }
  let value = '';
  const start = cursor;
  while (cursor < tokens.length && !['whitespace', 'style', 'themeRef'].includes(tokens[cursor].kind)) {
    value += tokens[cursor].value;
    cursor += 1;
  }
  return {
    consumedValueTokenCount: cursor - start, cursorAfter: cursor, quoted: false, value, valueIndex, valueKind: 'bare',
  };
}

function finalPropertyState(properties, quoteOrder) {
  return {
    finalProperties: [...properties.values()],
    quotedProperties: quoteOrder.map((key, orderIndex) => {
      const property = properties.get(key);
      return { generation: property.quoteGeneration, key, orderIndex, propertyIndex: property.uniqueIndex };
    }),
  };
}

function applyStyleWrite(write, styles, pseudoStyles) {
  if (write.kind === 'style') {
    if (write.visible) styles.set(write.key, write.value);
    return;
  }
  if (write.pseudo === 'constructor') return;
  let target = pseudoStyles.get(write.pseudo);
  if (!target) {
    target = new Map();
    pseudoStyles.set(write.pseudo, target);
  }
  if (write.visible) target.set(write.key, write.value);
}

function finalStyleState(styles, pseudoStyles) {
  const finalStyles = ordinaryOwnKeyOrder([...styles.keys()]).map((key, orderIndex) => ({ key, orderIndex, value: styles.get(key) }));
  const finalPseudoStyles = [];
  for (const pseudo of ordinaryOwnKeyOrder([...pseudoStyles.keys()])) {
    const target = pseudoStyles.get(pseudo);
    const entries = ordinaryOwnKeyOrder([...target.keys()]).map((key, orderIndex) => ({ key, orderIndex, value: target.get(key) }));
    finalPseudoStyles.push({ entries, pseudo });
  }
  return { finalPseudoStyles, finalStyles };
}

export function normalizeGenericPropertyStyleThemeOracle(content, snapshot, policy, inherited, authenticatedStream) {
  const stream = authenticatedStream;
  if (stream.status === 'failure') return failure(stream.code, stream.detail);
  if (inherited.status === 'failure' && inherited.code !== 'THEME_PROFILE') return failure(inherited.code, inherited.detail);
  let startUtf16 = 0;
  const tokens = stream.tokens.map((token) => {
    startUtf16 += token.startDelta.length;
    return { ...token, startUtf16 };
  });
  const admittedType = tokens[0]?.kind === 'identifier' ? tokens[0].value : '';
  if (admittedType === '') {
    return {
      admittedType: '', diagnostics: [], finalProperties: [], finalPseudoStyles: [], finalStyles: [],
      firstStyleCursor: null, format: policy.genericPropertyStyleThemeFormat, inherited,
      interpretations: [], knownState: 'dropped', parseEpoch: snapshot.parseEpoch,
      predecessorState: 'dropped', quotedProperties: [], runtimeInstance: snapshot.runtimeInstance,
      segments: [], sourceProfile: policy.genericPropertyStyleThemeSourceProfile, state: 'dropped',
      stream, styleWrites: [], terminalCursor: 0, terminalKind: 'dropped', themeRefs: [], transitions: [], writes: [],
    };
  }

  const knownState = policy.builtinNodeCatalog.includes(admittedType) ||
    snapshot.evolvedTypes.includes(admittedType) || snapshot.multilineTypes.includes(admittedType) ||
    snapshot.templateTypes.includes(admittedType) ? 'known' : 'unknown';
  const properties = new Map();
  const quoteOrder = [];
  const diagnostics = [];
  const themeRefs = [];
  const transitions = [];
  const writes = [];
  const segments = [];
  const interpretations = [];
  const styleWrites = [];
  const styles = new Map();
  const pseudoStyles = new Map();
  let firstStyleCursor = null;
  let styleCount = 0;
  let cursor = 1;
  while (cursor < tokens.length) {
    const propertyCursorBefore = cursor;
    while (cursor < tokens.length && tokens[cursor].kind === 'whitespace') cursor += 1;
    if (cursor >= tokens.length) break;
    const cursorBefore = cursor;
    const token = tokens[cursor];
    if (token.kind === 'style') {
      if (styleCount >= policy.maxGenericPropertyStyleThemeStyleTokens) return failure('STYLE_TOKEN_LIMIT');
      const segmentBase = segments.length;
      const interpretationBase = interpretations.length;
      const styleWriteBase = styleWrites.length;
      const style = splitAndInterpretStyle(token.value, {
        interpretations, segments, styleOrdinal: styleCount, tokenIndex: cursor, writes: styleWrites,
      }, policy);
      if (style.status === 'failure') return style;
      if (firstStyleCursor === null) firstStyleCursor = cursor;
      segments.push(...style.segments);
      interpretations.push(...style.interpretations);
      for (const write of style.writes) {
        styleWrites.push(write);
        applyStyleWrite(write, styles, pseudoStyles);
      }
      transitions.push({
        cursorAfter: cursor + 1, cursorBefore, interpretationBase,
        interpretationCount: style.interpretations.length, segmentBase, segmentCount: style.segments.length,
        styleOrdinal: styleCount, styleWriteBase, styleWriteCount: style.writes.length, tokenIndex: cursor,
        tokenStart: token.startUtf16, transitionIndex: transitions.length, type: 'style', value: token.value,
      });
      styleCount += 1;
      cursor += 1;
      continue;
    }
    if (token.kind === 'themeRef') {
      if (themeRefs.length >= policy.maxGenericPropertyStyleThemeThemeRefs) return failure('THEME_LIMIT');
      transitions.push({
        cursorAfter: cursor + 1, cursorBefore, themeIndex: themeRefs.length, tokenIndex: cursor,
        transitionIndex: transitions.length, type: 'theme', value: token.value,
      });
      themeRefs.push(token.value);
      cursor += 1;
      continue;
    }
    const equalsToken = tokens[cursor + 1];
    if (token.kind !== 'identifier' || equalsToken?.kind !== 'equals') return failure('STYLE_PROFILE');
    if (writes.length >= policy.maxGenericPropertyStyleThemeProperties) return failure('THEME_LIMIT');
    const key = token.value;
    const parsed = parseValue(tokens, cursor + 2);
    const duplicate = properties.has(key);
    const existing = properties.get(key);
    const uniqueIndex = duplicate ? existing.uniqueIndex : properties.size;
    const diagnosticIndex = duplicate ? diagnostics.length : null;
    const col = 1 + token.startUtf16;
    let quoteGeneration = existing?.quoteGeneration ?? 0;
    if (parsed.quoted) {
      if (!existing?.quoted) {
        quoteOrder.push(key);
        quoteGeneration = writes.length + 1;
      }
    } else {
      const quoteIndex = quoteOrder.indexOf(key);
      if (quoteIndex >= 0) quoteOrder.splice(quoteIndex, 1);
      quoteGeneration = 0;
    }
    const write = {
      ...parsed, cursorBefore: propertyCursorBefore,
      ...(duplicate ? { diagnosticCol: col, diagnosticEndCol: col + key.length } : {}),
      diagnosticIndex, duplicate, equalsIndex: cursor + 1, key, propertyIndex: cursor,
      quoteGeneration, transitionIndex: transitions.length, type: 'property', uniqueIndex, writeIndex: writes.length,
    };
    if (duplicate) diagnostics.push({
      code: 'DUPLICATE_PROP', col, endCol: col + key.length, endLine: 1, index: diagnosticIndex,
      line: 1, message: `Duplicate property '${key}' at line 1`, severity: 'warning', writeIndex: write.writeIndex,
    });
    properties.set(key, {
      firstWriteIndex: existing?.firstWriteIndex ?? write.writeIndex, key, lastWriteIndex: write.writeIndex,
      quoteGeneration, quoted: parsed.quoted, uniqueIndex, value: parsed.value, valueKind: parsed.valueKind,
    });
    writes.push(write);
    transitions.push(write);
    cursor = parsed.cursorAfter;
  }

  const predecessorState = styleCount > 0 ? 'expected-profile' : 'success';
  if (predecessorState === 'expected-profile' && (inherited.status !== 'failure' || inherited.code !== 'THEME_PROFILE')) {
    return failure('STYLE_INVALID');
  }
  if (predecessorState === 'success' && inherited.status === 'failure') return failure('STYLE_INVALID');
  return {
    admittedType,
    diagnostics,
    ...finalPropertyState(properties, quoteOrder),
    ...finalStyleState(styles, pseudoStyles),
    firstStyleCursor,
    format: policy.genericPropertyStyleThemeFormat,
    inherited,
    interpretations,
    knownState,
    parseEpoch: snapshot.parseEpoch,
    predecessorState,
    runtimeInstance: snapshot.runtimeInstance,
    segments,
    sourceProfile: policy.genericPropertyStyleThemeSourceProfile,
    state: 'loop',
    stream,
    styleWrites,
    terminalCursor: cursor,
    terminalKind: 'eof',
    themeRefs,
    transitions,
    writes,
  };
}
