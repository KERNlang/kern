import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { assertPublicRuntimeHandlerDeclaration } from '../runtime-handler-public-declaration.mjs';

const declaration = readFileSync('packages/core/dist/runtime-handler.d.ts', 'utf8');

function replaceExactly(source, needle, replacement) {
  assert.ok(source.includes(needle), `mutation source missing: ${needle}`);
  const mutated = source.replace(needle, replacement);
  assert.notEqual(mutated, source, `mutation was a no-op: ${needle}`);
  return mutated;
}

test('built public runtime handler declaration matches the closed v1 constitution', () => {
  const result = assertPublicRuntimeHandlerDeclaration(declaration);
  assert.deepEqual(result.eventOperations, ['stdout', 'stderr', 'capability']);
  assert.ok(result.symbols.includes('KernRuntimeHandlerEnvelope'));
});

for (const [name, mutation, error] of [
  ['raw Trace export', (source) => `${source}\nexport interface Trace { events: unknown[] }\n`, /forbidden public type Trace/u],
  [
    'raw Trace alias',
    (source) => `${source}\nexport type PublicTrace = import('./ir/semantics/trace.js').Trace;\n`,
    /forbidden public type Trace/u,
  ],
  [
    'unknown event channel',
    (source) => {
      const mutated = source.replace(/export type KernRuntimeHandlerEvent = [\s\S]*?;\nexport type KernRuntimeHandlerDiagnosticCode/u, 'export type KernRuntimeHandlerEvent = unknown;\nexport type KernRuntimeHandlerDiagnosticCode');
      assert.notEqual(mutated, source, 'event mutation was a no-op');
      return mutated;
    },
    /KernRuntimeHandlerEvent/u,
  ],
  [
    'invented diagnostic code',
    (source) => replaceExactly(source, "'unsupported-runtime-input';", "'unsupported-runtime-input' | 'invented';"),
    /diagnostic code inventory drifted/u,
  ],
  [
    'deleted limit',
    (source) => replaceExactly(source, '    readonly maxEvents: number;\n', ''),
    /limit property inventory drifted/u,
  ],
  [
    'request any channel',
    (source) => replaceExactly(source, 'readonly arguments: readonly unknown[];', 'readonly arguments: readonly any[];'),
    /complete declaration schema drifted/u,
  ],
  [
    'optional request source',
    (source) => replaceExactly(source, 'readonly source: string;', 'readonly source?: string;'),
    /complete declaration schema drifted/u,
  ],
  [
    'extra host option',
    (source) => replaceExactly(source, 'readonly enabled: true;', 'readonly host?: any;\n    readonly enabled: true;'),
    /complete declaration schema drifted/u,
  ],
  [
    'widened capability context',
    (source) => replaceExactly(source, 'readonly sourceName?: string;', 'readonly sourceName?: any;'),
    /complete declaration schema drifted/u,
  ],
  [
    'capability authority field',
    (source) => replaceExactly(source, 'readonly operation: string;\n}', 'readonly operation: string;\n    readonly authority?: string;\n}'),
    /complete declaration schema drifted/u,
  ],
  [
    'removed readonly modifier',
    (source) => replaceExactly(source, 'readonly handlerName: string;', 'handlerName: string;'),
    /complete declaration schema drifted/u,
  ],
  [
    'async provider return',
    (source) => replaceExactly(source, 'PromiseLike<KernRuntimeHandlerCapabilityValue | undefined>', 'PromiseLike<any>'),
    /complete declaration schema drifted/u,
  ],
  [
    'scheduler signal type',
    (source) => replaceExactly(source, 'readonly signal?: AbortSignal;', 'readonly signal?: unknown;'),
    /complete declaration schema drifted/u,
  ],
  [
    'error inheritance',
    (source) => replaceExactly(source, 'extends TypeError', 'extends Error'),
    /complete declaration schema drifted/u,
  ],
  [
    'sync return type',
    (source) => replaceExactly(source, '): KernRuntimeHandlerEnvelope;', '): any;'),
    /complete declaration schema drifted/u,
  ],
  [
    'async return wrapper',
    (source) => replaceExactly(source, '): Promise<KernRuntimeHandlerEnvelope>;', '): KernRuntimeHandlerEnvelope;'),
    /complete declaration schema drifted/u,
  ],
]) {
  test(`declaration oracle rejects ${name}`, () => {
    assert.throws(() => assertPublicRuntimeHandlerDeclaration(mutation(declaration)), error);
  });
}
