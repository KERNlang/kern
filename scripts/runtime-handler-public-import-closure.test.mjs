import assert from 'node:assert/strict';
import { dirname, relative, resolve } from 'node:path';
import { test } from 'node:test';
import {
  assertPublicHandlerAbiClosure,
  handlerEnvelopeForbiddenPaths,
} from './runtime-envelope-import-closure.mjs';

const coreSource = resolve(process.cwd(), 'packages/core/src');
const syntheticCore = '/repo/core';
const publicHandler = resolve(syntheticCore, 'runtime-handler.ts');

function specifier(fromPath, targetPath) {
  const path = relative(dirname(fromPath), targetPath).replace(/\.ts$/u, '.js');
  return path.startsWith('.') ? path : `./${path}`;
}

function reader(entries) {
  return (path) => {
    if (!entries.has(path)) throw new Error(`missing synthetic source ${path}`);
    return entries.get(path);
  };
}

test('production public handler ABI satisfies the machine-only closure', () => {
  assert.ok(assertPublicHandlerAbiClosure(coreSource).size > 0);
});

test('public handler ABI rejects every forbidden owner directly', () => {
  for (const target of handlerEnvelopeForbiddenPaths(syntheticCore)) {
    const importPath = specifier(publicHandler, target);
    const entries = new Map([
      [publicHandler, `import '${importPath}';`],
      [target, 'export {};'],
    ]);
    assert.throws(() => assertPublicHandlerAbiClosure(syntheticCore, reader(entries)), /is reachable/u, target);
  }
});

test('public handler ABI rejects transitive and re-export bridges', () => {
  const bridge = resolve(syntheticCore, 'runtime-handler-bridge.ts');
  const target = resolve(syntheticCore, 'runner.ts');
  for (const bridgeSource of ["import './runner.js';", "export { run } from './runner.js';"]) {
    const entries = new Map([
      [publicHandler, "import './runtime-handler-bridge.js';"],
      [bridge, bridgeSource],
      [target, 'export const run = () => {};'],
    ]);
    assert.throws(() => assertPublicHandlerAbiClosure(syntheticCore, reader(entries)), /runner\.ts is reachable/u);
  }
});

test('public handler ABI rejects own-package, bare alias, Node, and TypeScript bypasses', () => {
  for (const [source, pattern] of [
    ["import '@kernlang/core/runner';", /own-package import/u],
    ["import '#runtime';", /unapproved bare import/u],
    ["import 'node:fs';", /unapproved Node builtin node:fs/u],
    ["import 'typescript';", /unapproved bare import typescript/u],
  ]) {
    assert.throws(
      () => assertPublicHandlerAbiClosure(syntheticCore, reader(new Map([[publicHandler, source]]))),
      pattern,
    );
  }
});
