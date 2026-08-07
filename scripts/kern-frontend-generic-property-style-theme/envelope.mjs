import assert from 'node:assert/strict';

import { normalizeGenericPropertyStyleThemeOracle } from './oracle.mjs';

export const STYLE_THEME_RECORD_WIDTH = 24;

function fail(detail) {
  throw new Error(`style/theme replay record rejection: ${detail}`);
}

function uint(field, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(field)) fail(`${label} must be canonical uint`);
  const value = Number(field);
  if (!Number.isSafeInteger(value)) fail(`${label} exceeds safe integer`);
  return value;
}

function optionalUint(field, label) {
  return field === 'none' ? null : uint(field, label);
}

function bool(field, label) {
  if (field === 'true') return true;
  if (field === 'false') return false;
  fail(`${label} must be canonical boolean`);
}

function emptyTail(record, start, label) {
  if (record.slice(start).some(Boolean)) fail(`${label} padding is not empty`);
}

function parseProperty(record, transitionIndex, writeIndex) {
  if (
    record[0] !== 'property-write' || uint(record[1], 'property transition') !== transitionIndex ||
    uint(record[2], 'property write') !== writeIndex
  ) fail('property transition identity drift');
  emptyTail(record, 19, 'property transition');
  const valueKind = record[4];
  const quoted = bool(record[6], 'property quoted');
  const duplicate = bool(record[7], 'property duplicate');
  const diagnosticIndex = optionalUint(record[14], 'property diagnostic index');
  const write = {
    consumedValueTokenCount: uint(record[13], 'property consumed count'),
    cursorAfter: uint(record[12], 'property cursor after'),
    cursorBefore: uint(record[8], 'property cursor before'),
    diagnosticIndex,
    duplicate,
    equalsIndex: uint(record[10], 'property equals index'),
    key: record[3],
    propertyIndex: uint(record[9], 'property token index'),
    quoteGeneration: uint(record[18], 'property quote generation'),
    quoted,
    transitionIndex,
    type: 'property',
    uniqueIndex: uint(record[17], 'property unique index'),
    value: record[5],
    valueIndex: optionalUint(record[11], 'property value index'),
    valueKind,
    writeIndex,
  };
  if (
    write.key === '' || !['empty', 'quoted', 'expr', 'bare'].includes(valueKind) ||
    write.equalsIndex !== write.propertyIndex + 1 || write.cursorAfter < write.equalsIndex + 1 ||
    quoted !== (valueKind === 'quoted') || duplicate !== (diagnosticIndex !== null)
  ) fail('property transition semantics drift');
  if (duplicate) {
    write.diagnosticCol = uint(record[15], 'duplicate col');
    write.diagnosticEndCol = uint(record[16], 'duplicate end col');
  } else if (record[15] !== 'none' || record[16] !== 'none') fail('non-duplicate diagnostic drift');
  return write;
}

function parseTheme(record, transitionIndex, themeIndex) {
  if (
    record[0] !== 'theme' || uint(record[1], 'theme transition') !== transitionIndex ||
    uint(record[2], 'theme index') !== themeIndex || record[4] === ''
  ) fail('theme transition identity drift');
  emptyTail(record, 7, 'theme transition');
  const tokenIndex = uint(record[3], 'theme token index');
  const cursorBefore = uint(record[5], 'theme cursor before');
  const cursorAfter = uint(record[6], 'theme cursor after');
  if (cursorBefore !== tokenIndex || cursorAfter !== tokenIndex + 1) fail('theme cursor drift');
  return { cursorAfter, cursorBefore, themeIndex, tokenIndex, transitionIndex, type: 'theme', value: record[4] };
}

function parseStyleTransition(record, transitionIndex, styleOrdinal) {
  if (
    record[0] !== 'style' || uint(record[1], 'style transition') !== transitionIndex ||
    uint(record[2], 'style ordinal') !== styleOrdinal
  ) fail('style transition identity drift');
  emptyTail(record, 14, 'style transition');
  const tokenIndex = uint(record[3], 'style token index');
  const cursorBefore = uint(record[6], 'style cursor before');
  const cursorAfter = uint(record[7], 'style cursor after');
  if (cursorBefore !== tokenIndex || cursorAfter !== tokenIndex + 1) fail('style cursor drift');
  return {
    cursorAfter,
    cursorBefore,
    interpretationBase: uint(record[10], 'style pair base'),
    interpretationCount: uint(record[11], 'style pair count'),
    segmentBase: uint(record[8], 'style segment base'),
    segmentCount: uint(record[9], 'style segment count'),
    styleOrdinal,
    styleWriteBase: uint(record[12], 'style write base'),
    styleWriteCount: uint(record[13], 'style write count'),
    tokenIndex,
    tokenStart: uint(record[4], 'style token start'),
    transitionIndex,
    type: 'style',
    value: record[5],
  };
}

