import { normalizeGenericPropertyAdmissionOracle } from '../kern-frontend-generic-property-admission/oracle.mjs';
import { normalizeRetainedTokenStreamOracle } from '../kern-frontend-retained-token-stream/oracle.mjs';

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

function profileFailure(detail) {
  throw new TypeError(`generic-property loop source profile rejection: ${detail}`);
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
  if (cursor < tokens.length && ['style', 'themeRef'].includes(tokens[cursor].kind)) {
    profileFailure(`${tokens[cursor].kind} tokens are deferred`);
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

export function normalizeGenericPropertyLoopOracle(content, snapshot, policy) {
  const inherited = normalizeGenericPropertyAdmissionOracle(content, snapshot, policy);
  if (inherited.status === 'failure') return failure(inherited.code, inherited.detail);
  const stream = normalizeRetainedTokenStreamOracle(content, policy);
  if (stream.status === 'failure') return failure(stream.code, stream.detail);
  if (inherited.state === 'dropped') {
    return {
      admittedType: '', diagnostics: [], finalProperties: [], format: policy.genericPropertyLoopFormat,
      inherited, knownState: 'dropped', parseEpoch: inherited.parseEpoch, quotedProperties: [],
      runtimeInstance: inherited.runtimeInstance, sourceProfile: policy.genericPropertyLoopSourceProfile,
      state: 'dropped', stream, terminalCursor: 0, terminalKind: 'dropped', writes: [],
    };
  }

  const tokens = stream.tokens;
  const properties = new Map();
  const quoteOrder = [];
  const writes = [];
  const diagnostics = [];
  let cursor = 1;
  while (cursor < tokens.length) {
    const cursorBefore = cursor;
    while (cursor < tokens.length && tokens[cursor].kind === 'whitespace') cursor += 1;
    if (cursor >= tokens.length) break;
    const keyToken = tokens[cursor];
    const equalsToken = tokens[cursor + 1];
    if (keyToken.kind !== 'identifier' || equalsToken?.kind !== 'equals') {
      profileFailure(`token ${cursor} is not a generic property`);
    }
    if (writes.length >= policy.maxGenericPropertyLoopProperties) profileFailure('property count exceeds policy');
    const key = keyToken.value;
    const duplicate = properties.has(key);
    const uniqueIndex = duplicate ? properties.get(key).uniqueIndex : properties.size;
    const parsed = parseValue(tokens, cursor + 2);
    const diagnosticIndex = duplicate ? diagnostics.length : null;
    const col = 1 + [...content].slice(0, keyToken.startScalar).join('').length;
    const write = {
      ...parsed,
      cursorBefore,
      ...(duplicate ? { diagnosticCol: col, diagnosticEndCol: col + key.length } : {}),
      diagnosticIndex,
      duplicate,
      equalsIndex: cursor + 1,
      key,
      propertyIndex: cursor,
      uniqueIndex,
      writeIndex: writes.length,
    };
    if (duplicate) {
      diagnostics.push({
        code: 'DUPLICATE_PROP',
        col,
        endCol: col + key.length,
        endLine: 1,
        index: diagnosticIndex,
        line: 1,
        message: `Duplicate property '${key}' at line 1`,
        severity: 'warning',
        writeIndex: write.writeIndex,
      });
    }
    const existing = properties.get(key);
    let quoteGeneration = existing?.quoteGeneration ?? 0;
    if (parsed.quoted) {
      if (!existing?.quoted) {
        quoteOrder.push(key);
        quoteGeneration = write.writeIndex + 1;
      }
    } else {
      const quoteIndex = quoteOrder.indexOf(key);
      if (quoteIndex >= 0) quoteOrder.splice(quoteIndex, 1);
      quoteGeneration = 0;
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
    write.quoteGeneration = quoteGeneration;
    writes.push(write);
    cursor = parsed.cursorAfter;
  }

  const finalProperties = [...properties.values()];
  const quotedProperties = quoteOrder.map((key, index) => {
    const property = properties.get(key);
    return { generation: property.quoteGeneration, key, orderIndex: index, propertyIndex: property.uniqueIndex };
  });
  if (writes.length === 0 && inherited.state === 'property') profileFailure('M4.164 property is missing from loop');
  if (writes.length > 0) {
    const first = writes[0];
    if (
      inherited.state !== 'property' || inherited.key !== first.key || inherited.valueKind !== first.valueKind ||
      inherited.value !== first.value || inherited.quoted !== first.quoted || inherited.propertyIndex !== first.propertyIndex ||
      inherited.equalsIndex !== first.equalsIndex || inherited.valueIndex !== first.valueIndex ||
      inherited.cursorAfter !== first.cursorAfter ||
      inherited.consumedValueTokenCount !== first.consumedValueTokenCount
    ) profileFailure('M4.164 first-property decision drift');
  }
  return {
    admittedType: inherited.admittedType,
    diagnostics,
    finalProperties,
    format: policy.genericPropertyLoopFormat,
    inherited,
    knownState: inherited.knownState,
    parseEpoch: inherited.parseEpoch,
    quotedProperties,
    runtimeInstance: inherited.runtimeInstance,
    sourceProfile: policy.genericPropertyLoopSourceProfile,
    state: 'loop',
    stream,
    terminalCursor: cursor,
    terminalKind: 'eof',
    writes,
  };
}
