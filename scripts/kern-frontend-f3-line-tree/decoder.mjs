import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';

const UINT = /^(?:0|[1-9][0-9]*)$/u;
const INT = /^(?:-1|0|[1-9][0-9]*)$/u;
const FAILURE_CODES = new Set([
  'F3_INVALID_REQUEST',
  'F3_LIMIT',
  'F3_F1_DRIFT',
  'F3_F2B_DRIFT',
  'FORCED_LATE_FAILURE',
]);
const STRUCTURAL_DIAGNOSTIC_CODES = new Set([
  'INVALID_INDENT',
  'DROPPED_LINE',
  'INDENT_JUMP',
]);
const FRAMING_ROLES = new Set(['ordinary', 'decorator', 'raw-owner', 'error']);
const DECORATOR_DISPOSITIONS = new Set(['candidate', 'orphan-eof', 'orphan-indent']);

export function fail(message) {
  throw new Error(`F3 line-tree decoder: ${message}`);
}

export function sha256(value) {
  const bytes = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(bytes).digest('hex');
}

function uint(text, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof text !== 'string' || !UINT.test(text)) fail(`${label} unsigned integer`);
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > maximum) fail(`${label} range`);
  return value;
}

function int(text, label) {
  if (typeof text !== 'string' || !INT.test(text)) fail(`${label} integer`);
  const value = Number(text);
  if (!Number.isSafeInteger(value)) fail(`${label} range`);
  return value;
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
    if (!Number.isSafeInteger(count) || count < 0 || this.index + count > this.points.length) {
      fail(`${this.label} width`);
    }
    const value = this.points.slice(this.index, this.index + count).join('');
    this.index += count;
    return value;
  }
}

export function framed(cursor, marker) {
  cursor.take(marker);
  const length = uint(cursor.until(':'), `${cursor.label} ${marker} length`);
  cursor.take(':');
  return cursor.width(length);
}

export function listTape(text, label) {
  if (text === '') return [];
  const cursor = new Cursor(text, label);
  const items = [];
  while (!cursor.done()) items.push(framed(cursor, 'i'));
  return items;
}

function decodeLogicalLineRow(text, ordinal, request, limits) {
  const fields = listTape(text, `logical line ${ordinal}`);
  if (fields.length !== 12) fail(`logical line ${ordinal} field count`);
  const row = {
    ordinal: uint(fields[0], 'logical ordinal', limits.maxLogicalLines),
    firstRecordOrdinal: uint(fields[1], 'first record ordinal'),
    lastRecordOrdinal: uint(fields[2], 'last record ordinal'),
    sourceStartScalar: uint(fields[3], 'source start scalar', request.sourceScalars),
    sourceEndScalar: uint(fields[4], 'source end scalar', request.sourceScalars),
    firstPhysicalLine: uint(fields[5], 'first physical line'),
    lastPhysicalLine: uint(fields[6], 'last physical line'),
    indentScalarCount: uint(fields[7], 'indent scalar count'),
    contentStartScalar: uint(fields[8], 'content start scalar', request.sourceScalars),
    role: fields[9],
    firstSegmentOrdinal: int(fields[10], 'first segment ordinal'),
    segmentCount: uint(fields[11], 'segment count'),
  };
  if (row.ordinal !== ordinal) fail('logical line ordinal mismatch');
  if (row.lastRecordOrdinal < row.firstRecordOrdinal) fail('logical line record bounds');
  if (row.sourceEndScalar < row.sourceStartScalar) fail('logical line scalar bounds');
  if (row.lastPhysicalLine < row.firstPhysicalLine) fail('logical line physical line bounds');
  if (row.contentStartScalar < row.sourceStartScalar || row.contentStartScalar > row.sourceEndScalar) {
    fail('logical line content start bounds');
  }
  if (!FRAMING_ROLES.has(row.role)) fail(`invalid framing role ${row.role}`);
  return row;
}

