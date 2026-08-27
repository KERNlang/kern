import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertCompileSuccess, compile, compilerOwner, nativeExecute, projection, runtimeRequest } from './support.mjs';

const IMPORT = /\b(?:import|export)\s+(?!type\b)[\s\S]*?\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*['"](\.[^'"]+)['"]/gu;
const PACKAGE_IMPORT = /\b(?:import|export)\s+(?!type\b)[\s\S]*?\bfrom\s*['"](#[^'"]+)['"]|\bimport\s*['"](#[^'"]+)['"]/gu;
const FORBIDDEN_PATH = /(?:packages\/cli|packages\/python|packages\/review|scripts\/kern-5-r0-contracts|closure-python-lowering|compiler\/kir-js-esm|parser|reference-runner|runtime-kir\.js)/iu;
const FORBIDDEN_SOURCE = /(?:ReferenceRunner|executeKernKir|generateR0|kern\.[\w.-]*\.r0|\beval\s*\(|\bFunction\s*\(|\bprocess\b|node:(?:http|https|net|tls|child_process)|typescript|ts\.create|parseDocument|parseExpression|closurePython|codegenPython)/iu;
const STANDARD_LIBRARY = new Set([
  'asyncio', 'dataclasses', 'decimal', 'hashlib', 'math', 're', 'time', 'typing', 'unicodedata',
]);
const FORBIDDEN_EMITTED = /(?:\b(?:eval|exec|input|print)\s*\(|(?<!\.)\bcompile\s*\(|\bJSON\b|json\.(?:loads|dumps)|sys\.(?:stdin|stdout|stderr)|subprocess|importlib|pathlib|site-packages|node_modules|@kernlang|packages\/|scripts\/|ReferenceRunner|executeKernKir|generateR0|kern\.[\w.-]*\.r0|generic.{0,40}(?:dispatch|interpret)|(?:dispatch|evaluate)\w*\s*\(\s*(?:kir|program|statement|expression)|(?:kir|program|statement|expression)\s*(?:\[|\.)\s*['"]?(?:kind|type|tag))/iu;

function here(relative) {
  return resolve(fileURLToPath(new URL(relative, import.meta.url)));
}

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
    for (const match of text.matchAll(PACKAGE_IMPORT)) {
      assert.fail(`${file} has unresolved static package import ${match[1] ?? match[2]}`);
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

function pythonImports(text) {
  const modules = [];
  for (const line of text.split('\n')) {
    const from = /^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+/u.exec(line);
    const imported = /^\s*import\s+(.+)$/u.exec(line);
    if (from) modules.push(from[1].split('.')[0]);
    if (imported) {
      for (const item of imported[1].split(',')) modules.push(item.trim().split(/[.\s]/u)[0]);
    }
  }
  return modules;
}

test('Python compiler closure stays Core-owned and cannot reach parser, R0, legacy Python, JS target, or runtime execution', async () => {
  const owner = await compilerOwner();
  const sourceFacade = here('../../packages/core/src/frontend-projection/verified-brand.ts');
  const builtFacade = here('../../packages/core/dist/frontend-projection/verified-brand.js');
  const sourceFiles = closure(owner.sourcePath, true, new Set([sourceFacade]));
  const builtFiles = closure(owner.builtPath, false, new Set([builtFacade]));
  assert.ok(sourceFiles.size >= 2, 'compiler must own lowering beyond a stub facade');
  assert.equal(sourceFiles.size, builtFiles.size, 'source and built closure cardinality must agree');
  assert.ok([...sourceFiles].every((file) => file.includes('/packages/core/src/')));
  assert.ok([...builtFiles].every((file) => file.includes('/packages/core/dist/')));
  assert.ok([...sourceFiles].some((file) => /\/linked-kir-program\//u.test(file)));
  assert.ok(!sourceFiles.has(here('../../packages/core/src/frontend-projection.ts')));
  assert.ok(!builtFiles.has(here('../../packages/core/dist/frontend-projection.js')));
});

test('entry.py has only standard-library imports and no stdio, host JSON, generic interpreter, parser, or repository fallback', async () => {
  const result = assertCompileSuccess(await compile(await projection()));
  const text = new TextDecoder().decode(result.artifact.bytes);
  assert.match(text, /async\s+def\s+execute\s*\(\s*input\s*,\s*execution_options\s*=\s*None\s*\)/u);
  assert.doesNotMatch(text, FORBIDDEN_EMITTED);
  const imports = pythonImports(text);
  assert.equal(imports.every((name) => STANDARD_LIBRARY.has(name)), true, `non-standard import: ${imports.join(', ')}`);
  const output = await nativeExecute(result.artifact.bytes, {
    runs: [{ request: runtimeRequest('closure', '{"ok":true}', []), reply: 'reply' }],
  });
  assert.equal(output.results[0].outcome, 'success');
});

test('entry.py parses numbers with a position-based compiled regex and no remaining-source copy', async () => {
  const result = assertCompileSuccess(await compile(await projection()));
  const text = new TextDecoder().decode(result.artifact.bytes);
  assert.match(text, /_NUMBER\s*=\s*re\.compile\(/u);
  assert.match(text, /_NUMBER\.match\(self\.source, self\.index\)/u);
  assert.doesNotMatch(text, /self\.source\[self\.index:\]/u);
});
