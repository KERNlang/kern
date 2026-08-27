import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FORBIDDEN_PATH = /(?:parser|runtime-inflate|reference-runner|source-handler|source-runner|legacy|compat|scripts)/iu;
const FORBIDDEN_SOURCE = /(?:parseExpression|parseDocument|ReferenceRunner|\bimport\s*\(|\beval\s*\(|\bFunction\s*\()/u;
const IMPORT = /\b(?:import|export)\s+(?!type\b)[\s\S]*?\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*['"](\.[^'"]+)['"]/gu;

function resolveRelative(from, specifier, source) {
  const target = resolve(dirname(from), specifier);
  if (existsSync(target)) return target;
  if (source && extname(target) === '.js') {
    const typed = `${target.slice(0, -3)}.ts`;
    if (existsSync(typed)) return typed;
  }
  return undefined;
}

function closure(entry, source, traversalBoundaries = new Set()) {
  const visited = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    visited.add(file);
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, FORBIDDEN_SOURCE, file);
    if (traversalBoundaries.has(file)) return;
    for (const match of content.matchAll(IMPORT)) {
      const dependency = resolveRelative(file, match[1] ?? match[2], source);
      if (dependency === undefined) continue;
      assert.doesNotMatch(dependency, FORBIDDEN_PATH, `${file} imports ${dependency}`);
      visit(dependency);
    }
  };
  visit(entry);
  return visited;
}

test('source and built runtime/KIR closures stay parser-, inflater-, runner-, adapter-, and dynamic-code-free', () => {
  const sourceEntry = resolve(ROOT, 'packages/core/src/runtime-kir.ts');
  const builtEntry = resolve(ROOT, 'packages/core/dist/runtime-kir.js');
  const sourceFacade = resolve(ROOT, 'packages/core/src/frontend-projection/verified-brand.ts');
  const builtFacade = resolve(ROOT, 'packages/core/dist/frontend-projection/verified-brand.js');
  const semanticSource = closure(sourceEntry, true, new Set([sourceFacade]));
  const semanticBuilt = closure(builtEntry, false, new Set([builtFacade]));
  assert.ok(semanticSource.size >= 9, 'semantic traversal must reach the production evaluator closure');
  assert.equal(semanticSource.size, semanticBuilt.size, 'built and source semantic closure cardinality must agree');
  assert.ok(!semanticSource.has(resolve(ROOT, 'packages/core/src/frontend-projection.ts')));
  assert.ok(!semanticBuilt.has(resolve(ROOT, 'packages/core/dist/frontend-projection.js')));

  const authenticatedSource = closure(sourceEntry, true);
  const authenticatedBuilt = closure(builtEntry, false);
  assert.ok(authenticatedSource.has(resolve(ROOT, 'packages/core/src/frontend-projection.ts')));
  assert.ok(authenticatedBuilt.has(resolve(ROOT, 'packages/core/dist/frontend-projection.js')));
  assert.equal(
    authenticatedSource.size,
    authenticatedBuilt.size + 1,
    'source closure has exactly one conservatively followed type-only edge',
  );
  assert.ok(authenticatedSource.has(resolve(ROOT, 'packages/core/src/canonical-value/types.ts')));
  assert.ok([...authenticatedSource].every((file) => file.includes('/packages/core/src/')));
  assert.ok([...authenticatedBuilt].every((file) => file.includes('/packages/core/dist/')));
});

test('direct-file imports expose authentication but no projection issuer or registrar', async () => {
  const facade = await import(pathToFileURL(resolve(ROOT, 'packages/core/dist/frontend-projection/verified-brand.js')).href);
  const producer = await import(pathToFileURL(resolve(ROOT, 'packages/core/dist/frontend-projection.js')).href);
  assert.deepEqual(Object.keys(facade), ['authenticateVerifiedProjection']);
  for (const namespace of [facade, producer]) {
    assert.equal(
      Object.keys(namespace).some((name) => /(?:issue|mint|register).*projection/iu.test(name)),
      false,
    );
  }
});