function decodeParentEdgeRow(text, index, logicalLines) {
  const fields = listTape(text, `parent edge ${index}`);
  if (fields.length !== 4) fail(`parent edge ${index} field count`);
  const childLogicalOrdinal = uint(fields[0], 'child logical ordinal');
  const parentLogicalOrdinal = int(fields[1], 'parent logical ordinal');
  const childIndent = uint(fields[2], 'child indent');
  const parentIndent = int(fields[3], 'parent indent');
  if (!logicalLines[childLogicalOrdinal]) fail('parent edge child line missing');
  if (parentLogicalOrdinal >= childLogicalOrdinal) fail('parent ordinal not strictly less than child');
  if (parentLogicalOrdinal === -1 && parentIndent !== -1) fail('root parent indent mismatch');
  if (parentLogicalOrdinal !== -1) {
    if (!logicalLines[parentLogicalOrdinal]) fail('parent edge parent line missing');
    if (parentIndent >= childIndent) fail('parent indent not strictly less than child indent');
  }
  return { childLogicalOrdinal, parentLogicalOrdinal, childIndent, parentIndent };
}

function decodeDecoratorRunRow(text, index, logicalLines) {
  const fields = listTape(text, `decorator run ${index}`);
  if (fields.length !== 5) fail(`decorator run ${index} field count`);
  const runOrdinal = uint(fields[0], 'run ordinal');
  const firstDecoratorOrdinal = uint(fields[1], 'first decorator ordinal');
  const lastDecoratorOrdinal = uint(fields[2], 'last decorator ordinal');
  const successorOrdinal = int(fields[3], 'successor ordinal');
  const disposition = fields[4];
  if (runOrdinal !== index) fail('decorator run ordinal mismatch');
  if (lastDecoratorOrdinal < firstDecoratorOrdinal) fail('decorator run range');
  if (!DECORATOR_DISPOSITIONS.has(disposition)) fail(`invalid decorator disposition ${disposition}`);
  if (disposition === 'orphan-eof') {
    if (successorOrdinal !== -1) fail('orphan-eof successor must be -1');
  } else {
    if (successorOrdinal <= lastDecoratorOrdinal || !logicalLines[successorOrdinal]) {
      fail('invalid decorator successor ordinal');
    }
  }
  return { runOrdinal, firstDecoratorOrdinal, lastDecoratorOrdinal, successorOrdinal, disposition };
}

function decodeRawBlockRow(text, index, logicalLines, request) {
  const fields = listTape(text, `raw block ${index}`);
  if (fields.length !== 8) fail(`raw block ${index} field count`);
  const rawOrdinal = uint(fields[0], 'raw ordinal');
  const ownerLogicalOrdinal = uint(fields[1], 'owner logical ordinal');
  const openerRecordOrdinal = uint(fields[2], 'opener record ordinal');
  const closerRecordOrdinal = int(fields[3], 'closer record ordinal');
  const bodyStartScalar = uint(fields[4], 'body start scalar', request.sourceScalars);
  const bodyEndScalar = uint(fields[5], 'body end scalar', request.sourceScalars);
  const inlineFlag = fields[6];
  const recognizedMultilineType = fields[7];
  if (rawOrdinal !== index) fail('raw block ordinal mismatch');
  if (!logicalLines[ownerLogicalOrdinal] || logicalLines[ownerLogicalOrdinal].role !== 'raw-owner') {
    fail('raw block owner mismatch');
  }
  if (bodyEndScalar < bodyStartScalar) fail('raw block body bounds');
  if (inlineFlag !== 'true' && inlineFlag !== 'false') fail('raw block inline flag');
  if (recognizedMultilineType === '') fail('raw block missing type');
  return {
    rawOrdinal,
    ownerLogicalOrdinal,
    openerRecordOrdinal,
    closerRecordOrdinal,
    bodyStartScalar,
    bodyEndScalar,
    inlineFlag,
    recognizedMultilineType,
  };
}

function decodeStructuralDiagnosticRow(text, index, request) {
  const fields = listTape(text, `diagnostic ${index}`);
  if (fields.length !== 4) fail(`diagnostic ${index} field count`);
  const code = fields[0];
  const startScalar = uint(fields[1], 'diagnostic start', request.sourceScalars);
  const endScalar = uint(fields[2], 'diagnostic end', request.sourceScalars);
  const logicalOrdinal = uint(fields[3], 'diagnostic logical ordinal');
  if (!STRUCTURAL_DIAGNOSTIC_CODES.has(code)) fail(`invalid structural diagnostic code ${code}`);
  if (endScalar < startScalar) fail('diagnostic scalar range');
  return { code, startScalar, endScalar, logicalOrdinal };
}

