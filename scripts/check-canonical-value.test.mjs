import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalValueReferences, moduleSpecifiers } from './check-canonical-value.mjs';

test('browser graph parser sees every supported module edge', () => {
  const source = `
    import './side-effect.js';
    import value from './value.js';
    export { item } from './named.js';
    export * from './all.js';
    async function load() { return import('./dynamic.js'); }
    const legacy = require('./legacy.js');
    import equal = require('./equal.js');
  `;
  assert.deepEqual(moduleSpecifiers(source, 'fixture.ts'), [
    './side-effect.js',
    './value.js',
    './named.js',
    './all.js',
    './dynamic.js',
    './legacy.js',
    './equal.js',
  ]);
});

test('browser graph parser fails closed on computed module edges', () => {
  assert.throws(() => moduleSpecifiers('import(target);', 'dynamic.ts'), /non-literal dynamic import/u);
  assert.throws(() => moduleSpecifiers('require(target);', 'require.ts'), /non-literal require/u);
});

test('containment check follows module edges rather than matching comments or strings', () => {
  const harmless = `
    // canonical-value is an internal format.
    const label = 'canonical-value';
    import value from './ordinary.js';
  `;
  assert.deepEqual(canonicalValueReferences(harmless, 'packages/core/src/consumer.ts'), []);
  assert.deepEqual(
    canonicalValueReferences(
      "import { decodeCanonicalValue } from './canonical-value/canonical.js';",
      'packages/core/src/consumer.ts',
    ),
    ['./canonical-value/canonical.js'],
  );
});
