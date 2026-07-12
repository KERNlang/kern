import assert from 'node:assert/strict';
import test from 'node:test';

import { structuralKirReferences } from './check-kir-structural-codec.mjs';

test('containment check follows module edges rather than matching comments or strings', () => {
  const harmless = `
    // kir-structural is an internal format.
    const label = 'kir-structural';
    import value from './ordinary.js';
  `;
  assert.deepEqual(structuralKirReferences(harmless, 'packages/core/src/consumer.ts'), []);
  assert.deepEqual(
    structuralKirReferences(
      "import { decodeStructuralKir } from './kir-structural/canonical.js';",
      'packages/core/src/consumer.ts',
    ),
    ['./kir-structural/canonical.js'],
  );
});
