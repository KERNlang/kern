import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const UINT = /^(?:0|[1-9][0-9]*)$/u;

export function fail(message) {
  throw new Error(`F2 expression decoder: ${message}`);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} shape`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} keys`);
}

function uint(text, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!UINT.test(text)) fail(`${label} integer`);
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

  done() {
    return this.index === this.points.length;
  }

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

function node(cursor, expectedId, sourceScalars) {
  cursor.take('n');
  const payloadLength = uint(cursor.until(':'), 'node payload length');
  cursor.take(':');
  const body = new Cursor(cursor.width(payloadLength), `node ${expectedId}`);
  const fields = [];
  for (let index = 0; index < 8; index += 1) {
    body.take('f');
    const fieldIndex = uint(body.until(','), 'field index');
    body.take(',');
    if (fieldIndex !== index) fail('field order');
    const length = uint(body.until(':'), 'field length');
    body.take(':');
    fields.push(body.width(length));
  }
  if (!body.done()) fail('node trailing data');
  const id = uint(fields[0], 'node id');
  if (id !== expectedId) fail('node id order');
  const kindId = uint(fields[1], 'kind id', 15);
  const startScalar = uint(fields[2], 'node start', sourceScalars);
  const endScalar = uint(fields[3], 'node end', sourceScalars);
  if (endScalar <= startScalar) fail('node span');
  const flags = uint(fields[4], 'node flags', 1);
  const subtreeSize = uint(fields[5], 'subtree size', expectedId + 1);
  return {
    children: listTape(fields[7], `node ${id} children`).map((item) => uint(item, 'child id', id - 1)),
    endScalar,
    flags,
    id,
    kindId,
    payload: listTape(fields[6], `node ${id} payload`),
    startScalar,
    subtreeSize,
  };
}

function chunks(text, expectedChunks, expectedNodes, sourceScalars, limits) {
  const cursor = new Cursor(text, 'node tape');
  const nodes = [];
  for (let ordinal = 0; ordinal < expectedChunks; ordinal += 1) {
    cursor.take('c');
    const actualOrdinal = uint(cursor.until(','), 'chunk ordinal');
    cursor.take(',');
    const firstNode = uint(cursor.until(','), 'chunk first node');
    cursor.take(',');
    const count = uint(cursor.until(','), 'chunk count', limits.nodesPerChunk);
    cursor.take(',');
    const payloadLength = uint(cursor.until(':'), 'chunk payload length', limits.maxTapeScalars);
    cursor.take(':');
    if (actualOrdinal !== ordinal || firstNode !== nodes.length || count === 0) fail('chunk geometry');
    const end = cursor.index + payloadLength;
    if (end > cursor.points.length) fail('chunk payload width');
    for (let index = 0; index < count; index += 1) nodes.push(node(cursor, nodes.length, sourceScalars));
    if (cursor.index !== end) fail('chunk payload accounting');
    cursor.take('s');
    const sealStart = cursor.index;
    while (cursor.index < cursor.points.length && /^[0-9]$/u.test(cursor.points[cursor.index])) cursor.index += 1;
    const seal = cursor.points.slice(sealStart, cursor.index).join('');
    if (uint(seal, 'chunk seal') !== ordinal) fail('chunk seal');
  }
  if (!cursor.done() || nodes.length !== expectedNodes) fail('tape count');
  return nodes;
}

