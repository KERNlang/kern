import assert from 'node:assert/strict';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';

import {
  assertPublicHandlerAbiClosure,
  RUNTIME_DYNAMIC_ESCAPE_BINDINGS,
  runtimeJavaScriptImportClosure,
  runtimeModuleSpecifiers,
} from '../runtime-envelope-import-closure.mjs';

test('public source and built JavaScript dependency graphs are acyclic and machine-only', () => {
  const coreSource = resolve('packages/core/src');
  const builtEntry = resolve('packages/core/dist/runtime-handler.js');
  assert.ok(assertPublicHandlerAbiClosure(coreSource).size > 0);
  assert.ok(runtimeJavaScriptImportClosure([builtEntry], undefined, new Set(['decimal.js']), false).size > 0);
});

test('built JavaScript dependency graph rejects a cycle', () => {
  const entry = '/repo/dist/runtime-handler.js';
  const dependency = '/repo/dist/runtime-envelope/handler-entry.js';
  const specifier = (fromPath, targetPath) => {
    const path = relative(dirname(fromPath), targetPath);
    return path.startsWith('.') ? path : `./${path}`;
  };
  const sources = new Map([
    [entry, `import '${specifier(entry, dependency)}';`],
    [dependency, `import '${specifier(dependency, entry)}';`],
  ]);
  assert.throws(
    () => runtimeJavaScriptImportClosure([entry], (path) => sources.get(path), new Set(), false),
    /runtime module dependency cycle/u,
  );
});

test('source and built closures reject every frozen dynamic-loader escape family', () => {
  assert.deepEqual(RUNTIME_DYNAMIC_ESCAPE_BINDINGS, [
    'Bun',
    'Deno',
    'Function',
    'WebAssembly',
    'constructor',
    'createRequire',
    'eval',
    'global',
    'globalThis',
    'importScripts',
    'module',
    'process',
  ]);
  const mutants = [
    'process.getBuiltinModule("node:fs")',
    'process["getBuiltinModule"]("node:fs")',
    'eval("import(\\"node:fs\\")")',
    '(0, eval)("import(\\"node:fs\\")")',
    'Function("return import(\\"node:fs\\")")()',
    'globalThis["Function"]("return import(\\"node:fs\\")")()',
    '(() => {}).constructor("return import(\\"node:fs\\")")()',
    'module.require("node:fs")',
    'createRequire(import.meta.url)("node:fs")',
    'WebAssembly.compile(bytes)',
    'Deno.readTextFile("secret")',
    'Bun.file("secret")',
    'importScripts("https://example.invalid/module.js")',
  ];
  for (const mutant of mutants) {
    assert.throws(() => runtimeModuleSpecifiers(mutant, 'mutant.ts'), /runtime-envelope import closure/u, mutant);
    assert.throws(
      () => runtimeJavaScriptImportClosure(['/repo/mutant.js'], () => mutant, new Set(), false),
      /runtime-envelope import closure/u,
      mutant,
    );
  }
});

test('classified literal loaders stay visible while nonliteral loaders fail closed', () => {
  assert.deepEqual(runtimeModuleSpecifiers('require("./dependency.js")', 'entry.ts'), ['./dependency.js']);
  assert.deepEqual(runtimeModuleSpecifiers('import("./dependency.js")', 'entry.ts'), ['./dependency.js']);
  assert.throws(() => runtimeModuleSpecifiers('require(name)', 'entry.ts'), /non-literal require/u);
  assert.throws(() => runtimeModuleSpecifiers('import(name)', 'entry.ts'), /non-literal dynamic import/u);
});
