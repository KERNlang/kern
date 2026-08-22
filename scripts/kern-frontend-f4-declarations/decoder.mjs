import { createHash } from 'node:crypto';
import { decodeExpression } from '../kern-frontend-f2-expression/decoder.mjs';

const UINT = /^(?:0|[1-9][0-9]*)$/u;
const INT = /^(?:-1|0|[1-9][0-9]*)$/u;
const STATUSES = new Set(['classified', 'rejected', 'fatal']);
const REPRESENTATIONS = new Set(['bare', 'quoted', 'expression']);
const PROPERTY_DISPOSITIONS = new Set([
  'excluded-host-expression', 'excluded-host-type', 'excluded-raw-block', 'included-value',
  'lowered-branch-path-value', 'lowered-each-collection-reference', 'lowered-expression',
  'lowered-import-path', 'lowered-type',
]);
const FACT_DOMAINS = new Set(['structural', 'module']);
const FACT_CODES = new Set([
  'unknown-node-kind', 'unknown-property', 'missing-property', 'excluded-host-payload',
  'invalid-property', 'invalid-child', 'unknown-expression-kind', 'invalid-expression',
  'invalid-type', 'invalid-import-path', 'invalid-module-root',
]);
const FATAL_CODES = new Set([
  'F4_INVALID_REQUEST', 'F4_AUTHORITY_DRIFT', 'F4_F1_DRIFT', 'F4_F2B_DRIFT',
  'F4_F3_DRIFT', 'F4_LIMIT', 'FORCED_LATE_FAILURE',
]);

export function fail(message) {
  throw new Error(`F4 declarations decoder: ${message}`);
}

