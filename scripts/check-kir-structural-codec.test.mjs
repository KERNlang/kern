import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAllowedStructuralKirConsumer,
  runStructuralKirCodecCheck,
  structuralKirReferences,
} from './check-kir-structural-codec.mjs';

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

test('containment ignores erased structural KIR type edges but retains runtime and mixed edges', () => {
  const sourcePath = 'packages/core/src/frontend-projection.ts';
  const canonicalModulePath = './kir-structural/module-canonical.js';
  const source = `
    import type { ModuleKirArtifact } from './kir-structural/module-types.js';
    export type { ModuleKirArtifact } from './kir-structural/module-types.js';
    import { decodeModuleKir } from './kir-structural/module-canonical.js';
    import { type ModuleKirArtifact, decodeModuleKir as MixedValue } from './kir-structural/module-canonical.js';
  `;
  assert.deepEqual(structuralKirReferences(source, sourcePath), [
    canonicalModulePath,
    canonicalModulePath,
  ]);
});

test('only the exact decoded-runtime binder is a sanctioned runtime consumer', () => {
  assert.equal(isAllowedStructuralKirConsumer('packages/core/src/kir-v1/canonical.ts'), true);
  assert.equal(
    isAllowedStructuralKirConsumer('packages/core/src/runtime-envelope/kir-handler.ts'),
    true,
  );
  assert.equal(
    isAllowedStructuralKirConsumer('packages/core/src/runtime-envelope/kir-handler-adapter.ts'),
    false,
  );
  assert.throws(
    () => runStructuralKirCodecCheck({
      additionalSources: [{
        path: 'packages/core/src/runtime-envelope/kir-handler-adapter.ts',
        source: "import { decodeModuleKir } from '../kir-structural/module-canonical.js';",
      }],
    }),
    /must remain internal and unconsumed.*kir-handler-adapter\.ts/u,
  );
});
