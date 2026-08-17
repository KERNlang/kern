import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const UINT = /^(?:0|[1-9][0-9]*)$/u;
const FAILURE_CODES = new Set([
  'SOURCE_LIMIT', 'FRONTEND_INVALID_EXPRESSION', 'EXPRESSION_LIMIT',
  'TRANSPORT_LIMIT', 'FORCED_LATE_FAILURE',
]);

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

export function isWellFormedText(text) {
  if (typeof text !== 'string') return false;
  if (typeof text.isWellFormed === 'function') return text.isWellFormed();
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { i += 1; continue; }
      return false;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

export function countSourceScalars(source) {
  if (!isWellFormedText(source)) fail('ill-formed source');
  let count = 0;
  for (let i = 0; i < source.length; ) {
    const code = source.codePointAt(i);
    if (code === undefined) break;
    i += code > 0xffff ? 2 : 1;
    count += 1;
  }
  return count;
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

function node(cursor, expectedId, sourceScalars) {
  cursor.take('n');
  const payloadLength = uint(cursor.until(':'), 'node payload length');
  cursor.take(':');
  const body = new Cursor(cursor.width(payloadLength), `node ${expectedId}`);
  const fields = [];
  for (let index = 0; index < 8; index += 1) {
    body.take('f');
    if (uint(body.until(','), 'field index') !== index) fail('field order');
    body.take(',');
    const length = uint(body.until(':'), 'field length');
    body.take(':');
    fields.push(body.width(length));
  }
  if (!body.done()) fail('node trailing data');
  const id = uint(fields[0], 'node id');
  if (id !== expectedId) fail('node id order');
  const startScalar = uint(fields[2], 'node start', sourceScalars);
  const endScalar = uint(fields[3], 'node end', sourceScalars);
  if (endScalar <= startScalar) fail('node span');
  return {
    children: listTape(fields[7], `node ${id} children`).map((item) => uint(item, 'child id', id - 1)),
    endScalar, flags: uint(fields[4], 'node flags', 1), id, kindId: uint(fields[1], 'kind id', 15),
    payload: listTape(fields[6], `node ${id} payload`), startScalar,
    subtreeSize: uint(fields[5], 'subtree size', expectedId + 1),
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
    if (!schema || schema.id !== item.kindId || !schema.flags.includes(item.flags)) fail('kind schema');
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
    if (item.kindId === 12 && (item.payload.some((name) => !IDENTIFIER.test(name)) || new Set(item.payload).size !== item.payload.length)) fail('lambda shape');
    let subtree = 1;
    let intervalStart = item.id + 1 - item.subtreeSize;
    for (const child of item.children) {
      if (child >= item.id) fail('forward child');
      if (child + 1 - nodes[child].subtreeSize !== intervalStart) fail('child postorder interval');
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

function stripOuterParens(raw) {
  let s = raw.trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let matched = false;
    for (let i = 0; i < s.length; i += 1) {
      if (s[i] === '(') depth += 1;
      else if (s[i] === ')') {
        depth -= 1;
        if (depth === 0) { matched = i === s.length - 1; break; }
      }
    }
    if (matched) s = s.slice(1, -1).trim();
    else break;
  }
  return s;
}

function decodeTextLiteral(raw) {
  const s = stripOuterParens(raw);
  const quote = s[0];
  if (quote !== '"' && quote !== "'") fail('text quote');
  if (s.length < 2 || s.at(-1) !== quote) fail('unclosed text literal');
  const inner = s.slice(1, -1);
  const out = [];
  let i = 0;
  const simple = { '\\\\': '\\', '\\"': '"', "\\'": "'", '\\b': '\b', '\\f': '\f', '\\n': '\n', '\\r': '\r', '\\t': '\t', '\\v': '\v' };
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '\\') {
      if (i + 1 >= inner.length) fail('trailing backslash');
      const esc = inner[i + 1];
      if (esc === '\n') { i += 2; continue; }
      if (esc === '\r') {
        if (i + 2 < inner.length && inner[i + 2] === '\n') { i += 3; continue; }
        fail('unsupported lone \\r');
      }
      if (simple[`\\${esc}`]) { out.push(simple[`\\${esc}`]); i += 2; continue; }
      if (esc === '0') {
        if (i + 2 < inner.length && /^[0-9]$/u.test(inner[i + 2])) fail('octal escape');
        out.push('\0'); i += 2; continue;
      }
      if (esc === 'x') {
        if (i + 3 >= inner.length || !/^[0-9A-Fa-f]{2}$/u.test(inner.slice(i + 2, i + 4))) fail('invalid \\x');
        out.push(String.fromCodePoint(parseInt(inner.slice(i + 2, i + 4), 16)));
        i += 4; continue;
      }
      if (esc === 'u') {
        if (i + 2 < inner.length && inner[i + 2] === '{') {
          const closeIdx = inner.indexOf('}', i + 3);
          if (closeIdx < 0 || closeIdx - (i + 3) > 6 || closeIdx === i + 3) fail('invalid \\u{}');
          const hex = inner.slice(i + 3, closeIdx);
          if (!/^[0-9A-Fa-f]+$/u.test(hex)) fail('invalid \\u{} hex');
          const cp = parseInt(hex, 16);
          if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) fail('surrogate in \\u{}');
          out.push(String.fromCodePoint(cp));
          i = closeIdx + 1; continue;
        }
        if (i + 5 >= inner.length || !/^[0-9A-Fa-f]{4}$/u.test(inner.slice(i + 2, i + 6))) fail('invalid \\u');
        let cp = parseInt(inner.slice(i + 2, i + 6), 16);
        if (cp >= 0xd800 && cp <= 0xdbff) {
          if (i + 11 >= inner.length || inner.slice(i + 6, i + 8) !== '\\u' || !/^[0-9A-Fa-f]{4}$/u.test(inner.slice(i + 8, i + 12))) fail('surrogate pair');
          const low = parseInt(inner.slice(i + 8, i + 12), 16);
          if (low < 0xdc00 || low > 0xdfff) fail('invalid low surrogate');
          cp = 0x10000 + (cp - 0xd800) * 0x400 + (low - 0xdc00);
          out.push(String.fromCodePoint(cp));
          i += 12; continue;
        }
        if (cp >= 0xdc00 && cp <= 0xdfff) fail('isolated low surrogate');
        out.push(String.fromCodePoint(cp));
        i += 6; continue;
      }
      fail(`unknown escape \\${esc}`);
    } else { out.push(ch); i += 1; }
  }
  return out.join('');
}

function deriveMemberProperty(sourcePoints, objectEnd, nodeEnd) {
  const match = /(?:^[.]|^\?[.])[ \t\r\n]*([A-Za-z_$][A-Za-z0-9_$]*)/u.exec(sourcePoints.slice(objectEnd, nodeEnd).join('').trim());
  if (!match) fail('member derivation');
  return match[1];
}

function deriveLambdaParams(sourcePoints, nodeStart, bodyStart) {
  const segment = sourcePoints.slice(nodeStart, bodyStart).join('');
  const arrowIdx = segment.lastIndexOf('=>');
  if (arrowIdx < 0) fail('lambda derivation arrow');
  const head = segment.slice(0, arrowIdx).trim();
  if (head.endsWith(')')) {
    let depth = 0;
    let open = -1;
    for (let index = head.length - 1; index >= 0; index -= 1) {
      if (head[index] === ')') depth += 1;
      else if (head[index] === '(' && --depth === 0) { open = index; break; }
    }
    if (open < 0) fail('lambda derivation parameters');
    const inner = head.slice(open + 1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((p) => p.trim());
  }
  const bare = /([A-Za-z_$][A-Za-z0-9_$]*)$/u.exec(head)?.[1];
  if (bare === undefined) fail('lambda derivation parameter');
  return [bare];
}

function deriveUnaryOperator(raw) {
  return /(?:^|[(])[ \t\r\n]*(typeof|void|[!+~-])[ \t\r\n]*$/u.exec(raw)?.[1];
}

function deriveRecordKeys(sourcePoints, item, nodes) {
  const keys = [];
  const prefixEnd = item.children.length === 0 ? item.endScalar : nodes[item.children[0]].startScalar;
  let brace = item.startScalar;
  while (brace < prefixEnd && sourcePoints[brace] !== '{') brace += 1;
  if (brace === prefixEnd) fail('record opening span');
  let prevEnd = brace + 1;
  for (let index = 0; index < item.children.length; index += 1) {
    const valChild = nodes[item.children[index]];
    const prefix = sourcePoints.slice(prevEnd, valChild.startScalar).join('').trim();
    if (prefix.endsWith(':')) {
      let keyRaw = prefix.slice(0, -1).trim();
      if (keyRaw.startsWith(',')) keyRaw = keyRaw.slice(1).trim();
      keys.push(keyRaw.startsWith('"') || keyRaw.startsWith("'") ? decodeTextLiteral(keyRaw) : keyRaw);
    } else {
      keys.push(valChild.payload[0]);
    }
    prevEnd = valChild.endScalar;
  }
  return keys;
}

function validateSourceSpans(nodes, source) {
  const points = Array.from(source);
  for (const item of nodes) {
    if (item.kindId <= 5) {
      const atom = stripOuterParens(points.slice(item.startScalar, item.endScalar).join(''));
      if (item.kindId === 0 && atom !== item.payload[0]) fail('identifier span');
      if (item.kindId === 1 && !['null', 'none'].includes(atom)) fail('null span');
      if (item.kindId === 2 && atom !== item.payload[0]) fail('boolean span');
      if ([3, 4].includes(item.kindId) && atom !== item.payload[0]) fail('number span');
      if (item.kindId === 5 && decodeTextLiteral(atom) !== item.payload[0]) fail('text span');
    }
    if (item.kindId === 8 && deriveMemberProperty(points, nodes[item.children[0]].endScalar, item.endScalar) !== item.payload[0]) fail('member span');
    if (item.kindId === 11) {
      const firstChild = item.children.length === 0 ? item.endScalar : nodes[item.children[0]].startScalar;
      const ctorMatch = /\bnew[ \t\r\n]+(Map|Error)\b/u.exec(points.slice(item.startScalar, firstChild).join(''));
      if (!ctorMatch || ctorMatch[1] !== item.payload[0]) fail('new span');
    }
    if (item.kindId === 12 && JSON.stringify(deriveLambdaParams(points, item.startScalar, nodes[item.children[0]].startScalar)) !== JSON.stringify(item.payload)) fail('lambda span');
    if (item.kindId === 13) {
      const left = nodes[item.children[0]];
      const right = nodes[item.children[1]];
      if (points.slice(left.endScalar, right.startScalar).join('').trim() !== item.payload[0]) fail('binary operator span');
    }
    if (item.kindId === 14) {
      const child = nodes[item.children[0]];
      if (deriveUnaryOperator(points.slice(item.startScalar, child.startScalar).join('')) !== item.payload[0]) fail('unary operator span');
    }
    if (item.kindId === 7 && JSON.stringify(deriveRecordKeys(points, item, nodes)) !== JSON.stringify(item.payload)) fail('record key span');
    for (const child of item.children) {
      if (nodes[child].startScalar < item.startScalar || nodes[child].endScalar > item.endScalar) fail('child span');
    }
  }
}

function diagnostic(text, sourceScalars) {
  const cursor = new Cursor(text, 'diagnostic');
  const code = framed(cursor, 'C');
  if (!FAILURE_CODES.has(code)) fail('failure code taxonomy');
  const startScalar = uint(framed(cursor, 'S'), 'diagnostic start', sourceScalars);
  const endScalar = uint(framed(cursor, 'E'), 'diagnostic end', sourceScalars);
  if (!cursor.done() || endScalar < startScalar) fail('diagnostic shape');
  if (['SOURCE_LIMIT', 'TRANSPORT_LIMIT'].includes(code)) {
    if (startScalar !== 0 || endScalar !== sourceScalars) fail('source-bind provable failure');
  }
  if (code === 'FORCED_LATE_FAILURE' && (startScalar !== sourceScalars || endScalar !== sourceScalars)) {
    fail('source-bind late failure');
  }
  return { code, endScalar, startScalar };
}

export function decodeExpression(fields, source, policy, options = {}) {
  if (!policy || typeof policy !== 'object') fail('policy required');
  if (typeof policy.sourceLedgerSha256 !== 'string' || policy.sourceLedgerSha256.length !== 64) fail('source ledger digest');
  if (policy.sourceLedger) {
    const ledgerBytes = typeof policy.ledgerSource === 'string'
      ? policy.ledgerSource
      : readFileSync(new URL(`../../${policy.sourceLedger}`, import.meta.url), 'utf8');
    if (createHash('sha256').update(ledgerBytes).digest('hex') !== policy.sourceLedgerSha256) fail('source ledger digest');
    if (JSON.stringify(JSON.parse(ledgerBytes)) !== JSON.stringify(policy.ledger)) fail('source ledger content');
  }
  const maxScalars = policy.profileLimits?.maxSourceScalars ?? 65536;
  const sourceScalars = countSourceScalars(source);
  if (!Array.isArray(fields) || fields.length !== 9 || fields.some((field) => typeof field !== 'string')) fail('result shape');
  if (fields[0] !== policy.resultFormat) fail('result format');
  if (uint(fields[3], 'source count') !== sourceScalars) fail('source count drift');
  if (fields[1] === 'failure') {
    if (fields[4] !== '0' || fields[5] !== '0' || fields[6] !== '0' || fields[7] !== '' || fields[8] !== 'failure') fail('non-atomic failure');
    const parsed = diagnostic(fields[2], sourceScalars);
    if (sourceScalars > maxScalars && parsed.code !== 'SOURCE_LIMIT') fail('source limit taxonomy');
    if (sourceScalars <= maxScalars && parsed.code === 'SOURCE_LIMIT') fail('source limit provenance');
    if (parsed.code === 'FORCED_LATE_FAILURE' && options.allowForcedLateFailure !== true) fail('forced failure authority');
    return { diagnostic: parsed, nodes: [], sourceScalars, status: 'failure' };
  }
  if (sourceScalars > maxScalars) fail('source limit exceeded');
  if (fields[1] !== 'parsed' || fields[2] !== '') fail('success disposition');
  const nodeCount = uint(fields[4], 'node count', policy.profileLimits.maxNodes);
  const chunkCount = uint(fields[5], 'chunk count', policy.profileLimits.maxChunks);
  const maxGuestList = uint(fields[6], 'maximum guest list', Math.max(policy.profileLimits.nodesPerChunk, policy.profileLimits.maxChunks));
  const expectedChunks = nodeCount === 0 ? 0 : Math.ceil(nodeCount / policy.profileLimits.nodesPerChunk);
  if (nodeCount === 0 || chunkCount !== expectedChunks || maxGuestList !== Math.max(chunkCount, Math.min(nodeCount, policy.profileLimits.nodesPerChunk))) fail('success geometry');
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
      'format', 'resultFormat', 'workCharging', 'sourceLedger', 'sourceLedgerSha256',
      'conformanceCorpus', 'conformanceCorpusSha256', 'ruleCoverage', 'ruleCoverageSha256',
      'modules', 'moduleSha256',
      'parserFragments', 'parserFragmentSha256', 'parserCompositeSha256', 'profileLimits', 'runtimeLimits', 'scheduler',
      'scalingWalls',
    ],
    'policy',
  );
  exactKeys(
    policy.workCharging,
    ['format', 'sourceScalar', 'tokenAdmission', 'parserTransition', 'containerItem', 'recordChunk', 'tapeNode'],
    'work charging',
  );
  if (
    policy.workCharging.format !== 'kern.frontend.f2-work.unit.1' ||
    Object.entries(policy.workCharging).some(([key, value]) => key !== 'format' && value !== 1)
  ) fail('work charging');
  for (const [pathKey, digestKey] of [
    ['sourceLedger', 'sourceLedgerSha256'],
    ['conformanceCorpus', 'conformanceCorpusSha256'],
    ['ruleCoverage', 'ruleCoverageSha256'],
  ]) {
    const bytes = readFileSync(new URL(`../../${policy[pathKey]}`, import.meta.url), 'utf8');
    if (createHash('sha256').update(bytes).digest('hex') !== policy[digestKey]) fail(`${pathKey} digest`);
  }
  policy.ledger = JSON.parse(readFileSync(new URL(`../../${policy.sourceLedger}`, import.meta.url), 'utf8'));
  return policy;
}
