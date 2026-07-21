import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { assertDirectParameterPrefix } from './coverage-value-band-parameter-migrations.mjs';

test('M4.33 rejects a parameter moved behind the function handler', () => {
  const document = parseDocumentWithDiagnostics(`fn name=misordered returns=number
  param name=left type=number
  handler lang="kern"
    return value="left + right"
  param name=right type=number
`);
  assert.deepEqual(document.diagnostics, []);
  const root = document.root.children[0];

  assert.throws(
    () => assertDirectParameterPrefix(root, [['left', 'number'], ['right', 'number']]),
    /parameter children must be the exact function prefix/,
  );
});
