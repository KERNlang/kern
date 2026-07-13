import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertRuntimeImportClosureExcludes, runtimeModuleSpecifiers } from './runtime-envelope-import-closure.mjs';

const entry = '/repo/internal-effect-machine-try.ts';
const bridge = '/repo/bridge.ts';
const legacy = '/repo/reference-runner.ts';

function reader(entries) {
  return (path) => {
    if (!entries.has(path)) throw new Error(`missing synthetic source ${path}`);
    return entries.get(path);
  };
}

test('runtime import parser excludes erased type-only edges', () => {
  assert.deepEqual(
    runtimeModuleSpecifiers(
      "import type { A } from './a.js'; import { type B } from './b.js'; import { C, type D } from './c.js';",
      entry,
    ),
    ['./c.js'],
  );
});

test('transitive closure rejects a forbidden emitted-JavaScript edge', () => {
  const sources = new Map([
    [entry, "import './bridge.js';"],
    [bridge, "export { run } from './reference-runner.js';"],
    [legacy, 'export const run = () => {};'],
  ]);
  assert.throws(() => assertRuntimeImportClosureExcludes([entry], [legacy], reader(sources)), /is reachable/u);
});

test('transitive closure accepts a bounded legacy-free graph', () => {
  const sources = new Map([
    [entry, "import { helper } from './bridge.js'; void helper;"],
    [bridge, 'export const helper = true;'],
  ]);
  assert.deepEqual([...assertRuntimeImportClosureExcludes([entry], [legacy], reader(sources))].sort(), [bridge, entry]);
});

test('non-literal dynamic imports fail closed', () => {
  assert.throws(() => runtimeModuleSpecifiers('const path = "./x.js"; import(path);', entry), /non-literal/u);
});
