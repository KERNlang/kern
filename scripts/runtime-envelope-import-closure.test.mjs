import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import {
  assertExecutableEnvelopeDirectClosure,
  EXECUTABLE_ENVELOPE_FORBIDDEN_SPECIFIERS,
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
const syntheticCoreSource = '/repo/core';
const syntheticEnvelope = resolve(syntheticCoreSource, 'runtime-envelope');
const syntheticSemantics = resolve(syntheticCoreSource, 'ir/semantics');
const syntheticExecute = resolve(syntheticEnvelope, 'execute.ts');
const syntheticEngine = resolve(syntheticEnvelope, 'internal-engine.ts');

function productionReader(mutations = new Map()) {
  return (path) => mutations.get(path) ?? readFileSync(path, 'utf8');
}

function reader(entries) {
  return (path) => {
    if (!entries.has(path)) throw new Error(`missing synthetic source ${path}`);
    return entries.get(path);
  };
}

function syntheticExecutableSources(executeSource = 'export {};', engineSource = 'export {};') {
  return new Map([
    [syntheticExecute, executeSource],
    [syntheticEngine, engineSource],
  ]);
}

function emittedTypeScriptPath(fromPath, specifier) {
  return resolve(dirname(fromPath), specifier).replace(/\.js$/u, '.ts');
}

test('runtime import parser excludes erased type-only edges', () => {
  assert.deepEqual(
    runtimeModuleSpecifiers(
      "import type { A } from './a.js'; import { type B } from './b.js'; import { C, type D } from './c.js'; export { type E } from './e.js'; export { F, type G } from './f.js';",
      entry,
    ),
    ['./c.js', './f.js'],
  );
});

test('runtime import parser includes TypeScript import-equals require edges', () => {
  assert.deepEqual(
    runtimeModuleSpecifiers("import runner = require('./reference-runner.js'); void runner;", entry),
    ['./reference-runner.js'],
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

test('production direct executable-envelope closure satisfies the machine-only policy', () => {
  assert.ok(assertExecutableEnvelopeDirectClosure(coreSource).size > 0);
});

test('production runtime-envelope checker invokes the direct executable closure policy', () => {
  const checker = readFileSync(resolve(process.cwd(), 'scripts/check-runtime-envelope.mjs'), 'utf8');
  assert.match(checker, /assertExecutableEnvelopeDirectClosure\(CORE_SOURCE\)/u);
});

test('direct executable-envelope policy rejects every compatibility, registry, reference, and legacy owner', () => {
  for (const specifier of EXECUTABLE_ENVELOPE_FORBIDDEN_SPECIFIERS) {
    const target = emittedTypeScriptPath(syntheticExecute, specifier);
    const sources = syntheticExecutableSources(`import '${specifier}';`);
    sources.set(target, 'export {};');
    assert.throws(
      () => assertExecutableEnvelopeDirectClosure(syntheticCoreSource, reader(sources)),
      /is reachable/u,
      specifier,
    );
  }
});

test('direct executable-envelope policy rejects a transitive reference edge', () => {
  const bridgePath = resolve(syntheticEnvelope, 'bridge.ts');
  const target = resolve(syntheticSemantics, 'reference-runner.ts');
  const sources = syntheticExecutableSources("import './bridge.js';");
  sources.set(bridgePath, "import '../ir/semantics/reference-runner.js';");
  sources.set(target, 'export {};');
  assert.throws(
    () => assertExecutableEnvelopeDirectClosure(syntheticCoreSource, reader(sources)),
    /reference-runner\.ts is reachable/u,
  );
});

test('direct executable-envelope policy rejects a runtime re-export edge', () => {
  const bridgePath = resolve(syntheticEnvelope, 'bridge.ts');
  const target = resolve(syntheticSemantics, 'reference-runner.ts');
  const sources = syntheticExecutableSources("import './bridge.js';");
  sources.set(bridgePath, "export { run } from '../ir/semantics/reference-runner.js';");
  sources.set(target, 'export const run = () => {};');
  assert.throws(
    () => assertExecutableEnvelopeDirectClosure(syntheticCoreSource, reader(sources)),
    /reference-runner\.ts is reachable/u,
  );
});

test('direct executable-envelope policy rejects an import-equals reference edge', () => {
  const target = resolve(syntheticSemantics, 'reference-runner.ts');
  const sources = syntheticExecutableSources(
    "import runner = require('../ir/semantics/reference-runner.js'); void runner;",
  );
  sources.set(target, 'export {};');
  assert.throws(
    () => assertExecutableEnvelopeDirectClosure(syntheticCoreSource, reader(sources)),
    /reference-runner\.ts is reachable/u,
  );
});

test('direct executable-envelope policy rejects literal and non-literal dynamic imports', () => {
  const target = resolve(syntheticSemantics, 'reference-runner.ts');
  const literalSources = syntheticExecutableSources("void import('../ir/semantics/reference-runner.js');");
  literalSources.set(target, 'export {};');
  assert.throws(
    () => assertExecutableEnvelopeDirectClosure(syntheticCoreSource, reader(literalSources)),
    /reference-runner\.ts is reachable/u,
  );
  const nonLiteralSources = syntheticExecutableSources(
    "const moduleName = '../ir/semantics/reference-runner.js'; void import(moduleName);",
  );
  assert.throws(
    () => assertExecutableEnvelopeDirectClosure(syntheticCoreSource, reader(nonLiteralSources)),
    /non-literal dynamic import/u,
  );
});

test('direct executable-envelope policy rejects a require reference edge', () => {
  const target = resolve(syntheticSemantics, 'reference-runner.ts');
  const sources = syntheticExecutableSources("require('../ir/semantics/reference-runner.js');");
  sources.set(target, 'export {};');
  assert.throws(
    () => assertExecutableEnvelopeDirectClosure(syntheticCoreSource, reader(sources)),
    /reference-runner\.ts is reachable/u,
  );
});

test('runtime import parser fails closed on aliased require calls', () => {
  assert.throws(
    () => runtimeModuleSpecifiers("const load = require; load('./reference-runner.js');", entry),
    /indirect require/u,
  );
});

test('direct executable-envelope policy rejects own-package imports', () => {
  const sources = syntheticExecutableSources("import '@kernlang/core/runner';");
  assert.throws(
    () => assertExecutableEnvelopeDirectClosure(syntheticCoreSource, reader(sources)),
    /own-package import @kernlang\/core\/runner/u,
  );
});

test('direct executable-envelope policy rejects unapproved bare aliases', () => {
  const sources = syntheticExecutableSources("import '#reference-runner';");
  assert.throws(
    () => assertExecutableEnvelopeDirectClosure(syntheticCoreSource, reader(sources)),
    /unapproved bare import #reference-runner/u,
  );
});

test('direct executable-envelope policy rejects peer-dependency bypasses', () => {
  const sources = syntheticExecutableSources("import ts from 'typescript'; void ts;");
  assert.throws(
    () => assertExecutableEnvelopeDirectClosure(syntheticCoreSource, reader(sources)),
    /unapproved bare import typescript/u,
  );
});

test('direct executable-envelope policy rejects createRequire loader bypasses', () => {
  const sources = syntheticExecutableSources(
    "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); load('../ir/semantics/reference-runner.js');",
  );
  assert.throws(
    () => assertExecutableEnvelopeDirectClosure(syntheticCoreSource, reader(sources)),
    /forbidden dynamic binding createRequire/u,
  );
});

test('direct executable-envelope policy admits only its literal runtime dependency allowlist', () => {
  const sources = syntheticExecutableSources("import Decimal from 'decimal.js'; void Decimal;");
  assert.equal(assertExecutableEnvelopeDirectClosure(syntheticCoreSource, reader(sources)).size, 2);
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

test('production policy rejects a TypeScript import-equals edge to the sync reference runner', () => {
  const machine = resolve(semantics, 'internal-effect-machine.ts');
  const source = readFileSync(machine, 'utf8');
  const mutation = `${source}\nimport runner = require('./reference-runner.js');\nvoid runner;\n`;
  assert.throws(
    () => assertStableEffectMachineClosure(coreSource, productionReader(new Map([[machine, mutation]]))),
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

test('production policy rejects core-evaluator edges to reference implementation modules', () => {
  const core = resolve(semantics, 'portable-core-evaluator.ts');
  const source = readFileSync(core, 'utf8');
  for (const moduleName of ['portable-reference-evaluator', 'portable-reference-body']) {
    const target = resolve(semantics, `${moduleName}.ts`);
    const mutation = `${source}\nimport './${moduleName}.js';\n`;
    assert.throws(
      () => assertPortableMachineEvaluatorClosure(
        coreSource,
        productionReader(new Map([
          [core, mutation],
          [target, 'export {};'],
        ])),
      ),
      new RegExp(`${moduleName}\\.ts is reachable`, 'u'),
    );
  }
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

test('unapproved bare specifiers fail closed instead of bypassing source closure resolution', () => {
  const sources = new Map([[entry, "import '#legacy-alias';"]]);
  assert.throws(
    () => assertRuntimeImportClosureExcludes([entry], [legacy], reader(sources)),
    /unapproved bare import #legacy-alias/u,
  );
});

test('production policy does not exempt peer dependencies from the runtime closure', () => {
  const core = resolve(semantics, 'portable-core-evaluator.ts');
  const source = readFileSync(core, 'utf8');
  const mutation = `${source}\nimport ts from 'typescript';\nvoid ts;\n`;
  assert.throws(
    () => assertPortableMachineEvaluatorClosure(coreSource, productionReader(new Map([[core, mutation]]))),
    /unapproved bare import typescript/u,
  );
});
