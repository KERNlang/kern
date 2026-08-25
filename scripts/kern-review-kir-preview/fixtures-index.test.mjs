import assert from 'node:assert/strict';
import test from 'node:test';

import { fixturePair } from './fixtures/index.mjs';

test('fixture lookup rejects an unknown id with the fixture contract error', () => {
  assert.throws(() => fixturePair('not-a-fixture'), /unknown KIR review fixture: not-a-fixture/u);
});
