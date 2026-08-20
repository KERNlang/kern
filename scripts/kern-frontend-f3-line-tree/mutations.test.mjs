import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runScan } from '../kern-frontend-f1-scan/worker.mjs';
import { runBatchWithScan } from '../kern-frontend-f2-batch/worker.mjs';
import { listTape, sha256 } from './decoder.mjs';
import { __test, loadPolicy, runDocument, validatePolicy, verifyDocumentFields } from './worker.mjs';

const frame = (value) => `i${Array.from(value).length}:${value}`;
const encodeTape = (items) => items.map(frame).join('');

function encodeF1Record(record) {
  const className = record.kindId <= 9 ? 'token' : 'trivia';
  const kindCode = record.kindId * 8 + record.flags;
  return `r${record.ordinal},${className},${kindCode},${record.startScalar},${record.endScalar},${Array.from(record.raw).length}:${record.raw}`;
}

function mutateNestedRow(fields, tapeIndex, rowIndex, fieldIndex, value) {
  const rows = listTape(fields[tapeIndex], 'mutation rows');
  const row = listTape(rows[rowIndex], 'mutation row');
  row[fieldIndex] = value;
  rows[rowIndex] = encodeTape(row);
  fields[tapeIndex] = encodeTape(rows);
}

test('standalone verification accepts a genuine F3 receipt', () => {
  const source = '@trace\nfn main\n  let x = {{1}}\n  return x\n';
  const result = runDocument(source);
  assert.deepEqual(verifyDocumentFields(source, result.fields).receipt, result.receipt);
});

test('standalone replay rejects top-level and nested receipt mutations', () => {
  const cases = [
    {
      name: 'format',
      source: 'fn main\n  return 1\n',
      mutate(fields) { fields[0] = 'kern.frontend.f3-line-tree.2'; },
    },
    {
      name: 'logical row',
      source: 'fn main\n  return 1\n',
      mutate(fields) { mutateNestedRow(fields, 8, 0, 0, '9'); },
    },
    {
      name: 'segment binding',
      source: 'let x = {{1}}\n',
      mutate(fields) { mutateNestedRow(fields, 8, 0, 11, '0'); },
    },
    {
      name: 'parent edge',
      source: 'fn main\n  return 1\n',
      mutate(fields) { mutateNestedRow(fields, 9, 1, 1, '-1'); },
    },
    {
      name: 'decorator disposition',
      source: '@trace\nfn main\n',
      mutate(fields) { mutateNestedRow(fields, 10, 0, 4, 'orphan-indent'); },
    },
    {
      name: 'raw body span',
      source: 'doc <<<raw>>>\n',
      mutate(fields) { mutateNestedRow(fields, 11, 0, 4, '0'); },
    },
    {
      name: 'diagnostic',
      source: '\tlet x = 1\n',
      mutate(fields) { mutateNestedRow(fields, 2, 0, 0, 'DROPPED_LINE'); },
    },
    {
      name: 'seal',
      source: 'fn main\n',
      mutate(fields) { fields[12] = 'tree:forged'; },
    },
  ];

  for (const current of cases) {
    const fields = [...runDocument(current.source).fields];
    current.mutate(fields);
    assert.throws(
      () => verifyDocumentFields(current.source, fields),
      /F3 line-tree decoder:/u,
      current.name,
    );
  }
});

test('F2B reuses and re-authenticates the exact F1 receipt', () => {
  const source = 'let x = {{1}}\n';
  const scan = runScan(source);
  const batch = runBatchWithScan(source, scan);
  assert.equal(batch.receipt.status, 'batched');
  assert.equal(batch.f1ReceiptSha256, sha256(scan.fields));
  assert.throws(
    () => runBatchWithScan('let y = {{2}}\n', scan),
    /F1 scan contract:/u,
  );
});

