import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { assertCompileSuccess, compile, compilerOwner, projection } from './support.mjs';

const IMPORT = /\b(?:import|export)\s+(?!type\b)[\s\S]*?\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*['"](\.[^'"]+)['"]/gu;
const FORBIDDEN_PATH = /(?:packages\/cli|scripts\/kern-5-r0-contracts|parser|reference-runner|runtime-kir\.js)/iu;
const FORBIDDEN_SOURCE = /(?:ReferenceRunner|executeKernKir|generateR0|kern\.[\w.-]*\.r0|\bJSON\.(?:parse|stringify)\b|\beval\s*\(|\bFunction\s*\(|\bprocess\b|node:(?:fs|http|https|net|tls|child_process)|\brequire\s*\(|typescript|ts\.create|parseDocument|parseExpression)/iu;
const FORBIDDEN_EMITTED = /(?:\bimport\s*(?:\(|['"]|[\w{*])|\brequire\s*\(|\beval\s*\(|\bFunction\s*\(|\bprocess\b|node:|\bJSON\.(?:parse|stringify)\b|ReferenceRunner|executeKernKir|kern\.[\w.-]*\.r0|generic.{0,40}dispatch|\b(?:dispatch|evaluate)\w*\s*\(\s*(?:kir|program|statement|expression)\b|\b(?:kir|program|statement|expression)\s*(?:\[|\.)\s*(?:kind|type|tag)\b|\bJSON\.stringify\s*\(\s*(?:kir|program|artifact|projection)\b)/iu;

function resolveRelative(from, specifier, source) {
  const target = resolve(dirname(from), specifier);
  if (existsSync(target)) return target;
  if (source && extname(target) === '.js' && existsSync(`${target.slice(0, -3)}.ts`)) return `${target.slice(0, -3)}.ts`;
  return undefined;
}

function closure(entry, source, boundaries = new Set()) {
  const visited = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    visited.add(file);
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, FORBIDDEN_SOURCE, file);
    if (boundaries.has(file)) return;
    for (const match of text.matchAll(IMPORT)) {
      const dependency = resolveRelative(file, match[1] ?? match[2], source);
      if (!dependency) continue;
      assert.doesNotMatch(dependency, FORBIDDEN_PATH, `${file} imports ${dependency}`);
      visit(dependency);
    }
  };
  visit(entry);
  return visited;
}

test('R2 semantic closure stops at the read-only auth facade; authenticated closure stays Core-only', async () => {
  const owner = await compilerOwner();
  const sourceFacade = resolve(new URL('../../packages/core/src/frontend-projection/verified-brand.ts', import.meta.url).pathname);
  const builtFacade = resolve(new URL('../../packages/core/dist/frontend-projection/verified-brand.js', import.meta.url).pathname);
  const semanticSource = closure(owner.sourcePath, true, new Set([sourceFacade]));
  const semanticBuilt = closure(owner.builtPath, false, new Set([builtFacade]));
  assert.ok(semanticSource.size >= 2, 'compiler must own lowering beyond its public facade');
  assert.equal(semanticSource.size, semanticBuilt.size, 'source and built semantic closure cardinality must agree');
  assert.ok([...semanticSource].every((file) => file.includes('/packages/core/src/')));
  assert.ok([...semanticBuilt].every((file) => file.includes('/packages/core/dist/')));
  assert.ok(!semanticSource.has(resolve(new URL('../../packages/core/src/frontend-projection.ts', import.meta.url).pathname)));
  assert.ok(!semanticBuilt.has(resolve(new URL('../../packages/core/dist/frontend-projection.js', import.meta.url).pathname)));
  const authenticatedSource = closure(owner.sourcePath, true);
  const authenticatedBuilt = closure(owner.builtPath, false);
  assert.ok(authenticatedSource.has(resolve(new URL('../../packages/core/src/frontend-projection.ts', import.meta.url).pathname)));
  assert.ok(authenticatedBuilt.has(resolve(new URL('../../packages/core/dist/frontend-projection.js', import.meta.url).pathname)));
  assert.ok([...authenticatedSource].every((file) => file.includes('/packages/core/src/')));
  assert.ok([...authenticatedBuilt].every((file) => file.includes('/packages/core/dist/')));
  const facade = await import(pathToFileURL(builtFacade).href);
  const issuer = await import(pathToFileURL(resolve(new URL('../../packages/core/dist/frontend-projection.js', import.meta.url).pathname)).href);
  assert.deepEqual(Object.keys(facade), ['authenticateVerifiedProjection']);
  for (const namespace of [facade, issuer]) {
    assert.equal(Object.keys(namespace).some((name) => /(?:issue|mint|register).*projection/iu.test(name)), false);
  }
  const rt1 = resolve(new URL('../../packages/core/src/kir-runtime/execute.ts', import.meta.url).pathname);
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