function validateSchema(nodes, ledger) {
  const used = Array(nodes.length).fill(0);
  for (const item of nodes) {
    const schema = ledger.nodeTape.kinds[item.kindId];
    if (!schema || schema.id !== item.kindId) fail('kind schema');
    if (!schema.flags.includes(item.flags)) fail('kind flags');
    const expectedPayload = [0, 2, 3, 4, 5, 8, 11, 13, 14].includes(item.kindId) ? 1 : null;
    if (expectedPayload !== null && item.payload.length !== expectedPayload) fail('payload arity');
    if ([1, 6, 9, 10, 15].includes(item.kindId) && item.payload.length !== 0) fail('empty payload');
    if (item.kindId === 0 && !IDENTIFIER.test(item.payload[0])) fail('identifier payload');
    if (item.kindId === 2 && !['true', 'false'].includes(item.payload[0])) fail('boolean payload');
    if (item.kindId === 3 && !/^(?:0|[1-9][0-9]*)$/u.test(item.payload[0])) fail('integer payload');
    if (item.kindId === 4 && !/^(?:0|[1-9][0-9]*)[.][0-9]+$/u.test(item.payload[0])) fail('decimal payload');
    if (item.kindId === 8 && !IDENTIFIER.test(item.payload[0])) fail('member payload');
    if (item.kindId === 11 && !['Map', 'Error'].includes(item.payload[0])) fail('new payload');
    if (item.kindId === 13 && !ledger.binaryOperators.includes(item.payload[0])) fail('binary payload');
    if (item.kindId === 14 && !ledger.unaryOperators.includes(item.payload[0])) fail('unary payload');
    const fixedChildren = [0, 0, 0, 0, 0, 0, null, null, 1, 2, null, null, 1, 2, 1, 3][item.kindId];
    if (fixedChildren !== null && item.children.length !== fixedChildren) fail('child arity');
    if (item.kindId === 7 && item.payload.length !== item.children.length) fail('record alignment');
    if (item.kindId === 7 && new Set(item.payload).size !== item.payload.length) fail('duplicate record key');
    if (item.kindId === 11 && item.children.length !== (item.payload[0] === 'Map' ? 0 : 1)) fail('new arity');
    if (item.kindId === 12 && item.payload.some((name) => !IDENTIFIER.test(name))) fail('lambda payload');
    if (item.kindId === 12 && new Set(item.payload).size !== item.payload.length) fail('duplicate lambda parameter');
    let subtree = 1;
    let intervalStart = item.id + 1 - item.subtreeSize;
    for (const child of item.children) {
      if (child >= item.id) fail('forward child');
      const childStart = child + 1 - nodes[child].subtreeSize;
      if (childStart !== intervalStart) fail('child postorder interval');
      intervalStart = child + 1;
      used[child] += 1;
      subtree += nodes[child].subtreeSize;
    }
    if (subtree !== item.subtreeSize) fail('subtree size');
  }
  if (nodes.length > 0) {
    for (let id = 0; id < nodes.length - 1; id += 1) if (used[id] !== 1) fail('tree ownership');
    if (used.at(-1) !== 0 || nodes.at(-1).subtreeSize !== nodes.length) fail('root topology');
  }
}

function validateSourceSpans(nodes, source) {
  const points = Array.from(source);
  for (const item of nodes) {
    const text = points.slice(item.startScalar, item.endScalar).join('');
    let atom = text.trim();
    while (atom.startsWith('(') && atom.endsWith(')')) atom = atom.slice(1, -1).trim();
    if (item.kindId === 0 && atom !== item.payload[0]) fail('identifier span');
    if (item.kindId === 1 && !['null', 'none'].includes(atom)) fail('null span');
    if (item.kindId === 2 && atom !== item.payload[0]) fail('boolean span');
    if ([3, 4].includes(item.kindId) && atom !== item.payload[0]) fail('number span');
    if (item.kindId === 5 && !['\"', "'"].includes(atom[0])) fail('text span');
    for (const child of item.children) {
      if (nodes[child].startScalar < item.startScalar || nodes[child].endScalar > item.endScalar) fail('child span');
    }
  }
}

function diagnostic(text, sourceScalars) {
  const cursor = new Cursor(text, 'diagnostic');
  const code = framed(cursor, 'C');
  const startScalar = uint(framed(cursor, 'S'), 'diagnostic start', sourceScalars);
  const endScalar = uint(framed(cursor, 'E'), 'diagnostic end', sourceScalars);
  if (!cursor.done() || endScalar < startScalar) fail('diagnostic shape');
  return { code, endScalar, startScalar };
}

