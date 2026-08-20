import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { __test, decodeBatch } from './decoder.mjs';
import { __test as workerTest, runBatch, verifyBatchFields } from './worker.mjs';

const source = 'left={{1 + 2}}\nright={{f(a)}}\n';
const baseline = runBatch(source);
const cloneFields = () => [...baseline.fields];
const frame = (value) => `i${Array.from(value).length}:${value}`;

const mutations = [
  ['format', (fields) => { fields[0] = 'kern.frontend.f2-batch.2'; }],
  ['source count', (fields) => { fields[3] = '0'; }],
  ['segment count', (fields) => { fields[4] = '1'; }],
  ['node count', (fields) => { fields[5] = '999'; }],
  ['segment tape', (fields) => { fields[6] = `x${fields[6].slice(1)}`; }],
  ['absolute span tape', (fields) => { fields[7] = `${fields[7]}${frame('i1:0i1:0i1:0i1:1')}`; }],
  ['F2 receipt tape', (fields) => { fields[8] = fields[8].slice(0, -1); }],
  ['KERN seal', (fields) => { fields[9] = 'batch:forged'; }],
];

for (const [name, mutate] of mutations) {
  test(`decoder rejects ${name} mutation`, () => {
    const fields = cloneFields();
    mutate(fields);
    assert.throws(() => verifyBatchFields(source, fields), /F2 batch decoder:/u);
  });
}

test('decoder rejects reordered genuine segment rows', () => {
  const fields = cloneFields();
  const rows = __test.listTape(fields[6], 'test segment tape');
  fields[6] = `${frame(rows[1])}${frame(rows[0])}`;
  fields[9] = `batch:2:${fields[5]}:${Array.from(fields[6]).length}:${Array.from(fields[7]).length}:${Array.from(fields[8]).length}:closed`;
  assert.throws(() => verifyBatchFields(source, fields), /segment request drift/u);
});

test('decoder rejects reordered complete absolute-span groups', () => {
  const fields = cloneFields();
  const rows = __test.listTape(fields[7], 'test span tape');
  const firstCount = baseline.receipt.segments[0].nodeCount;
  const reordered = [...rows.slice(firstCount), ...rows.slice(0, firstCount)];
  fields[7] = reordered.map(frame).join('');
  fields[9] = `batch:2:${fields[5]}:${Array.from(fields[6]).length}:${Array.from(fields[7]).length}:${Array.from(fields[8]).length}:closed`;
  assert.throws(() => verifyBatchFields(source, fields), /F2 batch decoder:/u);
});

test('decoder rejects a genuine F2 receipt replayed under another segment', () => {
  const fields = cloneFields();
  const rows = __test.listTape(fields[8], 'test receipt tape');
  fields[8] = `${frame(rows[0])}${frame(rows[0])}`;
  fields[9] = `batch:2:${fields[5]}:${Array.from(fields[6]).length}:${Array.from(fields[7]).length}:${Array.from(fields[8]).length}:closed`;
  assert.throws(() => verifyBatchFields(source, fields), /F2 (?:batch|expression) decoder:/u);
});

test('worker has one F2 runtime invocation and no per-expression host parser loop', () => {
  assert.equal(baseline.runtimeInvocations, 1);
  const worker = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
  assert.equal((worker.match(/executeKernRuntimeHandlerSync[(]/gu) ?? []).length, 1);
  assert.doesNotMatch(worker, /runExpression/u);
  assert.doesNotMatch(worker, /for\s*[(][^)]*(?:request[.]segments|segments|bodies)/u);
});

test('source closure binds F1 discovery and excludes host semantic authorities', () => {
  const worker = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
  const kern = readFileSync(new URL('../../examples/kern-frontend/f2-batch-main.kern', import.meta.url), 'utf8');
  assert.match(worker, /runScan[(]source[)]/u);
  assert.match(worker, /record[.]kind === 'expr'.*record[.]flags/su);
  assert.doesNotMatch(worker, /(?:parseExpression|projectExpressionText|ReferenceRunner)\s*[(]/u);
  assert.doesNotMatch(worker, /from\s+['"][^'"]*(?:parser-expression|typescript)/u);
  assert.equal((kern.match(/parsef2expression[(]/gu) ?? []).length, 1);
  assert.doesNotMatch(kern, /typescript|parseExpression|projectExpressionText|ReferenceRunner/u);
});

test('failure fields cannot smuggle successful sections', () => {
  const failed = runBatch('a={{1}}\nb={{(}}\n');
  const fields = [...failed.fields];
  fields[6] = baseline.fields[6];
  assert.throws(() => verifyBatchFields('a={{1}}\nb={{(}}\n', fields), /failure atomicity/u);
});

test('failure diagnostics bind their ordinal to an actual request segment', () => {
  const failedSource = 'a={{(}}\n';
  const fields = [...runBatch(failedSource).fields];
  fields[2] = fields[2].replace(/O1:0$/u, 'O3:999');
  assert.throws(() => verifyBatchFields(failedSource, fields), /F2 batch decoder:/u);
});

test('forced late failure requires explicit test authority while decoding', () => {
  const forcedSource = 'a={{1}}\n';
  const fields = runBatch(forcedSource, { forceLateFailure: true }).fields;
  assert.throws(() => verifyBatchFields(forcedSource, fields), /F2 batch decoder:/u);
  assert.equal(
    verifyBatchFields(forcedSource, fields, { forceLateFailure: true }).receipt.diagnostic.code,
    'FORCED_LATE_FAILURE',
  );
});

test('effective encoded-byte limit rejects a result larger than its override', () => {
  assert.throws(
    () => runBatch('a={{1}}\n', { profileLimits: { maxEncodedBytes: 1 } }),
    /encoded|runtime envelope/u,
  );
});

test('KERN rejects a same-length body substitution before F2 dispatch', () => {
  const substituted = workerTest.runWithBodySubstitution('a={{1}}\n', 0, '2');
  assert.equal(substituted.receipt.status, 'failure');
  assert.equal(substituted.receipt.diagnostic.code, 'BATCH_INVALID_REQUEST');
  assert.equal(substituted.receipt.diagnostic.segmentOrdinal, 0);
});

test('profile overrides are downward-only', () => {
  assert.throws(
    () => runBatch('a={{1}}\n', { profileLimits: { maxSegments: 10_001 } }),
    /profile limit override maxSegments/u,
  );
});

test('standalone verification rejects a genuine failure from different effective limits', () => {
  const limitedSource = 'a={{1}}\nb={{2}}\n';
  const fields = runBatch(limitedSource, { profileLimits: { maxSegments: 1 } }).fields;
  assert.throws(() => verifyBatchFields(limitedSource, fields), /receipt replay/u);
  assert.equal(
    verifyBatchFields(limitedSource, fields, { profileLimits: { maxSegments: 1 } }).receipt.diagnostic.code,
    'BATCH_LIMIT',
  );
});

test('source-level batch limits bind the complete source span', () => {
  const source = 'abc';
  const fields = [
    'kern.frontend.f2-batch.1', 'failure', 'C11:BATCH_LIMITS1:0E1:3O2:-1', '3',
    '0', '0', '', '', '', 'failure',
  ];
  const decoded = decodeBatch(fields, source, { sourceScalars: 3, segments: [] }, {
    allowForcedLateFailure: false,
    limits: { maxEncodedBytes: 1024 },
    resultFormat: 'kern.frontend.f2-batch.1',
  });
  assert.equal(decoded.receipt.diagnostic.startScalar, 0);
  assert.equal(decoded.receipt.diagnostic.endScalar, 3);
});