export function isCanonicalModuleId(value) {
  if (typeof value !== 'string' || value === '' || !value.endsWith('.kern') ||
      value.startsWith('/') || value.includes('\\') || value.includes(':') ||
      value.includes('//') || value.endsWith('/')) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function integer(text, label, signed = false) {
  const pattern = signed ? INT : UINT;
  if (typeof text !== 'string' || !pattern.test(text)) fail(`${label} integer`);
  const value = Number(text);
  if (!Number.isSafeInteger(value)) fail(`${label} range`);
  return value;
}

function boolean(text, label) {
  if (text !== 'true' && text !== 'false') fail(`${label} boolean`);
  return text === 'true';
}

class Cursor {
  constructor(text, label) {
    this.points = Array.from(text);
    this.index = 0;
    this.label = label;
  }
  done() { return this.index === this.points.length; }
  take(expected) {
    if (this.points[this.index] !== expected) fail(`${this.label} expected ${expected}`);
    this.index += 1;
  }
  until(delimiter) {
    const start = this.index;
    while (this.index < this.points.length && this.points[this.index] !== delimiter) this.index += 1;
    if (this.index === this.points.length) fail(`${this.label} missing ${delimiter}`);
    return this.points.slice(start, this.index).join('');
  }
  width(count) {
    if (count < 0 || this.index + count > this.points.length) fail(`${this.label} width`);
    const value = this.points.slice(this.index, this.index + count).join('');
    this.index += count;
    return value;
  }
}

function framed(cursor, marker) {
  cursor.take(marker);
  const length = integer(cursor.until(':'), `${cursor.label} length`);
  cursor.take(':');
  return cursor.width(length);
}

export function listTape(text, label) {
  if (text === '') return [];
  const cursor = new Cursor(text, label);
  const values = [];
  while (!cursor.done()) values.push(framed(cursor, 'i'));
  return values;
}

function rows(text, label) {
  return listTape(text, `${label} tape`).map((row, index) => listTape(row, `${label} row ${index}`));
}

function decodeDeclaration(fields, index, sourceScalars) {
  if (fields.length !== 10) fail('declaration field count');
  const ordinal = integer(fields[0], 'declaration ordinal');
  if (ordinal !== index) fail('declaration ordinal order');
  const startScalar = integer(fields[6], 'declaration start');
  const endScalar = integer(fields[7], 'declaration end');
  if (endScalar < startScalar || endScalar > sourceScalars) fail('declaration span');
  return {
    ordinal,
    logicalOrdinal: integer(fields[1], 'declaration logical'),
    kind: fields[2],
    catalogOrdinal: integer(fields[3], 'declaration catalog'),
    schemaStatus: fields[4],
    disposition: fields[5],
    startScalar,
    endScalar,
    parentLogicalOrdinal: integer(fields[8], 'declaration parent', true),
    detached: boolean(fields[9], 'declaration detached'),
  };
}

function decodeOccurrence(fields, index, sourceScalars) {
  if (fields.length !== 13) fail('property occurrence field count');
  const ordinal = integer(fields[0], 'occurrence ordinal');
  if (ordinal !== index) fail('occurrence ordinal order');
  const startScalar = integer(fields[10], 'occurrence start');
  const endScalar = integer(fields[11], 'occurrence end');
  if (endScalar < startScalar || endScalar > sourceScalars) fail('occurrence span');
  if (!PROPERTY_DISPOSITIONS.has(fields[7]) || !REPRESENTATIONS.has(fields[8]) ||
      (fields[6] !== 'true' && fields[6] !== 'false')) fail('occurrence vocabulary');
  return {
    ordinal,
    ownerLogicalOrdinal: integer(fields[1], 'occurrence owner'),
    ownerKind: fields[2],
    propertyName: fields[3],
    catalogOrdinal: integer(fields[4], 'occurrence catalog'),
    schemaKind: fields[5],
    required: fields[6] === 'true',
    disposition: fields[7],
    valueRepresentation: fields[8],
    f2bSegmentOrdinal: integer(fields[9], 'occurrence segment', true),
    startScalar,
    endScalar,
    value: fields[12],
  };
}

function decodePresence(fields) {
  if (fields.length !== 3) fail('property presence field count');
  return {
    ownerLogicalOrdinal: integer(fields[0], 'presence owner'),
    propertyName: fields[1],
    effectiveOccurrenceOrdinal: integer(fields[2], 'presence occurrence', true),
  };
}

const PROPERTY_AUTHORITY_KEYS = [
  'nodeKinds', 'propertyNames', 'schemaKinds', 'required', 'dispositions',
];
const CONSTITUTION_PROPERTY_ROWS = 1_149;

function propertyKey(ownerLogicalOrdinal, propertyName) {
  return JSON.stringify([ownerLogicalOrdinal, propertyName]);
}

function validatePropertyContract(occurrences, presenceRows, context) {
  const authority = context.propertyAuthority;
  if (!authority || typeof authority !== 'object' || Array.isArray(authority) ||
      Object.keys(authority).sort().join('|') !== [...PROPERTY_AUTHORITY_KEYS].sort().join('|') ||
      PROPERTY_AUTHORITY_KEYS.some((key) => !Array.isArray(authority[key])) ||
      PROPERTY_AUTHORITY_KEYS.some((key) => authority[key].length !== authority.nodeKinds.length) ||
      authority.nodeKinds.length !== CONSTITUTION_PROPERTY_ROWS) fail('property authority shape');
  const lastOccurrenceByKey = new Map();
  let previousStart = -1;
  for (const occurrence of occurrences) {
    const catalogOrdinal = occurrence.catalogOrdinal;
    if (catalogOrdinal >= authority.nodeKinds.length ||
        occurrence.ownerKind !== authority.nodeKinds[catalogOrdinal] ||
        occurrence.propertyName !== authority.propertyNames[catalogOrdinal] ||
        occurrence.schemaKind !== authority.schemaKinds[catalogOrdinal] ||
        occurrence.required !== (authority.required[catalogOrdinal] === 'true') ||
        occurrence.disposition !== authority.dispositions[catalogOrdinal]) {
      fail('property authority binding');
    }
    if (occurrence.startScalar < previousStart) fail('occurrence order');
    previousStart = occurrence.startScalar;
    if ((occurrence.disposition === 'excluded-host-expression' ||
        occurrence.disposition === 'excluded-host-type' ||
        occurrence.disposition === 'excluded-raw-block') && occurrence.value !== '') {
      fail('excluded property payload');
    }
    lastOccurrenceByKey.set(propertyKey(occurrence.ownerLogicalOrdinal, occurrence.propertyName),
      occurrence.ordinal);
  }
  const seenPresence = new Set();
  for (const presence of presenceRows) {
    const key = propertyKey(presence.ownerLogicalOrdinal, presence.propertyName);
    if (seenPresence.has(key)) fail('property presence duplicate');
    seenPresence.add(key);
    const expected = lastOccurrenceByKey.get(key);
    if (expected === undefined ? presence.effectiveOccurrenceOrdinal !== -1 :
      presence.effectiveOccurrenceOrdinal !== expected) fail('property presence binding');
  }
  for (const key of lastOccurrenceByKey.keys()) {
    if (!seenPresence.has(key)) fail('property presence missing');
  }
}

function decodeAttachment(fields) {
  if (fields.length !== 3) fail('attachment field count');
  if (fields[2] !== 'attached' && fields[2] !== 'detached-local') fail('attachment disposition');
  return {
    parentLogicalOrdinal: integer(fields[0], 'attachment parent'),
    childLogicalOrdinal: integer(fields[1], 'attachment child'),
    disposition: fields[2],
  };
}

function decodeDecorator(fields, sourceScalars) {
  if (fields.length !== 6) fail('decorator field count');
  const startScalar = integer(fields[4], 'decorator start');
  const endScalar = integer(fields[5], 'decorator end');
  if (endScalar < startScalar || endScalar > sourceScalars) fail('decorator span');
  if ((fields[1] !== 'attached' && fields[1] !== 'dropped') ||
      (fields[3] !== 'true' && fields[3] !== 'false')) fail('decorator vocabulary');
  return {
    logicalOrdinal: integer(fields[0], 'decorator logical'),
    disposition: fields[1],
    targetLogicalOrdinal: integer(fields[2], 'decorator target', true),
    explicitExport: fields[3] === 'true',
    startScalar,
    endScalar,
  };
}

function decodeSymbol(fields) {
  if (fields.length !== 5) fail('symbol field count');
  return {
    kind: fields[0], name: fields[1], exported: boolean(fields[2], 'symbol exported'),
    logicalOrdinal: integer(fields[3], 'symbol logical'),
    startScalar: integer(fields[4], 'symbol start'),
  };
}

function decodeBinding(fields) {
  if (fields.length !== 8) fail('binding field count');
  if (!isCanonicalModuleId(fields[0]) || !isCanonicalModuleId(fields[1])) fail('binding module id');
  return {
    moduleId: fields[0], targetModuleId: fields[1], imported: fields[2], local: fields[3],
    requestedKind: fields[4], reexport: boolean(fields[5], 'binding reexport'),
    logicalOrdinal: integer(fields[6], 'binding logical'), startScalar: integer(fields[7], 'binding start'),
  };
}

function decodeDiagnostic(fields, sourceScalars) {
  if (fields.length !== 5) fail('diagnostic field count');
  const startScalar = integer(fields[2], 'diagnostic start');
  const endScalar = integer(fields[3], 'diagnostic end');
  if (endScalar < startScalar || endScalar > sourceScalars) fail('diagnostic span');
  if (fields[1] !== 'error' && fields[1] !== 'warning') fail('diagnostic severity');
  return { code: fields[0], severity: fields[1], startScalar, endScalar, logicalOrdinal: integer(fields[4], 'diagnostic logical', true) };
}

function decodeFact(fields, sourceScalars) {
  if (fields.length !== 6) fail('fact field count');
  const startScalar = integer(fields[2], 'fact start');
  const endScalar = integer(fields[3], 'fact end');
  if (endScalar < startScalar || endScalar > sourceScalars) fail('fact span');
  if (!FACT_DOMAINS.has(fields[0]) || !FACT_CODES.has(fields[1])) fail('fact vocabulary');
  return {
    domain: fields[0], code: fields[1], startScalar, endScalar,
    logicalOrdinal: integer(fields[4], 'fact logical', true), propertyName: fields[5], detail: fields[5],
  };
}

function decodeExpressionEvidence(fields, index, sourceScalars, context, occurrences) {
  if (fields.length !== 12) fail('expression evidence field count');
  const evidenceOrdinal = integer(fields[0], 'evidence ordinal');
  const occurrenceOrdinal = integer(fields[1], 'evidence occurrence');
  const f2bSegmentOrdinal = integer(fields[3], 'evidence segment', true);
  const expressionStartScalar = integer(fields[4], 'evidence start');
  const expressionEndScalar = integer(fields[5], 'evidence end');
  const nodeCount = integer(fields[10], 'evidence node count');
  if (evidenceOrdinal !== index || expressionEndScalar <= expressionStartScalar ||
      expressionEndScalar > sourceScalars || (fields[2] !== 'f2b' && fields[2] !== 'f4-local')) {
    fail('expression evidence identity');
  }
  const occurrence = occurrences[occurrenceOrdinal];
  if (!occurrence || occurrence.disposition !== 'lowered-expression') fail('expression occurrence binding');
  const boundaryMap = listTape(fields[7], `evidence ${index} boundary`).map((value) =>
    integer(value, 'evidence boundary'));
  const f2ReceiptTape = listTape(fields[8], `evidence ${index} F2 receipt`);
  if (f2ReceiptTape.length !== 9) fail('evidence F2 receipt field count');
  const decodedF2 = decodeExpression(f2ReceiptTape, fields[6], context.f2Policy);
  if (decodedF2.status !== 'parsed' || decodedF2.nodes.length !== nodeCount) fail('evidence F2 receipt');
  const absoluteSpans = rows(fields[9], `evidence ${index} absolute span`).map((row, nodeId) => {
    if (row.length !== 3 || integer(row[0], 'evidence span node') !== nodeId) fail('evidence span order');
    const startScalar = integer(row[1], 'evidence span start');
    const endScalar = integer(row[2], 'evidence span end');
    if (endScalar <= startScalar || endScalar > sourceScalars) fail('evidence span geometry');
    return { nodeId, startScalar, endScalar };
  });
  if (absoluteSpans.length !== nodeCount) fail('evidence span count');
  if (fields[2] === 'f2b') {
    const segment = context.f2bSegments[f2bSegmentOrdinal];
    if (occurrence.valueRepresentation !== 'expression' || !segment || boundaryMap.length !== 0 ||
        expressionStartScalar !== segment.bodyStartScalar || expressionEndScalar !== segment.bodyEndScalar ||
        fields[6] !== context.sourcePoints.slice(segment.bodyStartScalar, segment.bodyEndScalar).join('') ||
        JSON.stringify(f2ReceiptTape) !== JSON.stringify(context.f2bExpressions[f2bSegmentOrdinal])) {
      fail('F2B evidence binding');
    }
    const expectedSpans = context.f2bAbsoluteSpans.filter((row) =>
      row.segmentOrdinal === f2bSegmentOrdinal);
    if (JSON.stringify(absoluteSpans) !== JSON.stringify(expectedSpans.map(({ nodeId, startScalar, endScalar }) =>
      ({ nodeId, startScalar, endScalar })))) fail('F2B evidence spans');
  } else {
    if (occurrence.valueRepresentation !== 'quoted' || f2bSegmentOrdinal !== -1 ||
        boundaryMap.length !== Array.from(fields[6]).length + 1 ||
        boundaryMap[0] !== expressionStartScalar || boundaryMap.at(-1) !== expressionEndScalar) {
      fail('local evidence binding');
    }
    for (let boundary = 1; boundary < boundaryMap.length; boundary += 1) {
      if (boundaryMap[boundary] < boundaryMap[boundary - 1]) fail('evidence boundary order');
    }
    for (const node of decodedF2.nodes) {
      const span = absoluteSpans[node.id];
      if (!span || span.startScalar !== boundaryMap[node.startScalar] ||
          span.endScalar !== boundaryMap[node.endScalar]) fail('local evidence spans');
    }
  }
  const expectedSeal = `expression:${evidenceOrdinal}:${occurrenceOrdinal}:${fields[2]}:${Array.from(fields[6]).length}:${nodeCount}:${Array.from(fields[7]).length}:${Array.from(fields[8]).length}:${Array.from(fields[9]).length}:closed`;
  if (fields[11] !== expectedSeal) fail('expression row seal');
  return {
    evidenceOrdinal, occurrenceOrdinal, origin: fields[2], f2bSegmentOrdinal,
    expressionStartScalar, expressionEndScalar, decodedSource: fields[6], boundaryMap,
    f2ReceiptTape, absoluteSpans, nodeCount, rowSeal: fields[11], seal: sha256(fields),
  };
}

export function decodeDocument(fields, context) {
  if (!Array.isArray(fields) || fields.length !== 17 || fields.some((field) => typeof field !== 'string')) {
    fail('document field shape');
  }
  if (fields[0] !== 'kern.frontend.f4-document.2' || !STATUSES.has(fields[1])) fail('document identity');
  const sourceScalars = integer(fields[3], 'source scalars');
  if (sourceScalars !== context.sourceScalars) fail('source scalar drift');
  const diagnostics = rows(fields[11], 'diagnostic').map((row) => decodeDiagnostic(row, sourceScalars));
  for (let index = 1; index < diagnostics.length; index += 1) {
    if (diagnostics[index].startScalar < diagnostics[index - 1].startScalar) fail('diagnostic order');
  }
  const occurrences = rows(fields[5], 'occurrence').map((row, index) =>
    decodeOccurrence(row, index, sourceScalars));
  const propertyPresence = rows(fields[6], 'presence').map(decodePresence);
  if (fields[1] !== 'fatal') validatePropertyContract(occurrences, propertyPresence, context);
  const expressionEvidence = rows(fields[14], 'expression evidence').map((row, index) =>
    decodeExpressionEvidence(row, index, sourceScalars, context, occurrences));
  const sealParts = fields[16].split(':');
  const base = {
    header: {
      format: fields[0], moduleId: context.moduleId, sourceScalars,
      sourceSha256: context.sourceSha256, terminalSeal: fields[16],
      f4LocalF2CallCount: fields[1] === 'fatal' ? 0 : integer(sealParts[13], 'local F2 calls'),
      aggregateExpressionScalars: fields[1] === 'fatal' ? 0 : integer(sealParts[14], 'expression scalars'),
      aggregateExpressionNodes: fields[1] === 'fatal' ? 0 : integer(sealParts[15], 'expression nodes'),
      expressionAbsoluteSpans: fields[1] === 'fatal' ? 0 : integer(sealParts[16], 'expression spans'),
      expressionBoundaryEntries: fields[1] === 'fatal' ? 0 : integer(sealParts[17], 'expression boundaries'),
      expressionReceiptScalars: fields[1] === 'fatal' ? 0 : integer(sealParts[18], 'expression receipt scalars'),
    },
    status: fields[1],
    declarations: rows(fields[4], 'declaration').map((row, index) => decodeDeclaration(row, index, sourceScalars)),
    propertyOccurrences: occurrences,
    propertyPresence,
    attachments: rows(fields[7], 'attachment').map(decodeAttachment),
    decorators: rows(fields[8], 'decorator').map((row) => decodeDecorator(row, sourceScalars)),
    symbols: rows(fields[9], 'symbol').map(decodeSymbol),
    bindings: rows(fields[10], 'binding').map(decodeBinding),
    diagnostics,
    facts: rows(fields[12], 'fact').map((row) => decodeFact(row, sourceScalars)),
    detachedLogicalOrdinals: rows(fields[13], 'detached').map((row) => {
      if (row.length !== 1) fail('detached field count');
      return integer(row[0], 'detached ordinal');
    }),
    expressionEvidence,
    workSteps: integer(fields[15], 'work steps'),
    seal: sha256(fields),
  };
  if (fields[1] === 'fatal') {
    if (fields[2] !== '' || base.declarations.length || base.propertyOccurrences.length || base.propertyPresence.length ||
        base.attachments.length || base.decorators.length || base.symbols.length || base.bindings.length ||
        base.facts.length || base.detachedLogicalOrdinals.length || base.expressionEvidence.length ||
        diagnostics.length !== 1 || !FATAL_CODES.has(diagnostics[0].code) || fields[16] !== 'failure') fail('fatal atomicity');
  } else {
    if (!isCanonicalModuleId(context.moduleId)) fail('module id');
    if (sealParts.length !== 20 || sealParts[0] !== 'document' || sealParts[1] !== fields[1] ||
        sealParts[19] !== 'closed') fail('terminal seal shape');
    const expected = `document:${fields[1]}:${Array.from(fields[4]).length}:${Array.from(fields[5]).length}:${Array.from(fields[6]).length}:${Array.from(fields[7]).length}:${Array.from(fields[8]).length}:${Array.from(fields[9]).length}:${Array.from(fields[10]).length}:${Array.from(fields[11]).length}:${Array.from(fields[12]).length}:${Array.from(fields[13]).length}:${Array.from(fields[14]).length}:${sealParts.slice(13, 19).join(':')}:closed`;
    if (fields[2] !== context.moduleId || fields[16] !== expected) fail('terminal seal');
    const recomputedScalars = expressionEvidence.reduce((total, row) =>
      total + Array.from(row.decodedSource).length, 0);
    const localEvidence = expressionEvidence.filter((row) => row.origin === 'f4-local');
    const localScalars = localEvidence.reduce((total, row) =>
      total + Array.from(row.decodedSource).length, 0);
    const recomputedBoundaries = localEvidence.reduce((total, row) => total + row.boundaryMap.length, 0);
    if (recomputedBoundaries !== localScalars + localEvidence.length ||
        base.header.aggregateExpressionScalars !== recomputedScalars ||
        base.header.expressionBoundaryEntries !== recomputedBoundaries) fail('sealed expression aggregates');
    if (fields[1] === 'classified' && base.facts.length !== 0) fail('classified facts');
    if (fields[1] === 'rejected' && (base.facts.length === 0 || base.symbols.length || base.bindings.length)) fail('rejected interface');
  }
  return base;
}