test('KERN rejects stale, reordered, crossing, and malformed F2B evidence', () => {
  const source = 'let a = {{1}}\nlet b = {{2}}\n';
  const mutations = [
    (request) => { request.segments[0].outerStartScalar += 1; },
    (request) => { request.segments[0].bodyStartScalar += 1; },
    (request) => { request.segments[0].firstRecordOrdinal += 1; },
    (request) => { request.segments.reverse(); },
    (request) => { request.segments[1] = { ...request.segments[0], ordinal: 1 }; },
  ];
  for (const mutate of mutations) {
    const result = __test.runWithRequestMutation(source, mutate);
    assert.equal(result.receipt.status, 'failure');
    assert.equal(result.receipt.diagnostics[0].code, 'F3_F2B_DRIFT');
  }
});

test('KERN rejects stale F1 partition evidence atomically', () => {
  const result = __test.runWithRequestMutation('fn main\n', (request) => {
    request.records[0].endScalar += 1;
  });
  assert.equal(result.receipt.status, 'failure');
  assert.equal(result.receipt.diagnostics[0].code, 'F3_F1_DRIFT');
  assert.deepEqual(result.receipt.logicalLines, []);
});

test('KERN rejects stale F1 kind and flag evidence atomically', () => {
  const cases = [
    {
      source: 'fn main\n',
      mutate(request) { request.records[0].kindId = 1; },
    },
    {
      source: '"closed"\n',
      mutate(request) { request.records[0].flags = 0; },
    },
    {
      source: 'doc <<<body>>>\n',
      mutate(request) {
        const marker = request.records.find((record) => record.kind === 'fenceMarker');
        marker.kindId = 0;
      },
    },
    {
      source: 'fn main\n',
      mutate(_request, prepared) { prepared.scan.fields[7] += 'forged'; },
    },
  ];

  for (const current of cases) {
    const result = __test.runWithRequestMutation(current.source, current.mutate);
    assert.equal(result.receipt.status, 'failure', current.source);
    assert.equal(result.receipt.diagnostics[0].code, 'F3_F1_DRIFT', current.source);
    assert.deepEqual(result.receipt.logicalLines, [], current.source);
  }
});

test('KERN rejects F1 tape chunk and record permutations atomically', () => {
  const source = 'fn item\n'.repeat(80);
  const mutations = [
    (_request, prepared) => {
      const tape = prepared.scan.fields[7];
      const boundary = tape.indexOf('s0c1,') + 2;
      assert.ok(boundary > 1, 'fixture must contain two F1 chunks');
      prepared.scan.fields[7] = tape.slice(boundary) + tape.slice(0, boundary);
    },
    (_request, prepared) => {
      const tape = prepared.scan.fields[7];
      const boundary = tape.indexOf('s0c1,') + 2;
      assert.ok(boundary > 1, 'fixture must contain two F1 chunks');
      prepared.scan.fields[7] = tape.slice(0, boundary).repeat(2);
    },
    (_request, prepared) => {
      const [first, second] = prepared.scan.decoded.records;
      const firstEncoded = encodeF1Record(first);
      const secondEncoded = encodeF1Record(second);
      const pair = firstEncoded + secondEncoded;
      assert.ok(prepared.scan.fields[7].includes(pair), 'fixture must contain adjacent records');
      prepared.scan.fields[7] = prepared.scan.fields[7].replace(pair, secondEncoded + firstEncoded);
    },
  ];

  for (const mutate of mutations) {
    const result = __test.runWithRequestMutation(source, mutate);
    assert.equal(result.receipt.status, 'failure');
    assert.equal(result.receipt.diagnostics[0].code, 'F3_F1_DRIFT');
    assert.deepEqual(result.receipt.logicalLines, []);
  }
});

