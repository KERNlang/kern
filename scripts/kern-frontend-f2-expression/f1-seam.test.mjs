import assert from 'node:assert/strict';
import test from 'node:test';

import { runScan } from '../kern-frontend-f1-scan/worker.mjs';
import { runExpression } from './worker.mjs';

const SEAMS = [
  {
    bodies: [{ body: ' a + b ', ordinals: [4] }],
    source: 'text value={{ a + b }}\n',
  },
  {
    bodies: [{ body: ' a +\n b ', ordinals: [4, 5, 6] }],
    source: 'text value={{ a +\n b }}\n',
  },
  {
    bodies: [
      { body: ' "}}" +\r\n "😀" ', ordinals: [2, 3, 4] },
      { body: 'f(a, b)', ordinals: [8] },
    ],
    source: 'first={{ "}}" +\r\n "😀" }}\r\nsecond={{f(a, b)}}\n',
  },
  {
    bodies: [{ body: ' "a\\\r\nb" ', ordinals: [2, 3, 4] }],
    source: 'value={{ "a\\\r\nb" }}\r\n',
  },
];

function bodyFromPredeterminedReceipts(records, ordinals) {
  const selected = ordinals.map((ordinal) => {
    const record = records[ordinal];
    assert.equal(record?.ordinal, ordinal, `missing predetermined F1 receipt ${ordinal}`);
    return record;
  });
  assert.equal(selected[0].kind, 'expr');
  assert.ok((selected[0].flags & 1) !== 0, 'first receipt must own expression opener');
  assert.equal(selected.at(-1).kind, 'expr');
  assert.ok((selected.at(-1).flags & 2) !== 0, 'last receipt must own expression closer');
  for (const record of selected.slice(1, -1)) assert.ok(['expr', 'newline'].includes(record.kind));
  const raw = selected.map((record) => record.raw).join('');
  assert.ok(raw.startsWith('{{') && raw.endsWith('}}'));
  return Array.from(raw).slice(2, -2).join('');
}

test('F2 reconstructs only predetermined bodies from authenticated F1 receipts', () => {
  for (const fixture of SEAMS) {
    const scan = runScan(fixture.source).decoded;
    assert.equal(scan.status, 'scanned');
    for (const expected of fixture.bodies) {
      const reconstructed = bodyFromPredeterminedReceipts(scan.records, expected.ordinals);
      assert.equal(reconstructed, expected.body);
      const direct = runExpression(expected.body);
      const fromReceipts = runExpression(reconstructed);
      assert.equal(direct.decoded.status, 'parsed', JSON.stringify(expected.body));
      assert.deepEqual(fromReceipts.fields, direct.fields);
      assert.deepEqual(fromReceipts.decoded, direct.decoded);
    }
  }
});
