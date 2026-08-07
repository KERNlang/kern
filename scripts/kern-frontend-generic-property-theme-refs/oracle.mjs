import { normalizeGenericPropertyAdmissionOracle } from '../kern-frontend-generic-property-admission/oracle.mjs';
import { normalizeRetainedTokenStreamOracle } from '../kern-frontend-retained-token-stream/oracle.mjs';

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

function parseValue(tokens, cursor) {
  const valueIndex = cursor < tokens.length ? cursor : null;
  const token = tokens[cursor];
  if (token === undefined || token.kind === 'whitespace') {
    return { consumedValueTokenCount: 0, cursorAfter: cursor, quoted: false, value: '', valueIndex, valueKind: 'empty' };
  }
  if (token.kind === 'quoted' || token.kind === 'expr') {
    return {
      consumedValueTokenCount: 1,
      cursorAfter: cursor + 1,
      quoted: token.kind === 'quoted',
      value: token.value,
      valueIndex,
      valueKind: token.kind,
    };
  }
  let value = '';
  const start = cursor;
  while (cursor < tokens.length && !['whitespace', 'style', 'themeRef'].includes(tokens[cursor].kind)) {
    value += tokens[cursor].value;
    cursor += 1;
  }
  return {
    consumedValueTokenCount: cursor - start,
    cursorAfter: cursor,
    quoted: false,
    value,
    valueIndex,
    valueKind: 'bare',
  };
}

function finalState(properties, quoteOrder) {
  const finalProperties = [...properties.values()];
  const quotedProperties = quoteOrder.map((key, orderIndex) => {
    const property = properties.get(key);
    return { generation: property.quoteGeneration, key, orderIndex, propertyIndex: property.uniqueIndex };
  });
  return { finalProperties, quotedProperties };
}

export function normalizeGenericPropertyThemeRefsOracle(content, snapshot, policy, inherited) {
  const admission = normalizeGenericPropertyAdmissionOracle(content, snapshot, policy);
  if (admission.status === 'failure') return failure(admission.code, admission.detail);
  const stream = normalizeRetainedTokenStreamOracle(content, policy);
  if (stream.status === 'failure') return failure(stream.code, stream.detail);
  if (inherited.status === 'failure' && inherited.code !== 'LOOP_PROFILE') {
    return failure(inherited.code, inherited.detail);
  }
  if (admission.state === 'dropped') {
    return {
      admittedType: '', diagnostics: [], finalProperties: [], firstFailureCursor: null,
      format: policy.genericPropertyThemeRefsFormat, inherited, knownState: 'dropped',
      parseEpoch: admission.parseEpoch, predecessorState: 'dropped', quotedProperties: [],
      runtimeInstance: admission.runtimeInstance,
      sourceProfile: policy.genericPropertyThemeRefsSourceProfile, state: 'dropped', stream,
      terminalCursor: 0, terminalKind: 'dropped', themeRefs: [], transitions: [], writes: [],
    };
  }

  const tokens = stream.tokens;
  const properties = new Map();
  const quoteOrder = [];
  const transitions = [];
  const writes = [];
  const diagnostics = [];
  const themeRefs = [];
  let cursor = 1;
  let firstFailureCursor = null;
  while (cursor < tokens.length) {
    const cursorBefore = cursor;
    while (cursor < tokens.length && tokens[cursor].kind === 'whitespace') cursor += 1;
    if (cursor >= tokens.length) break;
    const token = tokens[cursor];
    if (token.kind === 'themeRef') {
      if (themeRefs.length >= policy.maxGenericPropertyThemeRefsThemeRefs) return failure('THEME_LIMIT');
      if (firstFailureCursor === null) firstFailureCursor = cursor;
      const theme = {
        cursorAfter: cursor + 1,
        cursorBefore: cursor,
        themeIndex: themeRefs.length,
        tokenIndex: cursor,
        transitionIndex: transitions.length,
        type: 'theme',
        value: token.value,
      };
      themeRefs.push(token.value);
      transitions.push(theme);
      cursor += 1;
      continue;
    }
    if (token.kind === 'style') return failure('THEME_PROFILE');
    const equalsToken = tokens[cursor + 1];
    if (token.kind !== 'identifier' || equalsToken?.kind !== 'equals') return failure('THEME_PROFILE');
    if (writes.length >= policy.maxGenericPropertyThemeRefsProperties) return failure('THEME_LIMIT');
    const key = token.value;
    const duplicate = properties.has(key);
    const uniqueIndex = duplicate ? properties.get(key).uniqueIndex : properties.size;
    const parsed = parseValue(tokens, cursor + 2);
    if (tokens[parsed.cursorAfter]?.kind === 'style') return failure('THEME_PROFILE');
    const diagnosticIndex = duplicate ? diagnostics.length : null;
    const col = 1 + [...content].slice(0, token.startScalar).join('').length;
    const existing = properties.get(key);
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
      ...parsed,
      cursorBefore,
      ...(duplicate ? { diagnosticCol: col, diagnosticEndCol: col + key.length } : {}),
      diagnosticIndex,
      duplicate,
      equalsIndex: cursor + 1,
      key,
      propertyIndex: cursor,
      quoteGeneration,
      transitionIndex: transitions.length,
      type: 'property',
      uniqueIndex,
      writeIndex: writes.length,
    };
    if (duplicate) {
      diagnostics.push({
        code: 'DUPLICATE_PROP', col, endCol: col + key.length, endLine: 1,
        index: diagnosticIndex, line: 1, message: `Duplicate property '${key}' at line 1`,
        severity: 'warning', writeIndex: write.writeIndex,
      });
    }
    properties.set(key, {
      firstWriteIndex: existing?.firstWriteIndex ?? write.writeIndex,
      key,
      lastWriteIndex: write.writeIndex,
      quoteGeneration,
      quoted: parsed.quoted,
      uniqueIndex,
      value: parsed.value,
      valueKind: parsed.valueKind,
    });
    writes.push(write);
    transitions.push(write);
    cursor = parsed.cursorAfter;
  }

  const expectedPredecessor = themeRefs.length > 0 ? 'expected-profile' : 'success';
  if (
    expectedPredecessor === 'expected-profile' &&
    (inherited.status !== 'failure' || inherited.code !== 'LOOP_PROFILE')
  ) return failure('THEME_INVALID');
  if (expectedPredecessor === 'success' && inherited.status === 'failure') return failure('THEME_INVALID');
  const state = finalState(properties, quoteOrder);
  return {
    admittedType: admission.admittedType,
    diagnostics,
    ...state,
    firstFailureCursor,
    format: policy.genericPropertyThemeRefsFormat,
    inherited,
    knownState: admission.knownState,
    parseEpoch: admission.parseEpoch,
    predecessorState: expectedPredecessor,
    runtimeInstance: admission.runtimeInstance,
    sourceProfile: policy.genericPropertyThemeRefsSourceProfile,
    state: 'loop',
    stream,
    terminalCursor: cursor,
    terminalKind: 'eof',
    themeRefs,
    transitions,
    writes,
  };
}
