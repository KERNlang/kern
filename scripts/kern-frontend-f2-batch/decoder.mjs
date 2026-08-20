import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

import { decodeExpression } from '../kern-frontend-f2-expression/decoder.mjs';

const UINT = /^(?:0|[1-9][0-9]*)$/u;
const FAILURE_CODES = new Set([
  'BATCH_EXPRESSION_REJECTED',
  'BATCH_INVALID_F2_RECEIPT',
  'BATCH_INVALID_REQUEST',
  'BATCH_LIMIT',
  'FORCED_LATE_FAILURE',
]);

function fail(message) {
  throw new Error(`F2 batch decoder: ${message}`);
}

function sha256(value) {
  const bytes = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(bytes).digest('hex');
}

function uint(text, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof text !== 'string' || !UINT.test(text)) fail(`${label} integer`);
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > maximum) fail(`${label} range`);
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

function framed(cursor, marker) {
  cursor.take(marker);
  const length = uint(cursor.until(':'), `${cursor.label} ${marker} length`);
  cursor.take(':');
  return cursor.width(length);
}

function listTape(text, label) {
  const cursor = new Cursor(text, label);
  const items = [];
  while (!cursor.done()) items.push(framed(cursor, 'i'));
  return items;
}

function segmentRow(text, ordinal, request, limits) {
  const fields = listTape(text, `segment ${ordinal}`);
  if (fields.length !== 10) fail('segment field count');
  const expected = request.segments[ordinal];
  const segment = {
    ordinal: uint(fields[0], 'segment ordinal', limits.maxSegments),
    firstRecordOrdinal: uint(fields[1], 'first record ordinal'),
    lastRecordOrdinal: uint(fields[2], 'last record ordinal'),
    outerStartScalar: uint(fields[3], 'outer start', request.sourceScalars),
    outerEndScalar: uint(fields[4], 'outer end', request.sourceScalars),
    bodyStartScalar: uint(fields[5], 'body start', request.sourceScalars),
    bodyEndScalar: uint(fields[6], 'body end', request.sourceScalars),
    bodySha256: fields[7],
    recordSha256: fields[8],
    nodeCount: uint(fields[9], 'node count', limits.maxAggregateNodes),
  };
  if (segment.ordinal !== ordinal || !expected ||
      segment.firstRecordOrdinal !== expected.firstRecordOrdinal ||
      segment.lastRecordOrdinal !== expected.lastRecordOrdinal ||
      segment.outerStartScalar !== expected.outerStartScalar ||
      segment.outerEndScalar !== expected.outerEndScalar ||
      segment.bodyStartScalar !== expected.bodyStartScalar ||
      segment.bodyEndScalar !== expected.bodyEndScalar ||
      segment.bodySha256 !== expected.bodySha256 || segment.recordSha256 !== expected.recordSha256) {
    fail('segment request drift');
  }
  return segment;
}

function spanRow(text, index, segments, sourceScalars, expectedSegmentOrdinal, expectedNodeId) {
  const fields = listTape(text, `span ${index}`);
  if (fields.length !== 4) fail('span field count');
  const segmentOrdinal = uint(fields[0], 'span segment', segments.length - 1);
  const nodeId = uint(fields[1], 'span node', segments[segmentOrdinal].nodeCount - 1);
  const startScalar = uint(fields[2], 'span start', sourceScalars);
  const endScalar = uint(fields[3], 'span end', sourceScalars);
  if (segmentOrdinal !== expectedSegmentOrdinal || nodeId !== expectedNodeId) fail('span order');
  if (endScalar <= startScalar || startScalar < segments[segmentOrdinal].bodyStartScalar ||
      endScalar > segments[segmentOrdinal].bodyEndScalar) fail('span containment');
  return { segmentOrdinal, nodeId, startScalar, endScalar };
}

