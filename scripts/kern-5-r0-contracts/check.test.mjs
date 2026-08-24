import assert from 'node:assert/strict';
import test from 'node:test';

import { parseChildPeakRssBytes } from './check.mjs';

test('R0 child RSS parser normalizes macOS bytes and Linux KiB', () => {
  assert.equal(parseChildPeakRssBytes('darwin', '123 maximum resident set size'), 123);
  assert.equal(parseChildPeakRssBytes('linux', 'Maximum resident set size (kbytes): 123'), 123 * 1024);
  assert.throws(() => parseChildPeakRssBytes('win32', ''), /unsupported/u);
});