function parseSegment(record, index) {
  if (record[0] !== 'segment' || uint(record[1], 'segment index') !== index) fail('segment identity drift');
  emptyTail(record, 13, 'segment');
  const start = uint(record[5], 'segment start');
  const end = uint(record[6], 'segment end');
  const trimStart = uint(record[7], 'segment trim start');
  const trimEnd = uint(record[8], 'segment trim end');
  if (start > end || trimStart < start || trimEnd < trimStart || trimEnd > end) fail('segment offset drift');
  return {
    delimiterOffset: optionalUint(record[9], 'segment delimiter'),
    end,
    raw: record[11],
    retained: bool(record[10], 'segment retained'),
    segmentIndex: index,
    segmentOrdinal: uint(record[4], 'segment ordinal'),
    start,
    styleOrdinal: uint(record[2], 'segment style ordinal'),
    text: record[12],
    tokenIndex: uint(record[3], 'segment token index'),
    trimEnd,
    trimStart,
  };
}

function parseInterpretation(record, index) {
  if (record[0] !== 'pair' || uint(record[1], 'pair index') !== index) fail('pair identity drift');
  emptyTail(record, 9, 'pair');
  if (!['pseudo', 'quoted-key', 'normal', 'ignored'].includes(record[5])) fail('pair kind drift');
  return {
    interpretationIndex: index,
    key: record[6],
    kind: record[5],
    pseudo: record[7],
    retained: true,
    segmentIndex: uint(record[4], 'pair segment index'),
    styleOrdinal: uint(record[2], 'pair style ordinal'),
    tokenIndex: uint(record[3], 'pair token index'),
    value: record[8],
  };
}

function parseStyleWrite(record, index) {
  if (record[0] !== 'style-write' || uint(record[1], 'style write index') !== index) fail('style write identity drift');
  emptyTail(record, 11, 'style write');
  if (!['style', 'pseudo'].includes(record[6])) fail('style write kind drift');
  return {
    interpretationIndex: uint(record[4], 'write pair index'),
    key: record[8],
    kind: record[6],
    pseudo: record[7],
    segmentIndex: uint(record[5], 'write segment index'),
    styleOrdinal: uint(record[2], 'write style ordinal'),
    tokenIndex: uint(record[3], 'write token index'),
    value: record[9],
    visible: bool(record[10], 'write visibility'),
    writeIndex: index,
  };
}

function derivePropertyState(writes) {
  const properties = new Map();
  const diagnostics = [];
  for (const write of writes) {
    const existing = properties.get(write.key);
    if (write.duplicate !== Boolean(existing) || write.uniqueIndex !== (existing?.uniqueIndex ?? properties.size)) {
      fail('property identity drift');
    }
    if (write.duplicate) diagnostics.push({
      code: 'DUPLICATE_PROP', col: write.diagnosticCol, endCol: write.diagnosticEndCol, endLine: 1,
      index: write.diagnosticIndex, line: 1, message: `Duplicate property '${write.key}' at line 1`,
      severity: 'warning', writeIndex: write.writeIndex,
    });
    properties.set(write.key, {
      firstWriteIndex: existing?.firstWriteIndex ?? write.writeIndex, key: write.key,
      lastWriteIndex: write.writeIndex, quoteGeneration: write.quoteGeneration, quoted: write.quoted,
      uniqueIndex: write.uniqueIndex, value: write.value, valueKind: write.valueKind,
    });
  }
  const finalProperties = [...properties.values()];
  const quotedProperties = finalProperties.filter(({ quoted }) => quoted)
    .sort((left, right) => left.quoteGeneration - right.quoteGeneration)
    .map(({ key, quoteGeneration: generation, uniqueIndex: propertyIndex }, orderIndex) => (
      { generation, key, orderIndex, propertyIndex }
    ));
  return { diagnostics, finalProperties, quotedProperties };
}

function streamWithUtf16Starts(stream) {
  let startUtf16 = 0;
  return stream.tokens.map((token) => {
    startUtf16 += token.startDelta.length;
    return { ...token, startUtf16 };
  });
}