function decodeFailureDiagnostic(text, request, context) {
  const sourceScalars = request.sourceScalars;
  const cursor = new Cursor(text, 'failure diagnostic');
  const code = framed(cursor, 'C');
  const startScalar = uint(framed(cursor, 'S'), 'diagnostic start', sourceScalars);
  const endScalar = uint(framed(cursor, 'E'), 'diagnostic end', sourceScalars);
  if (!cursor.done() || !FAILURE_CODES.has(code) || endScalar < startScalar) fail('failure diagnostic shape');
  if (code === 'FORCED_LATE_FAILURE') {
    if (context.allowForcedLateFailure !== true) fail('forced late failure unauthorized');
  }
  return { code, startScalar, endScalar };
}

function validateLogicalEvidence(logicalLines, request) {
  let previousLast = -1;
  let segmentCursor = 0;
  for (const line of logicalLines) {
    const first = request.records[line.firstRecordOrdinal];
    const last = request.records[line.lastRecordOrdinal];
    if (!first || !last || first.ordinal !== line.firstRecordOrdinal || last.ordinal !== line.lastRecordOrdinal) {
      fail('logical line record evidence');
    }
    if (line.firstRecordOrdinal <= previousLast) fail('logical line record order');
    previousLast = line.lastRecordOrdinal;
    const expectedEnd = last.kind === 'newline' ? last.startScalar : last.endScalar;
    const expectedIndent = first.kind === 'whitespace' ? first.endScalar - first.startScalar : 0;
    const expectedContentStart = first.kind === 'whitespace' ? first.endScalar : first.startScalar;
    if (line.sourceStartScalar !== first.startScalar || line.sourceEndScalar !== expectedEnd ||
        line.indentScalarCount !== expectedIndent || line.contentStartScalar !== expectedContentStart) {
      fail('logical line source evidence');
    }
    const firstSegmentCursor = segmentCursor;
    while (segmentCursor < request.segments.length &&
           request.segments[segmentCursor].firstRecordOrdinal <= line.lastRecordOrdinal) {
      const segment = request.segments[segmentCursor];
      if (segment.firstRecordOrdinal < line.firstRecordOrdinal || segment.lastRecordOrdinal > line.lastRecordOrdinal ||
          segment.ordinal !== segmentCursor) {
        fail('logical line segment containment');
      }
      segmentCursor += 1;
    }
    const containedCount = segmentCursor - firstSegmentCursor;
    const expectedFirst = containedCount === 0 ? -1 : firstSegmentCursor;
    if (line.firstSegmentOrdinal !== expectedFirst || line.segmentCount !== containedCount) {
      fail('logical line segment evidence');
    }
  }
  if (segmentCursor !== request.segments.length) fail('logical line segment coverage');
}

function validateParentEvidence(parentEdges, logicalLines) {
  const stack = [];
  let edgeIndex = 0;
  for (const line of logicalLines) {
    if (line.role === 'decorator') continue;
    while (stack.length > 0 && stack.at(-1).indent >= line.indentScalarCount) stack.pop();
    const parent = stack.at(-1);
    const edge = parentEdges[edgeIndex];
    if (!edge || edge.childLogicalOrdinal !== line.ordinal ||
        edge.parentLogicalOrdinal !== (parent?.ordinal ?? -1) ||
        edge.childIndent !== line.indentScalarCount || edge.parentIndent !== (parent?.indent ?? -1)) {
      fail('parent edge stack evidence');
    }
    stack.push({ indent: line.indentScalarCount, ordinal: line.ordinal });
    edgeIndex += 1;
  }
  if (edgeIndex !== parentEdges.length) fail('parent edge coverage');
}