function diagnostic(text, request, context) {
  const sourceScalars = request.sourceScalars;
  const cursor = new Cursor(text, 'diagnostic');
  const code = framed(cursor, 'C');
  const startScalar = uint(framed(cursor, 'S'), 'diagnostic start', sourceScalars);
  const endScalar = uint(framed(cursor, 'E'), 'diagnostic end', sourceScalars);
  const ordinalText = framed(cursor, 'O');
  if (!cursor.done() || !FAILURE_CODES.has(code) || endScalar < startScalar) fail('diagnostic shape');
  const segmentOrdinal = ordinalText === '-1' ? null : uint(ordinalText, 'diagnostic segment');
  const segment = segmentOrdinal === null ? null : request.segments[segmentOrdinal];
  if (segmentOrdinal !== null && !segment) fail('diagnostic segment binding');
  if (code === 'FORCED_LATE_FAILURE') {
    if (context.allowForcedLateFailure !== true || segment !== null ||
        startScalar !== sourceScalars || endScalar !== sourceScalars) fail('forced failure authority');
  } else if (code === 'BATCH_EXPRESSION_REJECTED') {
    if (!segment || startScalar < segment.bodyStartScalar || endScalar > segment.bodyEndScalar) {
      fail('expression diagnostic binding');
    }
  } else if (code === 'BATCH_INVALID_F2_RECEIPT') {
    if (!segment || startScalar !== segment.outerStartScalar || endScalar !== segment.outerEndScalar) {
      fail('F2 receipt diagnostic binding');
    }
  } else if (code === 'BATCH_LIMIT') {
    const sourceLimit = segment === null && startScalar === 0 && endScalar === sourceScalars;
    const segmentLimit = segment && startScalar === segment.outerStartScalar && endScalar === segment.outerEndScalar;
    if (!sourceLimit && !segmentLimit) fail('limit diagnostic binding');
  } else if (code === 'BATCH_INVALID_REQUEST') {
    const requestFailure = segment === null && startScalar === 0 && endScalar === sourceScalars;
    const segmentFailure = segment && startScalar === segment.outerStartScalar && endScalar === segment.outerEndScalar;
    if (!requestFailure && !segmentFailure) fail('request diagnostic binding');
  }
  return { code, startScalar, endScalar, segmentOrdinal };
}

