import assert from 'node:assert/strict';
import test from 'node:test';

import { loadKernFormatterAssets } from '../../packages/cli/dist/kern-formatter-assets.js';
import { createKernFormatterPhysicalRecords } from '../../packages/cli/dist/kern-formatter-physical-records.js';
import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { INVALID_FORMATTER_FIXTURES, VALID_FORMATTER_FIXTURES } from './fixtures.mjs';

const assets = loadKernFormatterAssets();
const limits = assets.policy.profileLimits;

function tape(source, physical = createKernFormatterPhysicalRecords(source, limits)) {
  const envelope = executeKernRuntimeHandlerSync(
    {
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: [
        source,
        physical,
        limits.maxCodePoints,
        limits.maxRecords,
        limits.maxRecordCodePoints,
        limits.maxLexicalDepth,
      ],
      identity: { handlerName: 'formattersourcetape', sourcePath: '@kernlang/cli/dist/kern-formatter/formatter.composed.kern' },
      source: assets.source,
    },
    { enabled: true, limits: assets.policy.runtimeLimits },
  );
  assert.equal(envelope.outcome, 'success');
  assert.equal(envelope.completion.kind, 'return');
  assert.deepEqual(envelope.events, []);
  assert.equal(envelope.result.value.tag, 'list');
  return envelope.result.value.value.map((field) => {
    assert.equal(field.tag, 'text');
    return field.value;
  });
}

test('source tape partitions every admitted source exactly once', () => {
  const allowed = new Set(['blank', 'comment', 'code', 'opaque', 'raw-opener', 'raw-body', 'raw-closer', 'raw-inline']);
  for (const fixture of VALID_FORMATTER_FIXTURES) {
    const fields = tape(fixture.source);
    assert.deepEqual(fields.slice(0, 2), ['kern.formatter.source-tape.1', 'ok'], fixture.id);
    const extents = [];
    let ordinal = 0;
    let offset = 4;
    for (; fields[offset] !== 'seal'; offset += 8) {
      assert.equal(fields[offset], 'record', fixture.id);
      assert.equal(fields[offset + 1], String(ordinal), fixture.id);
      assert.ok(allowed.has(fields[offset + 4]), fixture.id);
      extents.push(fields[offset + 7]);
      ordinal += 1;
    }
    assert.equal(offset + 8, fields.length, fixture.id);
    assert.equal(extents.join(''), fixture.source, fixture.id);
    assert.deepEqual(fields.slice(offset + 1, offset + 5), [fixture.source, fields[2], fields[3], String(ordinal)], fixture.id);
  }
});

test('tape owns raw, comment, blank, opaque, and ordinary precedence', () => {
  const source = '# comment  \n   \ncode   \nhandler <<<\n# raw   \n>>>\ntext value="open   \nclose"   \n';
  const fields = tape(source);
  const classes = [];
  for (let offset = 4; fields[offset] !== 'seal'; offset += 8) classes.push(fields[offset + 4]);
  assert.deepEqual(classes, ['comment', 'blank', 'code', 'raw-opener', 'raw-body', 'raw-closer', 'opaque', 'opaque']);
});

test('tape failures retain stable native codes', () => {
  for (const fixture of INVALID_FORMATTER_FIXTURES.filter((item) => item.code !== 'BARE_CR')) {
    const fields = tape(fixture.source);
    assert.deepEqual(fields.slice(0, 3), ['kern.formatter.source-tape.1', 'failure', fixture.code], fixture.id);
  }
});

test('hostile physical-record witnesses fail before source classification', () => {
  const cases = [
    ['x\n', ['kern.formatter.physical-records.1', 'record', '1', 'x', 'lf', 'seal', '1']],
    ['x\n', ['kern.formatter.physical-records.1', 'record', '0', 'x\n', 'none', 'seal', '1']],
    ['x\n', ['kern.formatter.physical-records.1', 'record', '0', 'x', 'none', 'seal', '1']],
    ['x\n', ['kern.formatter.physical-records.1', 'record', '0', 'x', 'lf', 'seal', '2']],
    ['x\n', ['kern.formatter.physical-records.1', 'record', '0', 'y', 'lf', 'seal', '1']],
  ];
  for (const [source, physical] of cases) {
    const fields = tape(source, physical);
    assert.deepEqual(
      fields.slice(0, 3),
      ['kern.formatter.source-tape.1', 'failure', 'MALFORMED_PHYSICAL_RECORDS'],
    );
  }
});
