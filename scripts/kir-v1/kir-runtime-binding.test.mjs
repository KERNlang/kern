import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { assertRuntimeImportClosureExcludes } from '../runtime-envelope-import-closure.mjs';

const root = process.cwd();
const core = resolve(root, 'packages/core/src');
const binder = resolve(core, 'runtime-envelope/kir-handler.ts');
const handlerEntry = resolve(core, 'runtime-envelope/handler-entry.ts');
const publicHandler = resolve(core, 'runtime-handler.ts');
const forbidden = [
  resolve(core, 'app-descriptor.ts'),
  resolve(core, 'parser.ts'),
  resolve(core, 'runner-capability-plan.ts'),
  resolve(core, 'runner.ts'),
  resolve(core, 'runtime.ts'),
  resolve(core, 'runtime-envelope/internal-legacy-engine.ts'),
  resolve(core, 'runtime-envelope/source-handler.ts'),
  resolve(core, 'runtime-envelope/source-runner-engine.ts'),
  resolve(core, 'runtime-envelope/source-runner-legacy.ts'),
];
const allowedBare = new Set(['decimal.js']);

function productionReader(mutations = new Map()) {
  return (path) => mutations.get(path) ?? readFileSync(path, 'utf8');
}

function assertBinderClosure(readText = productionReader(), forbiddenPaths = forbidden) {
  return assertRuntimeImportClosureExcludes([binder], forbiddenPaths, readText, allowedBare, false);
}

function assertHandlerEntryIsNotStructurallyWidened(readText = productionReader()) {
  const source = readText(handlerEntry);
  assert.doesNotMatch(source, /StructuralKirNode/u);
  assert.doesNotMatch(source, /KirHandler/u);
}

test('production KIR runtime binder excludes source, loader, public runner, and legacy owners', () => {
  assert.ok(assertBinderClosure().size > 0);
});

test('binder closure rejects direct and transitive source-handler adoption', () => {
  const binderSource = readFileSync(binder, 'utf8');
  const sourceHandler = resolve(core, 'runtime-envelope/source-handler.ts');
  assert.ok(assertBinderClosure(productionReader(), [sourceHandler]).size > 0);
  assert.throws(
    () =>
      assertBinderClosure(
        productionReader(new Map([[binder, `${binderSource}\nimport './source-handler.js';\n`]])),
        [sourceHandler],
      ),
    /source-handler\.ts is reachable/u,
  );

  const bridge = resolve(core, 'runtime-envelope/kir-source-bridge.ts');
  assert.throws(
    () =>
      assertBinderClosure(
        productionReader(
          new Map([
            [binder, `${binderSource}\nimport './kir-source-bridge.js';\n`],
            [bridge, "export { resolveInternalRuntimeSourceHandler } from './source-handler.js';\n"],
          ]),
        ),
        [sourceHandler],
      ),
    /source-handler\.ts is reachable/u,
  );
});

test('binder closure rejects public runner, non-literal loaders, and legacy fallback', () => {
  const binderSource = readFileSync(binder, 'utf8');
  const runner = resolve(core, 'runner.ts');
  const legacy = resolve(core, 'runtime-envelope/source-runner-legacy.ts');
  assert.ok(assertBinderClosure(productionReader(), [runner]).size > 0);
  assert.ok(assertBinderClosure(productionReader(), [legacy]).size > 0);
  const mutations = [
    [`${binderSource}\nimport '../runner.js';\n`, [runner], /runner\.ts is reachable/u],
    [`${binderSource}\nimport './source-runner-legacy.js';\n`, [legacy], /source-runner-legacy\.ts is reachable/u],
    [`${binderSource}\nconst target = './source-handler.js'; void import(target);\n`, forbidden, /non-literal dynamic import/u],
  ];
  for (const [source, forbiddenPaths, pattern] of mutations) {
    assert.throws(
      () => assertBinderClosure(productionReader(new Map([[binder, source]])), forbiddenPaths),
      pattern,
    );
  }
});

test('frozen handler entry rejects structural type smuggling', () => {
  assertHandlerEntryIsNotStructurallyWidened();
  const source = readFileSync(handlerEntry, 'utf8');
  assert.throws(
    () =>
      assertHandlerEntryIsNotStructurallyWidened(
        productionReader(new Map([[handlerEntry, `${source}\ntype Smuggled = StructuralKirNode;\n`]])),
      ),
    /StructuralKirNode/u,
  );
});

test('binder remains internal and absent from the frozen public handler surface', () => {
  assert.doesNotMatch(readFileSync(publicHandler, 'utf8'), /kir-handler|InternalRuntimeKir/u);
  const manifest = JSON.parse(readFileSync(resolve(root, 'packages/core/package.json'), 'utf8'));
  assert.doesNotMatch(JSON.stringify(manifest.exports), /kir-handler|kir-runtime/u);
});