function successReceipt(fields, source, request, context) {
  if (fields[2] !== '') fail('success diagnostic');
  const sourceScalars = uint(fields[3], 'source count');
  const segmentCount = uint(fields[4], 'segment count', context.limits.maxSegments);
  const aggregateNodes = uint(fields[5], 'node count', context.limits.maxAggregateNodes);
  if (sourceScalars !== request.sourceScalars || segmentCount !== request.segments.length) fail('success counts');
  const segmentItems = listTape(fields[6], 'segment tape');
  const spanItems = listTape(fields[7], 'span tape');
  const receiptItems = listTape(fields[8], 'receipt tape');
  if (segmentItems.length !== segmentCount || receiptItems.length !== segmentCount ||
      spanItems.length !== aggregateNodes) fail('section counts');
  const segments = segmentItems.map((row, ordinal) => segmentRow(row, ordinal, request, context.limits));
  const spanGroups = segments.map(() => []);
  let expectedSegmentOrdinal = 0;
  let expectedNodeId = 0;
  const absoluteSpans = spanItems.map((row, index) => {
    while (expectedSegmentOrdinal < segments.length &&
           expectedNodeId === segments[expectedSegmentOrdinal].nodeCount) {
      expectedSegmentOrdinal += 1;
      expectedNodeId = 0;
    }
    if (expectedSegmentOrdinal >= segments.length) fail('span order overflow');
    const span = spanRow(
      row, index, segments, sourceScalars, expectedSegmentOrdinal, expectedNodeId,
    );
    spanGroups[expectedSegmentOrdinal].push(span);
    expectedNodeId += 1;
    return span;
  });
  const expressions = receiptItems.map((row, ordinal) => {
    const expressionFields = listTape(row, `F2 receipt ${ordinal}`);
    if (expressionFields.length !== 9) fail('F2 receipt field count');
    const decoded = decodeExpression(expressionFields, request.segments[ordinal].body, context.f2Policy);
    if (decoded.status !== 'parsed' || decoded.nodes.length !== segments[ordinal].nodeCount) fail('F2 receipt result');
    const spans = spanGroups[ordinal];
    if (spans.length !== decoded.nodes.length) fail('F2 span count');
    for (const node of decoded.nodes) {
      const span = spans[node.id];
      if (!span || span.nodeId !== node.id ||
          span.startScalar !== segments[ordinal].bodyStartScalar + node.startScalar ||
          span.endScalar !== segments[ordinal].bodyStartScalar + node.endScalar) fail('F2 absolute span');
    }
    segments[ordinal].f2Status = decoded.status;
    segments[ordinal].rootNodeId = decoded.root.id;
    segments[ordinal].f2ReceiptSha256 = sha256(expressionFields);
    return expressionFields;
  });
  const expectedSeal = `batch:${segmentCount}:${aggregateNodes}:${Array.from(fields[6]).length}:${Array.from(fields[7]).length}:${Array.from(fields[8]).length}:closed`;
  if (fields[9] !== expectedSeal) fail('KERN terminal seal');
  return {
    expressions,
    receipt: {
      status: 'batched',
      header: {
        format: fields[0],
        sourceScalars,
        sourceSha256: sha256(source),
        batchPolicySha256: context.batchPolicySha256,
        f1ReceiptSha256: context.f1ReceiptSha256,
        f1ModulesSha256: context.f1ModulesSha256,
        f2ModulesSha256: context.f2ModulesSha256,
        segmentCount,
        aggregateNodes,
        segmentSha256: sha256(segments),
        absoluteSpanSha256: sha256(absoluteSpans),
        expressionReceiptSha256: sha256(expressions),
        kernSeal: fields[9],
      },
      segments,
      absoluteSpans,
      diagnostic: null,
      seal: sha256(fields),
    },
  };
}

function failureReceipt(fields, source, request, context) {
  if (fields[4] !== '0' || fields[5] !== '0' || fields[6] !== '' || fields[7] !== '' ||
      fields[8] !== '' || fields[9] !== 'failure') fail('failure atomicity');
  const sourceScalars = uint(fields[3], 'failure source count');
  if (sourceScalars !== request.sourceScalars) fail('failure source drift');
  const parsed = diagnostic(fields[2], request, context);
  return {
    expressions: [],
    receipt: {
      status: 'failure',
      header: {
        format: fields[0],
        sourceScalars,
        sourceSha256: sha256(source),
        batchPolicySha256: context.batchPolicySha256,
        f1ReceiptSha256: context.f1ReceiptSha256,
        f1ModulesSha256: context.f1ModulesSha256,
        f2ModulesSha256: context.f2ModulesSha256,
        segmentCount: 0,
        aggregateNodes: 0,
        segmentSha256: sha256([]),
        absoluteSpanSha256: sha256([]),
        expressionReceiptSha256: sha256([]),
        kernSeal: 'failure',
      },
      segments: [],
      absoluteSpans: [],
      diagnostic: parsed,
      seal: sha256(fields),
    },
  };
}

export function decodeBatch(fields, source, request, context) {
  if (!Array.isArray(fields) || fields.length !== 10 || fields.some((field) => typeof field !== 'string')) {
    fail('result shape');
  }
  if (Buffer.byteLength(JSON.stringify(fields), 'utf8') > context.limits.maxEncodedBytes) {
    fail('encoded byte limit');
  }
  if (fields[0] !== context.resultFormat) fail('result format');
  if (fields[1] === 'batched') return successReceipt(fields, source, request, context);
  if (fields[1] === 'failure') return failureReceipt(fields, source, request, context);
  fail('result status');
}

export const __test = { listTape, sha256 };
