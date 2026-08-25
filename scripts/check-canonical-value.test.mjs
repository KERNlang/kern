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
  assert.deepEqual(moduleSpecifiers(source, 'fixture.ts', { includeTypeOnly: false }), [
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

test('containment ignores erased type-only imports but retains runtime canonical-value edges', () => {
  const sourcePath = 'packages/core/src/frontend-projection/assets.ts';
  const source = `
    import type { CanonicalValueLimits } from '../canonical-value/types.js';
    import { type CanonicalValue } from '../canonical-value/types.js';
    import type LegacyCanonicalValue = require('../canonical-value/types.js');
    import { CanonicalValueDecodeError } from '../canonical-value/types.js';
    import { type CanonicalValue, CanonicalValueDecodeError as MixedValue } from '../canonical-value/types.js';
    async function load() { return import('../canonical-value/canonical.js'); }
    const legacy = require('../canonical-value/canonical.js');
  `;
  assert.deepEqual(canonicalValueReferences(source, sourcePath), [
    '../canonical-value/types.js',
    '../canonical-value/types.js',
    '../canonical-value/canonical.js',
    '../canonical-value/canonical.js',
  ]);
  assert.deepEqual(moduleSpecifiers(source, sourcePath), [
    '../canonical-value/types.js',
    '../canonical-value/types.js',
    '../canonical-value/types.js',
    '../canonical-value/types.js',
    '../canonical-value/types.js',
    '../canonical-value/canonical.js',
    '../canonical-value/canonical.js',
  ]);
});
