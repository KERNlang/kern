import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { assertCompileSuccess, compile, compilerOwner, projection } from './support.mjs';

const IMPORT = /\b(?:import|export)\s+(?!type\b)[\s\S]*?\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*['"](\.[^'"]+)['"]/gu;
const PACKAGE_IMPORT = /\b(?:import|export)\s+(?!type\b)[\s\S]*?\bfrom\s*['"](#[^'"]+)['"]|\bimport\s*['"](#[^'"]+)['"]/gu;
const FORBIDDEN_PATH = /(?:packages\/cli|scripts\/kern-5-r0-contracts|parser|reference-runner|runtime-kir\.js)/iu;
const SEMANTIC_FORBIDDEN_SOURCE = /(?:ReferenceRunner|executeKernKir|generateR0|kern\.[\w.-]*\.r0|\bJSON\.(?:parse|stringify)\s*\(|\beval\s*\(|\bFunction\s*\(|\bprocess\b|node:(?:fs|http|https|net|tls|child_process)|\brequire\s*\(|typescript|ts\.create|parseDocument|parseExpression)/iu;
const AUTHENTICATED_FORBIDDEN_SOURCE = /(?:ReferenceRunner|executeKernKir|generateR0|kern\.[\w.-]*\.r0|\beval\s*\(|\bFunction\s*\(|\bprocess\b|node:(?:http|https|net|tls|child_process)|typescript|ts\.create|parseDocument|parseExpression)/iu;
const FORBIDDEN_EMITTED = /(?:\bimport\s*(?:\(|['"]|[\w{*])|\brequire\s*\(|\beval\s*\(|\bFunction\s*\(|\bprocess\b|node:|\bJSON\.(?:parse|stringify)\b|ReferenceRunner|executeKernKir|kern\.[\w.-]*\.r0|generic.{0,40}dispatch|\b(?:dispatch|evaluate)\w*\s*\(\s*(?:kir|program|statement|expression)\b|\b(?:kir|program|statement|expression)\s*(?:\[|\.)\s*(?:kind|type|tag)\b|\bJSON\.stringify\s*\(\s*(?:kir|program|artifact|projection)\b)/iu;

function here(relative) {
  return resolve(fileURLToPath(new URL(relative, import.meta.url)));
}

function resolveRelative(from, specifier, source) {
  const target = resolve(dirname(from), specifier);
  if (existsSync(target)) return target;
  if (source && extname(target) === '.js' && existsSync(`${target.slice(0, -3)}.ts`)) return `${target.slice(0, -3)}.ts`;
  return undefined;
}

function closure(entry, source, forbiddenSource, boundaries = new Set()) {
  const visited = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    visited.add(file);
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, forbiddenSource, file);
    if (boundaries.has(file)) return;
    for (const match of text.matchAll(PACKAGE_IMPORT)) {
      assert.fail(`${file} has unresolved static package import ${match[1] ?? match[2]}; resolve it or use a relative edge`);
    }
    for (const match of text.matchAll(IMPORT)) {
      const dependency = resolveRelative(file, match[1] ?? match[2], source);
      assert.ok(dependency, `${file} has unresolved static relative import ${match[1] ?? match[2]}`);
      assert.doesNotMatch(dependency, FORBIDDEN_PATH, `${file} imports ${dependency}`);
      visit(dependency);
    }
  };
  visit(entry);
  return visited;
}

test('R2 semantic closure stops at the read-only auth facade; authenticated closure stays Core-only', async () => {
  const owner = await compilerOwner();
  const sourceFacade = here('../../packages/core/src/frontend-projection/verified-brand.ts');
  const builtFacade = here('../../packages/core/dist/frontend-projection/verified-brand.js');
  const semanticSource = closure(owner.sourcePath, true, SEMANTIC_FORBIDDEN_SOURCE, new Set([sourceFacade]));
  const semanticBuilt = closure(owner.builtPath, false, SEMANTIC_FORBIDDEN_SOURCE, new Set([builtFacade]));
  assert.ok(semanticSource.size >= 2, 'compiler must own lowering beyond its public facade');
  assert.equal(semanticSource.size, semanticBuilt.size, 'source and built semantic closure cardinality must agree');
  assert.ok([...semanticSource].every((file) => file.includes('/packages/core/src/')));
  assert.ok([...semanticBuilt].every((file) => file.includes('/packages/core/dist/')));
  assert.ok(!semanticSource.has(here('../../packages/core/src/frontend-projection.ts')));
  assert.ok(!semanticBuilt.has(here('../../packages/core/dist/frontend-projection.js')));
  const authenticatedSource = closure(owner.sourcePath, true, AUTHENTICATED_FORBIDDEN_SOURCE);
  const authenticatedBuilt = closure(owner.builtPath, false, AUTHENTICATED_FORBIDDEN_SOURCE);
  assert.ok(authenticatedSource.has(here('../../packages/core/src/frontend-projection.ts')));
  assert.ok(authenticatedBuilt.has(here('../../packages/core/dist/frontend-projection.js')));
  assert.ok([...authenticatedSource].every((file) => file.includes('/packages/core/src/')));
  assert.ok([...authenticatedBuilt].every((file) => file.includes('/packages/core/dist/')));
  const facade = await import(pathToFileURL(builtFacade).href);
  const issuer = await import(pathToFileURL(here('../../packages/core/dist/frontend-projection.js')).href);
  assert.deepEqual(Object.keys(facade), ['authenticateVerifiedProjection']);
  for (const namespace of [facade, issuer]) {
    assert.equal(Object.keys(namespace).some((name) => /(?:issue|mint|register).*projection/iu.test(name)), false);
  }
  const rt1 = here('../../packages/core/src/kir-runtime/execute.ts');
  assert.match(readFileSync(rt1, 'utf8'), /from\s+['"][^'"]*linked-kir-program[^'"]*['"]/u);
  assert.ok([...semanticSource].some((file) => /\/linked-kir-program\//u.test(file)));
});

test('emitted ESM has an empty import graph and no parser, runtime, host-JSON, dynamic-code, or generic-dispatch escape hatch', async () => {
  const output = assertCompileSuccess(await compile(await projection()));
  const text = new TextDecoder().decode(output.artifact.bytes);
  assert.doesNotMatch(text, FORBIDDEN_EMITTED);
  assert.doesNotMatch(text, /(?:packages\/cli|scripts\/kern-5-r0-contracts|typescript|ts\.create|parseDocument|parseExpression)/iu);
  assert.match(text, /Object\.create\(null\)/u, 'KERN records must be null-prototype records');
});
