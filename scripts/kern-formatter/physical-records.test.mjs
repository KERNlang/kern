import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadKernFormatterAssets } from '../../packages/cli/dist/kern-formatter-assets.js';
import {
  createKernFormatterPhysicalRecords,
  KernFormatterPhysicalRecordError,
} from '../../packages/cli/dist/kern-formatter-physical-records.js';
import { runKernFormatter } from '../../packages/cli/dist/kern-formatter-runtime.js';

const limits = loadKernFormatterAssets().policy.profileLimits;

test('physical transport frames only content and LF/CRLF/EOF mechanics', () => {
  assert.deepEqual(createKernFormatterPhysicalRecords('', limits), [
    'kern.formatter.physical-records.1',
    'seal',
    '0',
  ]);
  assert.deepEqual(createKernFormatterPhysicalRecords('a\r\n\nlast', limits), [
    'kern.formatter.physical-records.1',
    'record',
    '0',
    'a',
    'crlf',
    'record',
    '1',
    '',
    'lf',
    'record',
    '2',
    'last',
    'none',
    'seal',
    '3',
  ]);
  const implementation = readFileSync('packages/cli/src/kern-formatter-physical-records.ts', 'utf8');
  for (const forbidden of ['commentOffset', 'leadingWidth', 'recordClass', 'raw-opener', 'opaque']) {
    assert.equal(implementation.includes(forbidden), false, forbidden);
  }
});

test('physical record and count ceilings admit exact values and reject plus one', () => {
  const exactWidth = createKernFormatterPhysicalRecords('x'.repeat(limits.maxRecordCodePoints), limits);
  assert.equal(exactWidth[3].length, limits.maxRecordCodePoints);
  assert.throws(
    () => createKernFormatterPhysicalRecords('x'.repeat(limits.maxRecordCodePoints + 1), limits),
    (error) => error instanceof KernFormatterPhysicalRecordError && error.code === 'RECORD_CODE_POINTS_LIMIT',
  );

  const exactRecords = '\n'.repeat(limits.maxRecords);
  assert.equal(createKernFormatterPhysicalRecords(exactRecords, limits).at(-1), String(limits.maxRecords));
  assert.throws(
    () => createKernFormatterPhysicalRecords(`${exactRecords}\n`, limits),
    (error) => error instanceof KernFormatterPhysicalRecordError && error.code === 'RECORD_LIMIT',
  );
});

test('bare CR and every malformed surrogate shape fail before KERN execution', () => {
  const request = (source) => runKernFormatter({ format: 'kern.formatter.request.1', source });
  assert.equal(request('x\ry').diagnostics[0].code, 'BARE_CR');
  for (const source of ['\ud800', '\udc00', '\ud800x', 'x\udc00', '\ud800\ud800', '\udc00\udc00']) {
    const result = request(source);
    assert.equal(result.outcome, 'failure');
    assert.match(result.diagnostics[0].message, /well-formed Unicode/u);
  }
});
