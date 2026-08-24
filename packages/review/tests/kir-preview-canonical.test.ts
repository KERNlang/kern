import assert from 'node:assert/strict';
import test from 'node:test';

import { compareCodePoints } from '../src/kir-preview/canonical.js';

test('KIR preview ordering compares Unicode code points instead of UTF-16 code units', () => {
  const bmpPrivateUse = '\uE000';
  const astral = '\u{10000}';

  assert.ok(compareCodePoints(bmpPrivateUse, astral) < 0, 'U+E000 must sort before U+10000');
  assert.ok(compareCodePoints(astral, bmpPrivateUse) > 0, 'ordering must be antisymmetric');
});