export function decodeExpression(fields, source, policy, options = {}) {
  if (!Array.isArray(fields) || fields.length !== 9 || fields.some((field) => typeof field !== 'string')) {
    fail('result shape');
  }
  if (fields[0] !== policy.resultFormat) fail('result format');
  const sourceScalars = Array.from(source).length;
  if (uint(fields[3], 'source count') !== sourceScalars) fail('source count drift');
  if (fields[1] === 'failure') {
    if (fields[4] !== '0' || fields[5] !== '0' || fields[6] !== '0' || fields[7] !== '' || fields[8] !== 'failure') {
      fail('non-atomic failure');
    }
    const parsed = diagnostic(fields[2], sourceScalars);
    if (parsed.code === 'FORCED_LATE_FAILURE' && options.allowForcedLateFailure !== true) fail('forced failure authority');
    return { diagnostic: parsed, nodes: [], sourceScalars, status: 'failure' };
  }
  if (fields[1] !== 'parsed' || fields[2] !== '') fail('success disposition');
  const nodeCount = uint(fields[4], 'node count', policy.profileLimits.maxNodes);
  const chunkCount = uint(fields[5], 'chunk count', policy.profileLimits.maxChunks);
  const maxGuestList = uint(fields[6], 'maximum guest list', Math.max(policy.profileLimits.nodesPerChunk, policy.profileLimits.maxChunks));
  const expectedChunks = nodeCount === 0 ? 0 : Math.ceil(nodeCount / policy.profileLimits.nodesPerChunk);
  if (nodeCount === 0 || chunkCount !== expectedChunks || maxGuestList !== Math.max(chunkCount, Math.min(nodeCount, policy.profileLimits.nodesPerChunk))) {
    fail('success geometry');
  }
  if (Array.from(fields[7]).length > policy.profileLimits.maxTapeScalars) fail('tape limit');
  const nodes = chunks(fields[7], chunkCount, nodeCount, sourceScalars, policy.profileLimits);
  validateSchema(nodes, policy.ledger);
  validateSourceSpans(nodes, source);
  if (fields[8] !== `root:${nodeCount - 1}:${nodeCount}:${chunkCount}:closed`) fail('root seal');
  const trimmedStart = Array.from(source).findIndex((point) => ![' ', '\t', '\n', '\r'].includes(point));
  let trimmedEnd = sourceScalars;
  const points = Array.from(source);
  while (trimmedEnd > 0 && [' ', '\t', '\n', '\r'].includes(points[trimmedEnd - 1])) trimmedEnd -= 1;
  if (nodes.at(-1).startScalar !== trimmedStart || nodes.at(-1).endScalar !== trimmedEnd) fail('root span');
  return { nodes, root: nodes.at(-1), sourceScalars, status: 'parsed' };
}

export function loadPolicy() {
  const policy = JSON.parse(readFileSync(new URL('./policy.json', import.meta.url), 'utf8'));
  exactKeys(
    policy,
    [
      'format', 'resultFormat', 'sourceLedger', 'sourceLedgerSha256',
      'conformanceCorpus', 'conformanceCorpusSha256', 'ruleCoverage', 'ruleCoverageSha256',
      'modules', 'moduleSha256',
      'parserFragments', 'parserFragmentSha256', 'parserCompositeSha256', 'profileLimits', 'runtimeLimits', 'scheduler',
      'scalingWalls',
    ],
    'policy',
  );
  for (const [pathKey, digestKey] of [
    ['conformanceCorpus', 'conformanceCorpusSha256'],
    ['ruleCoverage', 'ruleCoverageSha256'],
  ]) {
    const bytes = readFileSync(new URL(`../../${policy[pathKey]}`, import.meta.url), 'utf8');
    if (createHash('sha256').update(bytes).digest('hex') !== policy[digestKey]) fail(`${pathKey} digest`);
  }
  policy.ledger = JSON.parse(readFileSync(new URL(`../../${policy.sourceLedger}`, import.meta.url), 'utf8'));
  return policy;
}