function validateDecoratorEvidence(decoratorRuns, logicalLines) {
  const expected = [];
  for (let cursor = 0; cursor < logicalLines.length;) {
    const line = logicalLines[cursor];
    if (line.role !== 'decorator') {
      cursor += 1;
      continue;
    }
    const first = cursor;
    const indent = line.indentScalarCount;
    while (cursor + 1 < logicalLines.length && logicalLines[cursor + 1].role === 'decorator' &&
           logicalLines[cursor + 1].indentScalarCount === indent) cursor += 1;
    const last = cursor;
    const successor = logicalLines[last + 1];
    expected.push({
      runOrdinal: expected.length,
      firstDecoratorOrdinal: first,
      lastDecoratorOrdinal: last,
      successorOrdinal: successor?.ordinal ?? -1,
      disposition: successor === undefined ? 'orphan-eof' :
        successor.indentScalarCount === indent ? 'candidate' : 'orphan-indent',
    });
    cursor += 1;
  }
  if (JSON.stringify(decoratorRuns) !== JSON.stringify(expected)) fail('decorator adjacency evidence');
}

function validateRawEvidence(rawBlocks, logicalLines, request, context) {
  const expectedOwners = logicalLines.filter((line) => line.role === 'raw-owner');
  if (rawBlocks.length !== expectedOwners.length) fail('raw owner coverage');
  for (let index = 0; index < rawBlocks.length; index += 1) {
    const block = rawBlocks[index];
    const owner = expectedOwners[index];
    const records = request.records.slice(owner.firstRecordOrdinal, owner.lastRecordOrdinal + 1);
    const opener = records.find((record) => record.kind === 'fenceMarker' && record.flags === 1);
    const closer = records.find((record) => record.kind === 'fenceMarker' && record.flags === 2);
    const firstContent = records.find((record) => record.kind !== 'whitespace' && record.kind !== 'newline');
    if (!opener || !closer || !firstContent || !context.rawOpenerTypes.includes(firstContent.raw) ||
        block.ownerLogicalOrdinal !== owner.ordinal || block.openerRecordOrdinal !== opener.ordinal ||
        block.closerRecordOrdinal !== closer.ordinal || block.bodyStartScalar !== opener.endScalar ||
        block.bodyEndScalar !== closer.startScalar || block.recognizedMultilineType !== firstContent.raw ||
        block.inlineFlag !== (owner.firstPhysicalLine === owner.lastPhysicalLine ? 'true' : 'false')) {
      fail('raw block evidence');
    }
  }
}

