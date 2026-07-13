import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  assertPortableMachineEvaluatorClosure,
  assertRuntimeImportClosureExcludes,
  assertStableEffectMachineClosure,
  runtimeModuleSpecifiers,
} from './runtime-envelope-import-closure.mjs';

const entry = '/repo/internal-effect-machine-try.ts';
const bridge = '/repo/bridge.ts';
const legacy = '/repo/reference-runner.ts';
const legacyContract = '/repo/if.ts';
const legacyFacade = '/repo/portable-scalar.ts';
const coreSource = resolve(process.cwd(), 'packages/core/src');
const semantics = resolve(coreSource, 'ir/semantics');

function productionReader(mutations = new Map()) {
  return (path) => mutations.get(path) ?? readFileSync(path, 'utf8');
}

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

test('transitive closure rejects a runtime-leaf edge to a legacy contract', () => {
  const sources = new Map([
    [entry, "import './bridge.js';"],
    [bridge, "export { evaluate } from './if.js';"],
    [legacyContract, 'export const evaluate = () => true;'],
  ]);
  assert.throws(
    () => assertRuntimeImportClosureExcludes([entry], [legacyContract], reader(sources)),
    /is reachable/u,
  );
});

test('transitive closure rejects a core-evaluator edge to the legacy facade', () => {
  const sources = new Map([
    [entry, "import './bridge.js';"],
    [bridge, "export { evaluate } from './portable-scalar.js';"],
    [legacyFacade, 'export const evaluate = () => true;'],
  ]);
  assert.throws(
    () => assertRuntimeImportClosureExcludes([entry], [legacyFacade], reader(sources)),
    /is reachable/u,
  );
});

test('non-literal dynamic imports fail closed', () => {
  assert.throws(() => runtimeModuleSpecifiers('const path = "./x.js"; import(path);', entry), /non-literal/u);
});

test('production stable-machine and scalar-machine closures satisfy the shared quarantine policy', () => {
  assert.ok(assertStableEffectMachineClosure(coreSource).size > 0);
  assert.ok(assertPortableMachineEvaluatorClosure(coreSource).size > 0);
});

test('production policy rejects a direct stable-machine edge to the sync reference runner', () => {
  const machine = resolve(semantics, 'internal-effect-machine.ts');
  const source = readFileSync(machine, 'utf8');
  assert.throws(
    () => assertStableEffectMachineClosure(
      coreSource,
      productionReader(new Map([[machine, `${source}\nimport './reference-runner.js';\n`]])),
    ),
    /reference-runner\.ts is reachable/u,
  );
});

test('production policy rejects a runtime-leaf edge to a legacy control contract', () => {
  const leaf = resolve(semantics, 'if-runtime.ts');
  const source = readFileSync(leaf, 'utf8');
  assert.throws(
    () => assertStableEffectMachineClosure(
      coreSource,
      productionReader(new Map([[leaf, `${source}\nimport './if.js';\n`]])),
    ),
    /if\.ts is reachable/u,
  );
});

test('production policy rejects a core-evaluator edge to the compatibility facade', () => {
  const core = resolve(semantics, 'portable-core-evaluator.ts');
  const source = readFileSync(core, 'utf8');
  assert.throws(
    () => assertPortableMachineEvaluatorClosure(
      coreSource,
      productionReader(new Map([[core, `${source}\nimport './portable-scalar.js';\n`]])),
    ),
    /portable-scalar\.ts is reachable/u,
  );
});

test('production policy rejects reintroducing the deleted ambient sequence bridge', () => {
  const structure = resolve(semantics, 'internal-effect-machine-structure.ts');
  const bridgePath = resolve(semantics, 'semantic-sequence-runtime.ts');
  const source = readFileSync(structure, 'utf8');
  const mutations = new Map([
    [structure, `${source}\nimport './semantic-sequence-runtime.js';\n`],
    [bridgePath, 'export {};'],
  ]);
  assert.throws(
    () => assertStableEffectMachineClosure(coreSource, productionReader(mutations)),
    /semantic-sequence-runtime\.ts is reachable/u,
  );
});

test('own-package imports fail closed instead of bypassing source closure resolution', () => {
  const core = resolve(semantics, 'portable-core-evaluator.ts');
  const source = readFileSync(core, 'utf8');
  const mutation = `${source}\nimport { referenceRunSequence as runSeq } from '@kernlang/core';\nvoid runSeq;\n`;
  assert.throws(
    () => assertPortableMachineEvaluatorClosure(coreSource, productionReader(new Map([[core, mutation]]))),
    /own-package import @kernlang\/core/u,
  );
});