test('F3 source closure performs one F1 scan and reuses it through F2B', () => {
  const worker = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
  const f2bWorker = readFileSync(new URL('../kern-frontend-f2-batch/worker.mjs', import.meta.url), 'utf8');
  const kern = [
    readFileSync(new URL('../../examples/kern-frontend/f3-line-tree-collection-helpers.kern', import.meta.url), 'utf8'),
    readFileSync(new URL('../../examples/kern-frontend/f3-line-tree-main.kern', import.meta.url), 'utf8'),
  ].join('\n');

  assert.equal((worker.match(/runScan[(]source[)]/gu) ?? []).length, 1);
  assert.equal((worker.match(/runBatchWithScan[(]source, scan[)]/gu) ?? []).length, 1);
  assert.doesNotMatch(worker, /runBatch[(]/u);
  assert.match(f2bWorker, /decodeScan[(]supplied[.]fields, source, f1Policy[)]/u);
  assert.match(worker, /scan[.]fields\[7\]/u);
  assert.match(kern, /f1RecordTape/u);
  assert.match(kern, /f3f1record/u);
  assert.doesNotMatch(kern, /Text[.]indexOf[(]f1RecordTape/u);
  assert.equal((worker.match(/executeKernRuntimeHandlerSync[(]/gu) ?? []).length, 1);
  assert.doesNotMatch(worker, /(?:parseExpression|projectExpressionText|ReferenceRunner)\s*[(]/u);
  assert.doesNotMatch(kern, /DROPPED_DECORATOR|typescript|parseExpression|projectExpressionText|ReferenceRunner/u);
});

test('policy is closed, relationally bounded, and downward-only', () => {
  const policy = loadPolicy().policy;
  assert.deepEqual(validatePolicy(structuredClone(policy)), policy);

  const badDensity = structuredClone(policy);
  badDensity.scalingWalls.densityCounts[2] += 1;
  assert.throws(() => validatePolicy(badDensity), /scaling density counts/u);

  const badRegistry = structuredClone(policy);
  badRegistry.rawOpenerTypes.push('mutable-policy');
  assert.throws(() => validatePolicy(badRegistry), /raw opener registry/u);

  const badRelationship = structuredClone(policy);
  badRelationship.runtimeLimits.maxBytes -= 1;
  assert.throws(() => validatePolicy(badRelationship), /limit relationship/u);

  assert.throws(
    () => runDocument('fn main\n', { profileLimits: { maxRecords: policy.profileLimits.maxRecords + 1 } }),
    /profile limit override maxRecords/u,
  );
});

test('forced failure and encoded-byte limits remain fail-closed', () => {
  const source = 'fn main\n  return 1\n';
  const fields = runDocument(source, { forceLateFailure: true }).fields;
  assert.throws(() => verifyDocumentFields(source, fields), /F3 line-tree decoder:/u);
  assert.equal(
    verifyDocumentFields(source, fields, { forceLateFailure: true }).receipt.diagnostics[0].code,
    'FORCED_LATE_FAILURE',
  );
  assert.throws(
    () => runDocument(source, { profileLimits: { maxEncodedBytes: 1 } }),
    /encoded|runtime envelope/u,
  );
});

test('every F3 profile ceiling fails atomically at the effective limit', () => {
  const cases = [
    ['maxRecords', 'fn main\n', 1],
    ['maxLogicalLines', 'fn one\nfn two\n', 1],
    ['maxParentEdges', 'fn one\nfn two\n', 1],
    ['maxDecoratorRuns', '@a\nfn one\n@b\nfn two\n', 1],
    ['maxRawBlocks', 'doc <<<a>>>\ndoc <<<b>>>\n', 1],
    ['maxStructuralDiagnostics', '\tlet a = 1\n\tlet b = 2\n', 1],
    ['maxWorkSteps', 'fn main\n', 1],
  ];
  for (const [key, source, value] of cases) {
    const result = runDocument(source, { profileLimits: { [key]: value } });
    assert.equal(result.receipt.status, 'failure', key);
    assert.equal(result.receipt.diagnostics[0].code, 'F3_LIMIT', key);
    assert.deepEqual(result.receipt.logicalLines, [], key);
  }
});