function successReceipt(fields, source, request, context) {
  const diagnosticTape = fields[2];
  const sourceScalars = uint(fields[3], 'source scalars');
  const logicalCount = uint(fields[4], 'logical count', context.limits.maxLogicalLines);
  const parentEdgeCount = uint(fields[5], 'parent edge count', context.limits.maxParentEdges);
  const decoratorRunCount = uint(fields[6], 'decorator run count', context.limits.maxDecoratorRuns);
  const rawBlockCount = uint(fields[7], 'raw block count', context.limits.maxRawBlocks);

  if (sourceScalars !== request.sourceScalars) fail('source scalar count drift');

  const diagItems = listTape(diagnosticTape, 'structural diagnostic tape');
  const logicalItems = listTape(fields[8], 'logical line tape');
  const edgeItems = listTape(fields[9], 'parent edge tape');
  const decoratorItems = listTape(fields[10], 'decorator adjacency tape');
  const rawItems = listTape(fields[11], 'raw block tape');

  if (logicalItems.length !== logicalCount || edgeItems.length !== parentEdgeCount ||
      decoratorItems.length !== decoratorRunCount || rawItems.length !== rawBlockCount) {
    fail('tape length count disagreement');
  }

  const diagnostics = diagItems.map((item, index) => decodeStructuralDiagnosticRow(item, index, request));
  const logicalLines = logicalItems.map((item, index) => decodeLogicalLineRow(item, index, request, context.limits));
  const parentEdges = edgeItems.map((item, index) => decodeParentEdgeRow(item, index, logicalLines));
  const decoratorRuns = decoratorItems.map((item, index) => decodeDecoratorRunRow(item, index, logicalLines));
  const rawBlocks = rawItems.map((item, index) => decodeRawBlockRow(item, index, logicalLines, request));

  if (diagnostics.length > context.limits.maxStructuralDiagnostics ||
      diagnostics.some((diagnostic) => !logicalLines[diagnostic.logicalOrdinal])) {
    fail('structural diagnostic evidence');
  }
  validateLogicalEvidence(logicalLines, request);
  validateParentEvidence(parentEdges, logicalLines);
  validateDecoratorEvidence(decoratorRuns, logicalLines);
  validateRawEvidence(rawBlocks, logicalLines, request, context);

  // Verify non-decorator count equals parent edge count
  const nonDecoratorCount = logicalLines.filter((l) => l.role !== 'decorator').length;
  if (nonDecoratorCount !== parentEdgeCount) fail('parent edge count does not equal non-decorator count');

  const expectedSeal = `tree:${logicalCount}:${parentEdgeCount}:${decoratorRunCount}:${rawBlockCount}:${Array.from(diagnosticTape).length}:${Array.from(fields[8]).length}:${Array.from(fields[9]).length}:${Array.from(fields[10]).length}:${Array.from(fields[11]).length}:closed`;
  if (fields[12] !== expectedSeal) fail('structural terminal seal mismatch');

  return {
    receipt: {
      status: 'structured',
      header: {
        format: fields[0],
        sourceScalars,
        sourceSha256: sha256(source),
        f3PolicySha256: context.f3PolicySha256,
        f1ReceiptSha256: context.f1ReceiptSha256,
        f2bReceiptSha256: context.f2bReceiptSha256,
        logicalCount,
        parentEdgeCount,
        decoratorRunCount,
        rawBlockCount,
        diagnosticCount: diagnostics.length,
        seal: fields[12],
      },
      logicalLines,
      parentEdges,
      decoratorRuns,
      rawBlocks,
      diagnostics,
      seal: sha256(fields),
    },
  };
}

function failureReceipt(fields, source, request, context) {
  if (fields[4] !== '0' || fields[5] !== '0' || fields[6] !== '0' || fields[7] !== '0' ||
      fields[8] !== '' || fields[9] !== '' || fields[10] !== '' || fields[11] !== '' || fields[12] !== 'failure') {
    fail('failure receipt atomicity');
  }
  const sourceScalars = uint(fields[3], 'source scalars');
  if (sourceScalars !== request.sourceScalars) fail('failure source count drift');
  const diagnostic = decodeFailureDiagnostic(fields[2], request, context);

  return {
    receipt: {
      status: 'failure',
      header: {
        format: fields[0],
        sourceScalars,
        sourceSha256: sha256(source),
        f3PolicySha256: context.f3PolicySha256,
        f1ReceiptSha256: context.f1ReceiptSha256,
        f2bReceiptSha256: context.f2bReceiptSha256,
        logicalCount: 0,
        parentEdgeCount: 0,
        decoratorRunCount: 0,
        rawBlockCount: 0,
        diagnosticCount: 1,
        seal: 'failure',
      },
      logicalLines: [],
      parentEdges: [],
      decoratorRuns: [],
      rawBlocks: [],
      diagnostics: [diagnostic],
      seal: sha256(fields),
    },
  };
}

export function decodeDocument(fields, source, request, context) {
  if (!Array.isArray(fields) || fields.length !== 13 || fields.some((f) => typeof f !== 'string')) {
    fail('result array shape');
  }
  if (Buffer.byteLength(JSON.stringify(fields), 'utf8') > context.limits.maxEncodedBytes) {
    fail('encoded byte limit');
  }
  if (fields[0] !== context.resultFormat) fail('result format');
  if (fields[1] === 'structured') return successReceipt(fields, source, request, context);
  if (fields[1] === 'failure') return failureReceipt(fields, source, request, context);
  fail(`unknown result status ${fields[1]}`);
}

export function loadPolicy(url = new URL('./policy.json', import.meta.url)) {
  const bytes = readFileSync(url, 'utf8');
  const policy = JSON.parse(bytes);
  return { bytes, policy, sha256: sha256(bytes) };
}
