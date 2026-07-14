import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import {
  assertHandlerEnvelopeDirectClosure,
  EXECUTABLE_ENVELOPE_FORBIDDEN_SPECIFIERS,
  HANDLER_ENVELOPE_ADDITIONAL_FORBIDDEN_SPECIFIERS,
} from './runtime-envelope-import-closure.mjs';

const coreSource = resolve(process.cwd(), 'packages/core/src');
const syntheticCore = '/repo/core';
const syntheticEnvelope = resolve(syntheticCore, 'runtime-envelope');
const handler = resolve(syntheticEnvelope, 'handler-entry.ts');
const sourceHandler = resolve(syntheticEnvelope, 'source-handler.ts');

const forbiddenSpecifiers = [
  ...EXECUTABLE_ENVELOPE_FORBIDDEN_SPECIFIERS,
  ...HANDLER_ENVELOPE_ADDITIONAL_FORBIDDEN_SPECIFIERS,
];

function emittedPath(fromPath, specifier) {
  return resolve(dirname(fromPath), specifier).replace(/\.js$/u, '.ts');
}

function sources(handlerSource = 'export {};', source = 'export {};') {
  return new Map([
    [handler, handlerSource],
    [sourceHandler, source],
  ]);
}

function reader(entries) {
  return (path) => {
    if (!entries.has(path)) throw new Error(`missing synthetic source ${path}`);
    return entries.get(path);
  };
}

function mutatedRoot(root, rootSource, targetSource = 'export {};') {
  const entries = sources(root === handler ? rootSource : undefined, root === sourceHandler ? rootSource : undefined);
  return { entries, addTarget(specifier) { entries.set(emittedPath(root, specifier), targetSource); } };
}

test('production handler and source-handler roots satisfy the machine-only closure', () => {
  assert.ok(assertHandlerEnvelopeDirectClosure(coreSource).size > 0);
});

test('runtime-envelope checker invokes the handler/source closure policy', () => {
  const checker = readFileSync(resolve(process.cwd(), 'scripts/check-runtime-envelope.mjs'), 'utf8');
  assert.match(checker, /assertHandlerEnvelopeDirectClosure\(CORE_SOURCE\)/u);
});

test('both handler roots reject every compatibility, reference, legacy, and host owner', () => {
  for (const root of [handler, sourceHandler]) {
    for (const specifier of forbiddenSpecifiers) {
      const mutation = mutatedRoot(root, `import '${specifier}';`);
      mutation.addTarget(specifier);
      assert.throws(
        () => assertHandlerEnvelopeDirectClosure(syntheticCore, reader(mutation.entries)),
        /is reachable/u,
        `${root}: ${specifier}`,
      );
    }
  }
});

test('handler policy rejects transitive and runtime re-export bridges', () => {
  const bridge = resolve(syntheticEnvelope, 'bridge.ts');
  const targetSpecifier = '../ir/semantics/reference-runner.js';
  const target = emittedPath(bridge, targetSpecifier);
  for (const bridgeSource of [`import '${targetSpecifier}';`, `export { run } from '${targetSpecifier}';`]) {
    const entries = sources("import './bridge.js';");
    entries.set(bridge, bridgeSource);
    entries.set(target, 'export const run = () => {};');
    assert.throws(
      () => assertHandlerEnvelopeDirectClosure(syntheticCore, reader(entries)),
      /reference-runner\.ts is reachable/u,
    );
  }
});

test('handler policy rejects import-equals, dynamic import, and require edges', () => {
  const specifier = '../ir/semantics/reference-runner.js';
  const target = emittedPath(handler, specifier);
  const mutations = [
    `import runner = require('${specifier}'); void runner;`,
    `void import('${specifier}');`,
    `require('${specifier}');`,
  ];
  for (const source of mutations) {
    const entries = sources(source);
    entries.set(target, 'export {};');
    assert.throws(
      () => assertHandlerEnvelopeDirectClosure(syntheticCore, reader(entries)),
      /reference-runner\.ts is reachable/u,
    );
  }
  const nonLiteral = sources(`const path = '${specifier}'; void import(path);`);
  assert.throws(
    () => assertHandlerEnvelopeDirectClosure(syntheticCore, reader(nonLiteral)),
    /non-literal dynamic import/u,
  );
});

test('handler policy rejects own-package, bare-alias, and dependency bypasses', () => {
  for (const [source, pattern] of [
    ["import '@kernlang/core/runner';", /own-package import/u],
    ["import '#legacy-runner';", /unapproved bare import/u],
    ["import ts from 'typescript'; void ts;", /unapproved bare import typescript/u],
  ]) {
    assert.throws(() => assertHandlerEnvelopeDirectClosure(syntheticCore, reader(sources(source))), pattern);
  }
});

test('handler policy admits only its literal runtime dependency allowlist', () => {
  assert.equal(
    assertHandlerEnvelopeDirectClosure(
      syntheticCore,
      reader(sources("import Decimal from 'decimal.js'; void Decimal;")),
    ).size,
    2,
  );
});
