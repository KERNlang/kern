import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { reconstructHistoricalSource } from './historical-source.mjs';

const EXPECTED = createHash('sha256').update('before\nstable\n').digest('hex');
const REPLACEMENTS = [{ current: 'after\n', historical: 'before\n' }];

test('historical source reconstruction applies only exact declared replacements', () => {
  assert.equal(
    reconstructHistoricalSource({
      currentSource: 'after\nstable\n',
      expectedDigest: EXPECTED,
      milestone: 'test',
      replacements: REPLACEMENTS,
    }).toString('utf8'),
    'before\nstable\n',
  );
});

test('historical source reconstruction rejects replacement and unrelated drift', () => {
  for (const currentSource of ['changed\nstable\n', 'after\nstable\nfuture\n', 'after\nafter\n']) {
    assert.throws(
      () => reconstructHistoricalSource({
        currentSource,
        expectedDigest: EXPECTED,
        milestone: 'test',
        replacements: REPLACEMENTS,
      }),
      /test historical source rejection:/u,
    );
  }
});
