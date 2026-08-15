import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadPolicy } from './decoder.mjs';

test('production F1 scanner assets exist in authenticated order', () => {
  const policy = loadPolicy();
  const sources = policy.modules.map((path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
  assert.equal(sources.length, 4);
  assert.ok(sources.every((source) => source.length > 0));
  assert.match(sources.at(-1), /fn name=scanf1records/u);
});