export function parseGenericPropertyStyleThemeReplay(content, snapshot, fields, policy, inherited, stream) {
  if (
    fields[0] !== policy.genericPropertyStyleThemeReplayFormat || fields.length < 49 ||
    (fields.length - 1) % STYLE_THEME_RECORD_WIDTH !== 0 ||
    fields.length > policy.maxGenericPropertyStyleThemeReplayEnvelopeFields
  ) fail('invalid replay envelope');
  const header = fields.slice(1, 25);
  const seal = fields.slice(-24);
  if (header[0] === 'failure') {
    if (fields.length !== 49 || header[1] === '' || uint(header[3], 'failure runtime') !== snapshot.runtimeInstance ||
      uint(header[4], 'failure epoch') !== snapshot.parseEpoch || header[5] !== content || header.slice(6).some(Boolean)) {
      fail('invalid replay failure header');
    }
    if (
      seal[0] !== 'failure-seal' || seal[1] !== header[1] || seal[2] !== header[2] || seal[3] !== content ||
      seal[4] !== header[3] || seal[5] !== header[4] || seal.slice(6).some(Boolean)
    ) fail('invalid replay failure seal');
    return { code: header[1], detail: header[2], status: 'failure' };
  }
  if (header[0] !== 'decision') fail('invalid replay header tag');
  const counts = {
    transitions: uint(header[4], 'transition count'), properties: uint(header[5], 'property count'),
    themes: uint(header[6], 'theme count'), styles: uint(header[7], 'style count'),
    segments: uint(header[8], 'segment count'), interpretations: uint(header[9], 'pair count'),
    styleWrites: uint(header[10], 'style write count'), finalStyles: uint(header[11], 'final style count'),
    finalPseudos: uint(header[12], 'final pseudo count'), finalPseudoEntries: uint(header[13], 'final pseudo entry count'),
  };
  if (
    counts.transitions !== counts.properties + counts.themes + counts.styles ||
    counts.transitions > policy.maxGenericPropertyStyleThemeTransitions ||
    counts.properties > policy.maxGenericPropertyStyleThemeProperties ||
    counts.themes > policy.maxGenericPropertyStyleThemeThemeRefs ||
    counts.styles > policy.maxGenericPropertyStyleThemeStyleTokens ||
    counts.segments > policy.maxGenericPropertyStyleThemeStyleSegments ||
    counts.interpretations > policy.maxGenericPropertyStyleThemeStylePairs ||
    counts.styleWrites > policy.maxGenericPropertyStyleThemeStyleWrites
  ) fail('replay count exceeds policy');
  const expectedRecords = 2 + Object.values(counts).reduce((sum, value) => sum + value, 0) - counts.properties -
    counts.themes - counts.styles;
  if (fields.length !== 1 + expectedRecords * 24) fail('replay record count drift');

  let cursor = 25;
  const transitions = [];
  const writes = [];
  const themeRefs = [];
  const styleTransitions = [];
  for (let index = 0; index < counts.transitions; index += 1, cursor += 24) {
    const record = fields.slice(cursor, cursor + 24);
    let transition;
    if (record[0] === 'property-write') transition = parseProperty(record, index, writes.length);
    else if (record[0] === 'theme') transition = parseTheme(record, index, themeRefs.length);
    else transition = parseStyleTransition(record, index, styleTransitions.length);
    transitions.push(transition);
    if (transition.type === 'property') writes.push(transition);
    else if (transition.type === 'theme') themeRefs.push(transition.value);
    else styleTransitions.push(transition);
  }
  const segments = [];
  const interpretations = [];
  const styleWrites = [];
  const evidenceCount = counts.segments + counts.interpretations + counts.styleWrites;
  for (let index = 0; index < evidenceCount; index += 1, cursor += 24) {
    const record = fields.slice(cursor, cursor + 24);
    if (record[0] === 'segment') segments.push(parseSegment(record, segments.length));
    else if (record[0] === 'pair') interpretations.push(parseInterpretation(record, interpretations.length));
    else if (record[0] === 'style-write') styleWrites.push(parseStyleWrite(record, styleWrites.length));
    else fail('unexpected style evidence tag');
  }
  if (segments.length !== counts.segments || interpretations.length !== counts.interpretations ||
    styleWrites.length !== counts.styleWrites) fail('style evidence kind count drift');

  const finalStyles = [];
  for (let index = 0; index < counts.finalStyles; index += 1, cursor += 24) {
    const record = fields.slice(cursor, cursor + 24);
    if (record[0] !== 'final-style' || uint(record[1], 'final style order') !== index) fail('final style drift');
    emptyTail(record, 4, 'final style');
    finalStyles.push({ key: record[2], orderIndex: index, value: record[3] });
  }
  const finalPseudoHeaders = [];
  for (let index = 0; index < counts.finalPseudos; index += 1, cursor += 24) {
    const record = fields.slice(cursor, cursor + 24);
    if (record[0] !== 'final-pseudo' || uint(record[1], 'final pseudo order') !== index) fail('final pseudo drift');
    emptyTail(record, 4, 'final pseudo');
    finalPseudoHeaders.push({ entryCount: uint(record[3], 'pseudo entry count'), pseudo: record[2] });
  }
  const pseudoEntries = [];
  for (let index = 0; index < counts.finalPseudoEntries; index += 1, cursor += 24) {
    const record = fields.slice(cursor, cursor + 24);
    if (record[0] !== 'final-pseudo-entry' || uint(record[1], 'global pseudo entry') !== index) {
      fail('final pseudo entry drift');
    }
    emptyTail(record, 7, 'final pseudo entry');
    pseudoEntries.push({
      key: record[5], orderIndex: uint(record[4], 'pseudo key order'),
      pseudo: record[3], pseudoOrder: uint(record[2], 'pseudo order'), value: record[6],
    });
  }
  const finalPseudoStyles = finalPseudoHeaders.map(({ entryCount, pseudo }, pseudoOrder) => {
    const entries = pseudoEntries.filter((entry) => entry.pseudoOrder === pseudoOrder).map(
      ({ key, orderIndex, value }) => ({ key, orderIndex, value }),
    );
    if (entries.length !== entryCount || entries.some((entry, index) => entry.orderIndex !== index)) {
      fail('final pseudo grouping drift');
    }
    return { entries, pseudo };
  });
  if (cursor !== fields.length - 24) fail('replay seal is not terminal');

  const tokens = streamWithUtf16Starts(stream);
  for (const transition of styleTransitions) {
    const token = tokens[transition.tokenIndex];
    if (!token || token.kind !== 'style' || token.value !== transition.value || token.startUtf16 !== transition.tokenStart) {
      fail('style transition is displaced from authenticated stream');
    }
    const ownedSegments = segments.filter(({ styleOrdinal }) => styleOrdinal === transition.styleOrdinal);
    const ownedPairs = interpretations.filter(({ styleOrdinal }) => styleOrdinal === transition.styleOrdinal);
    const ownedWrites = styleWrites.filter(({ styleOrdinal }) => styleOrdinal === transition.styleOrdinal);
    if (
      ownedSegments.length !== transition.segmentCount || ownedSegments[0]?.segmentIndex !== transition.segmentBase ||
      ownedPairs.length !== transition.interpretationCount ||
      (ownedPairs.length > 0 && ownedPairs[0].interpretationIndex !== transition.interpretationBase) ||
      ownedWrites.length !== transition.styleWriteCount ||
      (ownedWrites.length > 0 && ownedWrites[0].writeIndex !== transition.styleWriteBase)
    ) fail('style transition evidence range drift');
  }

  const decision = {
    admittedType: header[3], firstStyleCursor: optionalUint(header[18], 'first style cursor'),
    knownState: header[2], predecessorState: header[19], state: header[1],
    terminalCursor: uint(header[14], 'terminal cursor'), terminalKind: header[15],
  };
  if (
    uint(header[16], 'replay runtime') !== snapshot.runtimeInstance ||
    uint(header[17], 'replay epoch') !== snapshot.parseEpoch || header[20] !== policy.styleBlockEvidenceFormat ||
    header.slice(21).some(Boolean)
  ) fail('replay identity drift');
  if (
    seal[0] !== 'seal' || seal[1] !== header[1] || seal[2] !== header[2] || seal[3] !== header[3] ||
    seal.slice(4, 15).some((field, index) => field !== header[index + 4]) || seal[15] !== content ||
    seal[16] !== header[16] || seal[17] !== header[17] || seal[18] !== header[18] || seal[19] !== header[19] ||
    seal[20] !== header[20] || seal.slice(21).some(Boolean)
  ) fail('replay terminal seal drift');

  const propertyState = derivePropertyState(writes);
  const actual = {
    admittedType: decision.admittedType,
    ...propertyState,
    finalPseudoStyles,
    finalStyles,
    firstStyleCursor: decision.firstStyleCursor,
    format: policy.genericPropertyStyleThemeFormat,
    inherited,
    interpretations,
    knownState: decision.knownState,
    parseEpoch: snapshot.parseEpoch,
    predecessorState: decision.predecessorState,
    runtimeInstance: snapshot.runtimeInstance,
    segments,
    sourceProfile: policy.genericPropertyStyleThemeSourceProfile,
    state: decision.state,
    stream,
    styleWrites,
    terminalCursor: decision.terminalCursor,
    terminalKind: decision.terminalKind,
    themeRefs,
    transitions,
    writes,
  };
  const expected = normalizeGenericPropertyStyleThemeOracle(content, snapshot, policy, inherited, stream);
  assert.deepEqual(actual, expected);
  return actual;
}
