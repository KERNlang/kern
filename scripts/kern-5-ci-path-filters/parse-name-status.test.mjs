import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNameStatus } from '../ci/classify-ci-changes.mjs';

function nulJoin(...fields) {
  return `${fields.join('\0')}\0`;
}

test('an empty diff produces no files', () => {
  assert.deepEqual(parseNameStatus(''), []);
});

test('a modified file has the same old and new path', () => {
  assert.deepEqual(parseNameStatus(nulJoin('M', 'src/index.ts')), [
    { status: 'M', oldPath: 'src/index.ts', newPath: 'src/index.ts' },
  ]);
});

test('an added file has no old path', () => {
  assert.deepEqual(parseNameStatus(nulJoin('A', 'src/new.ts')), [
    { status: 'A', oldPath: undefined, newPath: 'src/new.ts' },
  ]);
});

test('a deleted file has no new path', () => {
  assert.deepEqual(parseNameStatus(nulJoin('D', 'src/old.ts')), [
    { status: 'D', oldPath: 'src/old.ts', newPath: undefined },
  ]);
});

test('a rename carries both the old and new path under its similarity-scored status', () => {
  assert.deepEqual(parseNameStatus(nulJoin('R100', 'old/name.ts', 'new/name.ts')), [
    { status: 'R100', oldPath: 'old/name.ts', newPath: 'new/name.ts' },
  ]);
});

test('a copy carries both the source and destination path', () => {
  assert.deepEqual(parseNameStatus(nulJoin('C75', 'src/shared.ts', 'src/copy.ts')), [
    { status: 'C75', oldPath: 'src/shared.ts', newPath: 'src/copy.ts' },
  ]);
});

test('multiple NUL-separated entries parse independently in order', () => {
  const output = nulJoin('M', 'a.ts') + nulJoin('A', 'b.ts') + nulJoin('D', 'c.ts');
  assert.deepEqual(parseNameStatus(output), [
    { status: 'M', oldPath: 'a.ts', newPath: 'a.ts' },
    { status: 'A', oldPath: undefined, newPath: 'b.ts' },
    { status: 'D', oldPath: 'c.ts', newPath: undefined },
  ]);
});

test('a trailing NUL does not produce a phantom empty-field entry', () => {
  assert.deepEqual(parseNameStatus('M\0only.ts\0'), [{ status: 'M', oldPath: 'only.ts', newPath: 'only.ts' }]);
});
